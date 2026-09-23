#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpsNotes - TF-IDF Similarity Engine
Lightweight, pure Python implementation for bilingual (Japanese & English) notes similarity.
Zero external dependencies.
"""

import math
import re
import unicodedata
from collections import Counter
from typing import List, Dict, Any, Set, Tuple

# ストップワード（一般的すぎる助詞・単語を除外）
STOPWORDS: Set[str] = {
    'これ', 'それ', 'あれ', 'この', 'その', 'あの', 'ここ', 'そこ', 'あそこ',
    'ため', 'こと', 'もの', 'よう', 'そう', 'など', 'あり', 'ある', 'する',
    'ます', 'です', 'した', 'して', 'から', 'まで', 'より', 'への', 'での',
    'the', 'is', 'are', 'was', 'were', 'and', 'or', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'an', 'as', 'it', 'this', 'that'
}

def tokenize(text: str) -> List[str]:
    """
    日英混在テキストをトークン化するハイブリッド関数
    1. 全角・半角正規化 (NFKC) & 小文字化 (Docker == docker)
    2. 英数字・技術用語・IP・識別子 (docker, 192.168.1.1, vlan10 など)
    3. カタカナ語 (コンテナ, サーバー, ネットワーク など)
    4. 漢字熟語 (障害, 復旧, 設定, 検証 など)
    5. 日本語文字バイグラム (ひらがな混じりの文節・複合語の2文字スライディング)
    """
    if not text:
        return []

    # 1. NFKC正規化 & 小文字化
    normalized = unicodedata.normalize('NFKC', text).lower()

    tokens = []

    # 2. 英数字・シンボル（コマンドやホスト名、IPアドレス対応）
    # 例: docker-compose, proxmox, 192.168.1.1, vlan_10, lxc
    en_tokens = re.findall(r'[a-z0-9][a-z0-9_\-\.]{1,}', normalized)
    for t in en_tokens:
        # ドットやハイフンだけのものを除外
        cleaned = t.strip('.-_')
        if len(cleaned) >= 2 and cleaned not in STOPWORDS:
            tokens.append(cleaned)

    # 3. カタカナ語（2文字以上）
    katakana_tokens = re.findall(r'[\u30a1-\u30f6ー]{2,}', normalized)
    for t in katakana_tokens:
        if t not in STOPWORDS:
            tokens.append(t)

    # 4. 漢字熟語（2文字以上）
    kanji_tokens = re.findall(r'[\u4e00-\u9faf]{2,}', normalized)
    for t in kanji_tokens:
        if t not in STOPWORDS:
            tokens.append(t)

    # 5. 日本語テキスト全体の文字バイグラム (2文字N-gram)
    # ひらがな・漢字・カタカナの連続から2文字ずつ抽出
    ja_text = re.sub(r'[^\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]', ' ', normalized)
    for segment in ja_text.split():
        if len(segment) >= 2:
            for i in range(len(segment) - 1):
                bi = segment[i:i+2]
                if bi not in STOPWORDS:
                    tokens.append(bi)

    return tokens

def compute_tfidf_vectors(documents: List[Dict[str, Any]]) -> List[Tuple[Dict[str, float], float]]:
    """
    ドキュメントリストから各ドキュメントのTF-IDFベクトル辞書を計算
    タイトルとタグは重要度が高いため重み付け（タイトル: 3倍、タグ: 2倍）
    """
    doc_tfs = []
    df_counts = Counter()
    total_docs = len(documents)

    for doc in documents:
        # 重み付けテキストの結合
        title = doc.get("title", "")
        tags_raw = doc.get("tags", "")
        tags_str = " ".join(tags_raw) if isinstance(tags_raw, list) else str(tags_raw)
        content = doc.get("content", "")

        # タイトルトークン（3倍重み）
        title_tokens = tokenize(title) * 3
        # タグトークン（2倍重み）
        tag_tokens = tokenize(tags_str) * 2
        # 本文トークン
        content_tokens = tokenize(content)

        all_tokens = title_tokens + tag_tokens + content_tokens
        tf = Counter(all_tokens)
        doc_tfs.append(tf)

        # 登場するユニーク単語のドキュメント頻度 (DF) をカウント
        for token in set(all_tokens):
            df_counts[token] += 1

    # IDFの計算: log( (N + 1) / (df + 1) ) + 1 (Smooth IDF)
    idf = {}
    for token, df in df_counts.items():
        idf[token] = math.log((total_docs + 1.0) / (df + 1.0)) + 1.0

    # 各ドキュメントのTF-IDFベクトルとL2ノルム（長さ）
    vectors = []
    for tf in doc_tfs:
        vec = {}
        norm_sq = 0.0
        for token, count in tf.items():
            # TFは log(1 + count) を用いて極端な頻出語の影響を抑制
            tf_val = 1.0 + math.log(count)
            val = tf_val * idf.get(token, 1.0)
            vec[token] = val
            norm_sq += val * val

        norm = math.sqrt(norm_sq) if norm_sq > 0 else 1.0
        vectors.append((vec, norm))

    return vectors


def cosine_similarity(vec_a: Dict[str, float], norm_a: float, vec_b: Dict[str, float], norm_b: float) -> float:
    """2つの疎ベクトルのコサイン類似度を計算 (0.0 〜 1.0)"""
    if norm_a == 0 or norm_b == 0:
        return 0.0

    # キー数の少ない方をループして高速化
    if len(vec_a) > len(vec_b):
        vec_a, vec_b = vec_b, vec_a

    dot = sum(val * vec_b.get(term, 0.0) for term, val in vec_a.items())
    return dot / (norm_a * norm_b)

# TF-IDFベクトルはメモ集合が変わらない限り再利用する（全件の再トークン化が最も重い処理のため）
_corpus_cache: Dict[str, Any] = {
    "key": None,
    "notes": [],
    "index": {},
    "vectors": []
}

def is_corpus_cached(key: Any) -> bool:
    """指定キーのコーパスがキャッシュ済みかを判定"""
    return _corpus_cache["key"] is not None and _corpus_cache["key"] == key

def build_corpus(key: Any, notes: List[Dict[str, Any]]):
    """メモ集合のTF-IDFベクトルを構築してキャッシュする"""
    _corpus_cache["key"] = key
    _corpus_cache["notes"] = notes
    _corpus_cache["index"] = {n["id"]: i for i, n in enumerate(notes)}
    _corpus_cache["vectors"] = compute_tfidf_vectors(notes)

def invalidate_corpus():
    """ロールバックやインポートなどDBを総入れ替えした際にキャッシュを破棄する"""
    _corpus_cache["key"] = None
    _corpus_cache["notes"] = []
    _corpus_cache["index"] = {}
    _corpus_cache["vectors"] = []

def find_related_notes(target_note_id: int, top_k: int = 3) -> List[Dict[str, Any]]:
    """
    キャッシュ済みコーパスから、対象メモとTF-IDFコサイン類似度が高い上位 top_k 件を抽出
    """
    all_notes = _corpus_cache["notes"]
    if len(all_notes) <= 1:
        return []

    target_idx = _corpus_cache["index"].get(target_note_id)
    if target_idx is None:
        return []

    vectors = _corpus_cache["vectors"]
    target_vec, target_norm = vectors[target_idx]

    scored = []
    for idx, note in enumerate(all_notes):
        if idx == target_idx:
            continue
        other_vec, other_norm = vectors[idx]
        sim = cosine_similarity(target_vec, target_norm, other_vec, other_norm)

        # 類似度が0より大きいもののみ候補とする
        if sim > 0.01:
            scored.append({
                "id": note["id"],
                "title": note.get("title", "無題のメモ"),
                "category": note.get("category", "General"),
                "summary": note.get("content", "")[:120].replace("\n", " ").strip(),
                "similarity_score": round(sim, 4),
                "similarity_percent": min(100, int(round(sim * 100)))
            })

    # 類似度降順でソートして上位 top_k 件を返す
    scored.sort(key=lambda x: x["similarity_score"], reverse=True)
    return scored[:top_k]
