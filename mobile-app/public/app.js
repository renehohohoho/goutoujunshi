const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const input = document.querySelector("#input");
const sendButton = document.querySelector("#sendButton");
const settings = document.querySelector("#settings");
const settingsButton = document.querySelector("#settingsButton");
const tokenInput = document.querySelector("#tokenInput");
const saveTokenButton = document.querySelector("#saveTokenButton");

const STORAGE_KEY = "goutoujunshi.messages";
const TOKEN_KEY = "goutoujunshi.token";

let messages = loadMessages();
let token = localStorage.getItem(TOKEN_KEY) || "";
tokenInput.value = token;

if (!messages.length) {
  messages = [
    {
      role: "assistant",
      content: "我在。你可以直接貼聊天記錄，也可以只說現在最卡的是情緒、回覆、推進、修復，還是要退場。"
    }
  ];
}

render();

settingsButton.addEventListener("click", () => {
  settings.hidden = !settings.hidden;
});

saveTokenButton.addEventListener("click", () => {
  token = tokenInput.value.trim();
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  settings.hidden = true;
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || sendButton.disabled) return;

  messages.push({ role: "user", content });
  input.value = "";
  input.style.height = "auto";
  persist();
  render();
  await ask();
});

async function ask() {
  sendButton.disabled = true;
  const placeholder = { role: "assistant", content: "我想一下，先把情緒和事實分開..." };
  messages.push(placeholder);
  render();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        messages: messages.filter((message) => message !== placeholder)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "回覆失敗");
    placeholder.content = data.text || "我這次沒有生成內容，你再貼一次情境。";
  } catch (error) {
    placeholder.role = "error";
    placeholder.content = `連線失敗：${error.message}`;
  } finally {
    sendButton.disabled = false;
    persist();
    render();
  }
}

function render() {
  messagesEl.replaceChildren(
    ...messages.map((message) => {
      const bubble = document.createElement("article");
      bubble.className = `message ${message.role}`;
      bubble.textContent = message.content;
      return bubble;
    })
  );
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function persist() {
  const kept = messages.filter((message) => message.role !== "error").slice(-40);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
}

function loadMessages() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
