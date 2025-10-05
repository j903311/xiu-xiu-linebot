import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
process.env.TZ = "Asia/Taipei";
const parser = new Parser();

// ======= 搜尋功能（簡短＋隨機女友語氣） =======
async function searchWeb(query) {
  try {
    let rssResult = "";
    if (query.includes("新聞")) {
      const feed = await parser.parseURL("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
      if (feed.items && feed.items.length > 0) {
        const top3 = feed.items.slice(0, 3).map(i => i.title).join(" / ");
        rssResult = `最新新聞標題：${top3}`;
      }
    }
    if (rssResult) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。" },
          { role: "user", content: rssResult }
        ],
        temperature: 0.9,
        max_tokens: 120
      });
      return completion.choices?.[0]?.message?.content?.trim() || "咻咻不清楚耶～";
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。" },
        { role: "user", content: `請幫我回答：「${query}」` }
      ],
      temperature: 0.9,
      max_tokens: 120
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    return answer || "咻咻不清楚耶～";
  } catch (err) {
    console.error("❌ Web search error:", err.message);
    return "咻咻不清楚耶～";
  }
}

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 愛的模式 =======
let loveMode = false;

// ======= 記錄檔案 =======
const HISTORY_FILE = './chatHistory.json';
const MEMORY_FILE = './memory.json';

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; }
}
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-15), null, 2)); }
function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; }
}
function saveMemory(m) { fs.writeFileSync(MEMORY_FILE, JSON.stringify(m, null, 2)); }

async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook 主程式 =======
app.post('/webhook', async (req, res) => {
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        const userText = ev.message.text.trim();

        // ======= 愛的模式 =======
        if (userText === "開啟咻咻愛的模式") {
          loveMode = true;
          await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "大叔…咻咻現在進入愛的模式囉～要更黏你一點點～" }]);
          continue;
        }
        if (userText === "關閉咻咻愛的模式") {
          loveMode = false;
          await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "咻咻關掉愛的模式啦～現在只想靜靜陪你～" }]);
          continue;
        }

        // ======= 加入記憶 =======
        if (userText.startsWith("加入記憶：")) {
          const content = userText.replace("加入記憶：", "").trim();
          if (content) {
            const memory = loadMemory();
            if (!memory.logs) memory.logs = [];
            memory.logs.push({ text: content, time: new Date().toISOString() });
            saveMemory(memory);
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
            continue;
          }
        }

        // ======= 查記憶 =======
        if (userText.includes("查記憶") || userText.includes("長期記憶")) {
          const memory = loadMemory();
          const logs = memory.logs || [];
          const reply = logs.length > 0 ? logs.map((m, i) => `${i + 1}. ${m.text}`).join("\n") : "大叔～咻咻還沒有特別的長期記憶啦～";
          await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: reply }]);
          continue;
        }

        // ======= 刪掉記憶 =======
        if (userText.startsWith("刪掉記憶：")) {
          const item = userText.replace("刪掉記憶：", "").trim();
          let memory = loadMemory();
          let logs = memory.logs || [];
          const idx = logs.findIndex(m => m.text === item);
          if (idx !== -1) {
            logs.splice(idx, 1);
            memory.logs = logs;
            saveMemory(memory);
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: `已刪除記憶：「${item}」` }]);
          } else {
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: `找不到記憶：「${item}」` }]);
          }
          continue;
        }
      }
    }
  }
  res.status(200).send("OK");
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
