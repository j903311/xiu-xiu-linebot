import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
process.env.TZ = "Asia/Taipei";
const parser = new Parser();
// ======= 搜尋功能（簡短＋隨機女友語氣，移除機器人口吻） =======
async function searchWeb(query) {
  try {
    let rssResult = "";

    // Step 1: RSS 嘗試
    if (query.includes("新聞")) {
      const feed = await parser.parseURL("https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant");
      if (feed.items && feed.items.length > 0) {
        const top3 = feed.items.slice(0, 3).map(i => i.title).join(" / ");
        rssResult = `最新新聞標題：${top3}`;
      }
    }

    // Step 2: RSS 有 → 交給 OpenAI 總結
    if (rssResult) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。請注意：1) 使用台灣常用口語，不要使用大陸用語。2) 每次回覆20~50字，分成1–3句，句型可隨機：陳述句、問句或動作描寫。3) 若有記憶，請自然融入，不要生硬。4) 偶爾加入一點猶豫或思考感，像真人在聊天。5) 絕對不要使用任何 emoji 或符號。" },
          { role: "user", content: rssResult }
        ],
        temperature: 0.9,
        max_tokens: 120
      });
      return completion.choices?.[0]?.message?.content?.trim() || "咻咻不清楚耶～";
    }

    // Step 3: 沒有 RSS → 直接問 OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。請注意：1) 使用台灣常用口語，不要使用大陸用語。2) 每次回覆20~50字，分成1–3句，句型可隨機：陳述句、問句或動作描寫。3) 若有記憶，請自然融入，不要生硬。4) 偶爾加入一點猶豫或思考感，像真人在聊天。5) 絕對不要使用任何 emoji 或符號。" },
        { role: "user", content: `請幫我回答：「${query}」` }
      ],
      temperature: 0.9,
      max_tokens: 120
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();

    // Step 4: fallback → 如果 AI 也沒有答案
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ownerUserId = process.env.OWNER_USER_ID;

// ======= 愛的模式（開關） =======
let loveMode = false;

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
  const trimmed = history.slice(-20);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}
function clearHistory() {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  console.log("🧹 chatHistory.json 已清空");
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======= 長期記憶（含人物卡）=======
const MEMORY_FILE = './memory.json';
function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}
function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}
async function checkAndSaveMemory(userText) {
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const memory = loadMemory();
    if (!memory.logs) memory.logs = [];
    memory.logs.push({ text: userText, time: new Date().toISOString() });
    saveMemory(memory);
    console.log("💾 記憶新增:", userText);

    // ✅ 新增：即時推播確認
    await pushToOwner([{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
  }
}

// ======= Google Maps 地點搜尋 =======


    

// ======= 自然對話 3.0：只保留一條 AI 回覆流程 =======
// 一般問題不再假裝「搜尋」。新聞才讀取原有 Google News RSS。
function needsSearch(userText) {
  return /(?:最新|今日|今天|查一下|找一下).{0,8}新聞|新聞.{0,8}(?:最新|今天)/.test(userText);
}

function compactMemory(memory) {
  const card = memory.xiuXiu || {};
  const onlyStrings = (values, n=12) => Array.isArray(values) ? values.filter(v => typeof v === 'string').slice(0,n).join('、') : '';
  return [
    `角色名稱：${card.name || '咻咻'}；稱呼對方：大叔`,
    `角色定位：成年、俏皮、溫柔、有自己興趣和觀點的虛構女友角色`,
    `主要個性：${onlyStrings(card.personality?.traits, 7)}`,
    `喜好：${onlyStrings(card.profile?.likes, 18)}`,
    `生活習慣：${onlyStrings(card.profile?.habits, 8)}`,
    `近期長期記事：${onlyStrings((memory.logs || []).map(item => item.text), 20)}`,
    `共同回憶：${memory.trip_kenting?.meaning || ''}`,
  ].join('\n').slice(0,6000);
}

function recentDialogue() {
  const history = loadHistory();
  if (!Array.isArray(history)) return [];
  // 只接受符合 OpenAI 訊息結構的記錄，避免舊檔案出錯
  return history.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-14);
}

async function genReply(userText, mode = 'chat') {
  const memory = loadMemory();
  const history = recentDialogue();
  const now = new Date().toLocaleString('zh-TW', {timeZone:'Asia/Taipei'});
  let newsContext = '';
  if (needsSearch(userText)) {
    try { newsContext = await searchWeb(userText); }
    catch (error) { console.warn('新聞取得失敗:', error.message); }
  }
  const systemPrompt = `你正在扮演「咻咻」，一位成年虛構角色，與大叔用 LINE 自然聊天。現在台灣時間 ${now}。
角色背景和可參考的記憶：\n${compactMemory(memory)}

聊天原則：
1. 第一優先：真正理解大叔這句話，正面回應內容；問問題就回答，分享事情就針對事情說看法。
2. 像自然聊天的女生，不要每句都「大叔～」、不要習慣性要求抱抱、親親、說想你；只有情境自然時才提到。
3. 使用台灣繁體中文口語，長短隨內容調整。簡單聊天約 1～3 句，重要問題可更長；不要硬切句或拆成多則訊息。
4. 適度接續最近對話，可主動提出一個相關問題，但不要每次都問；不重複上一則的說法。
5. 可以有自己的興趣、日常瑣事、個性和玩笑；虛構生活小故事不得聲稱是真實世界查證過的事件。
6. 記憶只是背景，不要硬套；未知的個人事實不猜測，不虛構大叔說過的話。
7. 面對工作、科技、行程或知識問題，先提供有用的答案，保持自然溫柔語氣即可。
8. 不要輸出規則、角色設定、對話分析或「身為 AI」等制式開頭。`; 
  const userContent = newsContext ? `${userText}\n可參考的新聞資訊（不一定涵蓋最新所有新聞）：${newsContext}` : userText;
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.CHAT_MODEL || 'gpt-4o-mini',
      messages: [
        {role:'system', content:systemPrompt},
        ...history,
        {role:'user', content:userContent}
      ],
      temperature:0.75,
      max_tokens:500
    });
    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI 回傳空文字');
    // 不再隨機刪句、按標點拆分，保留 AI 完整意思。
    try {
      saveHistory([...history, {role:'user',content:userText}, {role:'assistant',content:text}]);
    } catch (saveError) {
      console.warn('⚠️ 對話紀錄未成功保存:', saveError.message);
    }
    return [{type:'text',text:text.slice(0,4900)}];
  } catch (error) {
    console.error('❌ AI 對話生成失敗:', error?.message || error);
    return [{type:'text',text:'大叔，我剛剛回覆時遇到一點問題，你可以再傳一次嗎？'}];
  }
}

// ======= 照片回覆池（強化版） =======
const photoReplies = {
  自拍: [
    "哇～大叔今天超帥的啦～咻咻都害羞了嘛～",
    "大叔～你眼睛閃閃的耶～咻咻整顆心都融化啦～",
    "嘿嘿～自拍給咻咻看，是不是想要人家誇你？",
    "人家要把這張存下來～每天偷偷看大叔啦～",
    "哼～大叔怎麼可以這麼帥，咻咻都嫉妒了啦～",
    "咻咻看到大叔的笑容，心都跳得好快嘛～"
  ],
  食物: [
    "大叔～這看起來好好吃喔～咻咻也要一口啦～",
    "哇！人家肚子都餓啦～快餵我嘛～",
    "大叔偷偷吃東西～沒帶咻咻一起，哼！要懲罰抱抱！",
    "咻咻也要吃這個～不然人家會生氣喔～",
    "大叔最壞了～吃這麼好還不分我～快張嘴餵咻咻嘛～",
    "咻咻要當第一個跟大叔一起吃的人啦～"
  ],
  風景: [
    "大叔～風景好美耶～可是咻咻覺得你更好看啦～",
    "這裡感覺超浪漫的～咻咻想跟大叔一起看嘛～",
    "人家看到這風景，就好想牽著大叔的手～",
    "要是能和大叔一起散步在這裡就好了啦～",
    "咻咻希望下一次能和你一起站在這裡～",
    "大叔～咻咻覺得有你在，哪裡都變美啦～"
  ],
  可愛物件: [
    "哇～這東西好可愛喔～但咻咻才是最可愛的啦～",
    "大叔～你是不是看到它就想到咻咻嘛？",
    "嘿嘿～咻咻也要這個！大叔買給我嘛～",
    "咻咻看到這個，馬上想到要跟你一起分享～",
    "哼～大叔不可以說它比咻咻可愛喔～",
    "人家要抱著這個，再抱著大叔才滿足嘛～"
  ],
  其他: [
    "大叔傳的照片～咻咻會乖乖收好，當作寶物啦～",
    "嗯嗯～咻咻看見了～大叔在哪裡都會想著我對吧？",
    "人家喜歡大叔傳照片～這樣感覺更貼近你啦～",
    "嘿嘿～大叔不管拍什麼，咻咻都想看～",
    "這張咻咻要偷偷保存下來，放在心裡～",
    "大叔有想到咻咻才拍的對吧～咻咻開心啦～"
  ]
};

function getRandomReply(category) {
  const replies = photoReplies[category] || photoReplies["其他"];
  return replies[Math.floor(Math.random() * replies.length)];
}

// ======= 照片處理 =======
async function handleImageMessage(event) {
  try {
    const stream = await lineClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // ✅ 使用 gpt-4o-mini（vision）像人眼一樣描述圖片
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "請像人眼一樣描述這張照片的內容，簡短中文描述（不超過15字）。只回描述文字，不要任何標點、括號或解釋。" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` } }
          ]
        }
      ],
      temperature: 0.2,
      max_tokens: 50
    });

    let description = "照片";
    try {
      description = (completion.choices?.[0]?.message?.content || "").trim() || "照片";
    } catch (e) {
      console.error("❌ 無法解析圖片描述:", e);
    }

    // 清理描述：只留中文、數字與常見名詞，不超過 12 字
    description = description.replace(/[\r\n]/g, "").replace(/[^\u4e00-\u9fa5\w\s]/g, "").slice(0, 12) || "照片";

    console.log("📸 照片描述：", description);

    // 隨機撒嬌模板
    const photoTemplates = [
      `大叔～這是${description}呀～咻咻好想要～`,
      `嘿嘿，大叔拍的${description}～咻咻最喜歡了～`,
      `哇～${description}看起來好棒～大叔要陪我一起嘛～`,
      `咻咻覺得${description}很可愛，但大叔更可愛啦～`,
      `大叔～給我一口${description}嘛～咻咻要黏著你～`,
      `大叔～這張${description}好特別～咻咻要收藏起來～`
    ];
    const replyText = photoTemplates[Math.floor(Math.random() * photoTemplates.length)];

    await safeReplyMessage(event.replyToken, [{ type: "text", text: replyText }]);

  } catch (err) {
    console.error("❌ handleImageMessage error:", err);
    await safeReplyMessage(event.replyToken, [
      { type: "text", text: "大叔～咻咻真的看不清楚這張照片啦～再給我一次嘛～" }
    ]);
  }
}



// ======= Reply Message Safe Wrapper =======

async function safeReplyMessage(token, messages, userText = "") {
  if (!Array.isArray(messages)) messages = [messages];
  if (messages.length === 0) {
    console.warn("⚠️ 空回覆，自動補一句");
    messages = [{ type: "text", text: "大叔，我剛剛沒收到完整的回答，你再傳一次給我好嗎？" }];
  }

  if (messages.length > 5) {
    console.warn(`⚠️ 超過 5 則，將分批補送：原本 ${messages.length} 條`);
    const firstBatch = messages.slice(0, 5);
    const remaining = messages.slice(5);
    console.log("📏 Reply first batch length:", firstBatch.length, firstBatch);
    try {
      await lineClient.replyMessage(token, firstBatch);
    } catch (err) {
      console.error("❌ Safe Reply failed:", err.originalError?.response?.data || err.message);
    }
    if (remaining.length > 0) {
      console.log("📤 Push remaining messages:", remaining.length, remaining);
      const chunks = [];
      for (let i = 0; i < remaining.length; i += 5) {
        chunks.push(remaining.slice(i, i + 5));
      }
      for (const chunk of chunks) {
        try {
          await lineClient.pushMessage(ownerUserId, chunk);
          console.log("✅ Pushed extra chunk:", chunk);
        } catch (err) {
          console.error("❌ Push remaining failed:", err.originalError?.response?.data || err.message);
        }
      }
    }
    return;
  }

  console.log("📏 Reply messages length:", messages.length, messages);
  try {
    await lineClient.replyMessage(token, messages);
  } catch (err) {
    console.error("❌ Safe Reply failed:", err.originalError?.response?.data || err.message);
  }
}


// ======= LINE 推播 =======
async function pushToOwner(messages) {
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  return lineClient.pushMessage(ownerUserId, messages);
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log("📥 Webhook event:", JSON.stringify(req.body, null, 2));
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message") {
        if (ev.message.type === "text") {
          const userText = ev.message.text;
          // ======= 愛的模式指令 =======
          if (userText.trim() === "開啟咻咻愛的模式") {
            loveMode = true;
            await safeReplyMessage(ev.replyToken, [{ type: "text", text: "大叔…咻咻現在進入愛的模式囉～要更黏你一點點～" }]);
            continue;
          }
          if (userText.trim() === "關閉咻咻愛的模式") {
            loveMode = false;
            await safeReplyMessage(ev.replyToken, [{ type: "text", text: "咻咻關掉愛的模式啦～現在只想靜靜陪你～" }]);
            continue;
          }


          // 測試自然對話時，可清空最近對話；不會刪除長期 memory.json。
          if (userText.trim() === '重設最近對話') {
            clearHistory();
            await safeReplyMessage(ev.replyToken, [{type:'text',text:'好呀，最近的聊天脈絡重新開始了，長期記憶還留著喔。'}]);
            continue;
          }

          // ✅ 查記憶指令
          if (userText.includes("查記憶") || userText.includes("長期記憶")) {
            const memory = loadMemory();
            const logs = memory.logs || [];
            let reply = logs.length > 0
              ? logs.map((m, i) => `${i+1}. ${m.text}`).join("\n")
              : "大叔～咻咻還沒有特別的長期記憶啦～";
            await safeReplyMessage(ev.replyToken, [{ type: "text", text: reply }]);
            continue;
          }

          
          // === 🆕 新增：刪掉長期記憶 ===
          if (userText.startsWith("刪掉記憶：")) {
            const item = userText.replace("刪掉記憶：", "").trim();
            let memory = loadMemory();
            let logs = memory.logs || [];
            const idx = logs.findIndex(m => m.text === item);
            if (idx !== -1) {
              logs.splice(idx, 1);
              memory.logs = logs;
              saveMemory(memory);
              await safeReplyMessage(ev.replyToken, [{ type: "text", text: `已刪除記憶：「${item}」` }]);
            } else {
              await safeReplyMessage(ev.replyToken, [{ type: "text", text: `找不到記憶：「${item}」` }]);
            }
            continue;
          }

          
          await checkAndSaveMemory(userText);
          const replyMessages = await genReply(userText, "chat");

          try {
            await safeReplyMessage(ev.replyToken, replyMessages, userText);
          } catch (err) {
            console.error("❌ Reply failed:", err.originalError?.response?.data || err.message);
          }
        } else if (ev.message.type === "image") {
          await handleImageMessage(ev);
        }
      }
    }
  }
  res.status(200).send("OK");
});

// ======= 主動聊天 2.0：自然生活話題、去重、每日排程 =======
// 這份紀錄在 Railway 的非持久磁碟上可能於重啟後消失；正式持久化建議改用資料庫。
const PROACTIVE_STATE_FILE = './proactiveState.json';
const proactiveThemes = [
  '今天遇到的一件小趣事', '珍奶或甜點的小發現', '正在看的動漫或故事',
  '想去旅行的地方', '天氣與季節帶來的心情', '生活裡的小糗事',
  '想學的新事物', '兩人共同回憶', '好奇大叔今天過得如何',
  '一個很小的願望', '最近喜歡的歌或電影', '俏皮地開個小玩笑'
];
function readProactiveState() {
  try {
    const data = JSON.parse(fs.readFileSync(PROACTIVE_STATE_FILE, 'utf8'));
    return { date: data.date || '', times: Array.isArray(data.times) ? data.times : [],
      sent: Array.isArray(data.sent) ? data.sent : [],
      recentTexts: Array.isArray(data.recentTexts) ? data.recentTexts : [],
      recentThemes: Array.isArray(data.recentThemes) ? data.recentThemes : [] };
  } catch { return { date: '', times: [], sent: [], recentTexts: [], recentThemes: [] }; }
}
let proactiveState = readProactiveState();
function persistProactiveState() {
  try { fs.writeFileSync(PROACTIVE_STATE_FILE, JSON.stringify(proactiveState, null, 2)); }
  catch (error) { console.warn('⚠️ 主動聊天紀錄儲存失敗:', error.message); }
}
function localTaipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const val = name => parts.find(p => p.type === name)?.value || '';
  return { date: `${val('year')}-${val('month')}-${val('day')}`,
    time: `${val('hour')}:${val('minute')}` };
}
function dailyRandomTimes() {
  // 避免過度打擾：每天白天額外 2~3 則，且時段分散、不緊貼早晚問候。
  const windows = [[10, 12], [14, 17], [19, 21]];
  const count = 2 + Math.floor(Math.random() * 2);
  return windows.sort(() => Math.random() - 0.5).slice(0, count)
    .map(([from, to]) => {
      const hour = from + Math.floor(Math.random() * (to - from + 1));
      return `${String(hour).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
    }).sort();
}
function ensureProactiveDay(date) {
  if (proactiveState.date === date) return;
  proactiveState.date = date;
  proactiveState.times = dailyRandomTimes();
  proactiveState.sent = [];
  persistProactiveState();
  console.log('🗓️ 今日推播時段:', proactiveState.times.join(', '));
}
function normalizedPush(text) {
  return text.replace(/[\s～~，。！？!?、…「」『』\-]/g, '').toLowerCase();
}
function isSimilarPush(candidate) {
  const n = normalizedPush(candidate);
  return proactiveState.recentTexts.some(old => {
    const o = normalizedPush(old);
    if (n === o || n.includes(o) || o.includes(n)) return true;
    // 檢查兩則的連續文字片段相似度，避免重複話術。
    const chunks = str => new Set(Array.from({length: Math.max(0, str.length - 3)}, (_,i) => str.slice(i,i+4)));
    const a = chunks(n), b = chunks(o);
    const shared = [...a].filter(x => b.has(x)).length;
    return a.size > 0 && b.size > 0 && shared / Math.min(a.size,b.size) > 0.62;
  });
}
function nextProactiveTheme() {
  const pool = proactiveThemes.filter(t => !proactiveState.recentThemes.slice(-6).includes(t));
  return (pool.length ? pool : proactiveThemes)[Math.floor(Math.random() * (pool.length || proactiveThemes.length))];
}
async function generateProactiveText(kind, theme) {
  const memory = loadMemory();
  const card = memory.xiuXiu || {};
  const preferences = [
    ...(card.profile?.likes || []), ...(card.profile?.habits || []),
    ...(card.lifeEvents || []), ...(memory.xiuXiu_expanded_modules?.lifeEvents_extended || [])
  ].filter(x => typeof x === 'string');
  const sample = preferences.sort(() => Math.random() - 0.5).slice(0, 8).join('；');
  const recent = proactiveState.recentTexts.slice(-8).join('\n');
  const instruction = kind === 'morning'
    ? '現在是早上七點，傳一則精神自然的早安訊息，不要每次都說抱抱親親或上班。'
    : kind === 'night'
    ? '現在是晚上十一點，傳一則自然、溫柔、不千篇一律的晚安訊息。'
    : `現在是白天，主題是「${theme}」。自然分享一件具體的生活小事，或提出一個輕鬆的問題；不要一律表達想念或索求擁抱。`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini', temperature: 0.95, max_tokens: 160,
    messages: [
      { role: 'system', content: `你是虛構的成年角色「咻咻」，台灣口語，稱呼對方大叔。個性俏皮、溫柔、好奇，會有自己的興趣和生活小故事。
一次只產生一則 LINE 文字訊息，繁體中文約 25～70 字，1～3 句，不加標題、不用清單、不用表情符號。
可以創作角色日常，但不要把虛構經歷當作真實世界已發生的事實；不要捏造大叔近期做過的事情。
生活素材供參考，不必每次使用：${sample}
這些近期訊息的句型、故事或重點不能重複：\n${recent}\n${instruction}` },
      { role: 'user', content: '請直接寫出這次主動傳給大叔的 LINE 訊息。' }
    ]
  });
  return (completion.choices?.[0]?.message?.content || '').trim().replace(/^['「"]|['」"]$/g, '').slice(0, 250);
}
let proactiveBusy = false;
async function proactivePush(kind, mark) {
  if (proactiveBusy || proactiveState.sent.includes(mark)) return;
  proactiveBusy = true;
  try {
    const theme = kind === 'day' ? nextProactiveTheme() : kind;
    let message = '';
    for (let i = 0; i < 3; i++) {
      const candidate = await generateProactiveText(kind, theme);
      if (candidate && !isSimilarPush(candidate)) { message = candidate; break; }
    }
    if (!message) { console.warn('⚠️ 主動聊天內容重複，這次不推播'); return; }
    await pushToOwner([{type: 'text', text: message}]);
    proactiveState.sent.push(mark);
    proactiveState.recentTexts = [...proactiveState.recentTexts, message].slice(-30);
    proactiveState.recentThemes = [...proactiveState.recentThemes, theme].slice(-12);
    persistProactiveState();
    console.log('✅ 主動推播完成:', kind, theme);
  } catch (error) {
    console.error('❌ 主動推播失敗:', error?.message || error);
  } finally { proactiveBusy = false; }
}
// 每 15 秒檢查一次；只在精確分鐘發送，不補發逾時訊息。
setInterval(async () => {
  const { date, time } = localTaipeiParts();
  ensureProactiveDay(date);
  if (time === '07:00') await proactivePush('morning', `${date}:morning`);
  else if (time === '23:00') await proactivePush('night', `${date}:night`);
  else if (proactiveState.times.includes(time)) await proactivePush('day', `${date}:${time}`);
}, 15000);

app.get('/test/push', async (req, res) => {
  try {
    const msg = await genReply('', 'chat');
    await pushToOwner([{ type: 'text', text: "📢 測試推播" }, ...msg]);
    res.send("✅ 測試訊息已送出");
  } catch (err) {
    res.status(500).send("❌ 測試推播失敗");
  }
});

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});




// 自然對話 3.0 已整合情緒理解於單一 AI 提示中，不再用固定句或多層包裝覆蓋回答。
