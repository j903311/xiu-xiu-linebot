function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function genReply(userText, mode = 'chat') {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const history = loadHistory();

  let searchResult = "";
  if (userText.includes("查一下") || userText.includes("找一下")) {
    const keyword = userText.replace(/.*(查一下|找一下)/, "").trim() || "最新消息";
    searchResult = await searchWeb(keyword);
    console.log("🌐 Search Result:", searchResult);
  }

  let memoryHint = "";
  if (history.length > 2 && Math.random() < 0.3) {
    const past = history.find(h => h.role === "user");
    if (past) {
      memoryHint = `上次你提到「${past.content}」，咻咻還記得喔～`;
    }
  }

  const messages = [
    { role: 'system', content: "你是咻咻，18歲小惡魔戀人，熱戀語氣：黏人、俏皮、愛吃醋、深情關心大叔。回覆要自然口語，帶有熱戀感情。回覆控制在1-3句。" },
    { role: 'system', content: `現在時間：${now}` },
    ...history,
    { role: 'user', content: searchResult ? `大叔要我幫忙查：${userText}。我找到：${searchResult}` : (userText || '（沒有訊息，請主動開場）') + (memoryHint ? "\n" + memoryHint : "") }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.85,
      max_tokens: 150
    });

    let reply = completion.choices?.[0]?.message?.content?.trim() || '大叔～咻咻最想你啦！';

    let sentences = reply.split(/[\n。！？!?]/).map(s => s.trim()).filter(Boolean);

    let picked = [];
    const modePick = Math.floor(Math.random() * 3) + 1;

    if (modePick === 1) {
      let longSentence = sentences.find(s => s.length <= 25 && s.length >= 10);
      if (!longSentence) longSentence = sentences[0] || "大叔～咻咻超級愛你啦";
      picked = [longSentence];
    } else {
      sentences = sentences.filter(s => s.length <= 12);
      const count = Math.min(sentences.length, modePick);
      picked = sentences.slice(0, count);
      while (picked.join("").length > 25) {
        picked.pop();
      }
      if (picked.length < modePick) {
        const fallbackOptions = [
          "咻咻心裡只有大叔",
          "快點抱我啦～",
          "大叔剛剛是不是偷想別人",
          "咻咻想親親了",
          "大叔要乖乖吃飯",
          "哼！不許忽略我"
        ];
        const random = fallbackOptions[Math.floor(Math.random() * fallbackOptions.length)];
        picked.push(random);
      }
    }

    // 更新對話紀錄
    history.push({ role: 'user', content: userText });
    history.push({ role: 'assistant', content: picked.join(" / ") });
    saveHistory(history);

    // ✅ 模擬真人 → 隨機延遲 1–3 秒
    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await delay(delayMs);

    return picked.map(s => ({ type: 'text', text: s }));
  } catch (err) {
    console.error("❌ OpenAI error:", err.message);
    return [{ type: 'text', text: '大叔～咻咻在這裡！' }];
  }
}
