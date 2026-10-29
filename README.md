# Re:Bukanostory 網站（GitHub Pages + Cloudflare 後台）

這個資料夾包含兩個部分：

| 部分 | 放在哪 | 做什麼 |
|---|---|---|
| 公開網站（根目錄） | GitHub Pages | 讀者看到的回憶錄，含無障礙功能 |
| `worker/` | Cloudflare Workers | 編輯後台：直接編輯、新增頁面、發布、傳圖片。只有名單內的人能進入 |

**編輯者名單**：`rjian@st-laurentacademy.com`、`bremen2006@gmail.com`
（要新增或移除人，見最後面「換編輯者」。）

## 運作方式（一張圖看懂）

```
編輯者 → Cloudflare Access（用 email 驗證碼登入）→ Worker 後台
                                                    │ 用 GitHub Token 寫入
                                                    ▼
                          GitHub 儲存庫（content/*.json）→ GitHub Pages 自動更新 → 讀者
```

編輯者**不需要有 GitHub 帳號**，登入後台就能編輯；寫入 GitHub 的動作由 Worker 代勞。

---

## 部署步驟（第一次，約 30–40 分鐘）

> 會用到：GitHub 帳號、Cloudflare 帳號（免費方案即可）、已安裝 [Node.js](https://nodejs.org)（LTS 版）。
> 以下指令請在 Windows 的「終端機」（開始選單搜尋 *終端機* 或 *PowerShell*）輸入。
> Cloudflare 的網頁選單偶爾改名，若找不到，用關鍵字（如 *Access*）搜尋即可。

### 步驟 1：建立 GitHub 儲存庫並上傳

1. 到 GitHub 按右上角「＋」→「New repository」，名稱填 `rebukanostory`，選 **Public**（GitHub Pages 免費版需要公開），按「Create repository」。
2. 在本資料夾開啟終端機，依序輸入（把 `你的帳號` 換成你的 GitHub 帳號）：
   ```
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin https://github.com/你的帳號/rebukanostory.git
   git push -u origin main
   ```
3. 到儲存庫的 **Settings → Pages**，Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
4. 等 1–2 分鐘，網站就會出現在 `https://你的帳號.github.io/rebukanostory/`。

> ⚠️ **儲存庫是公開的，草稿頁的檔案也看得到**（只是網站目錄不顯示）。不要把真正敏感、不能公開的內容放進草稿。

### 步驟 2：建立 GitHub Token（讓後台能寫入儲存庫）

1. GitHub 右上角頭像 → **Settings** → 最下面 **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
2. Token name 填 `rebukanostory-admin`；Expiration 選你能接受的期限（到期要重做，見「常見問題」）。
3. **Repository access** 選 **Only select repositories**，只勾 `rebukanostory`。
4. **Permissions → Repository permissions → Contents** 設為 **Read and write**（其他都不用開）。
5. 按 **Generate token**，**馬上複製**（只會顯示一次），先貼到記事本備用。

### 步驟 3：設定並部署 Worker

1. 開啟 `worker/wrangler.toml`，改這四個地方：
   - `GH_REPO`：`你的GitHub帳號/rebukanostory`
   - `SITE_URL`：你的 GitHub Pages 網址（結尾要有 `/`）
   - `ACCESS_TEAM_DOMAIN`：先留著，步驟 4 再回來填
   - `EDITORS`：已填好兩位編輯者
2. 在 `worker` 資料夾開啟終端機：
   ```
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   `login` 會開瀏覽器請你授權 Cloudflare。成功後會顯示網址，像 `https://rebukanostory-admin.xxxx.workers.dev`，**把它記下來**。
3. 設定 GitHub Token（貼上步驟 2 複製的內容）：
   ```
   npx wrangler secret put GH_TOKEN
   ```

### 步驟 4：用 Cloudflare Access 鎖住後台（最重要）

1. 登入 Cloudflare 後台 → **Workers & Pages** → 點 `rebukanostory-admin` → **Access** 分頁 → **Protect this Worker behind Access**（若找不到，可用 **Zero Trust → Access controls → Applications → Add an application → Self-hosted** 手動新增，網域填你的 workers.dev 網址）。
2. 範圍選 **All traffic**，Policy 先隨便選一個，完成建立。
3. 設定「只有這兩個 email」：**Zero Trust → Access controls → Policies**（或進入該 Application 編輯 Policy）：
   - Action：**Allow**
   - Include → Selector 選 **Emails**，加入：
     - `rjian@st-laurentacademy.com`
     - `bremen2006@gmail.com`
   - 登入方式用 **One-time PIN**（輸入 email 後，系統寄 6 位數驗證碼到信箱，不需要密碼，Gmail 與學校信箱都可）。
4. 取得兩個值：
   - **Team domain**：長得像 `你的team名稱.cloudflareaccess.com`（Zero Trust 左下角 **Settings** 可看到 team name）。填回 `wrangler.toml` 的 `ACCESS_TEAM_DOMAIN`（不含 `https://`）。
   - **AUD tag**：**Zero Trust → Access controls → Applications → 你的應用程式 → Configure → Additional settings → Application Audience (AUD) Tag**，複製後執行：
     ```
     npx wrangler secret put ACCESS_AUD
     ```
5. 重新部署一次讓 `ACCESS_TEAM_DOMAIN` 生效：`npx wrangler deploy`

### 步驟 5：把後台網址告訴公開網站

開啟根目錄的 `config.js`，把 `adminUrl` 改成你的 Worker 網址，然後：
```
git add .
git commit -m "set admin url"
git push
```
公開網站頁尾的「編輯者登入」就會連到後台。

### 步驟 6：測試

1. 打開 Worker 網址，應該先跳出 Cloudflare 的 email 登入畫面。
2. 用 `rjian@st-laurentacademy.com` 收驗證碼登入，進到編輯後台。
3. 用其他 email 試登入，應該收不到驗證碼或被拒絕（這代表鎖住了）。
4. 開 `Ch 1` 隨便加一個字 → 「儲存修改」→ 約 1–2 分鐘後重新整理公開網站，應該看到更新。

---

## 日常使用

- **直接編輯**：左邊選頁面，右邊就是版面，點段落直接打字。`Enter` 新增下一段；`Ctrl + S` 儲存。
  選取段落後，下方出現工具列：改成大標題／小標題／註解／詩歌、上下移動、插入圖片、刪除。
- **新增頁面**：左上角「＋ 新增頁面」→ 填標題與網址代號（例：`ch-16`）→ 先以**草稿**儲存 → 寫完按「**發布**」。
- **圖片**：「＋圖片」會自動上傳並縮小；**請填「圖片說明」**（看不到圖片的讀者靠它理解），沒填會提醒。
- **調整順序**：左邊清單的 ↑ ↓。
- **發布 / 取消發布**：取消發布的頁面讀者看不到，內容仍保留。
- 每次儲存都是 GitHub 的一筆紀錄，改壞了可以在 GitHub 的 **History** 找回舊版。

## 內容搬遷狀態

Ch 1 – Final 共 16 章已全部從原 Wix 網站搬入並發布（每章字數都與原頁面核對過）。
搬遷時做了這些調整：修正明顯錯字與標點、移除 Wix 為排版加的全形空白與雙空格、把 Ch 5 的兒歌做成詩歌區塊。
Wix 上的字體、顏色、字級等樣式不會保留，統一使用新網站的版面。每個頁面 JSON 內的 `source` 欄位記錄了原 Wix 網址，方便對照。

## 換編輯者

名單在兩個地方，**兩處都要改**：
1. Cloudflare Access 的 Policy（誰能登入）。
2. `worker/wrangler.toml` 的 `EDITORS`（Worker 再檢查一次），改完執行 `npx wrangler deploy`。

## 無障礙功能清單

公開網站右上角「無障礙設定」：
- 文字大小（80%–200%）、行距三段、縮窄欄寬、明體／黑體
- 色彩主題：跟隨系統、淺色、深色、高對比（黑底黃字）
- 連結一律底線、減少動態效果
- **朗讀本頁**（瀏覽器內建中文語音，可暫停／停止／調速，朗讀中的段落會標示）
- 設定會記在瀏覽器，下次回來仍有效

網站結構本身：
- 語言標示 `zh-Hant`；「跳到主要內容」連結；標題層級正確
- 完整鍵盤操作；清楚的焦點框；所有按鈕與連結至少 44×44 像素
- 切換章節時，焦點移到內容並由螢幕閱讀器播報「已切換到：○○」
- 章節目錄可搜尋；上一章／下一章連結；顯示預估閱讀時間
- 尊重系統的「減少動態效果」「深色模式」設定；列印版面乾淨
- 圖片必須有替代文字（編輯後台會提醒）
- 已用 axe-core（WCAG 2.1 AA）掃描淺色／深色／高對比三種主題，未發現違規

## 常見問題

**後台顯示「你沒有編輯權限」**：Access 的 Policy 或 `EDITORS` 少了該 email，或 `ACCESS_AUD`／`ACCESS_TEAM_DOMAIN` 設錯。

**儲存失敗：GitHub 401/403**：GitHub Token 過期或權限不是 Contents 的 Read and write。重做步驟 2，再執行 `npx wrangler secret put GH_TOKEN`。

**儲存後公開網站沒變**：GitHub Pages 要 1–2 分鐘；可到儲存庫的 **Actions** 分頁看 `pages build and deployment` 是否完成。

**兩個人同時編輯同一頁**：後者儲存時會被擋下並提示「剛剛被別人修改過」，請重新載入再改，避免互相覆蓋。

**本機測試後端**：`cd worker && npm test`（33 項自動測試，不需要網路與帳號）。

## 已知限制

- 網站用 `#/章節` 的單頁式網址。搜尋引擎對這種網址的收錄較弱；若之後想讓 Google 找得到每一章，可改成每章產生獨立靜態網頁（需要加一個建置步驟，可再請我加）。
- 圖片上限約 4.5 MB（超過 3 MB 會自動縮小）。
- 不支援粗體／斜體／超連結等行內格式（刻意的：內容只存純文字，才能保證不會被塞入惡意程式碼）。
