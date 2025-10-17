import fs from "fs";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const DRIVE_FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || "咻咻記憶同步";

async function testOAuthDrive() {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      console.error("❌ 缺少必要的 OAuth 環境變數，請確認 .env 設定。");
      return;
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    console.log("✅ OAuth 認證成功，正在檢查雲端資料夾…");

    const folderList = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
      fields: "files(id, name)",
    });

    let folderId;
    if (folderList.data.files.length > 0) {
      folderId = folderList.data.files[0].id;
      console.log(`📁 已找到資料夾：「${DRIVE_FOLDER_NAME}」`);
    } else {
      const folder = await drive.files.create({
        requestBody: { name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" },
        fields: "id",
      });
      folderId = folder.data.id;
      console.log(`📂 已建立新資料夾：「${DRIVE_FOLDER_NAME}」`);
    }

    const testFile = "oauth_test.txt";
    fs.writeFileSync(testFile, "這是咻咻的 OAuth 測試檔案\n");

    await drive.files.create({
      requestBody: { name: testFile, parents: [folderId] },
      media: { mimeType: "text/plain", body: fs.createReadStream(testFile) },
      fields: "id",
    });

    console.log("✅ 測試檔案已成功上傳到 Google Drive！");
    fs.unlinkSync(testFile);
    console.log("🎉 OAuth 驗證完全成功！");
  } catch (err) {
    console.error("❌ 測試失敗：", err.response?.data || err.message);
  }
}

testOAuthDrive();
