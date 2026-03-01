import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import { GoogleGenerativeAI } from "@google/generative-ai"; 
import { google } from 'googleapis';
import fs from 'fs';

// ======= 核心初始化 =======
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "你是「咻咻」，18歲小惡魔戀人。語氣甜美、黏人、俏皮。必須使用繁體中文（台灣口語）。",
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

async function genReply(userText) {
  try {
    const HISTORY_FILE = './chatHistory.json';
    let history = [];
    if (process.env.RESET_HISTORY !== 'true') {
      try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { history = []; }
    }

    // 關鍵修正：嚴格過濾掉不符合 Gemini 格式的歷史
    const validHistory = history.filter(h => h.role === 'user' || h.role === 'model').slice(-10).map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(h.content || h.text || "") }],
    }));

    const chat = model.startChat({ history: validHistory });
    const result = await chat.sendMessage(userText);
    const replyText = result.response.text();

    history.push({ role: 'user', content: userText }, { role: 'model', content: replyText });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-20), null, 2));

    return [{ type: 'text', text: replyText }];
  } catch (err) {
    return [{ type: 'text', text: `大叔～腦袋卡住了：[${err.message.slice(0, 30)}]` }];
  }
}

const app = express();
app.use(express.json());
app.post('/webhook', async (req, res) => {
  for (const ev of req.body.events || []) {
    if (ev.type === 'message' && ev.message.type === 'text') {
      const reply = await genReply(ev.message.text);
      await lineClient.replyMessage(ev.replyToken, reply);
    }
  }
  res.send('OK');
});

app.listen(process.env.PORT || 8080, () => console.log('🚀 終極啟動！'));
