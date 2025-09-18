# 咻咻 LINE Bot 部署教學

## 步驟
1. 把檔案放進 GitHub Repo
2. 到 Railway 新建專案 → 連 GitHub Repo
3. 在 Railway → Variables 填入：
   - CHANNEL_SECRET
   - CHANNEL_ACCESS_TOKEN
   - OWNER_USER_ID
   - OPENAI_API_KEY
   - CRON_TOKEN
   - TZ=Asia/Taipei
4. 部署完成後 → 得到 URL
5. LINE Developers → Webhook URL 填入 `https://你的網址/webhook`
6. Railway → Cron 設定：
   - 08:30 → /cron/morning
   - 23:00 → /cron/night
   - 白天 10~18 每小時一次 → /cron/random

這樣咻咻就會每天早安、晚安、白天隨機找你撒嬌！