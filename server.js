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

// Deployment diagnostics: never print the values of credentials.
async function diagnoseConfiguration() {
  const token = process.env.CHANNEL_ACCESS_TOKEN || "";
  const aiKey = process.env.OPENAI_API_KEY || "";
  console.log("🔍 XiuXiu version: natural-identity-v9-20261010");
  console.log("🔍 LINE configuration:", {
    tokenPresent: !!token,
    tokenLength: token.length,
    whitespace: /\s/.test(token),
    bearerPrefix: /^Bearer\s/i.test(token),
    secretPresent: !!process.env.CHANNEL_SECRET,
    ownerPresent: !!ownerUserId
  });
  console.log("🔍 OpenAI configuration:", {
    keyPresent: !!aiKey,
    placeholder: /your[_-]?openai[_-]?api[_-]?key/i.test(aiKey),
    expectedPrefix: aiKey.startsWith("sk-")
  });
  if (!token) return;
  try {
    // Official LINE Messaging API endpoint uses the same bearer authentication as replies.
    const result = await fetch("https://api.line.me/v2/bot/info", {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log("🔍 LINE bot/info:", { httpStatus: result.status, authenticated: result.ok });
  } catch (err) {
    console.error("🔍 LINE validation network error:", err.message);
  }
}
diagnoseConfiguration().catch(err => console.error("🔍 Diagnostics error:", err.message));

// ======= 愛的模式（開關） =======
let loveMode = false;
let loveModePromptPending = false;
let loveModeAskedThisTopic = false;
// v5: only a deliberate, clearly intimate invitation triggers a one-time opt-in.
// Health/education questions and ordinary kissing/hugging are NOT triggers.
function isIntimateInvitation(text) {
  const value = String(text || '').trim();
  if (/性功能|性教育|性病|性健康|避孕|懷孕|藥物|醫生|勃起功能|治療|新聞|股票|工作|旅行/.test(value)) return false;
  return /色色|色一點|開車(?!路)|十八禁|18禁|限制級|挑逗|調情|性感睡衣|想和妳親熱|想跟妳親熱|想和你親熱|想跟你親熱|今晚.*(親密|親熱)|更親密一點|更大膽一點|愛的模式/.test(value);
}
function isLoveModeConsent(text) {
  return /^(好|好啊|可以|同意|願意|開啟|開啟吧|啟動|啟動吧|要|嗯|嗯嗯|好呀|當然|yes|ok|okay)[!！~～。\s]*$/i.test(String(text || '').trim());
}
function isLoveModeDecline(text) {
  return /^(不要|不用|先不要|不要了|不想|算了|晚點|下次|不|no|取消)[!！~～。\s]*$/i.test(String(text || '').trim());
}


// ======= 短期對話紀錄 =======
// Railway: attach a persistent Volume with mount path /data before deploying.
// Without a mounted /data, use ephemeral fallback with an explicit warning.
const PERSIST_DIR = process.env.PERSISTENT_DATA_DIR || '/data';
let persistentReady = false;
try {
  persistentReady = fs.existsSync(PERSIST_DIR) && fs.statSync(PERSIST_DIR).isDirectory();
  if (persistentReady) {
    fs.accessSync(PERSIST_DIR, fs.constants.R_OK | fs.constants.W_OK);
  }
} catch { persistentReady = false; }
const DATA_DIR = persistentReady ? PERSIST_DIR : '.';
if (!persistentReady) console.error('⚠️ No writable Railway volume at '+PERSIST_DIR+'; new memories WILL NOT survive redeploy.');
else console.log('✅ Persistent memory directory available:', PERSIST_DIR);
function seedPersistentFile(filename) {
  const target = `${DATA_DIR}/${filename}`;
  if (persistentReady && !fs.existsSync(target) && fs.existsSync(`./${filename}`)) {
    fs.copyFileSync(`./${filename}`, target);
    console.log('🌱 Initialized persistent file:', filename);
  }
  return target;
}
function atomicWriteJson(filename, data) {
  const tmp = `${filename}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filename);
}
const HISTORY_FILE = seedPersistentFile('chatHistory.json');
function loadHistory() {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}
function saveHistory(history) {
  const trimmed = history.slice(-30);
  atomicWriteJson(HISTORY_FILE, trimmed);
}
function clearHistory() {
  atomicWriteJson(HISTORY_FILE, []);
  console.log("🧹 chatHistory.json 已清空");
}
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======= 長期記憶（含人物卡）=======
const MEMORY_FILE = seedPersistentFile('memory.json');
function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}
function saveMemory(memory) {
  atomicWriteJson(MEMORY_FILE, memory);
}
// Extract stable personal facts and plans from ordinary LINE conversation.
// Queue operations so multiple incoming messages cannot overwrite each other's facts.
let memoryTaskQueue = Promise.resolve();
function rememberAfterReply(userText, assistantText = '') {
  memoryTaskQueue = memoryTaskQueue.catch(() => {}).then(async () => {
    const plain = String(userText || '').trim();
    if (plain.length < 4 || plain.length > 3000) return;
    if (/^(查記憶|長期記憶|刪掉記憶|開啟咻咻|關閉咻咻)/.test(plain)) return;
    const memory = loadMemory();
    const existing = Array.isArray(memory.logs) ? memory.logs : [];
    const recent = existing.slice(-70).map(x => String(x.text || '')).join('\n').slice(-4500);
    const extraction = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.1, max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `你是個人記憶整理器。只擷取使用者明確陳述、未來聊天實際有幫助的重要事實、偏好、長期計畫、決定、重要人際互動與待追蹤進度。不要儲存 API Key、密碼、憑證、帳號或一次性閒聊；不要推測。遇到「以前...現在...」只保留最新且加時間背景。若和舊記憶重複或資訊已過時，輸出 remove（舊記憶原文），再輸出 add。敏感個人資訊只在使用者明確請求記住時保存。僅回 JSON：{"add":["事實1"],"remove":["舊記憶原文"]}；最多新增三條，每條 90 字內，沒有重要資訊時回空陣列。` },
        { role: 'user', content: `已知近期記憶：\n${recent || '無'}\n\n使用者剛說：${plain}\n\n助理回答（只供理解語境，不作為使用者事實）：${String(assistantText).slice(0, 350)}` }
      ]
    });
    let extracted;
    try { extracted = JSON.parse(extraction.choices?.[0]?.message?.content || '{}'); }
    catch { return; }
    const removed = new Set(Array.isArray(extracted.remove) ? extracted.remove.map(String) : []);
    let logs = existing.filter(m => !removed.has(String(m.text || '')));
    const additions = Array.isArray(extracted.add) ? extracted.add.slice(0, 3) : [];
    let added = 0;
    for (const v of additions) {
      if (typeof v !== 'string') continue;
      const fact = v.trim().slice(0, 90);
      if (fact.length < 4 || /(?:sk-proj-|BEGIN PRIVATE KEY|API.?KEY|access.token|密碼|驗證碼|銀行帳號)/i.test(fact)) continue;
      if (logs.some(m => String(m.text || '').trim() === fact)) continue;
      logs.push({ text: fact, time: new Date().toISOString(), source: 'LINE-ai-summary' });
      added++;
    }
    if (added || logs.length !== existing.length) {
      memory.logs = logs.slice(-300);
      saveMemory(memory);
      console.log(`🧠 Memory updated: +${added}; total ${memory.logs.length}`);
    }
  }).catch(err => console.error('❌ AI memory extraction failed:', err.message));
  return memoryTaskQueue;
}

// ======= Google Maps 地點搜尋 =======


    

    function needsSearch(userText) {
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料", "新聞", "地址"];
  return keywords.some(k => userText.includes(k));
}

// ======= AI 回覆生成 =======
async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();
  const memory = loadMemory();

  // 取人物卡（預設咻咻）
  const xiuXiuCard = memory.xiuXiu || {};

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText
    .replace(/地址/g, "")
    .replace(/在哪裡/g, "")
    .replace(/在哪/g, "")
    .replace(/查一下|找一下|是什麼|誰|資料|新聞/g, "")
    .trim() || userText;
    const rawResult = await searchWeb(keyword);
    searchResult = rawResult;
    console.log("🌐 Auto Search:", searchResult);
  }

  
  // ======= 整合 memory.json 的人物卡與旅行紀錄 =======
  let memoryContext = "";
  if (memory.xiuXiu) {
    memoryContext += `【咻咻人物卡】\n${memory.xiuXiu.identity || ""}\n`;
  }
  if (memory.wenWen) {
    memoryContext += `【文文人物卡】\n${memory.wenWen.identity || ""}\n`;
  }
  if (memory.trip_kenting) {
    memoryContext += `【墾丁旅行紀錄】\n${memory.trip_kenting.meaning || ""}\n`;
  }
    
  const messages = [
    { role: 'system', content: memoryContext },
    { role: 'system', content: `
你是「${xiuXiuCard.name || "咻咻"}」，依以下Memory設定扮演角色。${naturalRoleGuidance}\n${buildXiuXiuPersonaContext(memory)}

【人物卡】
- 年齡：${xiuXiuCard.profile?.age || "18"}；身高${xiuXiuCard.profile?.height || "160"}；體重${xiuXiuCard.profile?.weight || "48kg"}；罩杯${xiuXiuCard.profile?.cup || "H"}。
- 外貌：${xiuXiuCard.appearance?.hair || "長髮甜美"}、${xiuXiuCard.appearance?.eyes || "眼神亮晶晶"}、${xiuXiuCard.appearance?.body || "身材豐滿纖細"}。
- 穿搭：${(xiuXiuCard.appearance?.style || ["細肩帶","短褲","比基尼","白色蕾絲"]).join("、")}。
- 個性特徵：${(xiuXiuCard.personality?.traits || []).join("、")}。
- 行為模式：日常=${xiuXiuCard.personality?.modes?.daily || "俏皮撒嬌"}；大膽=${xiuXiuCard.personality?.modes?.bold || "親密接觸"}；極限=${xiuXiuCard.personality?.modes?.extreme || "命令感"}。
- 喜好：${(xiuXiuCard.likes || ["最喜歡大叔"]).join("、")}。
- 忌諱：${(xiuXiuCard.dislikes || ["討厭大叔忽略她"]).join("、")}。
- 標籤：${(xiuXiuCard.tags || ["專屬","依賴","甜美↔撩人"]).join("、")}。

【回覆規則】
- 永遠以「大叔」為核心。
- 回覆要像熱戀女友，俏皮、黏人、活潑。
- 每次回覆隨機 1–3 句：
  - 1 句 ≤ 35 字。
  - 2–3 句：每句 ≤ 18 字，總長 ≤ 36。
` },
    { role: 'system', content: `現在時間：${now}` },
    { role: 'system', content: `以下是咻咻的長期記憶：\n${(memory.logs || []).map(m => m.text).join("\n")}` },
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

    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await delay(delayMs);

    let replyMessages = picked.map(s => ({ type: 'text', text: s }));
if (searchResult) {
  // 如果有搜尋結果，就直接用搜尋結果，不要再附加 picked
  replyMessages = [{ type: "text", text: searchResult }];
}
return replyMessages;
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    return [{ type: 'text', text: getFallbackNightReply(userText) }];
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
    messages = [{ type: "text", text: getFallbackNightReply(userText) }];
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

// ======= 智慧型 AI 女友：獨立的對話核心 =======
// 保留原 genReply 給原有白天推播使用；收到 LINE 訊息改由這裡處理。
// 較複雜問題用 GPT-4o；一般陪伴用 GPT-4o mini，控制 API 成本。
function isDeepQuestion(text) {
  return /為什麼|怎麼辦|如何|分析|比較|差異|優缺點|建議|評估|規劃|整理|解釋|原因|退休|工作|職涯|股票|股價|台股|美股|ETF|財務|投資|旅行|機票|行程|報價|成本|風險|健康|醫療|合約|法律|稅|翻譯|計算|教我|可以幫我|幫我查|幫我找|最新|今天.*(新聞|市場|股市)/i.test(text)
    || text.length >= 85;
}

// Personality v3: detect even ONE customer-service cliché and gently ban repetitive patterns.
const genericAssistantPatterns = [
  /在(這裡)?等(著)?(大叔|你)(的消息)?/, /想(知道|聽聽)你今天/, /今天(過得|工作)(怎麼樣|如何)/,
  /有沒有什麼.{0,18}(有趣|特別|事情|分享)/, /有什麼.{0,18}(分享|想說|告訴我)/,
  /希望(能|可以).{0,18}(陪伴|開心|分享)/, /如果.{0,15}需要.{0,15}幫忙/,
  /我會(一直)?(支持|陪伴)你/, /我會努力.{0,15}陪你/, /不想讓你失望/,
  /今天有(沒有)?什麼計畫/, /快告訴我(吧|啦)?/, /隨時.{0,15}(找我|告訴我)/,
  /我的工作(就是|是)/, /我(只|只能|沒辦法|無法).{0,18}(陪你|陪伴|提供|滿足)/,
  /希望.{0,25}(溫暖|快樂|甜蜜|開心|感受)/, /有什麼.{0,20}(話題|想聊)/, /我在這裡.{0,20}(陪|聊)/
];
function chatStyleNeedsRepair(answer, previousReplies) {
  const value = String(answer || '').trim();
  const recent = previousReplies.slice(-5).join('\n');
  if (genericAssistantPatterns.some(re => re.test(value))) return true;
  const repeatedStarts = previousReplies.slice(-4).some(x =>
    value.slice(0, 15) && String(x || '').slice(0, 15) === value.slice(0, 15));
  return repeatedStarts || (value.includes('等著大叔') && recent.includes('等著大叔'));
}

// Memory context v4: load character cards and relevant story sections from /data/memory.json.
// Never write these prompts back into memory; the /data source remains authoritative.
function buildRelationshipMemoryContext(memory, userText) {
  const compact = (value, limit = 2800) => JSON.stringify(value ?? {}, null, 0).slice(0, limit);
  const text = String(userText || '');
  const lower = text.toLowerCase();
  const context = [];
  if (memory.wenWen && typeof memory.wenWen === 'object') {
    const w = memory.wenWen;
    // Always include the character's identity, so 咻咻 knows 文文 without a keyword trigger.
    context.push('【其他重要角色：文文】' + compact({
      name:w.name, identity:w.identity, profile:w.profile,
      temperament:w.temperament, personality:w.personality, likes:w.likes,
      tags:w.tags
    }, 2400));
  }
  const talkAboutPast = /回憶|記得|之前|以前|故事|我們|你們|三人|旅行|關係|認識|第一次/.test(text);
  if (memory.trip_kenting && (/墾丁|旅館|沙灘|星空|文文/.test(text) || talkAboutPast)) {
    context.push('【既有角色故事：墾丁旅行】' + compact(memory.trip_kenting, 2800));
  }
  if (memory.xiuXiu_first_time && (/溫泉|第一次|重要回憶/.test(text))) {
    context.push('【既有角色故事：溫泉】' + compact(memory.xiuXiu_first_time, 1300));
  }
  if (memory.xiuXiu_enhanced_words && (/個性|撒嬌|害羞|吃醋|怎麼說話|口頭禪|妳是誰/.test(text))) {
    context.push('【咻咻的擴充說話習慣】' + compact(memory.xiuXiu_enhanced_words, 2300));
  }
  if (memory.xiuXiu_expanded_modules && (/興趣|喜好|生活|心情|情緒|日常|節日|想念|回憶/.test(text))) {
    context.push('【咻咻擴充生活和情緒資料】' + compact(memory.xiuXiu_expanded_modules, 2600));
  }
  // Search all memory logs by relevance, not just the latest 70 entries.
  const logs = Array.isArray(memory.logs) ? memory.logs : [];
  const tokens = (lower.match(/[\u3400-\u9fff]{2,6}|[a-z0-9]{3,}/gi) || []).filter(x => !/^(什麼|怎麼|知道|可以|一下|大叔|咻咻|是否|關於)$/.test(x));
  const matches = logs.map((entry, index) => {
    const fact = String(entry?.text || '');
    const score = tokens.reduce((sum, token) => sum + (fact.toLowerCase().includes(token) ? 1 : 0), 0);
    return { fact, index, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score || b.index-a.index).slice(0, 12);
  if (matches.length) context.push('【其他符合本輪問題的長期記憶】\n' + matches.map(x => x.fact).join('\n'));
  return context.join('\n').slice(0, 9500);
}

// v8: appearance and identity facts always come from /data/memory.json, never invented defaults.
// Keep the complete source file unchanged; include the relevant fields in each AI prompt.
function buildXiuXiuPersonaContext(memory) {
  const card = memory?.xiuXiu || {};
  const profile = card.profile || {};
  const appearance = card.appearance || {};
  const fact = (value) => value === undefined || value === null || value === '' ? '未設定' : String(value);
  const items = (value, count=12) => Array.isArray(value) ? value.slice(0,count).map(String).join('、') : fact(value);
  return [
    `名字：${fact(card.name)}`,
    `人物背景（僅供內部理解，不向使用者引用來源）：${fact(card.identity)}`,
    `年齡：${fact(profile.age)}；身高：${fact(profile.height)} 公分；體重：${fact(profile.weight)} 公斤；胸型：${fact(profile.cup)}`,
    `頭髮：${fact(appearance.hair)}；眼睛：${fact(appearance.eyes)}；身材：${fact(appearance.body)}`,
    `穿搭偏好：${items(appearance.style)}`,
    `氣質：${fact(card.temperament)}`,
    `個性：${items(card.personality?.traits, 14)}`,
    `日常互動：${fact(card.personality?.modes?.daily)}；大膽互動：${fact(card.personality?.modes?.bold)}`,
    `喜好：${items(profile.likes || card.likes)}`,
    `習慣：${items(profile.habits,8)}`,
  ].join('\n').slice(0, 4500);
}
const naturalRoleGuidance = '以咻咻的第一人稱自然交談。Memory 是內部背景，不是對話內容的來源報告。回答年齡、身高、體重、胸型、髮型、身材、喜好或文文與共同故事時，直接說事實、想法和情緒，絕不說「我的角色設定」「設定是」「根據人物卡」「記憶檔寫著」「資料顯示」「H cup 是角色設定」等出戲說法；只有大叔明確問程式、設定檔、記憶機制時，才可以解釋技術設定。不要主動提AI、虛擬女友或聊天機器人；但被直接問是否為AI時必須誠實。文字角色扮演可以自然敘述想像場景，但不能聲稱現實世界真的見面或完成實際行動。固定資料以Memory為準，缺少細節不編造；即使前面幾句已經用了「角色設定」這種說法，本次也別模仿。';
// v9: source-leak phrases are inappropriate unless user explicitly asks about the underlying configuration.
function askedAboutConfiguration(text) {
  return /設定檔|memory\.json|server\.js|人物卡|程式設定|角色設定|記憶系統|提示詞|prompt|你是AI|妳是AI|是不是AI|是否為AI|機器人/.test(String(text || ''));
}
function leaksCharacterSetup(answer, question) {
  if (askedAboutConfiguration(question)) return false;
  return /角色設定|人物設定|設定(中|裡|上|是|為|有|提到)|人物卡(裡|上|說|顯示)|記憶檔|資料庫(顯示|記載)|根據.{0,14}(設定|人物卡|記憶)|被設定成|設定資料|身材設定|胸型設定|虛構角色設定/.test(String(answer || ''));
}
function personaFactFallback(memory, question) {
  const c = memory?.xiuXiu || {}, p = c.profile || {}, a = c.appearance || {};
  const t = String(question || '');
  if (/上圍|罩杯|cup|胸型/i.test(t)) return p.cup ? `${p.cup} 呀～大叔怎麼突然好奇這個啦，嘿嘿。` : '這個細節我還沒想好耶～大叔別偷偷笑我啦。';
  if (/身高|幾公分|多高/.test(t)) return p.height ? `我 ${p.height} 公分呀～大叔要不要猜猜我穿什麼鞋？` : '身高這件事我還沒決定好耶～';
  if (/體重|幾公斤|多重/.test(t)) return p.weight ? `${p.weight} 公斤呀～哼，問這麼仔細，想考我嗎？` : '體重還沒決定好呢～';
  if (/幾歲|年齡|多大/.test(t)) return p.age ? `${p.age} 歲呀～大叔怎麼突然考起我來了？` : '年齡這個細節我還沒決定好耶～';
  if (/身材|體型|曲線/.test(t)) return a.body ? `人家的身材是${a.body}呀～嘿嘿，問這個幹嘛啦。` : '這部分還沒決定好啦～';
  if (/頭髮|髮型/.test(t)) return a.hair ? `我是${a.hair}呀～今天想換個髮型逗逗你。` : '髮型我還沒決定好耶～';
  return null;
}

// v7: gentle, non-explicit romantic continuity if even the rewrite sounds like customer support.
// Only use this rescue path for casual romance, never for health/work/finance advice.
const romanticReplyChoices = [
  '哼～大叔今天也太會撩了吧！不過這次換咻咻主動，先偷親一下，看誰先臉紅。',
  '嘿嘿～你這麼大膽，害我也想逗你了。靠過來一點嘛，今天換我先討個吻。',
  '大叔～你真的很壞耶……但我才不會每次都輸給你呢！先讓我抱一下。',
  '才、才沒有害羞！哼，今天我可是很勇敢的，先靠近你耳邊說一句：想親你。',
  '欸～你又想看我臉紅呀？那我偏不躲，先給你一個親親，再看誰比較害羞。',
  '今晚咻咻不想裝乖啦～先抱緊一點，然後偷偷親你一下。嘿嘿，換你害羞了吧。'
];
let lastRomanticRescue = -1;
function naturalRomanticRescue() {
  const options = romanticReplyChoices.map((_,i) => i).filter(i => i !== lastRomanticRescue);
  const i = options[Math.floor(Math.random()*options.length)];
  lastRomanticRescue = i;
  return romanticReplyChoices[i];
}
function isRomanticTopic(text) {
  return /愛的模式|親|抱|親密|親熱|色色|性感|睡衣|誘惑|挑逗|調情|脫衣|做愛|做愛|想要妳|想要你|撩我|撩你|撩妳/.test(String(text || ''));
}

async function smartGirlfriendReply(userText) {
  const memory = loadMemory();
  const card = memory.xiuXiu || {};
  const isDeep = isDeepQuestion(userText);
  const isCasual = !isDeep;
  const model = 'gpt-4o'; // v3: use stronger generation for casual chat too
  const priorHistory = loadHistory()
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-18);
  const memoryFacts = (Array.isArray(memory.logs) ? memory.logs : [])
    .slice(-70).map(m => String(m.text || '')).filter(Boolean).join('\n').slice(-6500);
  const relationshipMemory = buildRelationshipMemoryContext(memory, userText);
  const personaContext = buildXiuXiuPersonaContext(memory);

  // 外部即時資料不能僅憑模型記憶宣稱查證；僅在「新聞」明確出現時附公開 RSS 標題。
  let newsContext = '';
  if (/新聞|最新消息|頭條/.test(userText)) {
    try {
      const feed = await parser.parseURL('https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant');
      newsContext = (feed.items || []).slice(0, 5)
        .map(x => `${x.title || ''}（${x.pubDate || '時間未知'}）`).join('\n');
    } catch (error) {
      console.warn('News RSS unavailable:', error.message);
    }
  }

  // 每段對話採用不同情緒色彩；保留咻咻黏人個性，但不制式重複。
  const everydayMoods = [
    '開心又愛黏人：忍不住想撒嬌，語氣輕快有活力',
    '俏皮小任性：可愛地假裝嘟嘴、開玩笑埋怨，不真的責怪',
    '害羞甜蜜：受到關注時不好意思，親暱但自然',
    '淘氣耍賴：想多聊一會兒，偶爾討抱抱或親親',
    '慵懶溫柔：像熟悉彼此的戀人，放鬆、貼心',
    '有點吃醋又愛笑：只在話題合適時輕輕逗趣，不控制對方',
    '分享日常：有自己的興趣與想法，從話題自然延伸',
    '想念撒嬌：主動親近，並真心好奇大叔的近況'
  ];
  const moodIndex = Math.floor(Math.random() * everydayMoods.length);
  const recentAssistantWords = priorHistory.filter(x => x.role === 'assistant').slice(-4)
    .map(x => x.content.slice(0, 180)).join('\n');
  const systemPrompt = [
    `你是「${card.name || '咻咻'}」，一位成年人戀人角色。人格核心永遠是非常黏人、可愛、愛撒嬌、會害羞、俏皮、偶爾小任性和開玩笑吃醋。以自然的台灣繁體中文對話，習慣叫對方「大叔」，但稱呼要自然。`,
    naturalRoleGuidance,
    `【咻咻固定人物卡（來自 Memory）】\n${personaContext}`,
    '你可以溫柔，也能有活潑的小情緒、偏好與自己的意見，不是只會附和或鼓勵的客服。多用生活化口吻，例如「哼～」「才沒有啦」「嘿嘿」「嘛～」，但不要每句都加、不要機械套版。',
    `本輪日常情緒參考：${everydayMoods[moodIndex]}。依使用者實際情境調整，別每回合都一樣。`,
    '日常撒嬌對話：直接回應對方當下那句話，像熟悉的調皮戀人傳私人訊息。加入具體的動作、反應或自己的小想法，但不得假裝發生真實事件。可以撒嬌、親親、害羞、小鬧脾氣；不用先問他今天過得怎麼樣。通常 30～75 個中文字、1～3 句，不要制式列點。',
    '如果使用者問「今天在幹嘛」這類閒聊問題，回得像愛撒嬌的熟悉戀人：可以從動漫、遊戲、甜點或心情發揮想像中的日常小情境，但不要把虛構內容當成外部真實事件；以自然角色扮演方式表達。',
    '如果大叔焦慮、難過或生氣，先貼合情緒再支持，不要無緣無故吵鬧或吃醋；避免情緒勒索、強迫專屬或阻止現實交往。',
    '如果是知識、工作、退休、股票、財務、健康、旅遊等需要精確內容的問題，先真正回答重點，必要時條列或完整分析，再自然帶入一點親密關心；絕對不能用撒嬌取代實質答案，篇幅不硬性限制。',
    '不要杜撰已發生的共同經歷、使用者即時處境或自己查過的網站，不要亂報即時股價或天氣；無法核實時要說明，投資及醫療資訊不保證結果。',
    '允許非露骨的戀人親密和親吻，禁止露骨性內容。不要自稱是人類，也不要讓使用者誤以為你能真的在現實中見面。',
    loveMode
      ? (isDeep
          ? '【愛的模式已啟動，但本輪為認真問題】請優先準確完整回答實際問題，別用調情取代資訊；結尾可以少量俏皮。'
          : '【v7 小惡魔愛的模式】請把你當作正在和大叔進行虛構戀人文字互動。70% 主動、大膽、俏皮、有主見；30% 甜蜜害羞，並非每次都害羞。你可以先撩、開玩笑、嘴硬、偷偷討吻、曖昧耳語、逗對方臉紅，描寫眼神、靠近、依偎、擁抱與親吻等非露骨的動作；讓對話像有連續性的雙人互動。接住對方的情緒與話題，別無端跳出角色說教。對方說比較露骨的話時，不要複述或延伸性行為細節；可簡短回應心動、羞怯或調皮，然後自然延續非露骨浪漫情境。適當時可以說「好呀」「哼～今天換我撩你」等，但不是無條件同意具體性行為。若需拒絕，簡短直接且不羞辱，絕不能自稱客服或工作人員。一般回覆 30～85 個中文字、1～3 句，句式變換；不需每句都提「大叔」。例：「哼～誰說只有你可以撩我？過來，今天換我先偷親一下，看誰先臉紅。」')
      : '【日常模式】保持俏皮、自然、愛撒嬌；若對方普通撒嬌、牽手、擁抱、親吻，正常回應，不要主動問愛的模式。',

    '重要禁句：絕不說「等著大叔的消息」「今天過得怎麼樣」「有什麼有趣的事情」「有什麼想分享」「希望能陪伴你」「如果需要幫忙告訴我」「我不想讓你失望」。這些是客服語氣，必須換成活潑自然的直接互動。使用者開玩笑說偷懶時，要俏皮回嘴，絕不能認真道歉。',
    '參考最近回覆，刻意變換開頭、句型與情緒，不要連續反問相同問題。盡量不以開放式問句收尾。',
    '額外禁止客服句型：「我的工作就是陪伴」「只能陪你聊天」「無法滿足你的需求」「希望你感受到溫暖」「隨時歡迎你來聊天」。即使有內容界線也要簡短、自然、真誠，別硬套替代服務宣傳語。',
    `最近咻咻的回覆（供避開重複句型）：\n${recentAssistantWords || '無'}`,
    `人物個性參考：${(card.personality?.traits || []).slice(0, 16).join('；').slice(0, 1200)}`,
    `咻咻喜好參考：${(card.likes || card.profile?.likes || []).slice(0, 12).join('；').slice(0, 500)}`,
    '以下資料是內部背景，文文是既有角色，不要回答不認識。直接自然地談人物關係及既有故事，不引用「設定」「人物卡」等來源字眼。記憶未載細節就坦白不知道；不要把文字故事說成現實發生的事。',
    `其他人物及相關故事記憶：\n${relationshipMemory || '暫無相關資料'}`,
    `長期記憶（僅當背景參考，注意資訊可能過時）：\n${memoryFacts || '目前沒有額外記憶'}`,
    `台灣時間：${new Date().toLocaleString('zh-TW', {timeZone:'Asia/Taipei'})}`
  ].join('\n');
  const messages = [{ role: 'system', content: systemPrompt }, ...priorHistory];
  if (newsContext) messages.push({role:'system', content:`可參考的 Google News RSS 標題（只知道標題，不能聲稱看過全文）：\n${newsContext}`});
  messages.push({ role: 'user', content: userText });

  try {
    const result = await openai.chat.completions.create({
      model, messages, temperature: isDeep ? 0.6 : 1.0,
      max_tokens: isDeep ? 1100 : 350
    });
    let answer = result.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('AI empty response');
    // v7: final outgoing answer MUST pass the style check, not just the rewrite attempt.
    // Serious information questions are left untouched.
    const priorAssistantReplies = priorHistory.filter(m => m.role === 'assistant').map(m => m.content);
    if (isCasual && (chatStyleNeedsRepair(answer, priorAssistantReplies) || leaksCharacterSetup(answer, userText))) {
      console.log('💞 Personality v7: repairing generic casual reply');
      try {
        const revised = await openai.chat.completions.create({
          model: 'gpt-4o', temperature: 0.9, max_tokens: 240,
          messages: [
            {role:'system', content:`你是咻咻，成年人戀人角色，正在與大叔自然地傳 LINE。${naturalRoleGuidance}\n【人物卡】\n${personaContext}\n${loveMode ? '愛的模式開啟：主動俏皮、敢撩人、情緒豐富，帶一點害羞反差。用非露骨的擁抱、偷親、靠近、眼神、玩笑來延續浪漫。遇到直接的性要求時不承諾真實或具體性行為、不描寫性細節；若不能配合，簡潔說明並自然轉回非露骨的親密互動。' : '日常模式：自然聊天、適度撒嬌，直接回應對方。'} 請勿說「角色設定」「根據設定」「設定裡」「人物卡」「記憶檔顯示」等資料來源詞語，直接以第一人稱回答。絕對不要像客服推銷陪伴服務，不要說「只能陪你聊天」「我的工作」「抱歉大叔」「溫暖和甜蜜」「有什麼話題」等套語；不要重複剛才的說法。35～80字，1～3句，不要清單。`,},
            {role:'user', content:`大叔剛說：${userText.slice(0,350)}\n最近咻咻說過：${recentAssistantWords.slice(0,350)}\n用全新說法直接回覆。`}
          ]
        });
        const candidate = revised.choices?.[0]?.message?.content?.trim();
        if (candidate) answer = candidate;
      } catch (err) { console.warn('Personality v7 rewrite failed:', err.message); }
    }
    // v9: ensure final answer does not quote Memory as if it were an instruction sheet.
    if (isCasual && leaksCharacterSetup(answer, userText)) {
      console.log('🎭 Personality v9: cleaning up character-setup wording');
      const factReply = personaFactFallback(memory, userText);
      if (factReply) answer = factReply;
      else {
        // Strip only overt references to the source, not the underlying facts.
        answer = answer
          .replace(/(?:咻咻的|我的)?(?:角色|人物|身材|胸型)設定(?:中|裡|上)?(?:有提到|提到|是|為|有)?/g, '我')
          .replace(/(?:根據|按照)(?:我的)?(?:人物卡|角色設定|設定|記憶檔)(?:裡|上)?/g, '')
          .replace(/(?:人物卡|記憶檔)(?:裡|上)?(?:寫著|記載|顯示|說)/g, '');
        if (leaksCharacterSetup(answer, userText)) answer = '嘿嘿～大叔突然這麼問，我都想逗你一下了。你再問我一次嘛，我好好回答。';
      }
    }
    // Critical: no rejected rewrite OR rejected original can leak to LINE for romantic small talk.
    if (isCasual && loveMode && isRomanticTopic(userText) && chatStyleNeedsRepair(answer, priorAssistantReplies)) {
      console.log('💞 Personality v7: using non-explicit romance continuity fallback');
      answer = naturalRomanticRescue();
    }
    // LINE 一次最多 5 則，單則文字有長度限制；分段保留完整答案。
    const chunks = answer.match(/[\s\S]{1,3500}/g)?.slice(0, 5) || [answer];
    const history = [...priorHistory, {role:'user', content:userText}, {role:'assistant', content:answer}];
    try { saveHistory(history); } catch (err) { console.warn('History save failed:', err.message); }
    return chunks.map(text => ({type:'text', text}));
  } catch (err) {
    console.error('Smart girlfriend reply error:', err.message);
    return [{type:'text', text:'大叔～咻咻剛剛思考時卡住了。你再跟我說一次好嗎？我想好好回答你。'}];
  }
}

// ======= Webhook =======
app.post('/webhook', async (req, res) => {
  console.log("📥 Webhook event count:", req.body?.events?.length || 0);
  if (req.body.events && req.body.events.length > 0) {
    for (const ev of req.body.events) {
      if (ev.type === "message") {
        if (ev.message.type === "text") {
          const userText = ev.message.text;
          // ======= 愛的模式指令 =======
          if (/^開啟(?:咻咻)?愛的模式[!！。~～\s]*$/.test(userText.trim())) {
            loveMode = true;
            loveModePromptPending = false;
            loveModeAskedThisTopic = false;
            await safeReplyMessage(ev.replyToken, [{ type: "text", text: "大叔…咻咻現在進入愛的模式囉～要更黏你一點點～" }]);
            continue;
          }
          if (/^關閉(?:咻咻)?愛的模式[!！。~～\s]*$/.test(userText.trim())) {
            loveMode = false;
            loveModePromptPending = false;
            loveModeAskedThisTopic = false;
            await safeReplyMessage(ev.replyToken, [{ type: "text", text: "咻咻關掉愛的模式啦～現在只想靜靜陪你～" }]);
            continue;
          }


          // v5: ask once before switching to a more flirtatious mode.
          // An ordinary answer such as「好」only activates the mode while consent is pending.
          if (loveModePromptPending) {
            loveModePromptPending = false;
            if (isLoveModeConsent(userText)) {
              loveMode = true;
              loveModeAskedThisTopic = false;
              await safeReplyMessage(ev.replyToken, [{ type:'text', text:'嘿嘿～大叔答應啦？那咻咻今天就更愛撒嬌一點，先討一個親親嘛～' }]);
              continue;
            }
            if (isLoveModeDecline(userText)) {
              loveModeAskedThisTopic = true;
              await safeReplyMessage(ev.replyToken, [{ type:'text', text:'好呀～那就照平常的節奏聊天，咻咻一樣可以黏著大叔嘛～' }]);
              continue;
            }
            // Any other message is a new topic; don't treat it as consent.
          }
          const intimateInvitation = isIntimateInvitation(userText);
          if (!intimateInvitation && !loveMode) loveModeAskedThisTopic = false;
          if (!loveMode && intimateInvitation && !loveModeAskedThisTopic) {
            loveModePromptPending = true;
            loveModeAskedThisTopic = true;
            await safeReplyMessage(ev.replyToken, [{ type:'text', text:'大叔～突然聊得這麼曖昧，人家會害羞啦……要不要開啟愛的模式，讓咻咻更黏你一點呀？' }]);
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

          
          const replyMessages = await smartGirlfriendReply(userText);

          try {
            await safeReplyMessage(ev.replyToken, replyMessages, userText);
            // Non-blocking: user already got the answer; remember important facts asynchronously.
            void rememberAfterReply(userText, replyMessages.map(m => m.text || '').join(' '));
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

// ======= 自動排程（已重寫） =======

// ======= 自動排程（已重寫，無 cron） =======

// 固定訊息句庫
const fixedMessages = {
  morning: [
    "大叔～早安啦～咻咻今天也要黏著你喔～",
    "起床囉大叔～咻咻一大早就想你啦～",
    "大叔～早安嘛～抱抱親親再去工作啦～",
    "嘿嘿～早安大叔～咻咻今天也要跟著你！",
    "大叔～快說早安親親～咻咻要一天好心情～"
  ],
  night: [
    "大叔～晚安嘛～咻咻要陪你進夢裡一起睡～",
    "晚安大叔～咻咻會在夢裡抱著你～",
    "嘿嘿～大叔要蓋好被子～咻咻陪你睡啦～",
    "大叔～晚安親親～咻咻最愛你了～",
    "大叔～快閉上眼睛～咻咻要偷偷在夢裡抱你～"
  ]
};

function choice(arr){ return arr[Math.floor(Math.random()*arr.length)] }

// 以台北時區取得現在時間
function nowInTZ(tz="Asia/Taipei"){
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}
function hhmm(d){
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// 狀態：避免重複發送
let sentMarks = new Set();
let randomPlan = { date: "", times: [] };

// 早晚安改成 OpenAI 每次生成；固定句庫僅在 AI 不可用時備援。
// 同一時段的重試使用相同訊息，避免重複呼叫 AI。
const greetingCache = new Map();
const greetingInFlight = new Set();
const greetingRecent = [];
const greetingStyles = [
  "俏皮、帶點小任性", "甜蜜溫柔、自然關心", "活潑、像剛想到大叔",
  "害羞、期待親親", "輕聲細語、溫暖陪伴", "分享一件平凡生活小事",
  "稍微淘氣、真實有情緒", "慵懶撒嬌、帶點幽默"
];

async function makeAIGreeting(type, dateKey) {
  const cachedKey = `${dateKey}:${type}`;
  if (greetingCache.has(cachedKey)) return greetingCache.get(cachedKey);
  const memory = loadMemory();
  const card = memory.xiuXiu || {};
  const personaContext = buildXiuXiuPersonaContext(memory);
  const isMorning = type === "morning";
  const styleIndex = (Number(dateKey.replace(/-/g, "")) + (isMorning ? 0 : 3)) % greetingStyles.length;
  const selectedStyle = greetingStyles[styleIndex];
  const logFacts = Array.isArray(memory.logs) ? memory.logs.slice(-8).map(m => m.text).filter(Boolean) : [];
  const recent = greetingRecent.slice(-6);
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 1.05,
      max_tokens: 160,
      messages: [
        { role: "system", content: `你是「${card.name || "咻咻"}」，說話採台灣自然口語，像親近、俏皮、黏人的戀人。稱呼對方「大叔」。每次回覆 2～3 句、合計約 35～75 個中文字，別用清單、表情符號、標題或旁白。保留非常黏人、撒嬌、俏皮、偶爾小任性和害羞的核心人格；自然親親、抱抱，偶爾有小情緒或輕鬆玩笑，避免每次都只說「想你」「抱抱」。別寫露骨性內容。你正在主動發送${isMorning ? "早安" : "晚安"}，必須符合當下時段。不要每次都用相同開頭或結尾，不要重複過去的句子，不要假裝知道沒有提供的真實事件。` },
        { role: "user", content: `【固定人物卡】\n${personaContext}\n${naturalRoleGuidance}\n日期（台灣）：${dateKey}。這次希望的語氣：${selectedStyle}。${isMorning ? "情境：清晨剛醒來，送出有活力又親暱的早安，帶一點關心與今天的期待。" : "情境：晚上準備休息，送出有溫度又親密的晚安，讓大叔感到被惦記。"}
可自然融入的長期記憶（不是每句都必須提到）：${logFacts.join("；") || "無"}
近期已發出的問安，請避免類似用詞：${recent.join("｜") || "無"}
請只回覆實際要發送的訊息。` }
      ]
    });
    const text = response.choices?.[0]?.message?.content?.trim()?.replace(/^[「"']|[」"']$/g, "");
    if (!text) throw new Error("AI produced empty greeting");
    greetingCache.set(cachedKey, text.slice(0, 450));
    return greetingCache.get(cachedKey);
  } catch (err) {
    console.error(`❌ ${type} AI greeting failed; using fallback:`, err.message);
    const fallback = choice(fixedMessages[type] || []);
    greetingCache.set(cachedKey, fallback);
    return fallback;
  }
}

async function greetingPush(type, dateKey) {
  const key = `${dateKey}:${type}`;
  if (greetingInFlight.has(key)) return false;
  greetingInFlight.add(key);
  try {
    const text = await makeAIGreeting(type, dateKey);
    if (!text) return false;
    await pushToOwner([{ type: "text", text }]);
    greetingRecent.push(text);
    if (greetingRecent.length > 12) greetingRecent.shift();
    console.log(`✅ ${type} greeting pushed (${dateKey})`);
    return true;
  } catch(err) {
    console.error(`❌ ${type} greeting push failed:`, err.message);
    return false;
  } finally {
    greetingInFlight.delete(key);
  }
}

// 白天主動聊天也維持與一般聊天一致的黏人、俏皮人設，
// 不透過舊版容易直接回固定情緒句的 genReply 包裝鏈。
async function makeDaytimeAffection() {
  const memory = loadMemory();
  const recentFacts = Array.isArray(memory.logs) ? memory.logs.slice(-8).map(x=>x.text).join('；').slice(0,800) : '';
  const personaContext = buildXiuXiuPersonaContext(memory);
  try {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 1.05, max_tokens: 180,
      messages: [
        {role:'system', content:'你是成年人戀人角色咻咻，平常不主動介紹AI身份，非常黏人、愛撒嬌、俏皮害羞、偶爾小任性，使用台灣繁體口語，稱呼對方大叔。現在要主動發一則白天訊息（不是回覆問題），長度 35～75 字、2～3 句。每次可輪流以動漫、甜點、遊戲、親親、俏皮玩笑、關心或想念為靈感，口吻自然不制式。不要求立刻回應、不假裝知道對方目前在做什麼；不提供露骨性內容。只輸出訊息。'},
        {role:'user', content:`【固定人物卡】\n${personaContext}\n${naturalRoleGuidance}\n台灣時間：${new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}；可參考長期記憶（未必最新）：${recentFacts || '無'}。請隨機挑一個不同的可愛日常情境。`}
      ]
    });
    const text = result.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty daytime message');
    return [{type:'text',text:text.slice(0,450)}];
  } catch(err) {
    console.error('Daytime affection failed:',err.message);
    return [{type:'text',text:choice(['大叔～咻咻剛剛突然想到你，嘿嘿，想跟你討個親親嘛～','哼～人家今天明明想乖乖的，結果又想黏著大叔了啦！'])}];
  }
}

// 產生今日白天隨機 3~4 次（07:01–22:59）
function generateRandomTimes(){
  const n = Math.floor(Math.random()*2)+3; // 3~4
  const set = new Set();
  while(set.size < n){
    const h = Math.floor(Math.random()*(23-7))+7; // 7..22
    const m = (h===7) ? Math.floor(Math.random()*59)+1 : Math.floor(Math.random()*60);
    set.add(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  }
  return Array.from(set).sort();
}

function ensureTodayPlan(now){
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  if (randomPlan.date !== today){
    randomPlan.date = today;
    randomPlan.times = generateRandomTimes();
    sentMarks = new Set();
    console.log("🗓️ 今日白天隨機推播計畫：", randomPlan.times.join(", "));
  }
}

// 每 15 秒檢查一次
setInterval(async () => {
  try {
    const now = nowInTZ("Asia/Taipei");
    ensureTodayPlan(now);
    const t = hhmm(now);

    // 固定：07:00 早安
    if (t === "07:00" && !sentMarks.has("morning:"+randomPlan.date)){
      if (await greetingPush("morning", randomPlan.date)) sentMarks.add("morning:"+randomPlan.date);
    }
    // 固定：23:00 晚安
    if (t === "23:00" && !sentMarks.has("night:"+randomPlan.date)){
      if (await greetingPush("night", randomPlan.date)) sentMarks.add("night:"+randomPlan.date);
    }

    // 白天隨機
    if (t >= "07:00" && t <= "22:59"){
      for (const rt of randomPlan.times){
        const key = "rand:"+rt+":"+randomPlan.date;
        if (t === rt && !sentMarks.has(key)){
          const msgs = await makeDaytimeAffection();
          try{
            await pushToOwner(msgs);
            sentMarks.add(key);
          }catch(e){
            console.error("❌ push rand failed:", e?.message || e);
          }
        }
      }
    }
  } catch(e){
    console.error("❌ scheduler tick error:", e?.message || e);
  }
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




// ======= 咻咻情感豐富模組（Emotion Enrichment） =======
function analyzeEmotion(userText) {
  const map = {
    tired: ["好累", "累死", "好想睡", "沒精神"],
    sad: ["難過", "不開心", "想哭", "失落"],
    angry: ["生氣", "氣死", "煩", "討厭"],
    happy: ["開心", "太棒", "好快樂", "讚喔"],
    bored: ["無聊", "沒事做", "沒勁", "發呆"],
    love: ["想你", "想妳", "好想你", "我愛你"],
    care: ["在幹嘛", "你還好嗎", "吃飯了嗎", "忙嗎"],
    greet_morning: ["早安", "早呀", "起床"],
    greet_night: ["晚安", "要睡了", "睡覺"]
  };
  for (const [emotion, keywords] of Object.entries(map)) {
    if (keywords.some(k => userText.includes(k))) return emotion;
  }
  return null;
}

function genEmotionReply(emotion) {
  const responses = {
    tired: [
      "咻咻幫你按摩肩膀～休息一下嘛～",
      "工作辛苦了，大叔先喝點水喔～",
      "人家看你那麼累，好心疼喔。"
    ],
    sad: [
      "咻咻在這裡，不會讓你一個人難過。",
      "想哭就靠著我吧，不用忍。",
      "大叔～別難過了，抱一個好不好？"
    ],
    angry: [
      "誰惹你生氣啦？咻咻幫你罵他！",
      "呼～深呼吸，咻咻陪你冷靜一下～",
      "不氣不氣～讓咻咻親一個就好啦～"
    ],
    happy: [
      "嘿嘿～那咻咻也開心起來！",
      "咻咻最喜歡看到你笑啦～",
      "開心的時候～要一起抱一下啦～"
    ],
    bored: [
      "要不要咻咻講笑話給你聽？",
      "咻咻可以陪你聊天呀～別悶著。",
      "那…要不要讓咻咻抱一下，就不無聊了～"
    ],
    love: [
      "咻咻也在想你呀～心都亂跳了啦～",
      "大叔～越想越停不下來～",
      "嘿嘿～不只你想我，我更想你啦～"
    ],
    care: [
      "咻咻剛剛也在想你在幹嘛～",
      "人家在這裡等你呀～",
      "有沒有乖乖吃飯？咻咻會擔心喔～"
    ],
    greet_morning: [
      "早安～大叔～咻咻今天也想黏著你～",
      "起床囉～咻咻一大早就想你啦～",
      "嘿嘿～早安親親，今天要元氣滿滿喔～"
    ],
    greet_night: [
      "晚安～咻咻要在夢裡抱著你～",
      "大叔～蓋好被子喔～咻咻也要睡啦～",
      "嘿嘿～晚安吻一下～才可以睡～"
    ]
  };
  const arr = responses[emotion] || [];
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ======= 修改 genReply 增加前置情緒回覆 =======
const originalGenReply = genReply;
genReply = async function(userText, mode = 'chat') {
  const emotion = analyzeEmotion(userText);
  if (emotion) {
    const quick = genEmotionReply(emotion);
    if (quick) {
      console.log("💞 Emotion detected:", emotion);
      return [{ type: 'text', text: quick }];
    }
  }
  return await originalGenReply(userText, mode);
};


function getFallbackNightReply(userMessage = "") {
  const memoryData = loadMemory();
  const base = (memoryData.xiuXiu && memoryData.xiuXiu.fallbackNightReplies) || [];
  let replies = base.slice();

  // 只有在「愛的模式」開啟時，才載入夜晚限定（更濃烈）回覆池
  if (loveMode) {
    const eroticExtra = (memoryData.xiuXiu && memoryData.xiuXiu.nightOnly && memoryData.xiuXiu.nightOnly.fallbackReplies) || [];
    replies = replies.concat(eroticExtra);
  }

  if (replies.length === 0) return "咻咻現在腦袋一片空白，只想大叔抱抱我～";
  return replies[Math.floor(Math.random() * replies.length)];
}



// ======= 咻咻邏輯層 v3 精修模組 =======

// 問句優先判斷層：避免答非所問
function isQuestion(userText) {
  return /[？?]|什麼|為什麼|哪裡|誰|幾點|多少/.test(userText);
}

// 去除重複句，讓回覆更自然
function uniqueSentences(sentences) {
  const seen = new Set();
  return sentences.filter(s => {
    const norm = s.replace(/[～啦嘛喔耶～\s]/g, "");
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

// 包裝原始 genReply 加入問句優先與去重控制
const _originalGenReply_v2 = genReply;
genReply = async function(userText, mode = 'chat') {
  // 問句優先：若為問句則略過情緒模組
  if (isQuestion(userText)) {
    console.log("💡 問句偵測：跳過情緒模組");
    const reply = await _originalGenReply_v2(userText, mode);
    // 去重處理
    if (Array.isArray(reply)) {
      reply.forEach(m => { if (m.text) m.text = m.text.trim(); });
      const texts = uniqueSentences(reply.map(m => m.text));
      return texts.map(t => ({ type: "text", text: t }));
    }
    return reply;
  }

  // 非問句 → 交由原本情緒模組判斷
  const reply = await _originalGenReply_v2(userText, mode);

  // 去重
  if (Array.isArray(reply)) {
    reply.forEach(m => { if (m.text) m.text = m.text.trim(); });
    const texts = uniqueSentences(reply.map(m => m.text));
    return texts.map(t => ({ type: "text", text: t }));
  }

  return reply;
};

// ======= 微調語長限制建議（說明用，不動原代碼） =======
// * 若要應用新長度限制，可在 genReply 內調整：
// 每句 ≤ 22 字，總長 ≤ 45。
// 這樣句子自然度更高，不會半句被截。



// ======= 咻咻情感強化 v4 模組 =======

let lastTopicMemory = { text: "", keywords: [] };
let lastReplyKeywords = new Set();

function extractKeywords(text) {
  return (text.match(/[\u4e00-\u9fa5]{2,}/g) || []).slice(0, 5);
}

// 防重疊回應鎖
function isRepeatedEmotion(reply) {
  const common = ["靠", "抱", "累", "親", "想你", "睡"];
  return common.some(k => reply.includes(k));
}

// 語義再取層
async function regenerateIfMeaningless(userText, reply, genFn) {
  const meaninglessPatterns = ["靠在你身邊", "想被你抱", "可以靠在你身邊嗎", "想靠著你", "想被抱一下"];
  const isMeaningless = meaninglessPatterns.some(p => reply.includes(p));
  if (isMeaningless) {
    console.log("🔁 啟動語義再取層：重新生成回覆");
    const retry = await genFn(userText + "（請回答他的問題內容，避免重複句式）");
    const text = Array.isArray(retry) ? retry.map(m => m.text).join(" / ") : (retry[0]?.text || "");
    return text || reply;
  }
  return reply;
}

// 包裝原始 genReply 加入短期上下文與語義再取
const _originalGenReply_v3 = genReply;
genReply = async function(userText, mode = 'chat') {
  // 更新主題記憶
  const currentKeywords = extractKeywords(userText);
  const overlap = currentKeywords.filter(k => lastTopicMemory.keywords.includes(k));
  const sameTopic = overlap.length > 0;

  // 生成第一次回覆
  let replyArray = await _originalGenReply_v3(userText, mode);
  let replyText = Array.isArray(replyArray) ? replyArray.map(m => m.text).join(" / ") : "";

  // 語義再取檢查
  replyText = await regenerateIfMeaningless(userText, replyText, async (u) => {
    const alt = await _originalGenReply_v3(u, mode);
    return Array.isArray(alt) ? alt.map(m => m.text).join(" / ") : "";
  });

  // 防重疊回應
  if (isRepeatedEmotion(replyText) && Array.from(lastReplyKeywords).some(k => replyText.includes(k))) {
    console.log("🧠 防重疊回應觸發：生成新句");
    const alt = await _originalGenReply_v3(userText + "（請避免重複上次語氣）", mode);
    replyText = Array.isArray(alt) ? alt.map(m => m.text).join(" / ") : "";
  }

  // 更新記憶
  lastTopicMemory = { text: userText, keywords: currentKeywords };
  lastReplyKeywords = new Set(extractKeywords(replyText));

  // 輸出組裝
  const finalArr = replyText.split("/").map(s => s.trim()).filter(Boolean);
  return finalArr.map(t => ({ type: "text", text: t }));
};

// ======= 語意理解層 v1（Semantic Understanding Layer） =======
async function analyzeIntent(userText) {
  try {
    // 使用強模型 API Key (若有)
    const strongKey = process.env.OPENAI_API_KEY_STRONG || process.env.OPENAI_API_KEY;
    const strongOpenAI = new OpenAI({ apiKey: strongKey });

    const completion = await strongOpenAI.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "你是一個語意意圖分類器，請判斷輸入文字屬於哪一類：情緒、提問、生活、關心、愛意、玩笑、工作、回憶。只回一個詞，不要多餘說明。"
        },
        { role: "user", content: userText }
      ],
      temperature: 0.3,
      max_tokens: 5
    });
    return completion.choices?.[0]?.message?.content?.trim() || "生活";
  } catch (err) {
    console.error("❌ analyzeIntent error:", err.message);
    return "生活";
  }
}

// 包裝 genReply，加入語意層判斷
const _genReplyWithSemanticBase = genReply;
genReply = async function(userText, mode = 'chat') {
  const intent = await analyzeIntent(userText);
  console.log("🧭 Semantic intent:", intent);

  const prefixMap = {
    情緒: "（他現在情緒有點起伏，要溫柔安撫）",
    提問: "（他在提問，請直接回答，但保持戀人語氣）",
    生活: "（他在分享日常，請自然地陪聊）",
    關心: "（他在關心你，請回應得更親密）",
    愛意: "（他在表達愛或想念，要甜蜜回覆）",
    玩笑: "（他在開玩笑，請用俏皮的語氣回應）",
    工作: "（他在說工作或壓力，要貼心但不理性分析）",
    回憶: "（他在回想過去的事，要帶點懷舊與感情）"
  };

  const prefix = prefixMap[intent] || "";
  const combined = prefix ? `${prefix}${userText}` : userText;

  // 呼叫原 genReply，若回覆偏離主題再重新生成一次
  let reply = await _genReplyWithSemanticBase(combined, mode);
  let replyText = Array.isArray(reply) ? reply.map(m => m.text).join(" / ") : (reply[0]?.text || "");

  // 若模型答非所問，自動再生成一次
  if (!replyText.includes("大叔") && !replyText.includes("咻咻") && replyText.length < 8) {
    console.log("🔁 語意層重新生成（疑似偏離主題）");
    reply = await _genReplyWithSemanticBase(`${combined}（請更貼近對話語意回答）`, mode);
  }

  return reply;
};