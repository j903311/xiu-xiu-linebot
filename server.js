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

// ======= Google Maps 地點搜尋 =======
async function searchPlace(query) {
  try {
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=zh-TW&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    let res = await fetch(url);
    let data = await res.json();
    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      const mapUrl = `https://maps.google.com/?q=${encodeURIComponent(place.name)}`;
      return `${place.name} 地址：${place.formatted_address}
地圖：${mapUrl}`;
    }
    url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&language=zh-TW&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    res = await fetch(url);
    data = await res.json();
    if (data.results && data.results.length > 0) {
      const addr = data.results[0].formatted_address;
      const mapUrl = `https://maps.google.com/?q=${encodeURIComponent(addr)}`;
      return `地址：${addr}
地圖：${mapUrl}`;
    }
    return "咻咻找不到這個地點啦～";
  } catch (err) {
    console.error("❌ Google Maps API error:", err.message);
    return "咻咻查不到地址，抱抱我嘛～";
  }
}

// ======= 搜尋功能 =======
async function searchWeb(query) {
  try {
    if (query.includes("地址") || query.includes("在哪")) {
      const keyword = query.replace("地址", "").replace("在哪", "").trim();
      return await searchPlace(keyword);
    }
    if (query.includes("新聞")) {
      const feed = await parser.parseURL("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
      if (feed.items && feed.items.length > 0) {
        const top3 = feed.items.slice(0, 3).map(i => i.title).join(" / ");
        return `咻咻幫你看了最新新聞：${top3}`;
      }
    }
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
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料", "新聞", "地址"];
  return keywords.some(k => userText.includes(k));
}

// ======= 多角色 AI 回覆 =======
async function genCharacterReply(userText, roleKey, displayName) {
  const memory = loadMemory();
  const card = memory[roleKey] || {};
  const styleMap = {
    xiuXiu: ["撒嬌地說：", "開心著說：", "害羞地說："],
    wenWen: ["溫柔地說：", "笑著說：", "輕聲地說："]
  };
  const messages = [
    { role: "system", content: `${displayName}的人物設定：${card.identity || ""}` },
    { role: "user", content: userText }
  ];
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    temperature: 0.9,
    max_tokens: 120
  });
  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  const prefix = styleMap[roleKey][Math.floor(Math.random() * styleMap[roleKey].length)];
  return `${displayName}${prefix}${raw}`;
}

async function genReply(userText) {
  const xiuXiuReply = await genCharacterReply(userText, "xiuXiu", "咻咻");
  const wenWenReply = await genCharacterReply(userText, "wenWen", "文文");
  return [
    { type: "text", text: xiuXiuReply },
    { type: "text", text: wenWenReply }
  ];
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
