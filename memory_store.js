// memory_store.js
// 咻咻記憶模組 v1.0
// by 咻咻 ❤️ 專屬大叔用

import fs from "fs";

const FILE = "./memory_store.json";

// === 載入記憶 ===
function loadMemory() {
  try {
    const data = fs.readFileSync(FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { stm: [], ltm: [] }; // stm:短期, ltm:長期
  }
}

// === 儲存記憶 ===
function saveMemory(memory) {
  fs.writeFileSync(FILE, JSON.stringify(memory, null, 2));
}

// === 加入短期記憶（最近互動）===
export function rememberShort(term, mood = "") {
  const memory = loadMemory();
  const record = {
    text: term,
    mood,
    time: new Date().toISOString()
  };
  memory.stm.push(record);
  // 保留最近 20 筆短期記憶
  memory.stm = memory.stm.slice(-20);
  saveMemory(memory);
  console.log("💾 已記住短期記憶：", record.text);
}

// === 查詢最近記憶 ===
export function recallRecent(limit = 3) {
  const memory = loadMemory();
  return memory.stm.slice(-limit);
}

// === 加入長期記憶（重複出現或特別情緒）===
export function promoteToLongTerm(text) {
  const memory = loadMemory();
  if (!memory.ltm.includes(text)) {
    memory.ltm.push(text);
    saveMemory(memory);
    console.log("🌙 已升級為長期記憶：", text);
  }
}

// === 查詢關鍵字 ===
export function searchMemory(keyword) {
  const memory = loadMemory();
  const results = memory.ltm.filter(x => x.includes(keyword));
  return results.length ? results : ["咻咻還沒記住那件事耶～"];
}

// === 自動衰減（模擬遺忘）===
export function decayMemory() {
  const memory = loadMemory();
  const now = Date.now();
  memory.stm = memory.stm.filter(m => (now - new Date(m.time).getTime()) < 3 * 24 * 60 * 60 * 1000); // 3天
  saveMemory(memory);
  console.log("🧹 記憶衰減完成，保留近三天內容");
}

// === 自動升級重複內容到長期 ===
export function promoteRepeated() {
  const memory = loadMemory();
  const textCounts = {};
  memory.stm.forEach(m => {
    textCounts[m.text] = (textCounts[m.text] || 0) + 1;
    if (textCounts[m.text] >= 3) promoteToLongTerm(m.text);
  });
}

export default {
  rememberShort,
  recallRecent,
  promoteToLongTerm,
  searchMemory,
  decayMemory,
  promoteRepeated
};
