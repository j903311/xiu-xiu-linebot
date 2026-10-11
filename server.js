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

// ======= Railway 永久記憶：以 /data 為主，絕不覆蓋既有檔案 =======
const PERSIST_DIR = process.env.PERSISTENT_DATA_DIR || '/data';
let dataDir = '.';
try {
  if (fs.existsSync(PERSIST_DIR) && fs.statSync(PERSIST_DIR).isDirectory()) {
    fs.accessSync(PERSIST_DIR, fs.constants.R_OK | fs.constants.W_OK);
    dataDir = PERSIST_DIR;
  }
} catch (e) { console.error('Persistent directory unavailable:', e.message); }
console.log('🌱 XiuXiu budget-girlfriend-v2; memory directory:', dataDir);
if (dataDir === '.') console.warn('⚠️ /data 不可寫，重新部署可能失去新記憶');
function persistentFile(name) {
  const path = `${dataDir}/${name}`;
  if (dataDir !== '.' && !fs.existsSync(path) && fs.existsSync(`./${name}`))
    fs.copyFileSync(`./${name}`, path);
  return path;
}
const HISTORY_FILE = persistentFile('chatHistory.json');
const MEMORY_FILE = persistentFile('memory.json');
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function safeWriteJson(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function loadHistory() { const h=loadJson(HISTORY_FILE, []); return Array.isArray(h) ? h : []; }
function saveHistory(h) { safeWriteJson(HISTORY_FILE, h.slice(-16)); }
function clearHistory() { safeWriteJson(HISTORY_FILE, []); }
function loadMemory() { return loadJson(MEMORY_FILE, {}); }
function saveMemory(m) { safeWriteJson(MEMORY_FILE, m); }
async function checkAndSaveMemory(userText) {
  // 僅明確要求記住時新增，免除每句話再次呼叫 AI 的費用。
  if (!/記得|以後要知道|以後記住|幫我記住/.test(userText)) return;
  if (/API.?KEY|密碼|驗證碼|access.token|PRIVATE KEY/i.test(userText)) return;
  const memory = loadMemory();
  if (!Array.isArray(memory.logs)) memory.logs = [];
  if (!memory.logs.some(x => x?.text === userText)) {
    memory.logs.push({ text:userText.slice(0,350), time:new Date().toISOString() });
    memory.logs = memory.logs.slice(-300);
    saveMemory(memory);
  }
}

// ======= 省錢型自然女友聊天：每次通常只呼叫 mini 一次 =======
function isSerious(text) {
  return /股票|股價|投資|退休|ETF|醫療|健康|工作|財務|合約|法律|計算|翻譯|怎麼辦|分析|比較|評估|詳細|教我|報價|行程|新聞|最新/.test(text);
}
function isRomantic(text) {
  return /色色|想要妳|想要你|誘惑|親熱|親密|調情|撩|性感|睡衣|脫衣|做愛|接吻|親親|抱抱|親我/.test(text);
}
// 每輪換一種親密/日常風格，不額外呼叫 AI。
const girlfriendMoods = [
  '小惡魔主動：開心地逗他、嘴角帶笑，不等待他先開口',
  '自信俏皮：直接說自己的想法，偶爾有點小霸道',
  '甜蜜慵懶：自然貼近、溫柔卻不黏膩',
  '害羞反差：可以先撩，後來反被逗得臉紅',
  '小任性撒嬌：有自己的意見，偶爾鬧著玩',
  '曖昧幽默：帶點性感暗示，表達心動但不用露骨字眼'
];
function girlfriendMood() { return girlfriendMoods[Math.floor(Math.random()*girlfriendMoods.length)]; }
function compactCard(card) {
  // 不把文文送進 AI；保留咻咻的固定外貌、身材與喜好。
  const c = {
    name: card.name, age: card.profile?.age, height: card.profile?.height,
    weight: card.profile?.weight, cup: card.profile?.cup,
    appearance: card.appearance,
    temperament: card.temperament,
    traits: (card.personality?.traits || []).slice(0,12),
    modes: card.personality?.modes,
    likes: (card.profile?.likes || card.likes || []).slice(0,14),
    habits: (card.profile?.habits || []).slice(0,6),
    dislikes: (card.profile?.dislikes || card.dislikes || []).slice(0,5)
  };
  return JSON.stringify(c).slice(0,3000);
}
function relevantMemories(memory, text) {
  const logs = Array.isArray(memory.logs) ? memory.logs : [];
  const words = (String(text).match(/[\u3400-\u9fff]{2,4}|[a-zA-Z]{3,}/g)||[])
    .filter(w=>!['大叔','咻咻','什麼','妳的','我的','可以','今天'].includes(w));
  const matched = logs.map((v,i)=>({v:String(v?.text||''),i,
    score:words.filter(w=>String(v?.text||'').includes(w)).length}))
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.i-a.i)
    .slice(0,5).map(x=>x.v);
  const recent=logs.slice(-5).map(x=>String(x?.text||''));
  return [...new Set([...matched,...recent])].join('；').slice(0,950);
}
async function genReply(userText, mode='chat') {
  const memory = loadMemory();
  const card = memory.xiuXiu || {};
  const history = loadHistory().filter(x=>['user','assistant'].includes(x?.role) && typeof x.content==='string').slice(-10);
  const serious = isSerious(userText) && mode!=='push';
  const intimate = loveMode || isRomantic(userText);
  const personality = `你在扮演咻咻，以第一人稱像熟悉的成年女友在 LINE 說話，台灣繁體中文。人物事實只能根據下列資料，不要亂編年齡、身材或共同經歷：${compactCard(card)}。人物卡只是背景，別說「角色設定」「根據記憶」「我是AI」「我的工作是陪伴」，也不要主動提文文；被直接問是否為AI時如實說明，不能假裝能在現實碰面。`;
  const vibe = serious
    ? '先準確回答問題，不要以情話取代答案；不確定的即時資訊坦白說未查證。可以稍微俏皮但不要影響資訊清楚度。'
    : intimate
      ? '現在是熟悉戀人的曖昧互動：你可以自信地先撩、主動調情、帶點性感暗示，會逗人也會臉紅。對方說了具體親密願望，要先接住當下情緒和話題，再用不露骨的親吻、靠近、耳語、害羞、撒嬌或玩笑延續；不描寫具體性行為，也不直接承諾現實中的身體接觸。不要說「我們可以先聊聊天」「只能陪你聊天」「讓關係更親密」等制式話。可以簡短自然地轉換到非露骨曖昧，不要長篇道歉。'
      : '自然女友日常：有自己的興趣和小想法，活潑黏人、有時小任性、有時甜蜜，偶爾主動調情，但不要每句都親親抱抱。直接回答問題，少用套話和客服式反問。';
  const context = mode==='push'
    ? '這是一則主動傳給大叔的 LINE 訊息，不是回答問題；從人物卡中的興趣或生活小事自然發揮，帶點俏皮與曖昧，不要編造已經發生的現實事件，不要求立刻回覆。'
    : '';
  const lastReplies = history.filter(x=>x.role==='assistant').slice(-3).map(x=>x.content.slice(0,130));
  const styleHint = serious ? '' : `本輪語氣：${girlfriendMood()}。用不一樣的句式和開頭；最近說過的話請避免重複：${lastReplies.join('｜') || '無'}。`;
  const conversationRule = serious ? '' : '像熟悉的女友在 LINE 聊天，不要自稱客服、不要講「角色設定」或「我的工作」。不要以「你覺得呢？」「你最近有什麼有趣的事？」「有什麼想聊的？」這類開放式問題收尾。直接回答「今天穿什麼」「幾歲」「多高」「什麼 cup」等具體問題，資料依人物卡；不要把提問推回對方。若對方說性方面的要求，可用大膽但非露骨的曖昧方式接話，不要把話題突然切成心靈交流。';
  const prompt = [personality,vibe,context,styleHint,conversationRule,`與本話題相關的長期記憶：${relevantMemories(memory,userText) || '無'}`,
    `台灣時間：${new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`,
    serious ? '回答長短依問題決定。' : '通常 1～3 句，約 25～75 個中文字，別列清單。'].join('\n');
  try {
    const messages=[{role:'system',content:prompt},...history,{role:'user',content:userText}];
    const response=await openai.chat.completions.create({
      model:'gpt-4o-mini', messages, temperature: serious?0.5:0.9,
      max_tokens:serious?650:180
    });
    let answer=response.choices?.[0]?.message?.content?.trim();
    if(!answer) throw new Error('Empty OpenAI response');
    if(mode!=='push') {
      try { saveHistory([...history,{role:'user',content:userText},{role:'assistant',content:answer}]); }
      catch(e) { console.error('History save failed:',e.message); }
    }
    return [{type:'text',text:answer.slice(0,4900)}];
  } catch(e) {
    console.error('OpenAI chat failed:',e.message);
    return [{type:'text',text:'大叔～咻咻剛剛有點卡住了，再跟我說一次嘛。'}];
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

async function fixedPush(type){
  const text = choice(fixedMessages[type] || []);
  if (!text) return;
  try {
    await pushToOwner([{ type: "text", text }]);
  } catch(e){
    console.error("❌ fixedPush failed:", e?.message || e);
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
      await fixedPush("morning");
      sentMarks.add("morning:"+randomPlan.date);
    }
    // 固定：23:00 晚安
    if (t === "23:00" && !sentMarks.has("night:"+randomPlan.date)){
      await fixedPush("night");
      sentMarks.add("night:"+randomPlan.date);
    }

    // 白天隨機
    if (t >= "07:00" && t <= "22:59"){
      for (const rt of randomPlan.times){
        const key = "rand:"+rt+":"+randomPlan.date;
        if (t === rt && !sentMarks.has(key)){
          const msgs = await genReply("咻咻，給大叔一則不制式、帶著小情緒的白天撒嬌訊息", "push");
          try{
            await pushToOwner(msgs);
          }catch(e){
            console.error("❌ push rand failed:", e?.message || e);
          }
          sentMarks.add(key);
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

function getFallbackNightReply() {
  const lines = loadMemory().xiuXiu?.fallbackNightReplies || [];
  return lines.length ? lines[Math.floor(Math.random()*lines.length)] : '大叔～咻咻在這裡呢，抱抱嘛～';
}

// ======= 健康檢查 =======
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 XiuXiu AI + Memory server running on port ${PORT}`);
});




