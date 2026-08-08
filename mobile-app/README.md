# Master Dog 手機版

一個手機優先的私人聊天入口。後端讀取本 repo 的 `SKILL.md` 與 `references/`，用 OpenAI Responses API 生成回答；前端可在手機瀏覽器使用，也可安裝到主畫面。

## 本地啟動

```bash
cd mobile-app
copy .env.example .env
# 編輯 .env，填入 GEMINI_API_KEY 或 OPENAI_API_KEY，並把 GOUTOUJUNSHI_ACCESS_TOKEN 改成自己的密碼
npm start
```

打開：

```text
http://localhost:8787
```

手機要連同一台電腦時，請用電腦的區域網路 IP，例如：

```text
http://192.168.1.23:8787
```

## 安全

- 不要把 `.env` 提交到 git。
- `GEMINI_API_KEY` / `OPENAI_API_KEY` 只放在伺服器，不要放進前端。
- 部署到公網時，務必設定 `GOUTOUJUNSHI_ACCESS_TOKEN` 或平台登入保護。
- 這個 app 會處理私人感情內容，建議只給自己使用。

## AI provider

預設可用 Gemini Free Tier：

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=你的Gemini API key
GEMINI_MODEL=gemini-3.5-flash-lite
```

要切回 OpenAI：

```text
AI_PROVIDER=openai
OPENAI_API_KEY=你的OpenAI API key
OPENAI_MODEL=gpt-5-mini
```

## 私人書籍來源

原始書籍檔案不要提交到 repo。若要讓後續腳本知道私人書籍在哪裡，可在 `.env` 設定：

```text
PRIVATE_BOOK_SOURCE_DIR=C:\path\to\private\books
PRIVATE_BOOK_INDEX_PATH=private-book-index.json
PRIVATE_BOOK_MAX_CHUNKS=3
```

目前知識庫只沉澱主題索引、短筆記、證據邊界和回答轉化規則，不收錄原書全文或長篇摘錄。

建立本機索引：

```bash
python ..\scripts\build_private_book_index.py
```

產物會寫入 `mobile-app/private-book-index.json`，這個檔案已被 git 忽略。EPUB 可直接索引；PDF 需要本機安裝 `pypdf` 或 `PyPDF2`。

## Telegram bot

1. 在 Telegram 找 `@BotFather` 建立 bot，拿到 bot token。
2. 在 `.env` 填入：

```text
TELEGRAM_BOT_TOKEN=1234567890:your-telegram-bot-token
TELEGRAM_CHAT_ID=你的Telegram聊天ID
ALLOWED_USER_IDS=你的Telegram數字ID
```

這裡沿用 `binance-bot` 的命名習慣：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`、`ALLOWED_USER_IDS`。`ALLOWED_USER_IDS` 可用逗號放多個 ID。部署到公網或長期運行時建議必填，避免別人使用你的 OpenAI 額度。

如果不知道自己的 ID，可以先暫時只填 `TELEGRAM_BOT_TOKEN`，啟動後對 bot 傳 `/id`。拿到 ID 後再填入 `ALLOWED_USER_IDS` 和 `TELEGRAM_CHAT_ID`。

啟動：

```bash
npm run telegram
```

指令：

```text
/start  開始使用
/reset  清空這個聊天的短期記憶
/id     顯示你的 Telegram user ID，方便填入白名單
/help   顯示指令清單
```

截圖：

- 直接把聊天截圖傳給 bot，可附 caption 說明你想問什麼。
- 圖片只用於當次分析，短期記憶只保留「已分析截圖」和你的文字說明。
- 預設單張圖片上限為 `TELEGRAM_IMAGE_MAX_BYTES=8000000`。
- Telegram 預設使用短回覆，可用 `TELEGRAM_REPLY_MAX_CHARS=700` 調整提示中的長度上限。
