# OpsNotes (オプス・ノート) 💻⚡

VMに依存せず、ホストOS（Windows / macOS / Linux）上で軽量かつ高耐久に常駐・動作する、**ホームラボ運用ノート & コマンドスニペット管理ツール**です。

ByteStashの「手軽なスニペット＆ワンクリックコピー・パラメータ置換」と、Trilium Notesの「Markdownノート・階層/タグ・高速検索」の長所を融合し、さらにインフラ構成図キャンバスエディタやデータ保全ロールバック機能などを備えています。

---

## 📋 主な機能・仕様一覧

### 1. コマンドスニペット管理
- ⚡ **ワンクリックコピー & パラメータ置換 (Interactive Variables)**
  - コマンド内に `{{TARGET_IP}}` や `{{VMID}}` を書いておくだけで、UI上に自動で入力欄が展開。
  - 値を入力するとリアルタイムにコマンドが置換され、その状態のままワンクリックでコピー可能。
  - よく使う変数（例: `TARGET_IP`）のデフォルト値プリセット管理も可能。
- 📋 **使用回数カウント & お気に入り・ピン留め**
  - 使用頻度に応じた並び替えやお気に入り管理に対応。

### 2. Markdown メモ & リッチエディタ
- 📝 **Split-View ライブプレビュー & 500ms 自動保存**
  - 入力停止後 500ms で自動バックグラウンド保存。電源断やブラウザ落ちでも作業内容を失いません。
  - **作成日時降順ソート**: メモの並び順は作成日時（`created_at DESC`）の秒単位で安定管理。編集しても順番が跳ね上がりません。
  - ツールチップで秒単位の作成日時（`YYYY-MM-DD HH:MM:SS`）を確認可能。
- 🎨 **リッチエディタツールバー (文字色 & マーカー)**
  - 文字色パレット & 蛍光ペンマーカー（文字の下半分を彩るスマートグラデーション）。
  - **タグ入れ子防止**: 既に色がついた文字列の色を変更した場合でも、`<span style="...">` や `<mark>` が二重に重ならず、カラーコードのみを自動置換。
- ⌨️ **スマートリスト自動継続**
  - 箇条書き（`- `）、番号付きリスト（`1. `）、チェックリスト（`- [ ] `）でEnterを押すと、次行にも自動でプレフィックスを継続。
- 📄 **プレビュー最大化 & プレビューのみのPDF出力**
  - メモプレビュー画面だけをA4最適化レイアウトでPDF出力・印刷可能。
- 🛡️ **ポストモーテム（障害事後検証報告書）変換機能**
  - 障害初動メモからワンクリックでSRE標準のポストモーテム構成テンプレートに自動展開。
- 🔗 **TF-IDF 関連メモ自動推薦**
  - メモの内容からTF-IDFアルゴリズムにより文脈の近い関連ノートを自動推薦・サイドバーに表示。

### 3. インフラ構成図・作図キャンバス (Canvas Diagram)
- 📐 **直感的なベクター作図**
  - ネットワーク機器（Router, L2/L3 Switch, Server, Firewall, Cloud, PCなど）
  - 基本シェイプ（四角形、角丸四角形、円、菱形、テキスト、吹き出し、雲など）
  - ホスト名・IPアドレス設定、タイトル表示（シェイプ左上に表示）、水平/垂直反転機能
- 🔌 **インテリジェントLAN配線接続**
  - ポート間をマグネット接続。機器をドラッグ移動しても配線が自動追従。
  - 背景に図形を重ねても配線が誤紐付けされない独立レイヤー構造。
- 🖼️ **Markdownへの埋め込み & 再編集**
  - 作図内容をSVG画像としてメモ本文に即座に挿入。
  - 挿入済みの作図は「キャンバスで再編集」ボタンでデータをそのまま読み出して復元・編集可能。

### 4. 画面レイアウト & 操作性
- ↔️ **リサイズ＆折りたたみ可能なマルチペイン**
  - サイドバー (`app-sidebar`) と メモ一覧 (`notes-list-pane`) はマウスドラッグで自由に幅を調整可能。
  - サイドバーはトグルボタンで**幅30pxにスマート折りたたみ**。開閉時でトグルボタンのY軸位置がブレずに固定。
  - メモ一覧もワンクリックで折りたたみ可能。
  - 開閉アニメーションは `0.25s cubic-bezier(0.2, 0, 0, 1)` で統一された滑らかなトランジション。
- 🔍 **ミリ秒単位のインクリメンタル全文検索 (Ctrl + K)**
  - SQLite FTS5仮想テーブルにより、大量のスニペット・コマンド引数・Markdownメモ本文を高速に横断検索。
- 🎨 **VS Code風テーマスイッチャー & カスタムテーマ対応**
  - **Monokai Pro (Filter Ristretto)** (デフォルト)
  - **Catppuccin Mocha** / **Catppuccin Latte**
  - **Ayu Dark** / **Ayu Mirage** / **Ayu Light**
  - **VS Code Dark+** / **VS Code Light+**
  - `styles/` ディレクトリにCSSファイルを配置するだけでカスタムテーマを即座に動的読み込み。
- 💡 **画面下部ティッカーフッター (高さ28px)**
  - ショートカットキーや運用のTipsが右から左へ流れるアニメーションフッターを常時表示。

### 5. 高信頼・データ保全 (バックアップ & ロールバック)
- 💾 **SQLite WALモード**
  - 単一ファイル `data/opsnotes.db` で安全に管理。
- ⏱️ **世代管理バックアップ（保持世代数の自由設定）**
  - 保持する最大バックアップ世代数を 1〜100世代（デフォルト: 20）で設定可能。
  - 世代数を減らした場合は、**超過した古いバックアップが自動的に削除**されディスク容量を常に適正化。
- 🔄 **UIからのワンクリック・ロールバック（復元）**
  - 過去のバックアップ一覧から、ワンクリックでその時点の状態にデータベースを安全復元。
  - **安全設計**: ロールバック直前に現在のDB状態が `opsnotes_prerollback_...` として自動退避されるため、誤復元時も直前の状態に戻せます。
- 📦 **全データJSONエクスポート/インポート**
  - 他環境への移行や完全バックアップのためのJSON入出力に対応。

---

## 🚀 クイックスタート

必要なのは [uv](https://docs.astral.sh/uv/) だけです。**Python のインストールも `pip install` も不要**です。uv が適切なバージョンの Python を自動で取得し、依存ライブラリを解決します。

### 1. uv をインストール

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. 起動

```bash
uv run --with-requirements requirements.txt server.py
```

ブラウザで `http://127.0.0.1:8420` にアクセスしてください。

初回はPythonと依存ライブラリの取得が走りますが、2回目以降はキャッシュが効いて数秒で起動します。プロジェクト内に `.venv` は作られず、uv のキャッシュ領域で完結します。

> **補足**: システムに Python が入っていても、uv は自身が管理する Python（`~/.local/share/uv/python/`）を使うため、環境を汚しません。特定バージョンで動かしたい場合は `--python 3.11` のように指定できます。

---

## 🔧 設定（環境変数）

常駐時の挙動は環境変数で制御します。すべて省略可能です。

| 変数 | 既定値 | 説明 |
| :--- | :--- | :--- |
| `OPSNOTES_HOST` | `127.0.0.1` | 待ち受けアドレス。コンテナ内では `0.0.0.0` が必要 |
| `OPSNOTES_PORT` | `8420` | 待ち受けポート |
| `OPSNOTES_RELOAD` | `0` | `1` でソース変更時の自動リロードを有効化（開発用） |
| `OPSNOTES_LOG_FILE` | (未設定) | 指定するとログをファイルへ出力（5MB×3世代でローテーション） |

`OPSNOTES_RELOAD=1` はファイル監視の常駐プロセスが増えCPUを消費し続けるため、**常駐運用では有効にしないでください**。

---

## ⏰ Windows で常駐させる（タスクスケジューラ）

ログオンのたびに自動起動し、コンソール画面を出さずにバックグラウンドで動かす手順です。Docker は不要で、管理者権限も要りません。

### 1. セットアップ（初回のみ）

```powershell
# uv のインストール（未導入の場合）
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# プロジェクトのフォルダへ移動
cd C:\opsnotes

# 仮想環境の作成（Python 本体も uv が自動取得します）
uv venv --python 3.11
uv pip install -r requirements.txt

# ログの出力先を指定（絶対パスで指定してください）
setx OPSNOTES_LOG_FILE "C:\opsnotes\logs\opsnotes.log"
```

`setx` の設定を反映させるため、一度 PowerShell を開き直してください。

### 2. タスクとして登録

`pythonw.exe` はコンソール画面を持たない Python です。これを使うことで黒い窓が出ません。

```powershell
schtasks /create /TN "OpsNotes" /SC ONLOGON /RL LIMITED /F ^
  /TR "\"C:\opsnotes\.venv\Scripts\pythonw.exe\" \"C:\opsnotes\server.py\""
```

パスは実際の配置場所に読み替えてください。`server.py` を**絶対パスで渡すことが重要**です（タスクスケジューラは作業ディレクトリを指定できないため）。

### 3. 異常終了時の自動復旧を設定

`schtasks` コマンドでは設定できないため、GUI で行います。

1. 「タスク スケジューラ」を開き、登録した **OpsNotes** を右クリック →「プロパティ」
2. **「設定」タブ** を開く
3. 「タスクが失敗した場合の再起動間隔」に **1 分**、「再起動試行回数」に **3 回** を設定
4. 「タスクを停止するまでの時間」の**チェックを外す**（常駐させるため）

### 4. 動作確認

```powershell
# 今すぐ起動
schtasks /run /TN "OpsNotes"

# 状態の確認
schtasks /query /TN "OpsNotes" /V /FO LIST | findstr /C:"状態" /C:"前回の結果"

# ヘルスチェック（{"status":"ok"} が返れば正常）
curl http://127.0.0.1:8420/api/health
```

ブラウザで `http://127.0.0.1:8420` を開けば利用できます。

### 5. ログの確認

```powershell
Get-Content C:\opsnotes\logs\opsnotes.log -Tail 20 -Wait
```

コンソールが出ないため、動作状況の確認はこのログが頼りになります。起動に失敗する場合もここに記録されます。

### 6. 停止・削除

```powershell
schtasks /end /TN "OpsNotes"      # 停止
schtasks /delete /TN "OpsNotes" /F # タスクごと削除
```

### 補足: 応答しなくなった場合の検知

タスクスケジューラはプロセスの生死しか見ないため、「起動しているが応答しない」状態は検知できません。必要であれば、`/api/health` を定期的に確認して異常時に再起動するタスクを別途登録してください。

```powershell
# 5分ごとにヘルスチェックし、失敗したらタスクを再起動する例
schtasks /create /TN "OpsNotes-Watchdog" /SC MINUTE /MO 5 /RL LIMITED /F ^
  /TR "powershell -WindowStyle Hidden -Command \"try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 http://127.0.0.1:8420/api/health | Out-Null } catch { schtasks /end /TN 'OpsNotes'; Start-Sleep 2; schtasks /run /TN 'OpsNotes' }\""
```

---

## 🖥️ デスクトップアプリ風に起動する方法（PWAライク）
Google Chrome または Microsoft Edge で `http://127.0.0.1:8420` を開いた状態で：
- **Edge の場合**: 画面右上のメニュー「...」→「アプリ」→「OpsNotes をアプリとしてインストール」
- **Chrome の場合**: 画面右上のメニュー「...」→「保存して共有」→「ページをアプリとしてインストール」

これでタスクバーにピン留めでき、アドレスバーのない独立したデスクトップウィンドウとして快適に利用できます。

---

## 📂 ディレクトリ構成
```
OpsNotes/
├── server.py              # FastAPI バックエンド & REST API
├── database.py            # SQLite FTS5、データ保全・ロールバック、世代管理
├── similarity.py          # TF-IDF 関連メモ推薦エンジン
├── requirements.txt       # 依存ライブラリ (fastapi, uvicorn)
├── README.md              # 仕様書 & 利用ガイド
├── data/                  # データベース保管ディレクトリ
│   ├── opsnotes.db        # メインSQLiteデータベース (WAL)
│   └── backups/           # 自動バックアップ (.db)
├── styles/                # カスタムテーマCSS格納ディレクトリ
│   ├── dark-terminal.css
│   ├── kawaii.css
│   └── minimal.css
└── static/
    ├── index.html         # メインSPA UI
    ├── css/
    │   ├── theme.css      # テーマカラーパレット定義
    │   └── style.css      # UIスタイル・レイアウト・アニメーション
    └── js/
        ├── app.js         # メインエントリーポイント & ペインリサイズ制御
        ├── api.js         # REST API通信クライアント
        ├── themes.js      # テーマ切り替えマネージャー
        ├── snippets.js    # スニペットカード＆パラメータ置換
        ├── notes.js       # Markdownメモ・リッチエディタ・作成日時ソート
        ├── search.js      # Ctrl+K 全文検索モーダル
        ├── backup.js      # データ保全・世代数設定・ロールバック制御
        └── canvas/        # 構成図・作図キャンバスモジュール
            ├── canvasEngine.js   # 描画・ズーム・パン・接続管理
            ├── canvasModal.js    # 作図モーダル・プロパティインスペクター
            └── shapes.js         # 機器・シェイプ・配線パス・SVGレンダリング
```
