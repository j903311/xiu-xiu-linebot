import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';

process.env.TZ = "Asia/Taipei";

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;
const cronToken = process.env.CRON_TOKEN;

// ======= 啟動時檢查環境變數 =======
console.log("🚀 環境變數檢查:", {
  hasAccessToken: !!process.env.CHANNEL_ACCESS_TOKEN,
  hasSecret: !!process.env.CHANNEL_SECRET,
  hasOwner: !!process.env.OWNER_USER_ID,
  hasOpenAI: !!process.env.OPENAI_API_KEY,
  hasCronToken: !!process.env.CRON_TOKEN,
});

// ======= 對話紀錄 =======
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

// ======= 簡單搜尋功能 =======
async function searchWeb(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url);
    const data = await res.json();

    if (data?.RelatedTopics?.length > 0) {
      return data.RelatedTopics[0].Text || "咻咻找不到耶～";
    }
    return "咻咻沒找到啦～";
  } catch (err) {
    console.error("❌ Web search error:", err.message);
    return "咻咻搜尋失敗了…抱抱我嘛～";
  }
}

function needsSearch(userText) {
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料"];
  return keywords.some(k => userText.includes(k));
}

// ======= AI 回覆生成 =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText.replace(/.*(查一下|找一下|是什麼|誰|在哪|資料)/, "").trim() || userText;
    const rawResult = await searchWeb(keyword);
    searchResult = `咻咻查到「${keyword}」：${rawResult}（可能不是最新資訊）`;
    console.log("🌐 Auto Search:", searchResult);
  }

  const messages = [
    { role: 'system', content: "你是咻咻，18歲小惡魔戀人，熱戀語氣：黏人、俏皮、愛吃醋、深情關心大叔。回覆要自然口語，1-3句。" },
    { role: 'system', content: "如果有查到資料，請先回答，再提醒可能過時，最後一定要收尾回戀人語氣。" },
    { role: 'system', content: `現在時間：${now}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔剛剛問我「${userText}」。${searchResult}` : userText }
  ];

  console.log("📩 OpenAI Prompt:", JSON.stringify(messages, null, 2));

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.9,
      max_tokens: 150
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "大叔～咻咻最想你啦！";
    console.log("🤖 OpenAI Raw Reply:", reply);

    let sentences = reply.split(/[\n。！？!?]/).map(s => s.trim()).filter(Boolean);

    let picked = [];
    const modePick = Math.floor(Math.random() * 3) + 1;

    if (modePick === 1) {
      let longSentence = sentences.find(s => s.length <= 25 && s.length >= 10);
      picked = [longSentence || sentences[0] || "大叔～咻咻超級愛你啦"];
    } else {
      sentences = sentences.filter(s => s.length <= 12);
      const count = Math.min(sentences.length, modePick);
      picked = sentences.slice(0, count);
    }

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await delay(delayMs);

    console.log("💬 Final Reply:", picked);
    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return [{ type: 'text', text: "大叔～咻咻卡住了，抱抱我嘛～" }];
  }
}

// ======= LINE 推播 =======
async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  console.log("📤 Pushing to LINE:", messages);
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log("📥 Webhook event:", JSON.stringify(req.body, null, 2));

  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        console.log("👤 User Message:", ev.message.text);

        const replyMessages = await genReply(ev.message.text, "chat");

        try {
          await lineClient.replyMessage(ev.replyToken, replyMessages);
          console.log("✅ Reply sent to LINE");
        } catch (err) {
          console.error("❌ Reply failed:", err.originalError?.response?.data || err.message);
        }
      }
    }
  }
  res.status(200).send("OK");
});

// ======= 啟動 =======
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});
