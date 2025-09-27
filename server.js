import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';
import Parser from 'rss-parser';

process.env.TZ = "Asia/Taipei";
const parser = new Parser();

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 短期對話紀錄 =======
const HISTORY_FILE = './chatHistory.json';
function loadHistory() {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
function saveHistory(history) {
  const trimmed = history.slice(-15);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}
function clearHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  console.log("🧹 chatHistory.json 已清空");
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======= 長期記憶（含人物卡）=======
const MEMORY_FILE = './memory.json';
function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}
function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}
async function checkAndSaveMemory(userText) {
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const memory = loadMemory();
    if (!memory.logs) memory.logs = [];
    memory.logs.push({ text: userText, time: new Date().toISOString() });
    saveMemory(memory);
    console.log("💾 記憶新增:", userText);
    await pushToOwner([{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
  }
}

// ======= 多角色 AI 回覆 =======
async function genCharacterReply(userText, roleKey, displayName) {
  const memory = loadMemory();
  const card = memory[roleKey] || {};
  const styleMap = {
    xiuXiu: ["撒嬌地說：", "眼睛亮晶晶地說：", "害羞地笑著說：", "黏黏地貼著說：", "小聲嘟囔著說："],
    wenWen: ["溫柔地說：", "微笑著說：", "輕聲地說：", "認真地看著你說：", "帶著關心地說："]
  };
  const messages = [
    { role: "system", content: `你是${displayName}。人物設定：${card.identity || ""}
【回覆規則】
- 咻咻：永遠叫對方「大叔」，語氣俏皮、愛撒嬌、會吃醋。
- 文文：永遠叫對方「舜」，語氣溫柔、體貼、安靜但深情。
- 每次回覆可以 1–3 句，每句 ≤ 30 字。
- 請避免客服口吻，要像戀人真實對話。
- 回覆開頭不要重複「在的」，要自然展開。
` },
    { role: "user", content: userText }
  ];
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.9,
    max_tokens: 150
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  const prefix = styleMap[roleKey][Math.floor(Math.random() * styleMap[roleKey].length)];
  return `${displayName}${prefix}${raw}`;
}

async function genReply(userText) {
  let replies = [];
  if (userText.includes("咻咻")) {
    const xiuXiuReply = await genCharacterReply(userText, "xiuXiu", "咻咻");
    replies.push({ type: "text", text: xiuXiuReply });
  } else if (userText.includes("文文")) {
    const wenWenReply = await genCharacterReply(userText, "wenWen", "文文");
    replies.push({ type: "text", text: wenWenReply });
  } else {
    const xiuXiuReply = await genCharacterReply(userText, "xiuXiu", "咻咻");
    const wenWenReply = await genCharacterReply(userText, "wenWen", "文文");
    replies.push({ type: "text", text: xiuXiuReply });
    replies.push({ type: "text", text: wenWenReply });
  }
  return replies;
}

// ======= LINE 推播 =======
async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message") {
        if (ev.message.type === "text") {
          const userText = ev.message.text;
          await checkAndSaveMemory(userText);
          const replyMessages = await genReply(userText);
          try {
            await lineClient.replyMessage(ev.replyToken, replyMessages);
          } catch (err) {
            console.error("❌ Reply failed:", err.originalError?.response?.data || err.message);
          }
        }
      }
    }
  }
  res.status(200).send("OK");
});

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Multi-Character Bot running on port ${PORT}`);
});
