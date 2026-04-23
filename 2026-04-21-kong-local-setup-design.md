# Kong Enterprise — Local Dev Setup Design

> AIRA Platform — Step 1: Kong Gateway exploration before backend is built

---

## Goal

Get Kong Enterprise running locally in DB-less mode with a mock OIDC identity provider, so the team can:
- Explore Kong's proxy, plugin, and auth capabilities
- Test the Insomnia demo flow from `2026-04-18-aira-insomnia-testing.md`
- Have a reproducible, committable setup that can later be extended with the AIRA backend

---

## Decisions Made

| Decision | Choice | Reason |
|----------|--------|--------|
| Kong config mode | DB-less (YAML) | Fastest to start, no database dependency, fully declarative |
| Auth plugin | OIDC (Kong Enterprise) | Realistic auth flow; supports `role`/`team_id` claims for Developer vs Org Admin personas |
| Identity Provider | Mock OIDC server (`mock-oauth2-server`) | Zero config, speaks real OIDC/OAuth2, swap for Keycloak later with one config change |
| Backend services | Not included (Step 2) | Focus is Kong exploration first |

---

## Stack

```
┌─────────────────────────────────────────────┐
│  Insomnia / curl (developer machine)        │
└────────────────┬────────────────────────────┘
                 │ :8000 (proxy) / :8001 (admin)
                 ▼
┌─────────────────────────────────────────────┐
│  Kong Enterprise (DB-less)                  │
│  - OIDC plugin → validates tokens           │
│  - Rate Limiting plugin                     │
│  - Pre-configured routes:                   │
│      /openai/v1/*  → api.openai.com         │
│      /anthropic/v1/* → api.anthropic.com    │
└────────────────┬────────────────────────────┘
                 │ OIDC discovery + token validation
                 ▼
┌─────────────────────────────────────────────┐
│  Mock OIDC Server (mock-oauth2-server)      │
│  port :8080                                 │
│  - Issues JWTs with any claims on demand    │
│  - Personas: Developer, Org Admin           │
└─────────────────────────────────────────────┘
```

---

## Section 1 — Folder Structure

```
kong/
├── docker-compose.yml      ← brings up Kong + mock IdP
├── kong.yml                ← declarative config (routes, plugins, consumers)
├── license.json            ← Kong Enterprise license (git-ignored)
└── README.md               ← how to start, get a token, Insomnia setup
```

Follows the same pattern as the existing `azure-service-bus-emulator/` folder.

---

---

## Section 2 — `docker-compose.yml` Detail

### Services

**Kong Enterprise**
- Image: `kong/kong-gateway:3.9`
- Ports: `8000` (proxy), `8001` (admin API)
- Key env vars:
  - `KONG_DATABASE=off` — DB-less mode
  - `KONG_DECLARATIVE_CONFIG=/kong/kong.yml` — points to mounted config
  - `KONG_LICENSE_DATA` — raw JSON string from `license.json`, injected via `.env` file (never committed)
- Volume: `./kong.yml` mounted into container at `/kong/kong.yml`

**Mock OIDC Server**
- Image: `ghcr.io/navikt/mock-oauth2-server:2.1.10`
- Port: `8080`
- Zero configuration required — works out of the box

### Networking

Both services share a Docker bridge network. Kong reaches the mock IdP internally at `http://mock-oauth2:8080` — this is the `issuer` URL configured in Kong's OIDC plugin.

### Secrets Pattern

```
kong/
├── .env              ← KONG_LICENSE_DATA=<raw json> — git-ignored
├── .env.example      ← KONG_LICENSE_DATA=<paste your license json here> — committed
```

`KONG_LICENSE_DATA` holds the raw JSON string of the license file. Using an env var over a bind-mounted file keeps secrets out of the filesystem and works cleanly with Docker Compose's `.env` loading.

> **Note:** DB-less Kong reads `kong.yml` at startup only. Config changes require `docker compose restart kong`.

---

## Sections To Be Designed (in progress)

---

## Section 3 — `kong.yml` Declarative Config

### Services

Two upstream services:

| Name | URL |
|------|-----|
| `openai-service` | `https://api.openai.com` |
| `anthropic-service` | `https://api.anthropic.com` |

### Routes

| Name | Path | Service |
|------|------|---------|
| `openai-route` | `/openai/v1/*` | `openai-service` |
| `anthropic-route` | `/anthropic/v1/*` | `anthropic-service` |

### Plugins

| Plugin | Level | Purpose |
|--------|-------|---------|
| `openid-connect` | Global | Validates Bearer token against mock IdP — rejects unauthenticated requests |
| `rate-limiting-advanced` | Per route | Sliding window rate limits per route (Enterprise-only) |
| `request-transformer` | Per service | Strips incoming `Authorization` header, injects real OpenAI/Anthropic API key from env var before forwarding upstream |

### Credential Flow

```
Developer → Bearer <oidc-token> → Kong validates with mock IdP
Kong strips oidc-token, injects OPENAI_API_KEY → api.openai.com
```

Developers never see the org's upstream API keys. Kong owns credential substitution.

### Deferred to Step 2

- Claim forwarding (`X-User-Role`, `X-Team-Id`, `X-User-Id` headers) — needed by AIRA backend but not Kong exploration

---

---

## Section 4 — OIDC Flow

**Get a Developer token:**
```
POST http://localhost:8080/default/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=aira-local&client_secret=any-string&scope=openid
&claims={"role":"developer","user_id":"dev-001","team_id":"team-alpha"}
```

**Get an Org Admin token:**
Same request, different claims:
```
&claims={"role":"org-admin","user_id":"admin-001","org_id":"org-ericsson"}
```

**Call Kong:**
```
POST http://localhost:8000/openai/v1/chat/completions
Authorization: Bearer <token-from-above>
```

Kong validates the token against mock IdP's JWKS at `http://mock-oauth2:8080/default/jwks`.

---

## Deferred

- [ ] Section 5 — Insomnia environment variables mapping
- [ ] Section 6 — Claim forwarding as headers (Step 2, when AIRA backend exists)
- [ ] Section 7 — Keycloak swap path (future)

---

*Design started: 2026-04-21*
*Paired with: [2026-04-18-aira-insomnia-testing.md](./2026-04-18-aira-insomnia-testing.md)*
