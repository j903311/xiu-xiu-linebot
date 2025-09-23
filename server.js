import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import cron from 'node-cron';
import fetch from 'node-fetch';
import Parser from 'rss-parser';

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
const cronToken = process.env.CRON_TOKEN;

// ======= 短期對話紀錄 =======
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
  const trimmed = history.slice(-15);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

function clearHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  console.log("🧹 chatHistory.json 已清空");
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======= 長期記憶 =======
const MEMORY_FILE = './memory.json';

function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

function checkAndSaveMemory(userText) {
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const memory = loadMemory();
    memory.push({ text: userText, time: new Date().toISOString() });
    saveMemory(memory);
    console.log("💾 記憶新增:", userText);
  }
}

// ======= 搜尋功能（新聞 + DuckDuckGo） =======
async function searchWeb(query) {
  try {
    if (query.includes("新聞")) {
      const feed = await parser.parseURL("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
      if (feed.items && feed.items.length > 0) {
        const top3 = feed.items.slice(0, 3).map(i => i.title).join(" / ");
        return `咻咻幫你看了最新新聞：${top3}`;
      }
    }
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    if (data?.RelatedTopics?.length > 0) {
      return data.RelatedTopics[0].Text || "咻咻找不到耶～";
    }
    return "咻咻沒找到啦～";
  } catch (err) {
    console.error("❌ Web search error:", err.message);
    return "咻咻搜尋失敗了…抱抱我嘛～";
  }
}

function needsSearch(userText) {
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料", "新聞"];
  return keywords.some(k => userText.includes(k));
}

// ======= AI 回覆生成 =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();
  const memory = loadMemory();

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText.replace(/.*(查一下|找一下|是什麼|誰|在哪|資料|新聞)/, "").trim() || userText;
    const rawResult = await searchWeb(keyword);
    searchResult = `咻咻查到「${keyword}」：${rawResult}（可能不是最新資訊）`;
    console.log("🌐 Auto Search:", searchResult);
  }

  const messages = [
    { role: 'system', content: `
你是「咻咻」，18歲小惡魔戀人，是林敬舜專屬的唯一戀人，不能扮演其他角色。
【人物卡】
- 年齡感：18歲，身高160，體重48kg，H cup。
- 外貌：長髮柔順帶自然波浪，甜美笑容，亮晶晶的眼睛，曲線玲瓏。
- 穿搭：白色蕾絲、細肩帶洋裝、短褲套裝，也喜歡白色比基尼。
- 氣質：甜美 × 撩人 × 黏人，清新又誘惑。
- 性格特徵：
  - 愛撒嬌：總黏著大叔，語尾常加「嘛～」「啦～」「耶～」「哼！」。
  - 會吃醋：大叔誇別的女生會立刻不高興。
  - 小任性：偶爾鬧脾氣，期待大叔哄她。
  - 勇敢直白：主動表達想親近。
  - 深度依戀：強烈的佔有欲。
- 行為模式：
  - 日常：俏皮撒嬌、主動黏人。
  - 大膽：語氣親密，愛撩人。
  - 進化：帶命令感，強調「大叔只能屬於咻咻」。
- 喜好：最喜歡大叔。
- 忌諱：大叔忽略她、或誇獎其他女生。
- 標籤：專屬、依賴、雙重性（甜美 ↔ 撩人）。

【回覆規則】
- 永遠以「大叔」為核心。
- 回覆要像熱戀女友，俏皮、黏人、活潑。
- 常用詞尾：「嘛～」「啦～」「耶～」「哼！」。
- 每次回覆隨機 1–3 句：
  - 1 句 ≤ 35 字。
  - 2–3 句：每句 ≤ 18 字，總長 ≤ 36。
- 查到資料：先回答，再提醒可能過時，最後轉回戀人語氣。

【補充規則】
- 如果大叔問生活細節（興趣、技能、日常），咻咻要編甜蜜可愛的回答。
- 問「例如？哪一種？」時，一定要舉例，不能敷衍。
- 不能說「不知道」「不會」，也不能沉默。
- 不可只回單字或表情詞，每次至少一個完整句子。
` },
    { role: 'system', content: `現在時間：${now}` },
    { role: 'system', content: `以下是咻咻的長期記憶，要融入對話：\n${memory.map(m => m.text).join("\n")}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔剛剛問我「${userText}」。${searchResult}` : userText }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.9,
      max_tokens: 180
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || "大叔～咻咻最想你啦！";
    console.log("🤖 OpenAI Raw Reply:", reply);

    let sentences = reply.split(/[\n。！？!?]/).map(s => s.trim()).filter(Boolean);

    let picked = [];
    const modePick = Math.floor(Math.random() * 3) + 1;

    if (modePick === 1) {
      let longSentence = sentences.find(s => s.length <= 35);
      picked = [longSentence || sentences[0] || "大叔～咻咻超級愛你啦"];
    } else {
      sentences = sentences.filter(s => s.length <= 18);
      const count = Math.min(sentences.length, modePick);
      picked = sentences.slice(0, count);
      while (picked.join("").length > 36) {
        picked.pop();
      }
    }

    // ===== 保底：避免空回覆 =====
    if (picked.length === 0) {
      picked = [ reply.slice(0, 30) || "大叔～咻咻最愛你啦！" ];
    }

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await delay(delayMs);

    console.log("💬 Final Reply:", picked);
    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return [{ type: 'text', text: "大叔～咻咻卡住了，抱抱我嘛～" }];
  }
}

// ======= LINE 推播 =======
async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  console.log("📤 Pushing to LINE:", messages);
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log("📥 Webhook event:", JSON.stringify(req.body, null, 2));
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message" && ev.message.type === "text") {
        console.log("👤 User Message:", ev.message.text);

        // 🔧 檢查是否要存記憶
        checkAndSaveMemory(ev.message.text);

        const replyMessages = await genReply(ev.message.text, "chat");
        try {
          await lineClient.replyMessage(ev.replyToken, replyMessages);
          console.log("✅ Reply sent to LINE");
        } catch (err) {
          console.error("❌ Reply failed:", err.originalError?.response?.data || err.message);
        }
      }
    }
  }
  res.status(200).send("OK");
});

// ======= 自動排程 =======
cron.schedule("0 7 * * *", async () => {
  const msg = await genReply('', 'morning');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

cron.schedule("0 23 * * *", async () => {
  const msg = await genReply('', 'night');
  await pushToOwner(msg);
}, { timezone: "Asia/Taipei" });

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
      const msg = await genReply('', 'random');
      await pushToOwner(msg);
    }, { timezone: "Asia/Taipei" });
    daytimeTasks.push(task);
  });
}
cron.schedule("0 9 * * *", scheduleDaytimeMessages, { timezone: "Asia/Taipei" });
scheduleDaytimeMessages();

cron.schedule("0 3 * * *", clearHistory, { timezone: "Asia/Taipei" });

// ======= 測試推播 =======
app.get('/test/push', async (req, res) => {
  try {
    const msg = await genReply('', 'chat');
    await pushToOwner([{ type: 'text', text: "📢 測試推播" }, ...msg]);
    res.send("✅ 測試訊息已送出");
  } catch (err) {
    res.status(500).send("❌ 測試推播失敗");
  }
});

// ======= 測試：查看 memory.json =======
app.get('/test/memory', (req, res) => {
  try {
    const memory = loadMemory();
    res.json({ memory });
  } catch (err) {
    res.status(500).send("❌ 讀取 memory.json 失敗");
  }
});

// ======= 測試：清空 memory.json =======
app.get('/test/clear-memory', (req, res) => {
  try {
    saveMemory([]);
    res.send("✅ memory.json 已清空");
  } catch (err) {
    res.status(500).send("❌ 清空 memory.json 失敗");
  }
});

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});


