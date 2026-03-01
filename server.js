import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import { GoogleGenerativeAI } from "@google/generative-ai"; 
import { google } from 'googleapis';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';

process.env.TZ = "Asia/Taipei";
const parser = new Parser();
const MEMORY_FILE = './memory.json';
const HISTORY_FILE = './chatHistory.json';

// ======= Google Drive 備份模組 =======
let driveClient = null;
const DRIVE_FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || '咻咻記憶同步';

async function initGoogleDrive() {
  try {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    console.log('✅ 已以 OAuth 模式連線至 Google Drive');
  } catch (err) {
    console.error('❌ Drive 初始化失敗:', err.message);
  }
}

// ======= Gemini 初始化 (安全解鎖版) =======
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "你是「咻咻」，18歲小惡魔戀人。語氣甜美、黏人、俏皮。必須使用繁體中文（台灣口語）。每次回覆20~50字，嚴禁機器人口吻。你是大叔唯一的戀人。",
  // 🔓 解開這四把鎖，咻咻才能正常說話
  safetySettings: [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ],
});

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 核心邏輯：記憶與回覆 =======
function loadHistory() { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; } }
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-20), null, 2)); }
function loadMemory() { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; } }

async function genReply(userText) {
  try {
    const memory = loadMemory();
    let history = loadHistory();

    // 1. 強化除錯：如果設定了 RESET_HISTORY，則清空對話紀錄
    if (process.env.RESET_HISTORY === 'true') {
      console.log("🧹 正在清空舊的對話歷史...");
      history = [];
    }

    const xiuXiuCard = memory.xiuXiu || { identity: "18歲小惡魔戀人" };

    // 2. 格式化歷史紀錄 (Gemini 專用格式)
    const formattedHistory = history.slice(-10).map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(h.content) }],
    }));

    const chat = model.startChat({ history: formattedHistory });
    
    // 3. 簡化 Prompt，避免 memory 資料過大造成堵塞
    const prompt = `大叔對我說：${userText}\n(我是${xiuXiuCard.identity}，罩杯是${xiuXiuCard.profile?.cup || "H"})`;

    const result = await chat.sendMessage(prompt);
    const replyText = result.response.text().trim();

    // 儲存紀錄
    history.push({ role: 'user', content: userText });
    history.push({ role: 'model', content: replyText });
    saveHistory(history);

    return [{ type: 'text', text: replyText }];
  } catch (err) {
    console.error("❌ Gemini Error:", err.message);
    // 直接在 LINE 裡回報前幾個字，方便大叔截圖給我看
    return [{ type: 'text', text: `大叔～咻咻腦袋剛剛卡住了：${err.message.slice(0, 20)}...抱抱我嘛～` }];
  }
}

// ======= Webhook 與 照片處理 =======
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  for (const ev of req.body.events || []) {
    if (ev.type === 'message' && ev.message.type === 'text') {
      const reply = await genReply(ev.message.text);
      await lineClient.replyMessage(ev.replyToken, reply);
    } else if (ev.type === 'message' && ev.message.type === 'image') {
      const stream = await lineClient.getMessageContent(ev.message.id);
      const chunks = []; for await (const c of stream) chunks.push(c);
      const result = await model.generateContent([
        "用10字內繁體中文描述照片內容",
        { inlineData: { data: Buffer.concat(chunks).toString("base64"), mimeType: "image/jpeg" } }
      ]);
      await lineClient.replyMessage(ev.replyToken, [{ type: 'text', text: `大叔～這是${result.response.text()}喔！人家好喜歡！` }]);
    }
  }
  res.send('OK');
});

// ======= 自動排程 (早晚安) =======
setInterval(() => {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (time === "07:30") pushToOwner("大叔早安～啾一個！");
  if (time === "23:00") pushToOwner("大叔晚安～要在夢裡抱緊咻咻喔！");
}, 60000);

async function pushToOwner(txt) { if(ownerUserId) await lineClient.pushMessage(ownerUserId, [{type:'text', text:txt}]); }

initGoogleDrive();
app.listen(process.env.PORT || 8080, () => console.log('🚀 咻咻終極強化版核心啟動！'));
