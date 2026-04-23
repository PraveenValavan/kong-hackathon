# AIRA — Kong AI Gateway (Local)

Kong Enterprise **AI Gateway** in DB-less mode + Mock OIDC server.

Kong AI Gateway adds native LLM intelligence on top of API Gateway: the `ai-proxy` plugin handles provider auth and format normalisation, `ai-rate-limiting-advanced` enforces token-based budget caps, and `ai-prompt-guard` blocks PII before it reaches the upstream model.

## Prerequisites

- Docker Desktop running
- Kong Enterprise license in `.env` (already set up — do not commit `.env`)
- OpenAI and/or Anthropic API keys in `.env`

```env
KONG_LICENSE_DATA=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Start

```bash
cd kong/
docker compose up -d
```

Check Kong is healthy:
```bash
curl http://localhost:8001/status
```

## Get a Token

**Developer** (default role, `team_id` and `department` claims required for cost tracking):
```bash
curl -s -X POST "http://localhost:8080/default/token?claims=%7B%22team_id%22%3A%22nlp-platform%22%2C%22department%22%3A%22R%26D%22%7D" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq -r .access_token
```

**FinOps role:**
```bash
curl -s -X POST "http://localhost:8080/default/token?claims=%7B%22role%22%3A%22finops%22%2C%22team_id%22%3A%22finance%22%2C%22department%22%3A%22Finance%22%7D" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq -r .access_token
```

**Org Admin:**
```bash
curl -s -X POST "http://localhost:8080/default/token?claims=%7B%22role%22%3A%22admin%22%2C%22team_id%22%3A%22platform%22%2C%22department%22%3A%22Engineering%22%7D" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq -r .access_token
```

## Call Kong AI Gateway

All AI calls use a unified OpenAI-compatible format. Kong's `ai-proxy` plugin normalises the request to the correct provider format automatically.

```bash
TOKEN=<paste token here>

# OpenAI — gpt-4o (default model set in ai-proxy config)
curl -X POST http://localhost:8000/openai/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# Anthropic — claude-haiku (via OpenAI-compatible format, ai-proxy translates)
curl -X POST http://localhost:8000/anthropic/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

> **Note:** Real API keys in `.env` required. Without them Kong forwards the request but the upstream rejects with 401.

## AI Gateway Plugins Active

| Plugin | Applied to | Purpose |
|---|---|---|
| `openid-connect` | Global | Validates Bearer JWT, forwards `team_id`/`department` as upstream headers |
| `ai-proxy` | Per route | Provider auth injection, request/response normalisation, token extraction |
| `ai-rate-limiting-advanced` | Per route | Token-based rate limiting (500k tokens/hour), maps directly to cost |
| `ai-prompt-guard` | Per route | Blocks SSN, credit card numbers, and credential patterns before they reach the LLM |
| `http-log` | Global | Emits full usage event (with token counts) to AIRA backend after each call |

## Token Usage in Responses

The `ai-proxy` plugin automatically extracts token usage and makes it available in:
- Response body: `usage.prompt_tokens`, `usage.completion_tokens`
- Kong log entry (forwarded to AIRA backend via `http-log`)

## Admin API

```bash
# List all plugins (verify AI plugins are loaded)
curl http://localhost:8001/plugins | jq '[.data[].name]'

# Check ai-proxy config on openai-route
curl http://localhost:8001/routes/openai-route/plugins

# Check Kong license
curl http://localhost:8001/license

# Check token rate limit counters
curl http://localhost:8001/routes/openai-route/plugins | jq '.data[] | select(.name=="ai-rate-limiting-advanced")'
```

## Stop

```bash
docker compose down
```

## Architecture

```
Client (AIRA Client / any tool)
  └─ POST /openai/v1/chat/completions  Bearer JWT
       └─ Kong AI Gateway :8000
            ├─ openid-connect     → validate JWT, extract team_id + department
            ├─ ai-prompt-guard    → block PII patterns
            ├─ ai-rate-limiting-advanced → check token budget (Redis counter)
            ├─ ai-proxy           → inject upstream API key, normalise format
            │    └─ Upstream: OpenAI / Anthropic
            └─ http-log           → POST usage event to AIRA backend :8002
```
