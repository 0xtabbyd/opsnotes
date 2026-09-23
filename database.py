#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HomeOps - Database Management Module
SQLite with WAL mode, FTS5 full-text search, and automated backups.
"""

import os
import sqlite3
import json
from contextlib import contextmanager
from datetime import datetime
from typing import List, Dict, Any, Iterator, Optional, Tuple

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
DB_PATH = os.path.join(DATA_DIR, "homeops.db")

# 通常の世代バックアップ（homeops_ は v0.1/v0.2 時代の旧プレフィックス）
BACKUP_PREFIXES = ("opsnotes_backup_", "homeops_backup_")
# ロールバック直前に自動退避されるバックアップ
PREROLLBACK_PREFIXES = ("opsnotes_prerollback_",)

@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """成功時コミット・失敗時ロールバックし、必ず接続を閉じる"""
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init_db():
    """データベースの初期化、テーブル作成、FTS5仮想テーブル構築、サンプルデータ投入"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    with get_connection() as conn:
        cursor = conn.cursor()

        # 1. スニペットテーブル
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS snippets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            command TEXT NOT NULL,
            language TEXT DEFAULT 'bash',
            category TEXT DEFAULT 'General',
            tags TEXT DEFAULT '[]',
            favorite INTEGER DEFAULT 0,
            pinned INTEGER DEFAULT 0,
            copy_count INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 2. メモテーブル
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            tags TEXT DEFAULT '[]',
            favorite INTEGER DEFAULT 0,
            pinned INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """)

        # 3. FTS5 全文検索テーブル
        cursor.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
            item_type,
            item_id UNINDEXED,
            title,
            content,
            tags,
            tokenize = 'unicode61'
        )
        """)

        # 4. 変数プリセットテーブル
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS variables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            default_value TEXT NOT NULL,
            description TEXT
        )
        """)

        # 5. アプリケーション設定テーブル
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """)

        # 5. FTS5同期トリガー
        # Snippets triggers
        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_snippets_ai AFTER INSERT ON snippets BEGIN
            INSERT INTO search_fts(item_type, item_id, title, content, tags)
            VALUES ('snippet', new.id, new.title, new.command || ' ' || COALESCE(new.description, ''), new.tags);
        END;
        """)

        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_snippets_ad AFTER DELETE ON snippets BEGIN
            DELETE FROM search_fts WHERE item_type = 'snippet' AND item_id = old.id;
        END;
        """)

        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_snippets_au AFTER UPDATE ON snippets BEGIN
            DELETE FROM search_fts WHERE item_type = 'snippet' AND item_id = old.id;
            INSERT INTO search_fts(item_type, item_id, title, content, tags)
            VALUES ('snippet', new.id, new.title, new.command || ' ' || COALESCE(new.description, ''), new.tags);
        END;
        """)

        # Notes triggers
        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_notes_ai AFTER INSERT ON notes BEGIN
            INSERT INTO search_fts(item_type, item_id, title, content, tags)
            VALUES ('note', new.id, new.title, new.content, new.tags);
        END;
        """)

        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_notes_ad AFTER DELETE ON notes BEGIN
            DELETE FROM search_fts WHERE item_type = 'note' AND item_id = old.id;
        END;
        """)

        cursor.execute("""
        CREATE TRIGGER IF NOT EXISTS trg_notes_au AFTER UPDATE ON notes BEGIN
            DELETE FROM search_fts WHERE item_type = 'note' AND item_id = old.id;
            INSERT INTO search_fts(item_type, item_id, title, content, tags)
            VALUES ('note', new.id, new.title, new.content, new.tags);
        END;
        """)

        # 初回起動時のサンプルデータ投入
        cursor.execute("SELECT COUNT(*) FROM snippets")
        if cursor.fetchone()[0] == 0:
            seed_sample_data(cursor)

        conn.commit()

def seed_sample_data(cursor: sqlite3.Cursor):
    """ホームラボで実用的な初期サンプルデータを登録"""
    sample_snippets = [
        (
            "Docker コンテナ ログ確認 (リアルタイム・直近100行)",
            "指定したコンテナのログを末尾100行からフォロー表示します",
            "docker logs -f --tail 100 {{CONTAINER_NAME}}",
            "bash",
            "Docker",
            json.dumps(["docker", "troubleshooting", "logs"]),
            1, 1
        ),
        (
            "Docker Compose 一括再起動 & ログ確認",
            "compose定義をバックグラウンド再ビルド起動し、ログを追跡します",
            "docker compose down && docker compose up -d --build && docker compose logs -f",
            "bash",
            "Docker",
            json.dumps(["docker", "compose", "deploy"]),
            1, 0
        ),
        (
            "Proxmox: LXCコンテナ作成コマンド",
            "Debian 12テンプレートからネットワーク固定IP付きLXCコンテナをデプロイ",
            "pct create {{VMID}} local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst \\\n  --hostname {{HOSTNAME}} \\\n  --cores {{CORES}} --memory {{RAM_MB}} \\\n  --net0 name=eth0,bridge=vmbr0,ip={{IP_CIDR}},gw={{GATEWAY}} \\\n  --storage local-lvm --start 1",
            "bash",
            "Proxmox",
            json.dumps(["proxmox", "lxc", "debian", "network"]),
            1, 1
        ),
        (
            "PowerShell: ポート疎通確認 (Test-NetConnection)",
            "特定IPアドレスとポートのTCP疎通テストを実行します",
            "Test-NetConnection -ComputerName {{TARGET_IP}} -Port {{PORT}} -InformationLevel Detailed",
            "powershell",
            "Network",
            json.dumps(["powershell", "network", "ping", "tcp"]),
            0, 0
        ),
        (
            "Linux: ディスク使用量TOP10ディレクトリ調査",
            "ルート直下のディスクを大量消費しているディレクトリをリストアップ",
            "sudo du -ahx / | sort -rh | head -n 10",
            "bash",
            "Linux",
            json.dumps(["linux", "disk", "maintenance"]),
            0, 0
        ),
        (
            "Cisco / VyOS: 簡易Ping & Traceroute",
            "インターフェースまたは送信元IPを指定してping実行",
            "ping {{TARGET_IP}} repeat 50 size 1400",
            "cisco",
            "Network",
            json.dumps(["cisco", "network", "ping"]),
            0, 0
        )
    ]

    for title, desc, cmd, lang, cat, tags, fav, pin in sample_snippets:
        cursor.execute("""
        INSERT INTO snippets (title, description, command, language, category, tags, favorite, pinned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (title, desc, cmd, lang, cat, tags, fav, pin))

    sample_notes = [
        (
            "🏠 ホームラボ環境ネットワーク設計メモ",
            """# ホームラボ環境ネットワーク設計

## サブネット一覧
| VLAN ID | 用途 | サブネット | ゲートウェイ |
| :--- | :--- | :--- | :--- |
| **VLAN 10** | 管理ネットワーク (Proxmox/Switch) | `192.168.10.0/24` | `192.168.10.1` |
| **VLAN 20** | サーバー・コンテナ群 | `192.168.20.0/24` | `192.168.20.1` |
| **VLAN 30** | 検証・ラボ用隔離環境 | `192.168.30.0/24` | `192.168.30.1` |

## DNS / リバースプロキシ
- **AdGuard Home**: `192.168.10.5`
- **Nginx Proxy Manager**: `192.168.20.10`
- ドメイン: `*.lab.local`

## 注意事項
- ルーターのDHCP除外範囲は `.1` 〜 `.99`（静的IP割当用）。
- VM作成時は必ず上記表のVLANタグを設定すること。
""",
            "Network",
            json.dumps(["network", "vlan", "homelab", "architecture"]),
            0, 0
        ),
        (
            "📦 Docker ホストセットアップ手順書",
            """# Ubuntu Server Docker ホスト初期構築

1. 公式リポジトリのGPGキー追加とセットアップ
2. Docker Engine, CLI, Containerd, Composeプラグインの導入
3. 一般ユーザー（`admin`）をdockerグループに追加

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## 推奨ディレクトリ構成
- `/opt/docker-compose/` 配下にサービスごとのディレクトリを作成して管理。
""",
            "Docker",
            json.dumps(["docker", "ubuntu", "setup", "cheatsheet"]),
            0, 0
        )
    ]

    for title, content, cat, tags, fav, pin in sample_notes:
        cursor.execute("""
        INSERT INTO notes (title, content, category, tags, favorite, pinned)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (title, content, cat, tags, fav, pin))

    sample_variables = [
        ("TARGET_IP", "192.168.1.100", "接続先・調査先のIPアドレス"),
        ("CONTAINER_NAME", "my-app", "対象のDockerコンテナ名"),
        ("VMID", "100", "Proxmoxの仮想マシン/LXC ID"),
        ("PORT", "8080", "対象ポート番号"),
        ("HOSTNAME", "lab-node-01", "サーバーまたはノードのホスト名"),
        ("IP_CIDR", "192.168.1.50/24", "IPアドレスとサブネットマスク"),
        ("GATEWAY", "192.168.1.1", "デフォルトゲートウェイ"),
        ("RAM_MB", "2048", "割り当てメモリ容量 (MB)"),
        ("CORES", "2", "CPUコア数")
    ]

    for name, val, desc in sample_variables:
        cursor.execute("""
        INSERT OR IGNORE INTO variables (name, default_value, description)
        VALUES (?, ?, ?)
        """, (name, val, desc))

def get_setting(key: str, default: str = "") -> str:
    """設定テーブルから値を取得"""
    try:
        with get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row[0] if row else default
    except Exception:
        return default

def set_setting(key: str, value: str):
    """設定テーブルに値を保存"""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (key, value))
        conn.commit()

def get_backup_max_generations() -> int:
    """バックアップ最大保持世代数を取得 (デフォルト: 20)"""
    try:
        val = int(get_setting("backup_max_generations", "20"))
        return max(1, min(100, val))
    except (ValueError, TypeError):
        return 20

def set_backup_max_generations(max_gen: int) -> int:
    """バックアップ最大保持世代数を設定 (1〜100)"""
    val = max(1, min(100, int(max_gen)))
    set_setting("backup_max_generations", str(val))
    cleanup_old_backups(val)
    return val

def list_backup_files(prefixes: Tuple[str, ...]) -> List[str]:
    """指定プレフィックスのバックアップを更新時刻の昇順（古い順）で取得"""
    if not os.path.isdir(BACKUP_DIR):
        return []
    files = [
        f for f in os.listdir(BACKUP_DIR)
        if f.startswith(prefixes) and f.endswith(".db")
    ]
    # 新旧プレフィックスが混在するためファイル名順では時系列にならない
    files.sort(key=lambda f: os.path.getmtime(os.path.join(BACKUP_DIR, f)))
    return files

def cleanup_old_backups(max_generations: Optional[int] = None):
    """指定世代数を超えた古いバックアップを削除（通常・ロールバック退避を独立に世代管理）"""
    if max_generations is None:
        max_generations = get_backup_max_generations()

    for prefixes in (BACKUP_PREFIXES, PREROLLBACK_PREFIXES):
        files = list_backup_files(prefixes)
        for old_bck in files[:-max_generations] if len(files) > max_generations else []:
            try:
                os.remove(os.path.join(BACKUP_DIR, old_bck))
            except OSError:
                pass

def create_backup(prefix: str = "opsnotes_backup") -> str:
    """自動世代バックアップを作成し、設定された保持世代数で古いバックアップを整理"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        return ""
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"{prefix}_{timestamp}.db"
    backup_path = os.path.join(BACKUP_DIR, backup_filename)

    # 同一秒内の連続バックアップで既存スナップショットを上書きしないよう採番する
    seq = 1
    while os.path.exists(backup_path):
        backup_filename = f"{prefix}_{timestamp}_{seq:02d}.db"
        backup_path = os.path.join(BACKUP_DIR, backup_filename)
        seq += 1


    # SQLiteオンラインバックアップAPIを使用して安全にコピー
    with get_connection() as src_conn:
        bck_conn = sqlite3.connect(backup_path)
        src_conn.backup(bck_conn)
        bck_conn.close()
    
    # 設定世代数で古いバックアップを整理
    cleanup_old_backups()
                
    return backup_filename

def rollback_backup(filename: str) -> Dict[str, Any]:
    """指定されたバックアップからDBを安全にロールバック（復元）"""
    safe_filename = os.path.basename(filename)
    target_path = os.path.join(BACKUP_DIR, safe_filename)
    
    if not os.path.exists(target_path) or not safe_filename.endswith(".db"):
        raise FileNotFoundError(f"Backup file '{safe_filename}' not found")
        
    # 1. 安全のため、現在のDBの直前バックアップを自動作成
    pre_rollback_backup = create_backup(prefix="opsnotes_prerollback")
    
    # 2. 対象のバックアップから homeops.db へオンラインリストア
    src_conn = sqlite3.connect(target_path)
    try:
        with get_connection() as dst_conn:
            src_conn.backup(dst_conn)
            # WALをコミット・フラッシュ
            dst_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        src_conn.close()


    return {
        "status": "ok",
        "restored_from": safe_filename,
        "pre_rollback_backup": pre_rollback_backup,
        "restored_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def list_backups() -> List[Dict[str, Any]]:
    """バックアップ一覧を新しい順で取得"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backups = []
    for f in reversed(list_backup_files(BACKUP_PREFIXES)):
        stat = os.stat(os.path.join(BACKUP_DIR, f))
        backups.append({
            "filename": f,
            "size_bytes": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        })
    return backups

def export_all_data() -> Dict[str, Any]:
    """全データをJSON形式でエクスポート"""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM snippets ORDER BY id ASC")
        snippets = [dict(row) for row in cursor.fetchall()]
        for s in snippets:
            try:
                s["tags"] = json.loads(s["tags"])
            except Exception:
                s["tags"] = []
                
        cursor.execute("SELECT * FROM notes ORDER BY id ASC")
        notes = [dict(row) for row in cursor.fetchall()]
        for n in notes:
            try:
                n["tags"] = json.loads(n["tags"])
            except Exception:
                n["tags"] = []
                
        cursor.execute("SELECT * FROM variables ORDER BY id ASC")
        variables = [dict(row) for row in cursor.fetchall()]
        
        return {
            "version": "1.0.0",
            "exported_at": datetime.now().isoformat(),
            "snippets": snippets,
            "notes": notes,
            "variables": variables
        }

def search_all(query: str, limit: int = 50) -> List[Dict[str, Any]]:
    """FTS5を用いた超高速インクリメンタル横断検索"""
    if not query.strip():
        return []
    
    clean_query = query.replace('"', '""').strip()
    # ワイルドカードを付与して部分一致対応
    fts_query = f'"{clean_query}"*'

    # FTS5のヒット行に対し、スニペット/ノート本体を1クエリでまとめて結合する
    fts_sql = """
    SELECT f.item_type, f.item_id, f.title, f.content, f.tags,
           s.id AS s_id, s.language, s.category AS s_category,
           s.favorite AS s_favorite, s.pinned AS s_pinned, s.copy_count,
           n.id AS n_id, n.category AS n_category,
           n.favorite AS n_favorite, n.pinned AS n_pinned, n.updated_at
    FROM (
        SELECT item_type, item_id, title, content, tags, rank
        FROM search_fts
        WHERE search_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    ) AS f
    LEFT JOIN snippets s ON f.item_type = 'snippet' AND s.id = f.item_id
    LEFT JOIN notes    n ON f.item_type = 'note'    AND n.id = f.item_id
    """

    # 構文エラー発生時のシンプルなLIKE検索フォールバック（列構成はFTS版と揃える）
    like_sql = """
    SELECT 'snippet' AS item_type, id AS item_id, title, command AS content, tags,
           id AS s_id, language, category AS s_category,
           favorite AS s_favorite, pinned AS s_pinned, copy_count,
           NULL AS n_id, NULL AS n_category,
           NULL AS n_favorite, NULL AS n_pinned, NULL AS updated_at
    FROM snippets WHERE title LIKE ? OR command LIKE ? OR description LIKE ?
    UNION ALL
    SELECT 'note', id, title, content, tags,
           NULL, NULL, NULL, NULL, NULL, NULL,
           id, category, favorite, pinned, updated_at
    FROM notes WHERE title LIKE ? OR content LIKE ?
    LIMIT ?
    """

    with get_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(fts_sql, (fts_query, limit))
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            like_pat = f"%{clean_query}%"
            cursor.execute(like_sql, (like_pat, like_pat, like_pat, like_pat, like_pat, limit))
            rows = cursor.fetchall()

        results = []
        for r in rows:
            if r["item_type"] == "snippet":
                if r["s_id"] is None:
                    continue
                results.append({
                    "type": "snippet",
                    "id": r["item_id"],
                    "title": r["title"],
                    "preview": r["content"][:200],
                    "tags": r["tags"],
                    "language": r["language"],
                    "category": r["s_category"],
                    "favorite": r["s_favorite"],
                    "pinned": r["s_pinned"],
                    "copy_count": r["copy_count"]
                })
            else:
                if r["n_id"] is None:
                    continue
                results.append({
                    "type": "note",
                    "id": r["item_id"],
                    "title": r["title"],
                    "preview": r["content"][:200],
                    "tags": r["tags"],
                    "category": r["n_category"],
                    "favorite": r["n_favorite"],
                    "pinned": r["n_pinned"],
                    "updated_at": r["updated_at"]
                })
        return results
