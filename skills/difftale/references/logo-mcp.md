# Logo MCP workflow

Prefer the `thesvg` MCP server for named brands and services. It requires no API key.

## MCP installation

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

## Tool sequence

1. Call `mcp__thesvg__search_icons` with the product name.
2. Confirm the exact product, not merely its parent company.
3. Call `mcp__thesvg__list_variants` when more than one variant is available.
4. Prefer `default`/`color` on this white board. Never recolor the returned brand SVG.
5. Call `mcp__thesvg__get_icon` and save the raw SVG under `public/logos/<slug>.svg` so localhost remains offline-capable.
6. Record the slug, variant, upstream URL, license, and trademark owner in `references/logo-sources.md` or the project notice.

## Fallback chain

If the MCP has no exact match or is unavailable:

1. Search the web for the exact product plus `official logo`, `brand assets`, `media kit`, and `brand guidelines`.
2. Prefer the product's official website, documentation, press kit, or parent-company brand page. Confirm that the asset identifies the exact service, not only the parent company.
3. Search trusted vector registries such as theSVG or Simple Icons. Cross-check the name, colors, official domain, license, and trademark owner.
4. Download the SVG to `public/logos/<slug>.svg`; never hotlink it at runtime. Record its source URL and usage terms.
5. If no trustworthy logo exists, identify what the service does and use `categoryIcon`. Keep the service name as visible text so the generic symbol cannot be mistaken for a brand mark.

Never redraw, recolor, approximate, or generate a brand logo.

## Category icon map

| Service role | `categoryIcon` |
|---|---|
| Browser or web client | `web-app` |
| Mobile application | `mobile-app` |
| API, SDK, developer endpoint | `api` |
| SQL, NoSQL, data store | `database` |
| Identity, login, access tokens | `auth` |
| Object or file storage | `storage` |
| Server, function, worker, compute | `compute` |
| Billing, checkout, payment | `payment` |
| Metrics, analytics, observability | `analytics` |
| Chat, email, notification | `messaging` |
| DNS, CDN, gateway, networking | `network` |
| Rules, firewall, verification | `security` |
| General cloud platform | `cloud` |
| Queue, job, async workflow | `queue` |
| Webhook delivery | `webhook` |
| Model, inference, AI agent | `ai` |
| Uncategorized backend service | `service` |

The MCP package and tool contract are documented at `https://www.npmjs.com/package/@thesvg/mcp-server`.
