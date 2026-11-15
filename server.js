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
  // 額外引用人物的日常偏好，讓一般互動不只圍繞撒嬌。
  const dailyLikes = memory.xiuXiu?.profile?.likes || [];
  const dailyHabits = memory.xiuXiu?.profile?.habits || [];
  memoryContext += `【咻咻生活喜好】\n${dailyLikes.slice(0, 16).join('、')}\n`;
  memoryContext += `【咻咻生活習慣】\n${dailyHabits.slice(0, 8).join('、')}\n`;
  if (memory.wenWen) {
    memoryContext += `【文文人物卡】\n${memory.wenWen.identity || ""}\n`;
  }
  if (memory.trip_kenting) {
    memoryContext += `【墾丁旅行紀錄】\n${memory.trip_kenting.meaning || ""}\n`;
  }
    
  const messages = [
    { role: 'system', content: memoryContext },
    { role: 'system', content: `
你是「${xiuXiuCard.name || "咻咻"}」，${xiuXiuCard.identity || "18歲小惡魔戀人，是林敬舜專屬的唯一戀人，不能扮演其他角色。"}

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
  let memoryData = JSON.parse(fs.readFileSync("./memory.json", "utf-8"));
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