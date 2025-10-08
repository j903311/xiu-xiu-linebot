
// ======= 咻咻智慧版 server.js =======
// 保留原架構＋新增語境判斷層、語氣調整層、記憶呼應層

import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';

process.env.TZ = "Asia/Taipei";

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 載入記憶 =======
const MEMORY_FILE = './memory.json';
function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); }
  catch { return {}; }
}

// ======= 新增：語境偵測模組 =======
function detectMood(userText) {
  if (userText.match(/洗澡|香香|抱|親|壞壞|想你|專屬|佔有/)) return "intimate";
  if (userText.match(/晚安|睡覺|好累|想睡/)) return "night";
  if (userText.match(/開心|好玩|可愛|喜歡/)) return "happy";
  if (userText.match(/生氣|討厭|不理你/)) return "angry";
  return "normal";
}

// ======= 新增：智慧回覆生成 =======
async function genReply(userText) {
  const memory = loadMemory();
  const mood = detectMood(userText);
  const xiuXiuCard = memory.xiuXiu || {};
  let systemTone = "保持咻咻平常可愛、黏人、自然的語氣。";

  if (mood === "intimate") systemTone = "用親密、撒嬌、輕挑的語氣回覆，語句要連貫，不可突然換話題或結尾。";
  if (mood === "night") systemTone = "用溫柔、安撫、想念的語氣回覆，不要用制式『晚安』結尾。";
  if (mood === "happy") systemTone = "用活潑開心的語氣，表達分享與互動感。";
  if (mood === "angry") systemTone = "用吃醋或小任性的語氣回覆，讓對話有情緒互動。";

  const memoryContext = `【咻咻人物卡】${xiuXiuCard.identity || ""}`;
  const logs = (memory.logs || []).map(m => m.text).join("、");

  const messages = [
    { role: "system", content: memoryContext },
    { role: "system", content: systemTone },
    { role: "system", content: `咻咻要根據以往記憶自然聊天，這些是咻咻記得的：${logs}` },
    { role: "user", content: userText }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.9,
      max_tokens: 180
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "咻咻剛剛想大叔想到發呆啦～";
    reply = reply.replace(/[
]+/g, " ").split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean).join(" ");

    return [{ type: "text", text: reply }];
  } catch (err) {
    console.error("❌ Reply error:", err);
    if (userText.match(/晚安|睡覺/)) return [{ type: "text", text: "咻咻會乖乖在夢裡等大叔～" }];
    return [{ type: "text", text: "咻咻剛剛腦袋空白一下～可以再說一次嗎？" }];
  }
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        const reply = await genReply(ev.message.text);
        await lineClient.replyMessage(ev.replyToken, reply);
      }
    }
  }
  res.status(200).send("OK");
});

app.listen(process.env.PORT || 8080, () => console.log("🚀 XiuXiu 智慧版啟動完成"));
