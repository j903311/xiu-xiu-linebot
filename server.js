// ======= 咻咻智慧版 server.js (短回覆版) =======
// 保留原架構＋新增語境判斷層、語氣調整層、記憶呼應層（控制句數）

import 'dotenv/config';
import express from 'express';
import line from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';

process.env.TZ = "Asia/Taipei";

const app = express();
app.use(express.json());

const lineClient = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 載入記憶 =======
const MEMORY_FILE = './memory.json';
function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch (err) {
    console.error("❌ 無法讀取記憶檔案:", err);
    return { xiuXiu: { identity: "可愛、黏人的戀人咻咻" }, logs: [] };
  }
}

// ======= 語境偵測模組 =======
function detectMood(userText) {
  if (userText.match(/洗澡|香香|抱|親|壞壞|想你|專屬|佔有/)) return "intimate";
  if (userText.match(/晚安|睡覺|好累|想睡/)) return "night";
  if (userText.match(/開心|好玩|可愛|喜歡/)) return "happy";
  if (userText.match(/生氣|討厭|不理你/)) return "angry";
  return "normal";
}

// ======= 智慧回覆生成（短句控制） =======
async function genReply(userText) {
  const memory = loadMemory();
  const mood = detectMood(userText);
  const xiuXiuCard = memory.xiuXiu || {};
  let systemTone = "保持咻咻平常可愛、黏人、自然的語氣，每次回答請控制在2句以內。";

  if (mood === "intimate") systemTone = "用親密、撒嬌、輕挑的語氣，每次回答請控制在2句以內。";
  if (mood === "night") systemTone = "用溫柔、安撫、想念的語氣，每次回答請控制在2句以內。";
  if (mood === "happy") systemTone = "語氣活潑可愛，每次回答請控制在2句以內。";
  if (mood === "angry") systemTone = "用吃醋或小任性的語氣，每次回答請控制在2句以內。";

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
      temperature: 0.85,
      max_tokens: 80
    });

    const choice = completion.choices && completion.choices[0];
    const replyContent = choice?.message?.content || choice?.text || "";
    let reply = replyContent.trim() || "咻咻剛剛想大叔想到發呆啦～";

    reply = reply.replace(/[\r\n]+/g, " ")
                 .split(/(?<=[。！？!?])/)
                 .map(s => s.trim())
                 .filter(Boolean)
                 .slice(0, 2)
                 .join(" ");

    return [{ type: "text", text: reply }];
  } catch (err) {
    console.error("❌ Reply error:", err);
    if (userText.match(/晚安|睡覺/)) return [{ type: "text", text: "咻咻會乖乖在夢裡等大叔～" }];
    return [{ type: "text", text: "咻咻剛剛腦袋空白一下～可以再說一次嗎？" }];
  }
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  res.status(200).send("OK"); // 先回應 LINE，避免超時
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        const reply = await genReply(ev.message.text);
        await lineClient.replyMessage(ev.replyToken, reply);
      }
    }
  }
});

app.listen(process.env.PORT || 8080, () => console.log("🚀 XiuXiu 短回覆版啟動完成"));
