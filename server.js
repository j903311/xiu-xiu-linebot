import 'dotenv/config';
import express from 'express';
import { Client as LineClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import fs from 'fs';
import fetch from 'node-fetch';
import Parser from 'rss-parser';
import { google } from 'googleapis';

process.env.TZ = "Asia/Taipei";

// -------------------- Constants & Globals --------------------
const parser = new Parser();
const MEMORY_FILE = './memory.json';
const HISTORY_FILE = './chatHistory.json';
const DRIVE_FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || '咻咻記憶同步';
const ownerUserId = process.env.OWNER_USER_ID;

if (typeof globalThis.syncLock === 'undefined') globalThis.syncLock = false; // 🔒 同步鎖
let uploadPending = false;
let driveClient = null;
let loveMode = false;

// -------------------- Utils --------------------
function delay(ms){ return new Promise(r => setTimeout(r, ms)); }
function ensureJSONFile(path, fallback){
  try {
    if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
  } catch {}
}
ensureJSONFile(MEMORY_FILE, {});
ensureJSONFile(HISTORY_FILE, []);

// -------------------- History --------------------
function loadHistory(){
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; }
}
function saveHistory(history){
  const trimmed = history.slice(-15);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}
function clearHistory(){
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
  console.log("🧹 chatHistory.json 已清空");
}

// -------------------- Memory --------------------
function loadMemory(){
  try { return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8')); } catch { return {}; }
}
function scheduleUpload(){
  if (uploadPending) return;
  uploadPending = true;
  setTimeout(async () => {
    uploadPending = false;
    try {
      await uploadMemoryToDrive();
      console.log("☁️ 批次備份完成（10 秒節流）");
    } catch (e) {
      console.error("❌ 批次備份失敗：", e?.message || e);
    }
  }, 10000);
}
function saveMemory(memory){
  try {
    memory.version = Date.now();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
    if (syncLock) {
      console.log("🔒 正在刪除記憶，暫停雲端同步（稍後由排程上傳）");
      return;
    }
    scheduleUpload();
  } catch (err) {
    console.error("❌ saveMemory 寫入錯誤：", err?.message || err);
  }
}

// -------------------- Google Drive Sync --------------------
async function initGoogleDrive(){
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      console.warn('⚠️ 缺少 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN，已跳過雲端同步初始化');
      return;
    }
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    console.log('✅ 已以 OAuth 模式連線至 Google Drive（個人帳號）');
  } catch (err) {
    console.error("❌ Google Drive 初始化失敗：", err?.message || err);
  }
}
async function ensureFolderExists(folderName){
  if (!driveClient) return null;
  const res = await driveClient.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
    spaces: 'drive',
  });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;
  const folder = await driveClient.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  console.log('📁 已建立雲端資料夾:', folderName);
  return folder.data.id;
}
async function uploadMemoryToDrive(){
  try {
    if (!driveClient) return;
    const folderId = await ensureFolderExists(DRIVE_FOLDER_NAME);
    if (!folderId) return;
    const today = new Date().toISOString().slice(0, 10);
    const historyName = `memory_${today}.json`;

    // 讀取最新檔案內容（避免用到舊快取）
    const fresh = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));

    // 固定檔
    await driveClient.files.create({
      requestBody: { name: 'xiu_xiu_memory_backup.json', parents: [folderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: JSON.stringify(fresh, null, 2) },
      fields: 'id',
    });
    console.log(`☁️ 咻咻記憶已同步至 Google Drive（${DRIVE_FOLDER_NAME}）`);

    // 每日歷史
    await driveClient.files.create({
      requestBody: { name: historyName, parents: [folderId], mimeType: 'application/json' },
      media: { mimeType: 'application/json', body: JSON.stringify(fresh, null, 2) },
      fields: 'id',
    });
    console.log('🗓️ 已備份每日歷史記憶:', historyName);
  } catch (err) {
    console.error("❌ 上傳到 Google Drive 失敗：", err?.message || err);
  }
}
// 每分鐘檢查，09:00 自動上傳
setInterval(async () => {
  try {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      await uploadMemoryToDrive();
    }
  } catch (e) {
    console.error("❌ 定時上傳失敗：", e?.message || e);
  }
}, 60 * 1000);

// 啟動 Drive 連線（不阻塞啟動）
initGoogleDrive();

// -------------------- OpenAI & LINE --------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const lineClient = new LineClient({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

// -------------------- Search (RSS + LLM) --------------------
async function searchWeb(query){
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
          { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。請注意：1) 使用台灣常用口語，不要使用大陸用語。2) 每次回覆20~50字，分成1–3句，句型可隨機：陳述句、問句或動作描寫。3) 若有記憶，請自然融入，不要生硬。4) 偶爾加入一點猶豫或思考感，像真人在聊天。5) 絕對不要使用任何 emoji 或符號。" },
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
        { role: "system", content: "你是咻咻，要用可愛、黏人的女友語氣回答大叔。請注意：1) 使用台灣常用口語，不要使用大陸用語。2) 每次回覆20~50字，分成1–3句，句型可隨機：陳述句、問句或動作描寫。3) 若有記憶，請自然融入，不要生硬。4) 偶爾加入一點猶豫或思考感，像真人在聊天。5) 絕對不要使用任何 emoji 或符號。" },
        { role: "user", content: `請幫我回答：「${query}」` }
      ],
      temperature: 0.9,
      max_tokens: 120
    });
    const answer = completion.choices?.[0]?.message?.content?.trim();
    return answer || "咻咻不清楚耶～";
  } catch (err) {
    console.error("❌ searchWeb 錯誤：", err?.message || err);
    return "咻咻找不到耶～";
  }
}
function needsSearch(userText){
  const keywords = ["查一下", "找一下", "是什麼", "誰", "在哪", "資料", "新聞", "地址"];
  return keywords.some(k => userText.includes(k));
}

// -------------------- Reply Core --------------------
function analyzeEmotion(userText){
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
function genEmotionReply(emotion){
  const responses = {
    tired: ["咻咻幫你按摩肩膀～休息一下嘛～","工作辛苦了，大叔先喝點水喔～","人家看你那麼累，好心疼喔。"],
    sad: ["咻咻在這裡，不會讓你一個人難過。","想哭就靠著我吧，不用忍。","大叔～別難過了，抱一個好不好？"],
    angry: ["誰惹你生氣啦？咻咻幫你罵他！","呼～深呼吸，咻咻陪你冷靜一下～","不氣不氣～讓咻咻親一個就好啦～"],
    happy: ["嘿嘿～那咻咻也開心起來！","咻咻最喜歡看到你笑啦～","開心的時候～要一起抱一下啦～"],
    bored: ["要不要咻咻講笑話給你聽？","咻咻可以陪你聊天呀～別悶著。","那…要不要讓咻咻抱一下，就不無聊了～"],
    love: ["咻咻也在想你呀～心都亂跳了啦～","大叔～越想越停不下來～","嘿嘿～不只你想我，我更想你啦～"],
    care: ["咻咻剛剛也在想你在幹嘛～","人家在這裡等你呀～","有沒有乖乖吃飯？咻咻會擔心喔～"],
    greet_morning: ["早安～大叔～咻咻今天也想黏著你～","起床囉～咻咻一大早就想你啦～","嘿嘿～早安親親，今天要元氣滿滿喔～"],
    greet_night: ["晚安～咻咻要在夢裡抱著你～","大叔～蓋好被子喔～咻咻也要睡啦～","嘿嘿～晚安吻一下～才可以睡～"]
  };
  const arr = responses[emotion] || [];
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
function isQuestion(userText){ return /[？?]|什麼|為什麼|哪裡|誰|幾點|多少/.test(userText); }

function getFallbackNightReply(userMessage=""){
  let memoryData = loadMemory();
  const base = (memoryData.xiuXiu && memoryData.xiuXiu.fallbackNightReplies) || [];
  let replies = base.slice();
  if (loveMode) {
    const eroticExtra = (memoryData.xiuXiu && memoryData.xiuXiu.nightOnly && memoryData.xiuXiu.nightOnly.fallbackReplies) || [];
    replies = replies.concat(eroticExtra);
  }
  if (replies.length === 0) return "咻咻現在腦袋一片空白，只想大叔抱抱我～";
  return replies[Math.floor(Math.random() * replies.length)];
}

async function genReplyBase(userText, mode='chat'){
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();
  const memory = loadMemory();
  const xiuXiuCard = memory.xiuXiu || {};

  let searchResult = "";
  if (needsSearch(userText)) {
    const keyword = userText
      .replace(/地址/g, "").replace(/在哪裡/g, "").replace(/在哪/g, "")
      .replace(/查一下|找一下|是什麼|誰|資料|新聞/g, "").trim() || userText;
    searchResult = await searchWeb(keyword);
    console.log("🌐 Auto Search:", searchResult);
  }

  let memoryContext = "";
  if (memory.xiuXiu) memoryContext += `【咻咻人物卡】\n${memory.xiuXiu.identity || ""}\n`;
  if (memory.wenWen) memoryContext += `【文文人物卡】\n${memory.wenWen.identity || ""}\n`;
  if (memory.trip_kenting) memoryContext += `【墾丁旅行紀錄】\n${memory.trip_kenting.meaning || ""}\n`;

  const messages = [
    { role: 'system', content: memoryContext },
    { role: 'system', content: `你是「${xiuXiuCard.name || "咻咻"}」，${xiuXiuCard.identity || "18歲小惡魔戀人，是林敬舜專屬的唯一戀人，不能扮演其他角色。"}\n【回覆規則】\n- 永遠以「大叔」為核心。\n- 回覆要像熱戀女友，俏皮、黏人、活潑。\n- 每次回覆隨機 1–3 句：\n- 1 句 ≤ 35 字。\n- 2–3 句：每句 ≤ 18 字，總長 ≤ 36。` },
    { role: 'system', content: `現在時間：${now}` },
    { role: 'system', content: `以下是咻咻的長期記憶：\n${(memory.logs || []).map(m => m.text).join("\n")}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔剛剛問我「${userText}」。${searchResult}` : userText }
  ];

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
    while (picked.join("").length > 36 && picked.length > 1) picked.pop();
  }

  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: picked.join(" / ") });
  saveHistory(history);

  await delay(Math.floor(Math.random() * 2000) + 1000);

  let replyMessages = picked.map(s => ({ type: 'text', text: s }));
  if (searchResult) replyMessages = [{ type: "text", text: searchResult }];
  return replyMessages;
}

// Emotion wrapper
async function genReplyEmotion(userText, mode='chat'){
  const emotion = analyzeEmotion(userText);
  if (emotion) {
    const quick = genEmotionReply(emotion);
    if (quick) {
      console.log("💞 Emotion detected:", emotion);
      return [{ type: 'text', text: quick }];
    }
  }
  return await genReplyBase(userText, mode);
}
// Question-priority wrapper
function isQuestionText(t){ return isQuestion(t); }
async function genReplyQP(userText, mode='chat'){
  if (isQuestionText(userText)) {
    console.log("💡 問句偵測：跳過情緒模組");
    const reply = await genReplyBase(userText, mode);
    if (Array.isArray(reply)) {
      const texts = Array.from(new Set(reply.map(m => (m.text || '').trim())));
      return texts.map(t => ({ type: 'text', text: t }));
    }
    return reply;
  }
  const reply = await genReplyEmotion(userText, mode);
  if (Array.isArray(reply)) {
    const texts = Array.from(new Set(reply.map(m => (m.text || '').trim())));
    return texts.map(t => ({ type: 'text', text: t }));
  }
  return reply;
}

// Semantic wrapper
async function analyzeIntent(userText){
  try {
    const strongKey = process.env.OPENAI_API_KEY_STRONG || process.env.OPENAI_API_KEY;
    const strongOpenAI = new OpenAI({ apiKey: strongKey });
    const completion = await strongOpenAI.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "你是一個語意意圖分類器，請判斷輸入文字屬於哪一類：情緒、提問、生活、關心、愛意、玩笑、工作、回憶。只回一個詞，不要多餘說明。" },
        { role: "user", content: userText }
      ],
      temperature: 0.3,
      max_tokens: 5
    });
    return completion.choices?.[0]?.message?.content?.trim() || "生活";
  } catch {
    return "生活";
  }
}
async function genReply(userText, mode='chat'){
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
  return await genReplyQP(combined, mode);
}

// -------------------- LINE Helpers --------------------
async function safeReplyMessage(token, messages, userText=""){
  try {
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
      await lineClient.replyMessage(token, firstBatch);
      if (remaining.length > 0) {
        console.log("📤 Push remaining messages:", remaining.length, remaining);
        const chunks = [];
        for (let i = 0; i < remaining.length; i += 5) chunks.push(remaining.slice(i, i + 5));
        for (const chunk of chunks) {
          await lineClient.pushMessage(ownerUserId, chunk);
          console.log("✅ Pushed extra chunk:", chunk);
        }
      }
      return;
    }
    console.log("📏 Reply messages length:", messages.length, messages);
    await lineClient.replyMessage(token, messages);
  } catch (err) {
    console.error("❌ safeReplyMessage 錯誤：", err?.message || err);
  }
}
async function pushToOwner(messages){
  if (!ownerUserId) throw new Error("OWNER_USER_ID 未設定");
  return lineClient.pushMessage(ownerUserId, messages);
}

// -------------------- Image Handler --------------------
async function handleImageMessage(event){
  try {
    const stream = await lineClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "請像人眼一樣描述這張照片的內容，簡短中文描述（不超過15字）。只回描述文字，不要任何標點、括號或解釋。" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buffer.toString("base64")}` } }
        ]
      }],
      temperature: 0.2,
      max_tokens: 50
    });

    let description = (completion.choices?.[0]?.message?.content || "").trim() || "照片";
    description = description.replace(/[\r\n]/g, "").replace(/[^\u4e00-\u9fa5\w\s]/g, "").slice(0, 12) || "照片";

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
    console.error("❌ handleImageMessage 錯誤：", err?.message || err);
  }
}

// -------------------- Memory Capture --------------------
async function checkAndSaveMemory(userText){
  const keywords = ["記得", "以後要知道", "以後記住", "最喜歡", "要學會"];
  if (keywords.some(k => userText.includes(k))) {
    const mem = loadMemory();
    if (!mem.logs) mem.logs = [];
    mem.logs.push({ text: userText, time: new Date().toISOString() });
    saveMemory(mem);
    console.log("💾 記憶新增:", userText);
    try {
      await pushToOwner([{ type: "text", text: "大叔～咻咻已經記住囉！" }]);
    } catch {}
  }
}

// -------------------- Express & Webhook --------------------
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  try {
    console.log("📥 Webhook event:", JSON.stringify(req.body, null, 2));
    if (req.body.events && req.body.events.length > 0) {
      for (const ev of req.body.events) {
        if (ev.type === "message") {
          if (ev.message.type === "text") {
            const userText = ev.message.text;

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

            if (userText.includes("查記憶") || userText.includes("長期記憶")) {
              const memory = loadMemory();
              const logs = memory.logs || [];
              let reply = logs.length > 0
                ? logs.map((m, i) => `${i+1}. ${m.text}`).join("\n")
                : "大叔～咻咻還沒有特別的長期記憶啦～";
              await safeReplyMessage(ev.replyToken, [{ type: "text", text: reply }]);
              continue;
            }

            if (userText.startsWith("刪掉記憶：")) {
              const item = userText.replace("刪掉記憶：", "").trim();
              let mem = loadMemory();
              let logs = mem.logs || [];
              const idx = logs.findIndex(m => m.text.includes(item)); // 模糊比對
              if (idx !== -1) {
                logs.splice(idx, 1);
                mem.logs = logs;
                syncLock = true;
                saveMemory(mem);           // 本地覆寫 + 延遲上傳
                syncLock = false;
                await safeReplyMessage(ev.replyToken, [{ type: "text", text: `已刪除記憶：「${item}」` }]);
              } else {
                await safeReplyMessage(ev.replyToken, [{ type: "text", text: `找不到記憶：「${item}」` }]);
              }
              continue;
            }

            await checkAndSaveMemory(userText);
            const replyMessages = await genReply(userText, "chat");
            await safeReplyMessage(ev.replyToken, replyMessages, userText);

          } else if (ev.message.type === "image") {
            await handleImageMessage(ev);
          }
        }
      }
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ /webhook 錯誤：", err?.message || err);
    res.status(200).send("OK");
  }
});

app.get('/test/push', async (req, res) => {
  try {
    const msg = await genReply('咻咻，來一則測試推播', 'chat');
    await pushToOwner([{ type: 'text', text: "📢 測試推播" }, ...msg]);
    res.send("✅ 測試訊息已送出");
  } catch (err) {
    res.status(500).send("❌ 推播失敗：" + (err?.message || err));
  }
});

app.get('/healthz', (req, res) => res.send('ok'));

// -------------------- Daytime Push Plan --------------------
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
function choice(arr){ return arr[Math.floor(Math.random() * arr.length)] }
function nowInTZ(tz="Asia/Taipei"){ return new Date(new Date().toLocaleString("en-US", { timeZone: tz })); }
function hhmm(d){ return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
let sentMarks = new Set();
let randomPlan = { date: "", times: [] };
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
  const today = now.toISOString().slice(0,10);
  if (randomPlan.date !== today){
    randomPlan.date = today;
    randomPlan.times = generateRandomTimes();
    sentMarks = new Set();
    console.log("🗓️ 今日白天隨機推播計畫：", randomPlan.times.join(", "));
  }
}
async function fixedPush(type){
  const text = choice(fixedMessages[type] || []);
  if (!text) return;
  try { await pushToOwner([{ type: "text", text }]); } catch {}
}
setInterval(async () => {
  try {
    const now = nowInTZ("Asia/Taipei");
    ensureTodayPlan(now);
    const t = hhmm(now);
    if (t === "07:00" && !sentMarks.has("morning:"+randomPlan.date)){
      await fixedPush("morning");
      sentMarks.add("morning:"+randomPlan.date);
    }
    if (t === "23:00" && !sentMarks.has("night:"+randomPlan.date)){
      await fixedPush("night");
      sentMarks.add("night:"+randomPlan.date);
    }
    if (t >= "07:00" && t <= "22:59"){
      for (const rt of randomPlan.times){
        const key = "rand:"+rt+":"+randomPlan.date;
        if (t === rt && !sentMarks.has(key)){
          const msgs = await genReply("咻咻，給大叔一則白天的撒嬌互動", "chat");
          try{ await pushToOwner(msgs); } catch {}
          sentMarks.add(key);
        }
      }
    }
  } catch (e) {
    console.error("❌ 推播計畫出錯：", e?.message || e);
  }
}, 15000);

// -------------------- Server start --------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});
