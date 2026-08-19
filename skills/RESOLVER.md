# Skill Resolver

| User intent / trigger | Route to skill | Expected result |
|---|---|---|
| 將 App／Web 畫面、user flow、bug、behavior change 畫成 Before / After | `difftale` | 建立並打開含畫面截圖的本地端動態 Board |
| 要求用不同方向線呈現 request / response、畫面跳轉或播放資料傳輸 | `difftale` | 產生 screen/service 節點、獨立方向線、常駐標籤與回放控制 |
| 保存、比較、列出或還原視覺 Board 版本 | `difftale` | 使用本機/Git revision 與 semantic diff，不顯示 JSON line diff |
| 明確要求舊的 `behavior-debug-board` | `behavior-debug-board` 相容入口 | 轉用 `difftale`，保留舊 prompt 相容性 |
| 只要求 code review、PR review 或文字 diff | 不路由 | 使用對應 review 能力 |
| 只要求靜態簡報或圖片 | 不路由 | 使用簡報或影像工具 |
