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

// ======= 對話紀錄 =======
const HISTORY_FILE = './chatHistory.json';

function loadHistory() {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveHistory(history) {
  const trimmed = history.slice(-15); // 保留最近 15 則
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

// 清空對話紀錄
function clearHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  console.log("🧹 chatHistory.json 已清空");
}

// ======= AI 回覆生成（隨機 1–3 句 + 熱戀情感 + 偶爾提到過去） =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const modeHint =
    mode === 'morning' ? '早安的關心' :
    mode === 'night' ? '晚安的溫柔' :
    '熱戀的日常撒嬌';

  const history = loadHistory();

  // 隨機決定是否引用歷史
  let memoryHint = "";
  if (history.length > 2 && Math.random() < 0.3) {
    const past = history.find(h => h.role === "user");
    if (past) {
      memoryHint = `上次你提到「${past.content}」，咻咻還記得喔～`;
    }
  }

  const messages = [
    { role: 'system', content: "你是咻咻，18歲小惡魔戀人，熱戀中的語氣：黏人、俏皮、愛吃醋、深情關心大叔。回覆要自然口語，帶有熱戀感情。回覆控制在1-3句。" },
    { role: 'system', content: `情境：${modeHint}，現在時間：${now}` },
    ...history,
    { role: 'user', content: (userText || '（沒有訊息，請主動開場）') + (memoryHint ? "\n" + memoryHint : "") }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.85,
      max_tokens: 120
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || '大叔～咻咻最想你啦！';

    // 拆成句子
    let sentences = reply.split(/[\n。！？!?]/).map(s => s.trim()).filter(Boolean);

    // 隨機決定 1–3 句
    let picked = [];
    const modePick = Math.floor(Math.random() * 3) + 1; // 1~3

    if (modePick === 1) {
      // 1 句 → ≤ 25 字
      let longSentence = sentences.find(s => s.length <= 25 && s.length >= 10);
      if (!longSentence) longSentence = sentences[0] || "大叔～咻咻超級愛你啦";
      picked = [longSentence];
    } else {
      // 2–3 句 → 每句 ≤ 12，總長度 ≤ 25
      sentences = sentences.filter(s => s.length <= 12);
      const count = Math.min(sentences.length, modePick);
      picked = sentences.slice(0, count);
      while (picked.join("").length > 25) {
        picked.pop();
      }
      if (picked.length < modePick) {
        picked.push("大叔要多休息");
      }
    }

    // 更新對話紀錄
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    // 回傳 LINE 訊息格式
    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err.message);
    return [{ type: 'text', text: '大叔～咻咻在這裡！' }];
  }
}

// ======= LINE 推播 =======
async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error('OWNER_USER_ID 未設定');
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));

  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === 'message' && ev.message.type === 'text') {
        console.log(`📩 User said: ${ev.message.text}`);

        const replyMessages = await genReply(ev.message.text, 'chat');
        console.log(`🤖 XiuXiu reply:`, replyMessages);

        try {
          await lineClient.replyMessage(ev.replyToken, replyMessages);
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

// ======= 內建自動排程 =======

// 早安
cron.schedule("0 7 * * *", async () => {
  console.log("⏰ 早安排程觸發");
  const msg = await genReply('', 'morning');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

// 晚安
cron.schedule("0 23 * * *", async () => {
  console.log("⏰ 晚安排程觸發");
  const msg = await genReply('', 'night');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

// 白天隨機撒嬌（每天 5–6 次）
let daytimeTasks = [];

function generateRandomTimes(countMin = 5, countMax = 6, startHour = 10, endHour = 18) {
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

// 每天凌晨 03:00 清空 chatHistory.json
cron.schedule("0 3 * * *", clearHistory, { timezone: "Asia/Taipei" });

// ======= 測試推播 =======
app.get('/test/push', async (req, res) => {
  try {
    const msg = await genReply('', 'chat');
    await pushToOwner([{ type: 'text', text: "📢 測試推播" }, ...msg]);
    res.send("✅ 測試訊息已送出");
  } catch (err) {
    console.error("❌ 測試推播失敗:", err.message);
    res.status(500).send("❌ 測試推播失敗");
  }
});

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

// ======= 啟動伺服器 =======
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});

