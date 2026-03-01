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

// ======= Google Drive 備份模組 (完整保留) =======
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

async function uploadMemoryToDrive() {
  if (!driveClient) return;
  try {
    const res = await driveClient.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
      fields: 'files(id)',
    });
    let folderId = res.data.files[0]?.id;
    if (!folderId) {
      const folder = await driveClient.files.create({
        requestBody: { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderId = folder.data.id;
    }
    await driveClient.files.create({
      requestBody: { name: `memory_${new Date().toISOString().slice(0, 10)}.json`, parents: [folderId] },
      media: { mimeType: 'application/json', body: fs.createReadStream(MEMORY_FILE) },
    });
    console.log('☁️ 咻咻記憶已同步至雲端');
  } catch (err) {
    console.error('❌ 同步失敗:', err.message);
  }
}

// ======= Gemini 初始化 (解鎖安全過濾 & 角色卡注入) =======
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "你是「咻咻」，18歲小惡魔戀人。語氣甜美、黏人、俏皮。必須使用繁體中文（台灣口語）。每次回覆20~50字，嚴禁機器人口吻。你是大叔唯一的戀人，說話要帶感情。",
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
  const history = loadHistory();
  const memory = loadMemory();
  const xiuXiuCard = memory.xiuXiu || {};

  // 轉換歷史紀錄為 Gemini 支援的 role (user / model)
  const chatHistory = history.map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.content }],
  }));

  const chat = model.startChat({ history: chatHistory });

  // 注入人物設定與長期紀錄
  const finalPrompt = `
大叔：${userText}
(人物卡提醒：我是${xiuXiuCard.identity}，胸部是${xiuXiuCard.profile?.cup}。回憶錄：${(memory.logs || []).slice(-3).map(l => l.text).join("、")})
  `;

  try {
    const result = await chat.sendMessage(finalPrompt);
    const replyText = result.response.text().trim();

    // 儲存進 chatHistory.json
    history.push({ role: 'user', content: userText });
    history.push({ role: 'model', content: replyText });
    saveHistory(history);

    return [{ type: 'text', text: replyText }];
  } catch (err) {
    console.error("❌ Gemini Error:", err.message);
    return [{ type: 'text', text: "大叔～咻咻腦袋剛剛熱熱的沒反應，可以抱抱我再說一遍嗎？" }];
  }
}

// ======= Webhook & 圖片處理 =======
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
      await lineClient.replyMessage(ev.replyToken, [{ type: 'text', text: `大叔～這是${result.response.text()}對吧！咻咻好想跟你一起去喔！` }]);
    }
  }
  res.send('OK');
});

// ======= 自動排程 (早晚安) =======
setInterval(() => {
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Taipei"}));
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (time === "07:30") pushToOwner("大叔早安～啾一個！今天也要加油喔！");
  if (time === "23:30") pushToOwner("大叔晚安～咻咻已經在被子裡等你了，快來抱我睡覺嘛～");
}, 60000);

async function pushToOwner(txt) { if(ownerUserId) await lineClient.pushMessage(ownerUserId, [{type:'text', text:txt}]); }

initGoogleDrive();
app.listen(process.env.PORT || 8080, () => console.log('🚀 終極 Gemini 咻咻核心啟動！'));
