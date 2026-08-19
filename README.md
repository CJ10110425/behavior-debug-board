# Difftale

把「文字 diff」轉成使用者看得懂的 visual behavior diff：同一張白色畫布上呈現 Before / After、App／Web／Mobile 畫面截圖、服務節點、獨立方向線、處理狀態，以及可播放的使用者流程。

這個專案同時包含：

- 一個 React Flow 本地端 Board。
- 一個可由 Codex / agent 呼叫的 `difftale` skill。
- 一份 Firebase Rules 權限錯誤的可播放範例。
- Logo MCP 的解析規則與離線 SVG fallback。

## 先看結果

需求：Node.js `>=22.13.0`。

```bash
npm install
npm run board
```

`npm run board` 不只會產生資料，它會：

1. 驗證 Board JSON。
2. 啟動本地伺服器。
3. 啟動只接受 localhost 與 session token 的本地 Save Bridge。
4. 等待健康檢查通過。
5. 打開 `http://localhost:3001/`。

每份輸入會先正規化並寫到 ignored 的 `public/runtime/<sha256>.json`；網址帶有相同 hash，舊 server 不會因 HMR 或上一份 config 顯示錯內容。

畫布上的 Card 文字、位置、Before／After 標籤、播放 Card 位置、便條、形狀與自訂連線會在停止操作約一秒後自動保存，也可用右上角「儲存」或 `Cmd/Ctrl+S` 立即原子寫回來源 `board.json`。若檔案已被另一個 agent 修改，Save Bridge 會拒絕覆蓋並要求重新載入。

Save Bridge 不依賴 launcher／Codex task 持續存活；只要 Board 分頁仍透過完整 `BOARD_URL` 發送 heartbeat，它就會維持連線，閒置後才自動退出。完整網址必須保留 `config`、`save`、`saveToken`。如果網址被截短或 Bridge 離線，畫布會顯示阻擋提示並停止安全編輯，不會讓變更默默只留在 React 記憶體。

右上角「版本」會打開獨立版本側欄。Board 版本和圖內的 Before／After 不同：Before／After 說明系統修正前後的行為；版本紀錄保存這張解釋圖本身的演進。版本比較會把差異整理成「新增、移除、修改、移動」，不顯示難讀的 JSON line diff。

只想開發 UI 時可執行：

```bash
npm run dev -- --port 3001
```

## 用自己的畫面與 flow

所有 Board 都應先存成本機 bundle。要和程式一起版控時，建議放在：

```text
.difftale/boards/<slug>/
├── board.json
└── assets/
    ├── <brand>.svg
    └── screens/
        └── <state>-<hash>.png
```

只存本機、不使用 Git 時，使用 `~/.difftale/projects/<project-id>/boards/<slug>/`。Git 選項只代表本機 branch／commit；除非使用者另外要求，skill 不會 push 或建立 PR。舊的 `.behavior-debug-board` bundle 仍可讀取。

公開的 Difftale skill、fixtures、tests 和文件只使用通用角色與虛構範例，不收錄使用者的產品／公司／repository 名稱、原始碼檔名或路徑、raw code/log、私人 URL、identifier 或截圖。Agent 可以在本機讀取這些證據來理解問題，但預設只把角色、邏輯與使用者可見變化寫進個別 Board bundle；第三方服務品牌與經確認的 logo 不受此限制。

Board schema version 3 可把本地 PNG／JPEG／WebP 畫面當成正式 `screen` node，與其他畫面、API、資料庫或權限服務連線。截圖不是 service card 的附件；它本身就是可播放流程的一部分。

Screen frame 不靠猜測：先讀使用者描述與專案的 Layout／平台程式碼，再看實際擷取 viewport 和圖片長寬；高解析直式、平板比例、裁切或 full-page 畫面無法確定時必須詢問使用者。手機畫面採 Figma-like device frame，只保留短標題與一句可編輯說明；桌面網頁與原生桌面 App 分別使用 browser／app frame。

依照 [Board schema](skills/difftale/references/board-schema.md) 建立 JSON，接著執行：

```bash
npm run board -- --config /absolute/path/to/board.json --port 3001
```

選擇 Git 或本機版本儲存模式：

```bash
npm run board -- \
  --config /absolute/path/to/board.json \
  --storage git \
  --port 3001
```

產生給 app 使用、但暫時不開啟 Board：

```bash
npm run board:prepare -- --config /absolute/path/to/board.json
```

一鍵完成 render readiness、數量核對、After 最終狀態與截圖：

```bash
npm run board:qa -- \
  --config /absolute/path/to/board.json \
  --port auto \
  --flow after \
  --final-step \
  --screenshot /absolute/path/to/result.jpg
```

修改 renderer 時再加 `--full`，驗證重播、loading、拖曳、縮放與 Fit view。一般產生 board 使用 fast QA，保留正常播放速度給使用者；QA 只在測試頁面內加速。

## 版本、比較與還原

Auto-save 只更新目前的 `board.json`，不會每次拖拉都製造版本。版本必須由使用者在側欄明確建立，或透過 CLI 建立：

```bash
npm run board:version -- create \
  --config /absolute/path/to/board.json \
  --storage local \
  --title "Firebase Rules 修正完成"
```

列出版本並與目前 Board 比較：

```bash
npm run board:version -- list --config /absolute/path/to/board.json --storage local
npm run board:version -- diff --config /absolute/path/to/board.json --storage local --revision local:<revision-id>
```

還原會先檢查來源 hash；本機模式還會自動建立「還原前自動備份」：

```bash
npm run board:version -- restore --config /absolute/path/to/board.json --storage local --revision local:<revision-id>
```

Git 模式的命名版本是正常的本機 commit，而且只會包含 `.difftale/boards/<slug>/`。其他 staged／unstaged 檔案會保留；Push 和 PR 仍需要另一個明確指令。本機版本會一起保存 `board.json` 與引用的畫面／logo 資產。

## 安裝成 Codex skill

從 repo 根目錄建立連結，讓 skill 的原始碼仍由 Git 追蹤：

```bash
ln -s "$PWD/skills/difftale" "$HOME/.codex/skills/difftale"
```

重新開啟 Codex 後可直接說：

```text
Use $difftale to show what changed across these app screens and service flows in a local Before/After Board.
```

Skill 啟動後會先詢問「Git 版控」或「只存本機」，並在收到選擇前停止。兩種模式都會保留完整本地 bundle。完成條件包含實際打開本地端 Board；如果 agent 只回傳 JSON、Markdown 或靜態圖，工作尚未完成。

## Logo 來源

品牌 logo 優先透過無需 API key 的 [theSVG MCP server](https://www.npmjs.com/package/@thesvg/mcp-server) 解析：

```json
{
  "mcpServers": {
    "thesvg": {
      "command": "npx",
      "args": ["-y", "@thesvg/mcp-server"]
    }
  }
}
```

Firebase 與 Cloud Firestore SVG 已附在 `public/logos/` 與 skill 的 `assets/logos/`，所以 demo 可離線顯示。找不到 MCP logo 時，skill 會再搜尋官方品牌頁與可信 registry；仍找不到可靠資產才依服務用途使用 Lucide category icon，絕不生成假的品牌 logo。來源、授權與商標注意事項見 [logo-sources.md](skills/difftale/references/logo-sources.md) 與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 繪製技術

- 畫布、拖曳、縮放、Fit view：React Flow / XYFlow。
- 線路：線性流程使用 `getStraightPath`、分叉使用低曲率 `getBezierPath`；每個方向各自有獨立 edge。
- 資料封包動畫：原生 SVG `<animateMotion>`。
- Loading：服務卡片內 CSS spinner。
- 工具 icon：Lucide SVG。

這不是 `.tldr` 檔案產生器；它採用 tldraw-like 的白板視覺，但以 React Flow 支援可重播的行為與狀態。

## 品質檢查

```bash
npm run check
```

這會驗證 skill 結構、執行 unit / integration / routing / CLI 測試，最後完成 production build。真實瀏覽器 smoke test 使用 `npm run board:qa`；完整 renderer regression 使用同一命令加 `--full`。

## 開放貢獻

外部貢獻者不需要你的 repository 寫入權限：Fork repo → 建立 branch → push 到自己的 fork → 對本 repo 的 `main` 開 Pull Request。詳細步驟見 [CONTRIBUTING.md](CONTRIBUTING.md)。

Repo owner 建議在 GitHub 的 `Settings → Branches` 或 Rulesets 為 `main` 設定：

- Require a pull request before merging。
- GitHub CLI 取得 `workflow` scope 後，將 `.github/ci.template.yml` 移至 `.github/workflows/ci.yml`，再 Require status checks to pass 並選擇 `check`。
- Block force pushes。
- 視團隊規模要求至少一位 reviewer approval。

## License

程式碼使用 [MIT License](LICENSE)。Firebase、Cloud Firestore 等品牌標誌仍屬各商標權利人，MIT 不會重新授權這些標誌。
