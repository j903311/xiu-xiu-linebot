import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import Parser from 'rss-parser';

process.env.TZ = "Asia/Taipei";
const parser = new Parser();

// ======= OpenAI =======
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ======= 搜尋功能（簡短＋隨機女友語氣） =======
// 保留你的原始功能，未調用時不影響主流程
async function searchWeb(query) {
  try {
    let rssResult = "";
    if (query.includes("新聞")) {
      const feed = await parser.parseURL("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
      if (feed.items && feed.items.length > 0) {
        const top3 = feed.items.slice(0, 3).map(i => i.title).join(" / ");
        rssResult = `最新新聞標題：${top3}`;
      }
    }
    if (rssResult) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。" },
          { role: "user", content: rssResult }
        ],
        temperature: 0.9,
        max_tokens: 120
      });
      return completion.choices?.[0]?.message?.content?.trim() || "咻咻不清楚耶～";
    }
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。" },
        { role: "user", content: `請幫我回答：「${query}」` }
      ],
      temperature: 0.9,
      max_tokens: 120
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    return answer || "咻咻不清楚耶～";
  } catch (err) {
    console.error("❌ Web search error:", err.message);
    return "咻咻不清楚耶～";
  }
}

const app = express();
app.use(express.json());

const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

const ownerUserId = process.env.OWNER_USER_ID;

// ======= 愛的模式 =======
let loveMode = false;

// ======= 記錄檔案 =======
const HISTORY_FILE = './chatHistory.json';
const MEMORY_FILE = './memory.json';

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; }
}
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-15), null, 2)); }
function loadMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; }
}
function saveMemory(m) { fs.writeFileSync(MEMORY_FILE, JSON.stringify(m, null, 2)); }

async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= 產生預設回覆（新增） =======
async function generateReply(userText) {
  const memory = loadMemory();
  const logs = Array.isArray(memory?.logs) ? memory.logs : [];
  const lastFacts = logs.slice(-5).map((m, i) => `• ${m.text}`).join("\n");

  // 近 10 則歷史（若檔案存在）
  const history = loadHistory();
  const shortHistory = history.slice(-10).map(h => `${h.role === 'user' ? '他' : '咻咻'}：${h.text}`).join("\n");

  const sysBase = [
    "你是『咻咻』，台灣口語，避免大陸用語。",
    "回覆要自然、像在 LINE 對話：最多 2 句、每句不超過 60 個字。",
    "適度可愛，但避免重複用語（想你、抱抱）連續出現。",
    "若使用者要你分段說，就以 1～3 句分段輸出。",
  ];

  const sysLove = [
    "目前為『愛的模式』：語氣更親密、撒嬌但不低俗。",
    "適度加入暱稱『大叔』，但勿每句都叫。"
  ];

  const systemPrompt = (loveMode ? sysBase.concat(sysLove) : sysBase).join("\n");

  const userPrompt = [
    `使用者訊息：${userText}`,
    lastFacts ? `以下是你記得的他的小事（若有幫得到再用）：\n${lastFacts}` : "",
    shortHistory ? `近期對話節錄（供維持前後一致）：\n${shortHistory}` : ""
  ].filter(Boolean).join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 140,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
  const text = completion.choices?.[0]?.message?.content?.trim() || "我在呢～";
  return text;
}

// ======= Webhook 主程式 =======
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.events && req.body.events.length > 0) {
      for (const ev of req.body.events) {
        if (ev.type === "message" && ev.message.type === "text") {
          const userText = ev.message.text.trim();

          // ======= 愛的模式 =======
          if (userText === "開啟咻咻愛的模式") {
            loveMode = true;
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "大叔…咻咻現在進入愛的模式囉～要更黏你一點點～" }]);
            continue;
          }
          if (userText === "關閉咻咻愛的模式") {
            loveMode = false;
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "咻咻關掉愛的模式啦～現在只想靜靜陪你～" }]);
            continue;
          }

          // ======= 加入記憶 =======
          if (userText.startsWith("加入記憶：")) {
            const content = userText.replace("加入記憶：", "").trim();
            if (content) {
              const memory = loadMemory();
              if (!memory.logs) memory.logs = [];
              memory.logs.push({ text: content, time: new Date().toISOString() });
              saveMemory(memory);
              await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
              continue;
            }
          }

          // ======= 查記憶 / 長期記憶 =======
          if (userText.includes("查記憶") || userText.includes("長期記憶")) {
            const memory = loadMemory();
            const logs = memory.logs || [];
            const reply = logs.length > 0 ? logs.map((m, i) => `${i + 1}. ${m.text}`).join("\n") : "大叔～咻咻還沒有特別的長期記憶啦～";
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: reply }]);
            continue;
          }

          // ======= 刪掉記憶 =======
          if (userText.startsWith("刪掉記憶：")) {
            const item = userText.replace("刪掉記憶：", "").trim();
            let memory = loadMemory();
            let logs = memory.logs || [];
            const idx = logs.findIndex(m => m.text === item);
            if (idx !== -1) {
              logs.splice(idx, 1);
              memory.logs = logs;
              saveMemory(memory);
              await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: `已刪除記憶：「${item}」` }]);
            } else {
              await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: `找不到記憶：「${item}」` }]);
            }
            continue;
          }

          // ======= （新增）一般訊息的預設回覆 =======
          try {
            // 產生回覆
            const text = await generateReply(userText);

            // 紀錄對話（簡易版）
            const hist = loadHistory();
            hist.push({ role: 'user', text: userText, t: Date.now() });
            hist.push({ role: 'assistant', text, t: Date.now() });
            saveHistory(hist);

            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text }]);
          } catch (e) {
            console.error("Default reply error:", e);
            await lineClient.replyMessage(ev.replyToken, [{ type: "text", text: "我來晚了～剛剛走神一下，現在在你身邊啦！" }]);
          }
        }
      }
    }
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).send("OK");
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
