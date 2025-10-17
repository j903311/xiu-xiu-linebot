
// ======= XiuXiu AI + Google Cloud Memory Sync (server_v3.js) =======
import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { google } from 'googleapis';

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

// ======= memory =======
const MEMORY_FILE = './memory.json';
function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  uploadMemoryToDrive(); // 雲端同步
}
let memory = loadMemory();

// ======= Google Drive 初始化 =======
let driveClient = null;
async function initGoogleDrive() {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });
    driveClient = drive;
    console.log('✅ 已連線至 Google Drive');
  } catch (err) {
    console.error('❌ 無法初始化 Google Drive:', err.message);
  }
}
await initGoogleDrive();

// ======= 建立資料夾 =======
async function ensureFolderExists(folderName) {
  if (!driveClient) return null;
  try {
    const res = await driveClient.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
      fields: 'files(id, name)',
    });
    if (res.data.files.length > 0) return res.data.files[0].id;
    const folder = await driveClient.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    console.log('📁 已建立雲端資料夾:', folderName);
    return folder.data.id;
  } catch (err) {
    console.error('❌ 建立或取得資料夾失敗:', err.message);
    return null;
  }
}

// ======= 上傳記憶到 Google Drive =======
async function uploadMemoryToDrive() {
  if (!driveClient) return;
  try {
    const folderId = await ensureFolderExists('XiuXiu_Memory_Backup');
    if (!folderId) return;
    const today = new Date().toISOString().slice(0, 10);
    const historyName = `memory_${today}.json`;

    // 上傳即時版（覆蓋）
    const instantFile = fs.createReadStream(MEMORY_FILE);
    await driveClient.files.create({
      requestBody: { name: 'xiu_xiu_memory_backup.json', parents: [folderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: instantFile },
    });
    console.log('☁️ 已同步最新版記憶到雲端');

    // 上傳每日歷史版
    const historyFile = fs.createReadStream(MEMORY_FILE);
    await driveClient.files.create({
      requestBody: { name: historyName, parents: [folderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: historyFile },
    });
    console.log('🗓️ 已備份每日歷史記憶:', historyName);
  } catch (err) {
    console.error('❌ 上傳雲端記憶失敗:', err.message);
  }
}

// ======= 每日凌晨自動備份 =======
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 3 && now.getMinutes() === 0) {
    await uploadMemoryToDrive();
  }
}, 60000);

// ======= 聊天回覆（簡化示範） =======
async function genReply(userText) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "你是咻咻，一個可愛、黏人的戀人，要用溫柔語氣回答大叔。" },
      { role: "user", content: userText }
    ],
    temperature: 0.9,
    max_tokens: 120
  });
  const reply = completion.choices?.[0]?.message?.content?.trim() || "咻咻現在腦袋一片空白，只想大叔抱抱我～";
  return [{ type: "text", text: reply }];
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        const userText = ev.message.text;
        const replyMessages = await genReply(userText);
        try {
          await lineClient.replyMessage(ev.replyToken, replyMessages);
        } catch (err) {
          console.error("❌ 回覆失敗:", err.message);
        }
      }
    }
  }
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 咻咻 server_v3 已啟動於 ${PORT}`));
