# 貢獻指南

謝謝你想讓 Behavior Debug Board 更好。這個專案歡迎新的 debug flow、服務 logo、互動改善、測試與文件修正。

## 外部貢獻流程

1. 在 GitHub 按 `Fork`，建立自己的 repo 副本。
2. Clone 你的 fork，並保留原 repo 為 `upstream`：

   ```bash
   git clone https://github.com/<your-name>/<repo>.git
   cd <repo>
   git remote add upstream https://github.com/<owner>/<repo>.git
   ```

3. 從最新 `main` 建立小而專注的 branch：

   ```bash
   git fetch upstream
   git switch -c feat/short-description upstream/main
   ```

4. 修改後執行完整檢查：

   ```bash
   npm install
   npm run check
   ```

5. Commit 並 push 到自己的 fork：

   ```bash
   git add <changed-files>
   git commit -m "feat: describe the behavior change"
   git push -u origin feat/short-description
   ```

6. 在 GitHub 建立 Pull Request：base 選原 repo 的 `main`，compare 選你的 fork branch。
7. 清楚填寫 behavior change、Before / After、測試結果與畫面證據；依 reviewer 意見繼續 push 即可更新同一張 PR。

GitHub 官方流程可參考 [Contributing to a project](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project?tool=cli) 與 [Creating a pull request from a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork)。

## Board 不可破壞的語意

- Before / After 必須位於同一張畫布。
- 一條 edge 只表示一個方向；請求與回傳不得共用同一條線。
- 播放前就要顯示所有線、箭頭與文字，動畫只負責強調目前步驟。
- 預設說明 behavior、原因與使用者結果，不展示 commit 或 code diff。
- 品牌 logo 保留官方顏色與比例，並附來源與使用說明。
- Skill 成功時必須啟動並打開 localhost Board。

## Logo 貢獻

優先依 [Logo MCP workflow](skills/behavior-debug-board/references/logo-mcp.md) 找 exact product logo；MCP 找不到時搜尋官方品牌頁與可信 registry，再存到 `public/logos/`。完全找不到可靠 logo 時，改用符合服務用途的 `categoryIcon`，不要提交自行生成或猜測的品牌 logo。若增加 skill 的離線 fallback，也同步放入 `skills/behavior-debug-board/assets/logos/`。

Pull Request 必須補上：

- 原始來源 URL。
- variant 名稱。
- license 或使用條款。
- 商標權利人。

不要提交來源不明、經過重新上色或可能誤導為官方合作的標誌。

## PR 規模與 review

- 一張 PR 解決一個可清楚描述的問題。
- 不要把格式化整個 repo 與功能修改混在一起。
- UI 修改請附 Before / After 圖或短錄影。
- Reviewer 會優先檢查 behavior contract、方向語意、可讀性、測試與第三方資產來源。
