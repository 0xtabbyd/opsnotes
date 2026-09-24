#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpsNotes - Backend API Server
FastAPI server providing REST APIs for snippets, markdown notes, FTS5 search, variables, and automated backups.
"""

import os
import sys
import json
import logging
import logging.handlers
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import database
import similarity

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
STYLES_DIR = os.path.join(BASE_DIR, "styles")

logger = logging.getLogger("opsnotes")

def env_flag(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").strip().lower() in ("1", "true", "yes", "on")

# 常駐（サービス・コンテナ）と開発のどちらでも同じコードを使えるよう外から設定する。
# コンテナ内では 0.0.0.0 でないと外から到達できないため HOST を上書きする。
HOST = os.environ.get("OPSNOTES_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPSNOTES_PORT", "8420"))
# 自動リロードはファイル監視の子プロセスを常駐させるため、既定では無効にする
RELOAD = env_flag("OPSNOTES_RELOAD", False)
LOG_FILE = os.environ.get("OPSNOTES_LOG_FILE", "").strip()

def configure_file_logging(log_file: str):
    """ログをファイルへ出力する。

    コンソールを持たない起動方法（Windowsのpythonw.exe、サービス実行など）では
    uvicorn既定のログ設定が sys.stderr を掴めず起動時に例外で落ちる。
    ルートロガーを差し替えたうえで uvicorn には log_config=None を渡すことで回避する。
    """
    log_dir = os.path.dirname(os.path.abspath(log_file))
    os.makedirs(log_dir, exist_ok=True)

    handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-8s [%(name)s] %(message)s"))

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for existing in root.handlers[:]:
        root.removeHandler(existing)
    root.addHandler(handler)

    # uvicorn は自前のハンドラを持つため、ルートへ流し直す
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

def sanitize_tags(tags_input) -> List[str]:
    """タグの先頭の # や空白を除去し、重複を排除してクリーンなリストにする"""
    if not tags_input:
        return []
    if isinstance(tags_input, str):
        tags_input = [t.strip() for t in tags_input.replace("、", ",").split(",") if t.strip()]
    cleaned = []
    for t in tags_input:
        if not t:
            continue
        c = str(t).strip().lstrip("#").strip()
        if c and c not in cleaned:
            cleaned.append(c)
    return cleaned

TAGS_NORMALIZED_FLAG = "tags_normalized_v1"

def cleanup_existing_tags():
    """DB内の既存タグの # や余分な空白を除去して正規化（移行済みならスキップ）"""
    if database.get_setting(TAGS_NORMALIZED_FLAG) == "1":
        return

    with database.get_connection() as conn:
        cursor = conn.cursor()
        for table in ("snippets", "notes"):
            cursor.execute(f"SELECT id, tags FROM {table}")
            for row_id, tags_raw in cursor.fetchall():
                try:
                    t_list = json.loads(tags_raw) if tags_raw else []
                except Exception:
                    t_list = [tags_raw] if tags_raw else []
                cleaned_json = json.dumps(sanitize_tags(t_list))
                # 変化がない行までUPDATEするとFTS5同期トリガーが無駄に発火する
                if cleaned_json != tags_raw:
                    cursor.execute(f"UPDATE {table} SET tags = ? WHERE id = ?", (cleaned_json, row_id))
        conn.commit()

    database.set_setting(TAGS_NORMALIZED_FLAG, "1")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 起動処理
    database.init_db()
    cleanup_existing_tags()
    backup_file = database.create_startup_backup()
    if backup_file:
        logger.info("Database initialized. Startup backup created: %s", backup_file)
    else:
        logger.info("Database initialized. Startup backup skipped (recent backup exists).")
    yield
    logger.info("Server shutting down.")

app = FastAPI(
    title="OpsNotes",
    description="Homelab Notes, Command Knowledge & Snippet Management System",
    version="1.0.0",
    lifespan=lifespan
)

# CORS設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# Snippets API
# ==========================================

@app.get("/api/snippets")
async def get_snippets(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    favorite: Optional[int] = None,
    sort: str = "pinned_updated"
):
    """スニペット一覧取得"""
    with database.get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM snippets WHERE 1=1"
        params = []

        if category and category != "all":
            query += " AND category = ?"
            params.append(category)

        if favorite is not None and favorite == 1:
            query += " AND favorite = 1"

        if sort == "pinned_updated":
            query += " ORDER BY pinned DESC, updated_at DESC"
        elif sort == "copies":
            query += " ORDER BY copy_count DESC"
        else:
            query += " ORDER BY id DESC"

        cursor.execute(query, params)
        rows = [dict(r) for r in cursor.fetchall()]

        # JSONタグのパース
        results = []
        for r in rows:
            try:
                r["tags"] = json.loads(r["tags"])
            except Exception:
                r["tags"] = []
            results.append(r)

        if tag:
            norm_tag = tag.strip().lstrip("#").strip().lower()
            results = [r for r in results if any(t.lower() == norm_tag for t in r["tags"])]

        return results

@app.get("/api/snippets/{snippet_id}")
async def get_snippet(snippet_id: int):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Snippet not found")
        item = dict(row)
        try:
            item["tags"] = json.loads(item["tags"])
        except Exception:
            item["tags"] = []
        return item

@app.post("/api/snippets")
async def create_snippet(payload: Dict[str, Any]):
    title = payload.get("title", "").strip()
    command = payload.get("command", "").strip()
    if not title or not command:
        raise HTTPException(status_code=400, detail="Title and command are required")

    description = payload.get("description", "").strip()
    language = payload.get("language", "bash").strip()
    category = payload.get("category", "General").strip() or "General"
    tags = sanitize_tags(payload.get("tags", []))
    tags_json = json.dumps(tags)
    favorite = 1 if payload.get("favorite") else 0
    pinned = 1 if payload.get("pinned") else 0

    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO snippets (title, description, command, language, category, tags, favorite, pinned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (title, description, command, language, category, tags_json, favorite, pinned))
        conn.commit()
        new_id = cursor.lastrowid

    return {"status": "ok", "id": new_id, "message": "Snippet created successfully"}

@app.put("/api/snippets/{snippet_id}")
async def update_snippet(snippet_id: int, payload: Dict[str, Any]):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM snippets WHERE id = ?", (snippet_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Snippet not found")

        title = payload.get("title", "").strip()
        command = payload.get("command", "").strip()
        if not title or not command:
            raise HTTPException(status_code=400, detail="Title and command are required")

        description = payload.get("description", "").strip()
        language = payload.get("language", "bash").strip()
        category = payload.get("category", "General").strip() or "General"
        tags = sanitize_tags(payload.get("tags", []))
        tags_json = json.dumps(tags)
        favorite = 1 if payload.get("favorite") else 0
        pinned = 1 if payload.get("pinned") else 0

        cursor.execute("""
        UPDATE snippets
        SET title = ?, description = ?, command = ?, language = ?, category = ?, tags = ?,
            favorite = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (title, description, command, language, category, tags_json, favorite, pinned, snippet_id))
        conn.commit()

    return {"status": "ok", "message": "Snippet updated"}

@app.delete("/api/snippets/{snippet_id}")
async def delete_snippet(snippet_id: int):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
        conn.commit()
    return {"status": "ok", "message": "Snippet deleted"}

@app.post("/api/snippets/{snippet_id}/copy")
async def record_snippet_copy(snippet_id: int):
    """クリップボードコピー時のカウントアップ"""
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE snippets SET copy_count = copy_count + 1 WHERE id = ?", (snippet_id,))
        conn.commit()
    return {"status": "ok"}

# ==========================================
# Notes API
# ==========================================

@app.get("/api/notes")
async def get_notes(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    favorite: Optional[int] = None
):
    """メモ一覧取得"""
    with database.get_connection() as conn:
        cursor = conn.cursor()
        query = "SELECT id, title, category, tags, favorite, pinned, created_at, updated_at, SUBSTR(content, 1, 150) as summary FROM notes WHERE 1=1"
        params = []

        if category and category != "all":
            query += " AND category = ?"
            params.append(category)

        if favorite is not None and favorite == 1:
            query += " AND favorite = 1"

        query += " ORDER BY pinned DESC, created_at DESC, id DESC"
        cursor.execute(query, params)
        rows = [dict(r) for r in cursor.fetchall()]

        results = []
        for r in rows:
            try:
                r["tags"] = json.loads(r["tags"])
            except Exception:
                r["tags"] = []
            results.append(r)

        if tag:
            norm_tag = tag.strip().lstrip("#").strip().lower()
            results = [r for r in results if any(t.lower() == norm_tag for t in r["tags"])]

        return results

@app.get("/api/notes/{note_id}")
async def get_note(note_id: int):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM notes WHERE id = ?", (note_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
        item = dict(row)
        try:
            item["tags"] = json.loads(item["tags"])
        except Exception:
            item["tags"] = []
        return item

@app.post("/api/notes")
async def create_note(payload: Dict[str, Any]):
    title = payload.get("title", "").strip() or "無題のメモ"
    content = payload.get("content", "")
    category = payload.get("category", "General").strip() or "General"
    tags = sanitize_tags(payload.get("tags", []))
    tags_json = json.dumps(tags)
    favorite = 1 if payload.get("favorite") else 0
    pinned = 1 if payload.get("pinned") else 0

    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO notes (title, content, category, tags, favorite, pinned)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (title, content, category, tags_json, favorite, pinned))
        conn.commit()
        new_id = cursor.lastrowid

    return {"status": "ok", "id": new_id, "message": "Note created"}

@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, payload: Dict[str, Any]):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM notes WHERE id = ?", (note_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Note not found")

        title = payload.get("title", "").strip() or "無題のメモ"
        content = payload.get("content", "")
        category = payload.get("category", "General").strip() or "General"
        tags = sanitize_tags(payload.get("tags", []))
        tags_json = json.dumps(tags)
        favorite = 1 if payload.get("favorite") else 0
        pinned = 1 if payload.get("pinned") else 0

        cursor.execute("""
        UPDATE notes
        SET title = ?, content = ?, category = ?, tags = ?,
            favorite = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (title, content, category, tags_json, favorite, pinned, note_id))
        conn.commit()

    return {"status": "ok", "message": "Note updated"}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        conn.commit()
    return {"status": "ok", "message": "Note deleted"}

@app.get("/api/notes/{note_id}/related")
async def get_related_notes(note_id: int, limit: int = 3):
    """TF-IDFに基づき対象ノートと類似度が高いメモ上位N件を取得"""
    with database.get_connection() as conn:
        cursor = conn.cursor()
        # メモ集合の変化を安価に検出し、変化がなければTF-IDF再計算も全文取得も省く
        cursor.execute(
            "SELECT COUNT(*), COALESCE(MAX(id), 0), COALESCE(MAX(updated_at), '') FROM notes"
        )
        corpus_key = tuple(cursor.fetchone())

        if not similarity.is_corpus_cached(corpus_key):
            cursor.execute("SELECT id, title, category, tags, content FROM notes")
            rows = [dict(r) for r in cursor.fetchall()]
            for r in rows:
                try:
                    r["tags"] = json.loads(r["tags"])
                except Exception:
                    r["tags"] = []
            similarity.build_corpus(corpus_key, rows)

    return similarity.find_related_notes(note_id, top_k=limit)

# ==========================================
# Variables API
# ==========================================

@app.get("/api/variables")
async def get_variables():
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM variables ORDER BY name ASC")
        return [dict(r) for r in cursor.fetchall()]

@app.post("/api/variables")
async def set_variable(payload: Dict[str, Any]):
    name = payload.get("name", "").strip().upper()
    default_value = payload.get("default_value", "").strip()
    description = payload.get("description", "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Variable name is required")

    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO variables (name, default_value, description)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            default_value = excluded.default_value,
            description = excluded.description
        """, (name, default_value, description))
        conn.commit()

    return {"status": "ok", "message": f"Variable '{name}' updated"}

@app.delete("/api/variables/{name}")
async def delete_variable(name: str):
    with database.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM variables WHERE name = ?", (name.upper(),))
        conn.commit()
    return {"status": "ok"}

# ==========================================
# Search & Meta API
# ==========================================

@app.get("/api/search")
async def search(q: str):
    return database.search_all(q)

@app.get("/api/health")
async def health_check():
    """常駐監視用の軽量ヘルスチェック。

    プロセスが生きていてもDBに到達できない状態を検知するため、
    応答を返すだけでなく実際にクエリを1本通す。
    ウォッチドッグから頻繁に叩かれるので集計は行わない。
    """
    try:
        with database.get_connection() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"database unavailable: {e}")
    return {"status": "ok"}

@app.get("/api/meta")
async def get_meta():
    """サイドバー用のカテゴリ一覧・全タグ・集計メトリクスを取得"""
    with database.get_connection() as conn:
        cursor = conn.cursor()

        # スニペットとノートからカテゴリ集計
        cursor.execute("SELECT category, COUNT(*) as cnt FROM snippets GROUP BY category")
        s_cats = {r["category"]: r["cnt"] for r in cursor.fetchall()}

        cursor.execute("SELECT category, COUNT(*) as cnt FROM notes GROUP BY category")
        n_cats = {r["category"]: r["cnt"] for r in cursor.fetchall()}

        all_cats = set(list(s_cats.keys()) + list(n_cats.keys()))
        categories = []
        for c in sorted(all_cats):
            categories.append({
                "name": c,
                "snippet_count": s_cats.get(c, 0),
                "note_count": n_cats.get(c, 0)
            })

        # タグの抽出
        cursor.execute("SELECT tags FROM snippets UNION ALL SELECT tags FROM notes")
        tag_counts: Dict[str, int] = {}
        for r in cursor.fetchall():
            try:
                t_list = json.loads(r["tags"])
                for t in t_list:
                    c = str(t).strip().lstrip("#").strip()
                    if c:
                        tag_counts[c] = tag_counts.get(c, 0) + 1
            except Exception:
                pass

        tags = sorted([{"name": k, "count": v} for k, v in tag_counts.items()], key=lambda x: x["count"], reverse=True)

        # 全体メトリクス
        cursor.execute("SELECT COUNT(*), COALESCE(SUM(copy_count), 0) FROM snippets")
        s_total, copy_total = cursor.fetchone()

        cursor.execute("SELECT COUNT(*) FROM notes")
        n_total = cursor.fetchone()[0]

        return {
            "categories": categories,
            "tags": tags,
            "metrics": {
                "snippets_count": s_total,
                "notes_count": n_total,
                "copies_count": copy_total
            }
        }

# ==========================================
# Backup & Export/Import API
# ==========================================

@app.get("/api/backups")
async def get_backups():
    return database.list_backups()

@app.post("/api/backups")
async def create_backup():
    filename = database.create_backup()
    return {"status": "ok", "filename": filename, "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

@app.get("/api/backups/settings")
async def get_backup_settings():
    """バックアップ保持世代数の設定を取得"""
    return {"max_generations": database.get_backup_max_generations()}

@app.post("/api/backups/settings")
async def update_backup_settings(payload: Dict[str, Any]):
    """バックアップ保持世代数の設定を更新"""
    val = payload.get("max_generations", 20)
    saved = database.set_backup_max_generations(val)
    return {"status": "ok", "max_generations": saved}

@app.post("/api/backups/{filename}/rollback")
async def rollback_backup(filename: str):
    """指定されたバックアップからDBをロールバック（復元）"""
    try:
        res = database.rollback_backup(filename)
        # DBが総入れ替えされるため、集計キーが偶然一致してもキャッシュを残さない
        similarity.invalidate_corpus()
        return res
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Backup file not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rollback failed: {str(e)}")

@app.get("/api/export")
async def export_data():
    return database.export_all_data()

@app.post("/api/import")
async def import_data(payload: Dict[str, Any]):
    """JSONバックアップからデータを復元・追加"""
    snippets = payload.get("snippets", [])
    notes = payload.get("notes", [])
    variables = payload.get("variables", [])

    imported_snippets = 0
    imported_notes = 0

    with database.get_connection() as conn:
        cursor = conn.cursor()

        for s in snippets:
            tags = json.dumps(s.get("tags", [])) if isinstance(s.get("tags"), list) else s.get("tags", "[]")
            cursor.execute("""
            INSERT INTO snippets (title, description, command, language, category, tags, favorite, pinned, copy_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                s.get("title", "Imported"),
                s.get("description", ""),
                s.get("command", ""),
                s.get("language", "bash"),
                s.get("category", "General"),
                tags,
                s.get("favorite", 0),
                s.get("pinned", 0),
                s.get("copy_count", 0)
            ))
            imported_snippets += 1

        for n in notes:
            tags = json.dumps(n.get("tags", [])) if isinstance(n.get("tags"), list) else n.get("tags", "[]")
            cursor.execute("""
            INSERT INTO notes (title, content, category, tags, favorite, pinned)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                n.get("title", "Imported Note"),
                n.get("content", ""),
                n.get("category", "General"),
                tags,
                n.get("favorite", 0),
                n.get("pinned", 0)
            ))
            imported_notes += 1

        for v in variables:
            name = v.get("name")
            val = v.get("default_value")
            desc = v.get("description", "")
            if name and val:
                cursor.execute("""
                INSERT OR REPLACE INTO variables (name, default_value, description)
                VALUES (?, ?, ?)
                """, (name, val, desc))

        conn.commit()

    similarity.invalidate_corpus()

    return {
        "status": "ok",
        "imported_snippets": imported_snippets,
        "imported_notes": imported_notes
    }

# ==========================================
# Static Files & SPA Fallback
# ==========================================

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(STYLES_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/styles", StaticFiles(directory=STYLES_DIR), name="styles")

@app.get("/api/preview-styles")
async def get_preview_styles():
    """stylesフォルダ内のカスタムCSSテーマ一覧を取得"""
    os.makedirs(STYLES_DIR, exist_ok=True)
    themes = [
        {"id": "default", "name": "デフォルト (テーマ連動)", "url": ""}
    ]
    
    # 既知のテーマ名の親切な表示名マッピング
    PRESET_NAMES = {
        "dark-terminal": "Dark Terminal (CRT緑)",
        "minimal": "Minimalist (洗練白黒)",
        "kawaii": "Kawaii Pop (パステルピンク)"
    }
    
    for f in sorted(os.listdir(STYLES_DIR)):
        if f.endswith(".css"):
            theme_id = f[:-4]
            name = PRESET_NAMES.get(theme_id, theme_id.replace("-", " ").replace("_", " ").title())
            themes.append({
                "id": theme_id,
                "name": name,
                "url": f"/styles/{f}"
            })
    return themes

@app.get("/")
async def root():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse({"message": "OpsNotes server is running. Web UI not found in static/"})

if __name__ == "__main__":
    run_kwargs: Dict[str, Any] = {"host": HOST, "port": PORT, "reload": RELOAD}
    if LOG_FILE:
        configure_file_logging(LOG_FILE)
        # 既定のログ設定は sys.stderr を前提とするため、ファイル出力時は組み立てさせない
        run_kwargs["log_config"] = None
    # reload はアプリをインポート文字列で渡す必要がある
    uvicorn.run("server:app" if RELOAD else app, **run_kwargs)
