@echo off
chcp 65001 > nul
title OpsNotes - Homelab Notes & Snippet Manager

echo ========================================================
echo   OpsNotes - ホームラボ運用ノート & コマンドスニペット
echo ========================================================
echo.

cd /d "%~dp0"

:: 1. Pythonの確認
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [エラー] Python が見つかりませんでした。
    echo Python 3.10 以上をインストールし、PATHに追加してください。
    pause
    exit /b 1
)

:: 2. 依存関係のチェック (fastapi, uvicorn)
python -c "import fastapi, uvicorn" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [準備中] 必要なライブラリ (fastapi, uvicorn) をインストールしています...
    python -m pip install -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo [エラー] パッケージのインストールに失敗しました。
        pause
        exit /b 1
    )
)

:: 3. ブラウザを自動で開く (バックグラウンドで2秒後に起動)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8420"

:: 4. サーバー起動
echo [起動] OpsNotes サーバーを開始しています (ポート: 8420)...
echo [情報] ブラウザが自動的に開きます: http://127.0.0.1:8420
echo [情報] 終了する場合は、このウィンドウを閉じるか Ctrl+C を押してください。
echo.

python server.py

pause
