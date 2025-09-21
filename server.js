import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import cron from 'node-cron';

process.env.TZ = "Asia/Taipei"; // 確保時區正確

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;
const cronToken = process.env.CRON_TOKEN;

// 載入角色記憶
function loadMemory() {
  try {
    const data = fs.readFileSync('./memory.json', 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error("❌ Memory load error:", err.message);
    return {};
  }
}
const memory = loadMemory();

// ======= AI 回覆生成 =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const modeHint =
    mode === 'morning' ? '早安的關心' :
    mode === 'night' ? '晚安的溫柔' :
    '日常撒嬌';

  const memoryText = JSON.stringify(memory, null, 2);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `以下是咻咻、文文、菲菲的角色與背景，請忠實扮演：\n${memoryText}` },
        { role: 'system', content: "你是咻咻，18歲小惡魔戀人，語氣黏人、俏皮、愛吃醋。" },
        { role: 'user', content: `現在時間：${now}\n情境：${modeHint}\n用戶說：「${userText || '（沒有訊息，請主動開場）'}」` }
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

// ======= LINE 推播 =======
async function pushToOwner(text) {
  if (!ownerUserId) throw new Error('OWNER_USER_ID 未設定');
  return lineClient.pushMessage(ownerUserId, [{ type: 'text', text }]);
}

// ======= Webhook =======
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

// ======= Cron 驗證（保留手動呼叫） =======
function requireCronAuth(req, res, next) {
  const token = req.headers['x-cron-token'];
  if (!cronToken || token !== cronToken) return res.status(401).send('Unauthorized');
  next();
}

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
  if (Math.random() < 0.5) {
    const msg = await genReply('', 'random');
    await pushToOwner(msg);
    return res.send('random sent');
  }
  res.send('skipped');
});

// ======= 新增內建自動排程 =======

// 固定早安
cron.schedule("0 7 * * *", async () => {
  console.log("⏰ 早安排程觸發");
  const msg = await genReply('', 'morning');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

// 固定晚安
cron.schedule("0 23 * * *", async () => {
  console.log("⏰ 晚安排程觸發");
  const msg = await genReply('', 'night');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

// 白天隨機撒嬌（每天 3-4 次）
let daytimeTasks = [];

function generateRandomTimes(countMin = 3, countMax = 4, startHour = 10, endHour = 18) {
  const n = Math.floor(Math.random() * (countMax - countMin + 1)) + countMin;
  const times = new Set();
  while (times.size < n) {
    const hour = Math.floor(Math.random() * (endHour - startHour + 1)) + startHour;
    const minute = Math.floor(Math.random() * 60);
    times.add(`${minute} ${hour}`);
  }
  return Array.from(times);
}

function scheduleDaytimeMessages() {
  daytimeTasks.forEach(t => t.stop());
  daytimeTasks = [];

  const times = generateRandomTimes();
  console.log("📅 今日白天隨機撒嬌時段:", times);

  times.forEach(exp => {
    const task = cron.schedule(exp + " * * *", async () => {
      console.log("⏰ 隨機撒嬌觸發:", exp);
      const msg = await genReply('', 'random');
      await pushToOwner(msg);
    }, { timezone: "Asia/Taipei" });
    daytimeTasks.push(task);
  });
}

cron.schedule("0 9 * * *", scheduleDaytimeMessages, { timezone: "Asia/Taipei" });
scheduleDaytimeMessages();

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

// ======= 啟動伺服器 =======
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});
