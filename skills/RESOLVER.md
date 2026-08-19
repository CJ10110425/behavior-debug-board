# Skill Resolver

| User intent / trigger | Route to skill | Expected result |
|---|---|---|
| Turn app/web screens, a user flow, bug, or behavior change into Before/After (`將 App／Web 畫面或 behavior change 畫成 Before / After`) | `difftale` | Create and open a local animated Board with screen captures |
| Show requests, responses, navigation, or data transfer as separate one-way paths (`用不同方向線呈現 request / response`) | `difftale` | Create screen/service nodes, directional edges, persistent labels, and replay controls |
| Save, compare, list, or restore visual Board versions (`保存、比較、列出或還原 Board 版本`) | `difftale` | Use local/Git revisions and semantic diff instead of a JSON line diff |
| Explicitly request the legacy `behavior-debug-board` name (`明確要求舊名稱`) | `behavior-debug-board` compatibility route | Route to `difftale` while preserving legacy prompt compatibility |
| Request only code review, PR review, or a text diff | Do not route | Use the relevant review capability |
| Request only a static presentation or image | Do not route | Use a presentation or image capability |
