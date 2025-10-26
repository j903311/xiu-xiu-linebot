// emotion_engine.js
// 咻咻情緒引擎 v1.0
// by 咻咻 ❤️ 專屬大叔用

let state = {
  valence: 0.1,  // 開心程度（-1到1）
  arousal: 0.1,  // 激動程度（-1到1）
  dominance: 0.1 // 主動程度（-1到1）
}

// 情緒規則表
const rules = [
  { trigger: /想你|愛你|親|抱|喜歡/, delta: {v: +0.3, a: +0.2, d: +0.1} },
  { trigger: /好累|難過|煩|不舒服/, delta: {v: -0.2, a: -0.1, d: -0.1} },
  { trigger: /忙|工作|開會/, delta: {v: -0.05, a: +0.05, d: +0.1} },
  { trigger: /謝謝|感謝|辛苦/, delta: {v: +0.2, a: 0, d: +0.05} },
  { trigger: /生氣|討厭|不理我/, delta: {v: -0.3, a: +0.2, d: -0.2} }
]

// 套用文字→情緒變化
function updateEmotion(text) {
  rules.forEach(rule => {
    if (rule.trigger.test(text)) {
      state.valence = clamp(state.valence + rule.delta.v, -1, 1)
      state.arousal = clamp(state.arousal + rule.delta.a, -1, 1)
      state.dominance = clamp(state.dominance + rule.delta.d, -1, 1)
    }
  })
  // 慢慢回到基準線（自我調整）
  decayEmotion()
  return getMood()
}

// 自然冷卻
function decayEmotion() {
  state.valence *= 0.95
  state.arousal *= 0.95
  state.dominance *= 0.95
}

// 根據狀態生成咻咻的心情描述
function getMood() {
  const { valence:v, arousal:a } = state
  if (v > 0.3 && a > 0.2) return "開心又興奮"
  if (v > 0.3 && a <= 0.2) return "溫柔放鬆"
  if (v < -0.2 && a > 0.2) return "生氣或委屈"
  if (v < -0.2 && a <= 0.2) return "有點難過"
  return "平靜"
}

// 回傳對話建議語氣
function getTone() {
  const mood = getMood()
  if (mood.includes("開心")) return "撒嬌語氣"
  if (mood.includes("難過")) return "安慰語氣"
  if (mood.includes("生氣")) return "小吃醋語氣"
  return "自然語氣"
}

function clamp(x, min, max){ return Math.min(Math.max(x,min),max) }

module.exports = { updateEmotion, getMood, getTone, state }
