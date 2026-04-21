# AIRA — Kong API Gateway (Local)

Kong Enterprise in DB-less mode + Mock OIDC server.

## Prerequisites

- Docker Desktop running
- Kong Enterprise license in `.env` (already set up — do not commit `.env`)

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

**Developer:**
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq .access_token
```

**Org Admin:**
```bash
curl -s -X POST "http://localhost:8080/default/token?claims=%7B%22role%22%3A%22org-admin%22%2C%22user_id%22%3A%22admin-001%22%7D" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq .access_token
```

## Call Kong

```bash
TOKEN=<paste token here>

# OpenAI proxy
curl -X POST http://localhost:8000/openai/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'

# Anthropic proxy
curl -X POST http://localhost:8000/anthropic/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'
```

> **Note:** Proxying to OpenAI/Anthropic requires real API keys in `.env`. Without them Kong will forward but the upstream will reject with 401.

## Admin API

```bash
# List all routes
curl http://localhost:8001/routes

# List all plugins
curl http://localhost:8001/plugins

# Check Kong license
curl http://localhost:8001/license
```

## Stop

```bash
docker compose down
```

## Next Step

Step 2: Add AIRA backend services to `docker-compose.yml` and enable claim forwarding in `kong.yml`.
