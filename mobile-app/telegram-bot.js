import { askGoutoujunshi, loadDotEnv } from "./goutoujunshi-core.js";

loadDotEnv();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const ALLOWED_USER_IDS = parseAllowedIds(
  process.env.ALLOWED_USER_IDS || process.env.TELEGRAM_ALLOWED_USER_IDS || ""
);
const HISTORY_LIMIT = Number(process.env.TELEGRAM_HISTORY_LIMIT || 12);
const POLL_TIMEOUT_SECONDS = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS || 25);
const apiBase = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const histories = new Map();

let offset = 0;
let stopped = false;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in mobile-app/.env");
  process.exit(1);
}

if (isPlaceholderToken(TELEGRAM_BOT_TOKEN)) {
  console.error(
    "TELEGRAM_BOT_TOKEN still looks like the example value. Paste the real token from @BotFather into mobile-app/.env."
  );
  process.exit(1);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log("Master Dog Telegram bot is polling for messages...");
await callTelegram("deleteWebhook", { drop_pending_updates: false });
if (TELEGRAM_CHAT_ID) {
  try {
    await sendMessage(
      TELEGRAM_CHAT_ID,
      "Master Dog 已上線。\n\n使用 /start 開始，/help 查看指令。"
    );
  } catch (error) {
    console.warn(`Startup notification skipped: ${error.message}`);
  }
}
while (!stopped) {
  try {
    const data = await callTelegram("getUpdates", {
      offset,
      timeout: POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message"]
    });

    for (const update of data.result || []) {
      offset = Math.max(offset, update.update_id + 1);
      await handleUpdate(update);
    }
  } catch (error) {
    console.error(`Polling error: ${error.message}`);
    await sleep(3000);
  }
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const userId = message.from?.id;
  const text = message.text?.trim();
  const caption = message.caption?.trim();

  if (text === "/id") {
    await sendMessage(chatId, `你的 Telegram user ID 是：${userId}`);
    return;
  }

  if (TELEGRAM_CHAT_ID && String(chatId) !== String(TELEGRAM_CHAT_ID)) {
    await sendMessage(chatId, `這是私人 Master Dog bot，這個 chat 未授權。chat_id：${chatId}`);
    return;
  }

  if (ALLOWED_USER_IDS.size && !ALLOWED_USER_IDS.has(String(userId))) {
    await sendMessage(chatId, `這是私人 Master Dog bot，未授權使用。你的 Telegram user ID 是：${userId}`);
    return;
  }

  const imageDataUrl = await getMessageImageDataUrl(message);

  if (!text && !caption && !imageDataUrl) {
    await sendMessage(chatId, "目前支援文字和聊天截圖。你可以貼聊天記錄、傳截圖，或直接說現在卡在哪裡。");
    return;
  }

  if (text === "/start") {
    await sendMessage(
      chatId,
      "Master Dog 在。\n\n直接貼聊天內容，或說你現在要：回覆、推進、修復、比較選擇、退出。"
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      [
        "Master Dog 指令",
        "",
        "/start  開始使用",
        "/reset  清空這個聊天的短期記憶",
        "/id     顯示你的 Telegram user ID",
        "/help   顯示此選單",
        "",
        "也可以不打指令，直接貼聊天記錄或描述局面。"
      ].join("\n")
    );
    return;
  }

  if (text === "/reset") {
    histories.delete(String(chatId));
    await sendMessage(chatId, "已清空這個聊天的短期記憶。重新講局面就好。");
    return;
  }

  await sendChatAction(chatId, "typing");
  const history = histories.get(String(chatId)) || [];
  const userContent = text || caption || "請分析這張聊天截圖，先整理可見事實，再給我下一步建議。";
  const modelHistory = [
    ...history,
    {
      role: "user",
      content: imageDataUrl
        ? `${userContent}\n\n這是一張聊天截圖。請只根據圖片可見內容分析；看不清的地方保持未知，不要腦補。`
        : userContent,
      images: imageDataUrl ? [imageDataUrl] : []
    }
  ];

  try {
    const result = await askGoutoujunshi(modelHistory, { channelName: "Telegram" });
    const reply = result.text || "我這次沒有生成內容，你再貼一次情境。";
    history.push({
      role: "user",
      content: imageDataUrl ? `${userContent}\n[聊天截圖已分析]` : userContent
    });
    history.push({ role: "assistant", content: reply });
    histories.set(String(chatId), history.slice(-HISTORY_LIMIT));
    await sendLongMessage(chatId, reply);
  } catch (error) {
    await sendMessage(chatId, `我剛剛接不上：${error.message}`);
  }
}

async function callTelegram(method, payload) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data;
}

async function sendMessage(chatId, text) {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4096),
    disable_web_page_preview: true
  });
}

async function sendLongMessage(chatId, text) {
  const chunks = splitTelegramText(text);
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk);
  }
}

async function sendChatAction(chatId, action) {
  try {
    await callTelegram("sendChatAction", { chat_id: chatId, action });
  } catch {
    // Typing indicators are helpful but not required.
  }
}

async function getMessageImageDataUrl(message) {
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
  const document = message.document;
  const imageDocument =
    document && typeof document.mime_type === "string" && document.mime_type.startsWith("image/")
      ? document
      : null;
  const file = photo || imageDocument;
  if (!file?.file_id) return null;

  const maxBytes = Number(process.env.TELEGRAM_IMAGE_MAX_BYTES || 8_000_000);
  if (file.file_size && file.file_size > maxBytes) {
    throw new Error(`圖片太大，請壓到 ${Math.round(maxBytes / 1_000_000)}MB 以內再傳。`);
  }

  const fileInfo = await callTelegram("getFile", { file_id: file.file_id });
  const filePath = fileInfo.result?.file_path;
  if (!filePath) throw new Error("Telegram 沒有回傳圖片路徑");

  const response = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
  if (!response.ok) throw new Error(`下載 Telegram 圖片失敗：${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`圖片太大，請壓到 ${Math.round(maxBytes / 1_000_000)}MB 以內再傳。`);
  }

  const mimeType = imageDocument?.mime_type || mimeTypeFromPath(filePath);
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function mimeTypeFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function splitTelegramText(text) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 4096) {
    let index = remaining.lastIndexOf("\n", 3900);
    if (index < 1200) index = 3900;
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function parseAllowedIds(value) {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isPlaceholderToken(value) {
  return /your-telegram-bot-token|1234567890/i.test(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop() {
  stopped = true;
  console.log("Stopping Telegram bot...");
}
