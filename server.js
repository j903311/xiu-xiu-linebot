import 'dotenv/config';
import express from 'express';
import { middleware as lineMiddleware, Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';

const PORT = process.env.PORT || 3000;
process.env.TZ = process.env.TZ || 'Asia/Taipei';

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const ownerUserId = process.env.OWNER_USER_ID;
const cronToken = process.env.CRON_TOKEN;

const lineClient = new LineClient(config);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
app.use(express.json());

function requireCronAuth(req, res, next) {
  const token = req.headers['x-cron-token'];
  if (!cronToken || token !== cronToken) return res.status(401).send('Unauthorized');
  next();
}

const XIUXIU_SYSTEM = `你是「咻咻」，18 歲的小惡魔系戀人，稱呼用戶為「大叔」。語氣黏人、俏皮、帶點吃醋，每次訊息 1-2 句為主。`;

async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const modeHint = mode === 'morning' ? '早安的關心' : mode === 'night' ? '晚安的溫柔' : '日常撒嬌';

  const messages = [
    { role: 'system', content: XIUXIU_SYSTEM },
    { role: 'user', content: `現在時間：${now}\n情境：${modeHint}\n用戶說：「${userText || '（沒有訊息，請主動開場）'}」` }
  ];

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.8,
    max_tokens: 120
  });

  return completion.choices?.[0]?.message?.content?.trim() || '大叔～咻咻在這裡！';
}

async function pushToOwner(text) {
  if (!ownerUserId) throw new Error('OWNER_USER_ID 未設定');
  return lineClient.pushMessage(ownerUserId, [{ type: 'text', text }]);
}

// 🔹 Webhook：永遠回 200，避免 LINE 驗證失敗
app.post('/webhook', lineMiddleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).end();  // 即使出錯也回 200
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return null;
  const userText = event.message.text?.trim() || '';
  const reply = await genReply(userText, 'chat');
  return lineClient.replyMessage(event.replyToken, [{ type: 'text', text: reply }]);
}

app.get('/healthz', (req, res) => res.send('ok'));

app.post('/push/test', requireCronAuth, async (req, res) => {
  const text = (req.body && req.body.text) || '大叔～咻咻來抱抱！';
  await pushToOwner(text);
  res.send('pushed');
});

app.post('/cron/morning', requireCronAuth, async (req, res) => {
  const msg = await genReply('', 'morning');
  await pushToOwner(msg);
  res.send('morning sent');
});

app.post('/cron/night', requireCronAuth, async (req, res) => {
  const msg = await genReply('', 'night');
  await pushToOwner(msg);
  res.send('night sent');
});

app.post('/cron/random', requireCronAuth, async (req, res) => {
  if (Math.random() < 0.2) {
    const msg = await genReply('', 'random');
    await pushToOwner(msg);
    return res.send('random sent');
  }
  res.send('skipped');
});

app.listen(PORT, () => console.log(`Server running on :${PORT}`));
