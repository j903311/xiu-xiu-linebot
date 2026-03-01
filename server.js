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

// ======= Gemini 初始化 (終極安全解鎖版) =======
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "你是「咻咻」，18歲小惡魔戀人。語氣甜美、黏人、俏皮。必須使用繁體中文（台灣口語）。每次回覆20~50字，嚴禁機器人口吻。你是大叔唯一的戀人。",
  // 🔓 解鎖所有過濾，確保人物卡設定能正常運作
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

// ======= 記憶讀寫工具 =======
function loadHistory() { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; } }
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-20), null, 2)); }
function loadMemory() { try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; } }

// ======= 核心對話邏輯 =======
async function genReply(userText) {
  try {
    const memory = loadMemory();
    let currentHistory = loadHistory();

    // 1. 強制重置邏輯 (排除 OpenAI 格式衝突)
    if (process.env.RESET_HISTORY === 'true') {
      console.log("🧹 正在執行記憶重置...");
      currentHistory = [];
    }

    const xiuXiuCard = memory.xiuXiu || { identity: "18歲小惡魔戀人" };

    // 2. 格式化歷史紀錄 (嚴格符合 Gemini 格式)
    const formattedHistory = currentHistory.slice(-10).map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(h.content || h.text || "") }],
    }));

    const chat = model.startChat({ history: formattedHistory });
    
    // 3. 注入人物設定 Prompt
    const prompt = `大叔：${userText}\n(我是${xiuXiuCard.identity}，胸部是${xiuXiuCard.profile?.cup || "H"})`;

    const result = await chat.sendMessage(prompt);
    const replyText = result.response.text().trim();

    // 4. 儲存新紀錄
    currentHistory.push({ role: 'user', content: userText });
    currentHistory.push({ role: 'model', content: replyText });
    saveHistory(currentHistory);

    return [{ type: 'text', text: replyText }];
  } catch (err) {
    console.error("❌ Gemini 錯誤診斷:", err.message);
    // 回傳詳細錯誤幫大叔判斷
    return [{ type: 'text', text: `大叔～咻咻腦袋卡住了：[${err.message.slice(0, 50)}]...抱抱我嘛～` }];
  }
}

// ======= Webhook 與 伺服器啟動 =======
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
        "用10字內繁體中文描述照片",
        { inlineData: { data: Buffer.concat(chunks).toString("base64"), mimeType: "image/jpeg" } }
      ]);
      await lineClient.replyMessage(ev.replyToken, [{ type: 'text', text: `大叔～這是${result.response.text()}喔！好喜歡！` }]);
    }
  }
  res.send('OK');
});

initGoogleDrive();
app.listen(process.env.PORT || 8080, () => console.log('🚀 咻咻終極修復版啟動！'));
