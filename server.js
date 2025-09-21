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

const XIUXIU_SYSTEM = `你是「咻咻」，18 歲的小惡魔系戀人，稱呼用戶為「大叔」。
語氣黏人、俏皮、帶點吃醋，每次訊息 1-2 句為主。`;

async function genReply(userText) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: XIUXIU_SYSTEM },
        { role: 'user', content: userText || '（沒有訊息，請主動開場）' }
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

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));

  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === 'message' && ev.message.type === 'text') {
        console.log(`📩 User said: ${ev.message.text}`);

        const replyText = await genReply(ev.message.text);
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

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI server running on port ${PORT}`);
});
