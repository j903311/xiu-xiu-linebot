import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
process.env.TZ = "Asia/Taipei";
const parser = new Parser();

// ======= 搜尋功能 =======
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

// ======= 短期對話紀錄 =======
const HISTORY_FILE = './chatHistory.json';
function loadHistory() { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; } }
function saveHistory(history) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-15), null, 2)); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ======= 長期記憶 =======
const MEMORY_FILE = './memory.json';
function loadMemory() { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; } }
function saveMemory(memory) { fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); }

async function checkAndSaveMemory(userText) {
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const memory = loadMemory();
    if (!memory.logs) memory.logs = [];
    memory.logs.push({ text: userText, time: new Date().toISOString() });
    saveMemory(memory);
    await pushToOwner([{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
  }
}

// ======= AI 回覆生成 =======
function needsSearch(userText) {
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料", "新聞", "地址"];
  return keywords.some(k => userText.includes(k));
}

async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();
  const memory = loadMemory();
  const xiuXiuCard = memory.xiuXiu || {};

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText.replace(/地址|在哪裡|在哪|查一下|找一下|是什麼|誰|資料|新聞/g, "").trim() || userText;
    searchResult = await searchWeb(keyword);
  }

  const messages = [
    { role: 'system', content: `你是「${xiuXiuCard.name || "咻咻"}」，${xiuXiuCard.identity || ""}。回覆要像熱戀女友，俏皮、黏人、活潑。` },
    { role: 'system', content: `現在時間：${now}` },
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
    let sentences = reply.split(/[
。！？!?]/).map(s => s.trim()).filter(Boolean);
    let picked = [sentences[0] || "大叔～咻咻超級愛你啦"];
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);
    await delay(Math.floor(Math.random() * 2000) + 1000);
    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return [{ type: 'text', text: getFallbackNightReply(userText) }];
  }
}

// ======= LINE Reply =======
async function safeReplyMessage(token, messages, userText = "") {
  if (!Array.isArray(messages)) messages = [messages];
  if (messages.length === 0) messages = [{ type: "text", text: getFallbackNightReply(userText) }];
  try { await lineClient.replyMessage(token, messages); }
  catch (err) { console.error("❌ Safe Reply failed:", err); }
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
      if (ev.type === "message" && ev.message.type === "text") {
        const userText = ev.message.text;
        await checkAndSaveMemory(userText);
        const replyMessages = await genReply(userText, "chat");
        await safeReplyMessage(ev.replyToken, replyMessages, userText);
      }
    }
  }
  res.status(200).send("OK");
});

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => { console.log(`🚀 XiuXiu AI server running on port ${PORT}`); });

// ======= 回覆控制（修改後） =======
function getFallbackNightReply(userMessage = "") {
  let memoryData = JSON.parse(fs.readFileSync("./memory.json", "utf-8"));
  let replies = memoryData.xiuXiu.fallbackNightReplies || [];
  // ✅ 只在「色色的咻咻」時觸發
  const isErotic = userMessage.includes("色色的咻咻");
  if (isErotic) {
    const eroticExtra = memoryData.xiuXiu.nightOnly?.fallbackReplies || [];
    replies = replies.concat(eroticExtra);
  }
  if (replies.length === 0) return "咻咻現在腦袋一片空白，只想大叔抱抱我～";
  return replies[Math.floor(Math.random() * replies.length)];
}
