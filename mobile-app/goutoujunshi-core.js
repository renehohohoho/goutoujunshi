import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export function loadDotEnv(filePath = path.join(__dirname, ".env")) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function safeRead(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  return readFile(fullPath, "utf8");
}

function pickReferencePaths(text) {
  const routes = new Set(["references/knowledge/21-私人書籍參考書架與轉化規則.md"]);
  const normalized = text.toLowerCase();

  if (/怎麼回|怎么回|回覆|回复|邀約|邀约|話術|话术|不回|已讀|已读/.test(text)) {
    routes.add("references/practical/實戰話術編排器：從一句回覆到後續分支.md");
  }
  if (/焦慮|焦虑|不安|依戀|依恋|冷落|拋棄|抛弃|羞辱|創傷|创伤|親密恐懼|亲密恐惧/.test(text)) {
    routes.add("references/knowledge/03-依戀理論與情緒調節.md");
  }
  if (/吵架|衝突|冲突|道歉|修復|修复|溝通|沟通|非暴力/.test(text)) {
    routes.add("references/knowledge/07-溝通衝突與修復.md");
  }
  if (/出軌|出轨|外遇|背叛|復合|复合|分手|無性|无性|慾望|欲望/.test(text)) {
    routes.add("references/knowledge/15-分手背叛與關係修復.md");
  }
  if (/性|親密|亲密|同意|邊界|边界/.test(text)) {
    routes.add("references/knowledge/08-同意邊界性與親密.md");
  }
  if (/榮格|荣格|jung|阿德勒|佛洛姆|fromm|巴特|barthes|包曼|bauman|哲學|哲学/.test(normalized)) {
    routes.add("references/knowledge/10-戀愛哲學.md");
  }

  return [...routes].slice(0, 4);
}

async function buildInstructions(messages, channelName) {
  const recentText = messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
  const skill = await safeRead("SKILL.md");
  const references = await Promise.all(
    pickReferencePaths(recentText).map(async (route) => {
      const content = await safeRead(route);
      return `\n\n## ${route}\n${content}`;
    })
  );
  const privateBookContext = await pickPrivateBookContext(recentText);

  return [
    skill,
    `\n\n# ${channelName}運行規則`,
    `你是 Master Dog 的${channelName}聊天入口。回答使用繁體中文，除非用戶指定其他語言。`,
    "先接住情緒，再分清事實/推測/未知，最後給一個能立刻執行的小動作。",
    "用戶只問怎麼回時，先給一條可直接複製的回覆，再用短句說明時機和後續分支。",
    channelName === "Telegram"
      ? [
          "Telegram 回覆必須手機友善：不要用 Markdown 大標題、分隔線、長表格或學術報告格式。",
          `預設控制在 180–350 字；複雜截圖最多 ${process.env.TELEGRAM_REPLY_MAX_CHARS || 700} 字。除非用戶要求詳細分析，否則不要列完整「情緒落地/事實拆分/下一步建議」三段式。`,
          "輸出順序：先給「可以直接發：...」，再給 2–3 句判斷，最後給一個下一步或停止條件。",
          "若需要條列，每次最多 3 點；不要用多層 bullet；不要使用 ###、---、大量粗體或公式符號。",
          "截圖分析只保留會影響行動的事實，不逐條抄完整對話。"
        ].join("\n")
      : "網頁版可以比 Telegram 稍微完整，但仍以可執行為主。",
    "不要宣稱已閱讀或引用私人書籍原文；只根據知識庫中的轉化規則使用書籍視角。",
    privateBookContext,
    references.join("")
  ].join("\n");
}

async function pickPrivateBookContext(query) {
  const indexPath = process.env.PRIVATE_BOOK_INDEX_PATH || "private-book-index.json";
  const fullPath = path.isAbsolute(indexPath)
    ? indexPath
    : path.join(__dirname, indexPath);
  if (!existsSync(fullPath)) return "";

  try {
    const index = JSON.parse(await readFile(fullPath, "utf8"));
    const chunks = Array.isArray(index.chunks) ? index.chunks : [];
    const terms = extractSearchTerms(query);
    if (!terms.length) return "";

    const ranked = chunks
      .map((chunk) => ({
        chunk,
        score: scoreChunk(chunk, terms)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(process.env.PRIVATE_BOOK_MAX_CHUNKS || 3));

    if (!ranked.length) return "";

    const entries = ranked.map(({ chunk }) => {
      const text = String(chunk.text || "").slice(0, 1200);
      return `### ${chunk.book || "私人書籍"} #${chunk.chunk_id ?? ""}\n${text}`;
    });

    return [
      "\n\n# 私人書庫檢索片段",
      "以下片段來自用戶本機私人書庫索引，只作內部參考。回答時請轉化為建議，不要長篇逐字引用；不要聲稱完整讀完原書。",
      entries.join("\n\n")
    ].join("\n");
  } catch (error) {
    return `\n\n# 私人書庫狀態\n私人書庫索引讀取失敗：${error.message}`;
  }
}

function extractSearchTerms(text) {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  const cjk = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}/g) || [];
  const cjkPairs = cjk.flatMap((segment) => {
    const pairs = [];
    for (let index = 0; index < segment.length - 1; index += 1) {
      pairs.push(segment.slice(index, index + 2));
    }
    return pairs;
  });
  const stop = new Set(["用戶", "軍師", "這個", "那個", "可以", "怎麼", "怎么", "幫我", "分析"]);
  return [...new Set([...latin, ...cjk, ...cjkPairs])].filter(
    (term) => term.length >= 2 && !stop.has(term)
  );
}

function scoreChunk(chunk, terms) {
  const haystack = `${chunk.book || ""}\n${chunk.text || ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const occurrences = haystack.split(term).length - 1;
    if (occurrences > 0) score += Math.min(occurrences, 5) * Math.min(term.length, 8);
  }
  return score;
}

export function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, 8000),
      images: Array.isArray(message.images)
        ? message.images
            .filter((image) => typeof image === "string" && image.startsWith("data:image/"))
            .slice(0, 4)
        : []
    }))
    .slice(-16);
}

export async function askGoutoujunshi(messages, options = {}) {
  const cleanMessages = normalizeMessages(messages);
  if (!cleanMessages.some((message) => message.role === "user" && message.content.trim())) {
    throw new Error("No user message");
  }

  const provider = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  const channelName = options.channelName || "手機版";
  const instructions = await buildInstructions(cleanMessages, channelName);
  if (provider === "gemini") {
    return askGemini(cleanMessages, instructions);
  }
  if (provider === "openai") {
    return askOpenAI(cleanMessages, instructions);
  }
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

async function askOpenAI(cleanMessages, instructions) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY on the server");

  const model = process.env.OPENAI_MODEL || "gpt-5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions,
      input: cleanMessages.map((message) => ({
        role: message.role,
        content: [
          {
            type: "input_text",
            text: `${message.role === "user" ? "用戶" : "軍師"}：${message.content || "[圖片]"}`
          },
          ...message.images.map((imageUrl) => ({
            type: "input_image",
            image_url: imageUrl,
            detail: "high"
          }))
        ]
      }))
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed");
  }

  return {
    text: data.output_text || "",
    model: data.model || model
  };
}

async function askGemini(cleanMessages, instructions) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY on the server");
  if (/your-gemini-api-key/i.test(apiKey)) {
    throw new Error("GEMINI_API_KEY still looks like the example value. Paste a real key from Google AI Studio into mobile-app/.env.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: instructions }]
      },
      contents: cleanMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [
          {
            text: `${message.role === "user" ? "用戶" : "軍師"}：${message.content || "[圖片]"}`
          },
          ...message.images.map(dataUrlToGeminiPart)
        ]
      }))
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini request failed");
  }

  const text = (data.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();

  return {
    text,
    model
  };
}

function dataUrlToGeminiPart(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data URL");
  return {
    inline_data: {
      mime_type: match[1],
      data: match[2]
    }
  };
}
