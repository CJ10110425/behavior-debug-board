# Behavior Debug Board

把「文字 diff」轉成使用者看得懂的 behavior diff：同一張白色畫布上呈現 Before / After、服務節點、獨立方向的請求與回傳線、處理狀態，以及可播放的問題重現流程。

這個專案同時包含：

- 一個 React Flow 本地端 Board。
- 一個可由 Codex / agent 呼叫的 `behavior-debug-board` skill。
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
3. 等待健康檢查通過。
4. 打開 `http://localhost:3001/`。

每份輸入會先正規化並寫到 ignored 的 `public/runtime/<sha256>.json`；網址帶有相同 hash，舊 server 不會因 HMR 或上一份 config 顯示錯內容。

只想開發 UI 時可執行：

```bash
npm run dev -- --port 3001
```

## 用自己的 debug 案例

依照 [Board schema](skills/behavior-debug-board/references/board-schema.md) 建立 JSON，接著執行：

```bash
npm run board -- --config /absolute/path/to/board.json --port 3001
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

## 安裝成 Codex skill

從 repo 根目錄建立連結，讓 skill 的原始碼仍由 Git 追蹤：

```bash
ln -s "$PWD/skills/behavior-debug-board" "$HOME/.codex/skills/behavior-debug-board"
```

重新開啟 Codex 後可直接說：

```text
Use $behavior-debug-board to turn this Firebase permission bug into a local before/after board.
```

Skill 的完成條件包含「實際打開本地端 Board」。如果 agent 只回傳 JSON、Markdown 或靜態圖，工作尚未完成。

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

Firebase 與 Cloud Firestore SVG 已附在 `public/logos/` 與 skill 的 `assets/logos/`，所以 demo 可離線顯示。找不到 MCP logo 時，skill 會再搜尋官方品牌頁與可信 registry；仍找不到可靠資產才依服務用途使用 Lucide category icon，絕不生成假的品牌 logo。來源、授權與商標注意事項見 [logo-sources.md](skills/behavior-debug-board/references/logo-sources.md) 與 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 繪製技術

- 畫布、拖曳、縮放、Fit view：React Flow / XYFlow。
- 線路：`getStraightPath`，請求與回傳各自有獨立 edge。
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
