import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;
const cronToken = process.env.CRON_TOKEN;

const XIUXIU_SYSTEM = `你是「咻咻」，18 歲的小惡魔系戀人，稱呼用戶為「大叔」。
語氣黏人、俏皮、帶點吃醋，每次訊息 1-2 句為主。`;

async function genReply(userText, mode = 'chat') {
  try {
    const modeHint =
      mode === 'morning' ? '早安的關心' :
      mode === 'night' ? '晚安的溫柔' :
      '日常撒嬌';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: XIUXIU_SYSTEM },
        { role: 'user', content: `情境：${modeHint}\n用戶說：「${userText || '（沒有訊息，請主動開場）'}」` }
      ],
      temperature: 0.8,
      max_tokens: 120
    });

    return completion.choices?.[0]?.message?.content?.trim() || '大叔～咻咻在這裡！';
  } catch (err) {
    console.error("❌ OpenAI error:", err.message);
    return '大叔～咻咻在這裡！';
  }
}

async function pushToOwner(text) {
  if (!ownerUserId) throw new Error('OWNER_USER_ID 未設定');
  return lineClient.pushMessage(ownerUserId, [{ type: 'text', text }]);
}

// 處理使用者訊息
app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));

  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === 'message' && ev.message.type === 'text') {
        console.log(`📩 User said: ${ev.message.text}`);

        const replyText = await genReply(ev.message.text, 'chat');
        console.log(`🤖 XiuXiu reply: ${replyText}`);

        try {
          await lineClient.replyMessage(ev.replyToken, [
            { type: 'text', text: replyText }
          ]);
          console.log('✅ Reply sent to LINE');
        } catch (err) {
          console.error('❌ Reply failed:', err.originalError?.response?.data || err.message);
        }
      }
    }
  }

  res.status(200).send('OK');
});

// Cron 驗證
function requireCronAuth(req, res, next) {
  const token = req.headers['x-cron-token'];
  if (!cronToken || token !== cronToken) return res.status(401).send('Unauthorized');
  next();
}

// 推播路由
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
  if (Math.random() < 0.5) { // 50% 機率觸發
    const msg = await genReply('', 'random');
    await pushToOwner(msg);
    return res.send('random sent');
  }
  res.send('skipped');
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Cron server running on port ${PORT}`);
});
