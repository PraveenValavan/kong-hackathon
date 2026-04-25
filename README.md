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

Custom JWT claims (`team_id`, `department`, `role`) are injected via the `scope` parameter. mock-oauth2-server v2.x maps each scope value to a fixed set of claims configured in `JSON_CONFIG` in `docker-compose.yml`.

> **Note:** The `?claims=...` query-param approach from older examples is **broken in v2.x** and will return a server error. Always use the `scope` approach below.

**Engineer** (`team_id: nlp-platform`, `department: R&D`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=engineering" \
  | jq -r .access_token
```

**Data Scientist** (`team_id: data-science`, `department: R&D`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=datascience" \
  | jq -r .access_token
```

**FinOps** (`team_id: finance`, `department: Finance`, `role: finops`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=finops" \
  | jq -r .access_token
```

**Admin** (`team_id: platform`, `department: Engineering`, `role: admin`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=admin" \
  | jq -r .access_token
```

Expected JWT payload (engineering example):
```json
{
  "sub": "engineer-001",
  "team_id": "nlp-platform",
  "department": "R&D",
  "role": "engineering",
  "iss": "http://localhost:8080/default"
}
```

Kong's `openid-connect` plugin forwards `team_id` and `department` as `x-team-id` and `x-department` upstream headers, which the AIRA backend uses for cost attribution.

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

## Chat Script

`scripts/aira-chat.sh` wraps the token fetch + Kong call into a single command.

**Prerequisites:** Docker stack running, `curl` and `jq` installed.

```bash
# Default: Anthropic, engineering role
./scripts/aira-chat.sh "Explain rate limiting"

# OpenAI, finops role
./scripts/aira-chat.sh "Summarise last month's spend" --provider openai --role finops

# Anthropic, datascience role
./scripts/aira-chat.sh "What is a transformer model?" --role datascience
```

Available roles: `engineering` | `finops` | `admin` | `datascience`  
Available providers: `anthropic` | `openai`

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
