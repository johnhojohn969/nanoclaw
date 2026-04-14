# Project Tracker — Linear + GitHub Projects

NanoClaw dùng **Linear** (content pipeline) + **GitHub Projects** (code/infra) để track toàn bộ công việc.

---

## Tại sao Linear?

Linear là tool DUY NHẤT có **official MCP server** — Claude agents gọi trực tiếp `create_issue`, `update_issue`, `add_comment` không cần viết HTTP code. GraphQL API 1,500 req/hr, uptime 99.7%+.

---

## Setup Linear MCP (1 lần duy nhất)

### Bước 1: Tạo tài khoản
- Vào [linear.app](https://linear.app) → tạo workspace "NanoClaw"
- Tạo các Teams/Projects:
  - **Content Pipeline** — video production, Facebook/Instagram posts
  - **Social Automation** — scheduling, trend detection, analytics
  - **AI Infrastructure** — Room API, music gen, image gen
  - **Monetization** — revenue tracking, CPM monitoring

### Bước 2: Thêm vào .mcp.json
```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp"
    }
  }
}
```

File path: `/workspace/extra/john/git/nanoclaw/.mcp.json`

### Bước 3: Authenticate
```bash
# Trong Claude Code session:
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
# Sau đó gõ /mcp → OAuth flow → done
```

---

## Workflow NanoClaw tự động log vào Linear

### Pattern chuẩn — mỗi task quan trọng:

```python
# Khi BẮT ĐẦU task (tạo issue)
# Dùng Linear MCP tool: create_issue
{
  "title": "Download Grok video 4169250d",
  "teamId": "CONTENT_PIPELINE_TEAM_ID",
  "stateId": "IN_PROGRESS_STATE_ID",
  "description": "Source: grok.com/imagine/post/4169250d\nExpected: 416x752, 10s"
}

# Khi XONG task (update issue)
# Dùng Linear MCP tool: update_issue
{
  "issueId": "ISSUE_ID",
  "stateId": "DONE_STATE_ID",
  "description": "✅ Done\n- Resolution: 416x752\n- File: /tmp/grok_new.mp4\n- Post ID: 122101711922883953"
}

# Khi có LỖI (add comment)
# Dùng Linear MCP tool: create_comment
{
  "issueId": "ISSUE_ID",
  "body": "❌ Error: CF blocked direct download\nFix applied: CDP stealth + warmup\nRetry: success"
}
```

---

## GitHub Projects (Code/Infra tasks)

Dùng cho: bugs, feature requests, code refactoring, infra changes — linked với commits.

### Setup
1. Vào `github.com/attyzen/nanoclaw` → Projects → New Project → Board
2. Columns: `Backlog` | `In Progress` | `Review` | `Done`
3. Labels: `video-production`, `social-automation`, `ai-infra`, `monetization`

### API (GraphQL)
```bash
# Get project ID
GH_TOKEN="ghp_..."
curl -s -X POST https://api.github.com/graphql \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ user(login: \"attyzen\") { projectsV2(first: 10) { nodes { id title } } } }"}' \
  | python3 -m json.tool

# Create issue linked to project
curl -s -X POST https://api.github.com/repos/attyzen/nanoclaw/issues \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Build Content Calendar", "labels": ["social-automation"], "body": "..."}'
```

---

## Phân chia: Linear vs GitHub Projects

| Task Type | Tool | Lý do |
|---|---|---|
| Video production jobs | Linear | Content pipeline |
| Facebook/Instagram posts | Linear | Content pipeline |
| Trend detection runs | Linear | Social automation |
| Music generation jobs | Linear | AI infrastructure |
| Monetization milestones | Linear | Revenue tracking |
| Bug fixes trong code | GitHub Projects | Linked tới commits |
| Feature requests | GitHub Projects | PR tracking |
| Infrastructure changes | GitHub Projects | DevOps |

---

## Mobile Monitoring (iPhone)

- **Linear app** (App Store): Xem toàn bộ content pipeline. Filter by project, status, priority.
- **GitHub app**: Xem code issues, PRs. Mobile Projects view khá yếu nhưng đủ để read-only.

---

## Lưu ý

| Tool | Rate Limit | Free Tier |
|---|---|---|
| Linear | 1,500 req/hr, 5,000 complexity/hr | 250 active issues, 2 teams |
| GitHub Projects | 5,000 points/hr (PAT) | Unlimited (miễn phí hoàn toàn) |

- Linear free: archive issues đã done để không bị limit 250
- Dùng **webhooks** thay vì polling để tiết kiệm rate limit
