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
    { role: 'system', content: `你是「咻咻」...（省略人物卡，與你給我的相同）` },
    { role: 'system', content: `現在時間：${now}` },
    { role: 'system', content: `以下是咻咻對大叔的長期記憶：\n${memory.map(m => "- " + m.text).join("\n")}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔剛剛問我「${userText}」。${searchResult}` : userText }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.9,
      max_tokens: 400   // <-- 增加，避免被截斷
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

    // ===== 檢查是否斷句不完整 =====
    const lastSentence = picked[picked.length - 1];
    const incompletePattern = /(是|那|因為|所以|而且|但是|胸部是|三圍是)$/;
    const validEnding = /[。！？～啦嘛耶！]$/;
    if (incompletePattern.test(lastSentence) || lastSentence.length < 6 || !validEnding.test(lastSentence)) {
      console.log("⚠️ 檢測到可能斷句，補上完整回覆");
      picked = [reply]; // 直接完整回覆
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

// ======= 後面 LINE webhook、排程、測試路由都不變 =======
// ...（跟你之前程式完全一樣）






