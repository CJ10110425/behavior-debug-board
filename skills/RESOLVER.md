# Skill Resolver

| User intent / trigger | Route to skill | Expected result |
|---|---|---|
| 將 bug、debug flow、behavior change、權限錯誤畫成 Before / After | `behavior-debug-board` | 建立並打開本地端動態 Board |
| 要求用不同方向線呈現 request / response、播放資料傳輸 | `behavior-debug-board` | 產生獨立方向線、常駐標籤與回放控制 |
| 保存、比較、列出或還原 behavior Board 版本 | `behavior-debug-board` | 使用本機/Git revision 與 semantic diff，不顯示 JSON line diff |
| 只要求 code review、PR review 或文字 diff | 不路由 | 使用對應 review 能力 |
| 只要求靜態簡報或圖片 | 不路由 | 使用簡報或影像工具 |
