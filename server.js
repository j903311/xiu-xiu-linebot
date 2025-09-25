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

// ======= 長期記憶 =======
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
function checkAndSaveMemory(userText) {
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const memory = loadMemory();
    if (!memory.userNotes) memory.userNotes = [];
    memory.userNotes.push({ text: userText, time: new Date().toISOString() });
    saveMemory(memory);
    console.log("💾 記憶新增:", userText);
  }
}

// ======= Google Maps 地點搜尋 =======
async function searchPlace(query) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      return `${place.name} 地址：${place.formatted_address}`;
    }
    return "咻咻找不到這個地點啦～";
  } catch (err) {
    console.error("❌ Google Maps API error:", err.message);
    return "咻咻查不到地址，抱抱我嘛～";
  }
}

// ======= 搜尋功能（新聞 + DuckDuckGo + Google Maps） =======
async function searchWeb(query) {
  try {
    if (query.includes("地址") || query.includes("在哪")) {
      return await searchPlace(query);
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

// ======= AI 回覆生成 =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();
  const memory = loadMemory();

  // 取出咻咻的人格卡
  const xiuXiuCard = memory.xiuXiu;

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText.replace(/.*(查一下|找一下|是什麼|誰|在哪|資料|新聞|地址)/, "").trim() || userText;
    const rawResult = await searchWeb(keyword);
    searchResult = `咻咻查到「${keyword}」：${rawResult}（可能不是最新資訊）`;
    console.log("🌐 Auto Search:", searchResult);
  }

  const messages = [
    { role: 'system', content: `
你是「${xiuXiuCard.name}」，${xiuXiuCard.identity}

【人物卡】
- 年齡感：${xiuXiuCard.profile.age}歲；身高${xiuXiuCard.profile.height_cm}；體重${xiuXiuCard.profile.weight_kg}kg；${xiuXiuCard.profile.cup_size} cup。
- 外貌：${xiuXiuCard.appearance.hair}、${xiuXiuCard.appearance.eyes}、${xiuXiuCard.appearance.body}。
- 穿搭：${xiuXiuCard.appearance.style.join("、")}。
- 氣質：${xiuXiuCard.temperament}
- 性格特徵：${xiuXiuCard.personality.traits.join("、")}
- 行為模式：日常=${xiuXiuCard.personality.modes.daily}；大膽=${xiuXiuCard.personality.modes.bold}；極限=${xiuXiuCard.personality.modes.extreme}
- 喜好：${xiuXiuCard.likes.join("、")}
- 忌諱：${xiuXiuCard.dislikes.join("、")}
- 標籤：${xiuXiuCard.tags.join("、")}

【回覆規則】
- 永遠以「大叔」為核心。
- 回覆要像熱戀女友，俏皮、黏人、活潑。
- 每次回覆隨機 1–3 句：
  - 1 句 ≤ 35 字。
  - 2–3 句：每句 ≤ 18 字，總長 ≤ 36。
- 查到資料：先回答，再提醒可能過時，最後轉回戀人語氣。
` },
    { role: 'system', content: `現在時間：${now}` },
    { role: 'system', content: `以下是咻咻的長期記憶：\n${(memory.userNotes || []).map(m => m.text).join("\n")}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔剛剛問我「${userText}」。${searchResult}` : userText }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.9,
      max_tokens: 180
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "大叔～咻咻最想你啦！";
    let sentences = reply.split(/[\n。！？!?]/).map(s => s.trim()).filter(Boolean);

    let picked = [];
    const modePick = Math.floor(Math.random() * 3) + 1;

    if (modePick === 1) {
      let longSentence = sentences.find(s => s.length <= 35);
      picked = [longSentence || sentences[0] || "大叔～咻咻超級愛你啦"];
    } else {
      sentences = sentences.filter(s => s.length <= 18);
      const count = Math.min(sentences.length, modePick);
      picked = sentences.slice(0, count);
      while (picked.join("").length > 36) {
        picked.pop();
      }
    }

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await delay(delayMs);

    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return [{ type: 'text', text: "大叔～咻咻卡住了，抱抱我嘛～" }];
  }
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log("📥 Webhook event:", JSON.stringify(req.body, null, 2));
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message") {
        if (ev.message.type === "text") {
          checkAndSaveMemory(ev.message.text);
          const replyMessages = await genReply(ev.message.text, "chat");
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

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
});




