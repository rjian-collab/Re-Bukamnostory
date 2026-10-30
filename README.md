# Bukam's story 網站（GitHub Pages + Cloudflare 後台）

這個資料夾包含兩個部分：

| 部分 | 放在哪 | 做什麼 |
|---|---|---|
| 公開網站（根目錄） | GitHub Pages | 讀者看到的回憶錄，含無障礙功能 |
| `worker/` | Cloudflare Workers | 編輯後台：直接編輯、新增頁面、發布、傳圖片。只有名單內的 Google 帳號能進入 |

**編輯者名單**：`rjian@st-laurentacademy.com`、`bremen2006@gmail.com`
（要新增或移除人，見「換編輯者」。）

## 運作方式

```
編輯者 → 開後台網址 → 用 Google 帳號登入 → Worker 檢查 Email 是否在名單內
                                              │ 通過才發 12 小時登入 Cookie，之後用 GitHub Token 寫入
                                              ▼
                    GitHub 儲存庫（content/*.json）→ GitHub Pages 自動更新 → 讀者
```

- **Email 驗證**：用 Google 登入，Google 保證這個 Email 是本人的；Worker 在伺服器上驗證簽章，再比對編輯者名單。名單內是 `rjian@st-laurentacademy.com`、`bremen2006@gmail.com`。
- 編輯者**不需要有 GitHub 帳號**，寫入 GitHub 的動作由 Worker 代勞。
- 不需要 Cloudflare Zero Trust，也不需要信用卡。

---

## 部署（在網頁上完成，不用裝任何程式）

### 1. 把專案放到 GitHub 並開啟 Pages
已完成：儲存庫 `rjian-collab/Re-Bukamnostory`，網站在 `https://rjian-collab.github.io/Re-Bukamnostory/`。
（Settings → Pages → Deploy from a branch → `main` / `/ (root)`）

### 2. 用 GitHub 自動部署 Worker
Cloudflare → Workers & Pages → Create → 匯入 `Re-Bukamnostory`：專案名稱 `rebukanostory-admin`、
Advanced settings 的 Path 填 `worker`、Deploy command 為 `npx wrangler deploy`。
之後只要改了 `worker/` 內的檔案並推上 GitHub，Cloudflare 會自動重新部署。

### 3. 允許 Google 登入用的網址
Google Cloud Console → 你的專案 → Google Auth Platform → **用戶端（Clients）** → 點 `Volcablearn web`：
在「已授權的 JavaScript 來源」按「新增 URI」，加入 `https://rebukanostory-admin.rjian.workers.dev`
（不要加結尾斜線），按「儲存」。

### 4. 設定 GitHub Token（唯一的機密值）
1. GitHub → 右上角頭像 → Settings → 最下面 Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。
2. 名稱 `rebukanostory-admin`；Repository access 選 Only select repositories → 只選 `Re-Bukamnostory`；
   Permissions → Repository permissions → **Contents** 設為 **Read and write**；Generate token 後立刻複製。
3. Cloudflare → Workers & Pages → `rebukanostory-admin` → Settings → Variables and Secrets → Add：
   Type 選 **Secret**，Variable name 填 `GH_TOKEN`，Value 貼上 Token，按 Deploy。

### 5. 測試
開 `https://rebukanostory-admin.rjian.workers.dev`，按「使用 Google 帳號登入」。
用名單內的帳號應該能進入；用其他 Google 帳號會看到「不在編輯者名單內」。

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

編輯者名單只在一個地方：`worker/wrangler.toml` 的 `EDITORS`（用逗號分隔）。改完推上 GitHub，Cloudflare 會自動部署，新名單立即生效。
被移除的人最多還能用手上的登入 Cookie 到 12 小時內過期；要立刻踢掉，到 Cloudflare 重設 `GH_TOKEN`（換新 Token）即可讓所有人登出。

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

**登入時顯示「不在編輯者名單內」**：該 Email 不在 `EDITORS`，或登入的不是你以為的那個 Google 帳號。

**Google 登入按鈕出現「Error 400: origin_mismatch」**：步驟 3 的「已授權的 JavaScript 來源」還沒加 `https://rebukanostory-admin.rjian.workers.dev`，或加完還沒生效（等幾分鐘）。

**學校信箱無法用 Google 登入**：學校的 Google 管理員可能封鎖了第三方登入。可請管理員放行，或改用另一個個人 Gmail 加進 `EDITORS`。

**儲存失敗：GitHub 401/403**：GitHub Token 過期或權限不是 Contents 的 Read and write。重做步驟 4。

**儲存後公開網站沒變**：GitHub Pages 要 1–2 分鐘；可到儲存庫的 Actions 分頁看 `pages build and deployment` 是否完成。

**兩個人同時編輯同一頁**：後者儲存時會被擋下並提示「剛剛被別人修改過」，請重新載入再改，避免互相覆蓋。

**本機測試後端**：`cd worker && npm install && npm test`（44 項自動測試，不需要網路與帳號）。

## 已知限制

- 網站用 `#/章節` 的單頁式網址。搜尋引擎對這種網址的收錄較弱；若之後想讓 Google 找得到每一章，可改成每章產生獨立靜態網頁（需要加一個建置步驟，可再請我加）。
- 圖片上限約 4.5 MB（超過 3 MB 會自動縮小）。
- 不支援粗體／斜體／超連結等行內格式（刻意的：內容只存純文字，才能保證不會被塞入惡意程式碼）。
