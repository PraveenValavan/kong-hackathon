#!/usr/bin/env bash
# aira-test.sh — End-to-end feature tests for the AIRA Kong AI Gateway
#
# Tests every feature layer:
#   1. Infrastructure health (Kong, AIRA backend, mock-oauth2)
#   2. Authentication (token acquisition, rejection without token)
#   3. Kong AI proxy (chat, model selection, session ID tracking)
#   4. PII / content guard (SSN, credit card, credential patterns)
#   5. Token-based rate limiting (response headers present)
#   6. Usage backend APIs (events, sessions, cost, dashboard)
#   7. Forecast endpoint (AI-generated FinOps narrative)
#   8. LLM-as-Judge (batch quality scoring)
#   9. Team config API (read + update + rollback)
#  10. Kong sync (push config from backend to Kong Admin)
#
# Usage:
#   ./scripts/aira-test.sh              # run all tests
#   ./scripts/aira-test.sh --no-llm     # skip tests that call real LLM APIs
#   ./scripts/aira-test.sh --verbose    # show full response bodies on failure

set -euo pipefail

# ── Endpoints ─────────────────────────────────────────────────────────────────
KONG_PROXY="http://localhost:8000"
KONG_ADMIN="http://localhost:8001"
IDP_URL="http://localhost:8080/default/token"
BACKEND="http://localhost:8002"
CLIENT_ID="${AIRA_CLIENT_ID:-aira-local}"
CLIENT_SECRET="${AIRA_CLIENT_SECRET:-aira-secret}"

# ── Flags ─────────────────────────────────────────────────────────────────────
NO_LLM=0
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --no-llm)   NO_LLM=1 ;;
    --verbose)  VERBOSE=1 ;;
  esac
done

# ── Counters ──────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

pass() { echo -e "  ${GREEN}✓${RESET} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; ((FAIL++)); [[ $VERBOSE -eq 1 ]] && [[ -n "${2:-}" ]] && echo "    $2"; }
skip() { echo -e "  ${YELLOW}⊘${RESET} $1 (skipped: --no-llm)"; ((SKIP++)); }
section() { echo -e "\n${BOLD}${CYAN}── $1 ─────────────────────────────────────────────${RESET}"; }

# Make an HTTP request, return body to stdout, capture status code in HTTP_CODE.
# Usage: body=$(req GET http://... [extra curl args])
req() {
  local method="$1"; local url="$2"; shift 2
  local tmp; tmp=$(mktemp)
  HTTP_CODE=$(curl -s -o "$tmp" -w "%{http_code}" -X "$method" "$url" "$@" --max-time 15 2>/dev/null || echo "000")
  cat "$tmp"
  rm -f "$tmp"
}

# Get a JWT token for a given scope/role.
get_token() {
  local scope="$1"
  curl -sf -X POST "$IDP_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=${scope}" \
    --max-time 10 2>/dev/null | jq -r .access_token 2>/dev/null || echo ""
}

# Assert HTTP status code matches expected.
assert_status() {
  local label="$1" expected="$2"
  if [[ "$HTTP_CODE" == "$expected" ]]; then
    pass "$label (HTTP $HTTP_CODE)"
  else
    fail "$label" "expected HTTP $expected, got HTTP $HTTP_CODE"
  fi
}

# Assert response body contains a string.
assert_contains() {
  local label="$1" needle="$2" body="$3"
  if echo "$body" | grep -q "$needle"; then
    pass "$label"
  else
    fail "$label" "expected '$needle' in response"
  fi
}

# Assert response body is valid JSON.
assert_json() {
  local label="$1" body="$2"
  if echo "$body" | jq . >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label" "response is not valid JSON: ${body:0:200}"
  fi
}

# ── Section 1: Infrastructure health ──────────────────────────────────────────

section "1 · Infrastructure health"

body=$(req GET "${BACKEND}/health")
assert_status "AIRA backend /health" "200"
assert_contains "backend health status=ok" '"ok"' "$body"

body=$(req GET "${KONG_ADMIN}/status")
if [[ "$HTTP_CODE" == "200" ]]; then
  pass "Kong Admin API reachable (HTTP 200)"
else
  fail "Kong Admin API reachable" "HTTP $HTTP_CODE (is Kong running?)"
fi

body=$(curl -sf "${IDP_URL%/token}/../.well-known/openid-configuration" --max-time 10 2>/dev/null || echo "")
if echo "$body" | jq -e .issuer >/dev/null 2>&1; then
  pass "mock-oauth2 OIDC discovery endpoint reachable"
else
  fail "mock-oauth2 OIDC discovery endpoint reachable" "no issuer in response"
fi

# ── Section 2: Authentication ─────────────────────────────────────────────────

section "2 · Authentication"

for role in engineering finops admin datascience; do
  tok=$(get_token "$role")
  if [[ -n "$tok" && "$tok" != "null" ]]; then
    pass "JWT token acquired for role=$role"
  else
    fail "JWT token acquired for role=$role" "empty or null token"
  fi
done

# Request without a token should be rejected by OIDC plugin
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}')
if [[ "$HTTP_CODE" == "401" ]]; then
  pass "Unauthenticated request rejected (HTTP 401)"
else
  fail "Unauthenticated request rejected" "expected 401, got $HTTP_CODE"
fi

# Request with a garbage token should also be rejected
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer this.is.garbage" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}')
if [[ "$HTTP_CODE" == "401" ]]; then
  pass "Invalid JWT rejected (HTTP 401)"
else
  fail "Invalid JWT rejected" "expected 401, got $HTTP_CODE"
fi

# ── Section 3: Kong AI proxy (requires real LLM) ──────────────────────────────

section "3 · Kong AI proxy — chat & routing"

ENG_TOKEN=$(get_token "engineering")

if [[ $NO_LLM -eq 1 ]]; then
  skip "Chat via Kong proxy (real LLM call)"
  skip "Response contains model field"
  skip "Session ID echoed in response context"
  skip "Explicit model selection (claude-haiku)"
else
  SESSION_ID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || uuidgen)

  body=$(req POST "${KONG_PROXY}/chat" \
    -H "Authorization: Bearer ${ENG_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Session-ID: ${SESSION_ID}" \
    -d '{"max_tokens":30,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}')
  assert_status "Chat via Kong proxy" "200"
  assert_json   "Chat response is valid JSON" "$body"

  MODEL_USED=$(echo "$body" | jq -r '.model // empty' 2>/dev/null || echo "")
  if [[ -n "$MODEL_USED" && "$MODEL_USED" != "null" ]]; then
    pass "Response contains model field: $MODEL_USED"
  else
    fail "Response contains model field" "model field missing or null"
  fi

  TOKENS=$(echo "$body" | jq -r '.usage.total_tokens // 0' 2>/dev/null || echo "0")
  if [[ "$TOKENS" -gt 0 ]]; then
    pass "Token usage tracked (total_tokens=$TOKENS)"
  else
    fail "Token usage tracked" "total_tokens=0 or missing"
  fi

  # Explicit model selection
  body=$(req POST "${KONG_PROXY}/chat" \
    -H "Authorization: Bearer ${ENG_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Session-ID: ${SESSION_ID}" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"Say hi"}]}')
  assert_status "Explicit model selection (haiku)" "200"
  EXPLICIT_MODEL=$(echo "$body" | jq -r '.model // empty' 2>/dev/null || echo "")
  if echo "$EXPLICIT_MODEL" | grep -q "haiku"; then
    pass "Explicit model routing (haiku selected)"
  else
    fail "Explicit model routing (haiku selected)" "got model: $EXPLICIT_MODEL"
  fi
fi

# ── Section 4: PII / content guard ────────────────────────────────────────────

section "4 · PII / content guard (ai-prompt-guard)"

# These tests do NOT require a real LLM call — Kong blocks at the plugin layer.

# SSN pattern
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer ${ENG_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":50,"messages":[{"role":"user","content":"My SSN is 123-45-6789, please help"}]}')
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "SSN pattern blocked (HTTP 400)"
else
  fail "SSN pattern blocked" "expected 400, got $HTTP_CODE"
fi

# Credit card pattern (16 consecutive digits)
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer ${ENG_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":50,"messages":[{"role":"user","content":"Charge card 4111111111111111 please"}]}')
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "Credit card pattern blocked (HTTP 400)"
else
  fail "Credit card pattern blocked" "expected 400, got $HTTP_CODE"
fi

# Key=value credential pattern
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer ${ENG_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":50,"messages":[{"role":"user","content":"api_key=sk-abc123secret"}]}')
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "api_key=value credential pattern blocked (HTTP 400)"
else
  fail "api_key=value credential pattern blocked" "expected 400, got $HTTP_CODE"
fi

# password: value credential pattern
body=$(req POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer ${ENG_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":50,"messages":[{"role":"user","content":"password: supersecret123"}]}')
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "password: value credential pattern blocked (HTTP 400)"
else
  fail "password: value credential pattern blocked" "expected 400, got $HTTP_CODE"
fi

# Legitimate message should NOT be blocked
if [[ $NO_LLM -eq 0 ]]; then
  body=$(req POST "${KONG_PROXY}/chat" \
    -H "Authorization: Bearer ${ENG_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"max_tokens":20,"messages":[{"role":"user","content":"What is 2+2?"}]}')
  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Clean message passes guard (HTTP 200)"
  else
    fail "Clean message passes guard" "expected 200, got $HTTP_CODE"
  fi
else
  skip "Clean message passes guard (real LLM call)"
fi

# ── Section 5: Rate limiting headers ──────────────────────────────────────────

section "5 · Token-based rate limiting (ai-rate-limiting-advanced)"

# Check that rate limit headers are present in a successful response.
if [[ $NO_LLM -eq 1 ]]; then
  skip "Rate limit headers present (real LLM call)"
else
  HEADERS_TMP=$(mktemp)
  HTTP_CODE=$(curl -s -o /dev/null -D "$HEADERS_TMP" -w "%{http_code}" \
    -X POST "${KONG_PROXY}/chat" \
    -H "Authorization: Bearer ${ENG_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' \
    --max-time 15 2>/dev/null || echo "000")
  HEADERS=$(cat "$HEADERS_TMP")
  rm -f "$HEADERS_TMP"

  if echo "$HEADERS" | grep -qi "x-ratelimit"; then
    pass "Rate limit headers present in response"
  else
    fail "Rate limit headers present in response" "no x-ratelimit* header found"
  fi
fi

# ── Section 6: Usage backend APIs ─────────────────────────────────────────────

section "6 · Usage backend APIs"

body=$(req GET "${BACKEND}/usage/events")
assert_status "GET /usage/events" "200"
assert_json   "GET /usage/events returns JSON" "$body"

body=$(req GET "${BACKEND}/usage/events?limit=5")
assert_status "GET /usage/events?limit=5" "200"

body=$(req GET "${BACKEND}/usage/sessions")
assert_status "GET /usage/sessions" "200"
assert_json   "GET /usage/sessions returns JSON" "$body"

body=$(req GET "${BACKEND}/usage/summary?group_by=user_id")
assert_status "GET /usage/summary?group_by=user_id" "200"
assert_json   "GET /usage/summary returns JSON" "$body"

body=$(req GET "${BACKEND}/usage/summary?group_by=department")
assert_status "GET /usage/summary?group_by=department" "200"

# Invalid group_by should return 400
body=$(req GET "${BACKEND}/usage/summary?group_by=invalid_column")
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "GET /usage/summary invalid group_by returns 400"
else
  fail "GET /usage/summary invalid group_by returns 400" "got $HTTP_CODE"
fi

body=$(req GET "${BACKEND}/usage/dashboard")
assert_status "GET /usage/dashboard" "200"
assert_json   "GET /usage/dashboard returns JSON" "$body"

# Dashboard contains expected top-level keys
for key in totals by_user by_department by_model by_day top_sessions; do
  if echo "$body" | jq -e ".$key" >/dev/null 2>&1; then
    pass "Dashboard response has key: $key"
  else
    fail "Dashboard response has key: $key"
  fi
done

body=$(req GET "${BACKEND}/usage/cost/by-user")
assert_status "GET /usage/cost/by-user" "200"
assert_json   "GET /usage/cost/by-user returns JSON" "$body"

body=$(req GET "${BACKEND}/usage/cost/by-department")
assert_status "GET /usage/cost/by-department" "200"
assert_json   "GET /usage/cost/by-department returns JSON" "$body"

# Non-existent user should return 404
body=$(req GET "${BACKEND}/usage/cost/by-user/no-such-user-xyz")
if [[ "$HTTP_CODE" == "404" ]]; then
  pass "GET /usage/cost/by-user/{id} returns 404 for unknown user"
else
  fail "GET /usage/cost/by-user/{id} returns 404 for unknown user" "got $HTTP_CODE"
fi

# Non-existent session should return 404
body=$(req GET "${BACKEND}/usage/sessions/00000000-0000-0000-0000-000000000000")
if [[ "$HTTP_CODE" == "404" ]]; then
  pass "GET /usage/sessions/{id} returns 404 for unknown session"
else
  fail "GET /usage/sessions/{id} returns 404 for unknown session" "got $HTTP_CODE"
fi

# ── Section 7: Forecast endpoint ──────────────────────────────────────────────

section "7 · AI-powered FinOps forecast"

if [[ $NO_LLM -eq 1 ]]; then
  skip "GET /forecast (calls Anthropic API)"
  skip "Forecast response has narrative field"
else
  body=$(req GET "${BACKEND}/forecast")
  assert_status "GET /forecast" "200"
  assert_json   "GET /forecast returns JSON" "$body"

  for key in narrative projected_eom generated_at; do
    if echo "$body" | jq -e ".$key" >/dev/null 2>&1; then
      pass "Forecast response has key: $key"
    else
      fail "Forecast response has key: $key"
    fi
  done

  body=$(req GET "${BACKEND}/forecast?department=R%26D")
  assert_status "GET /forecast?department=R&D" "200"
fi

# ── Section 8: LLM-as-Judge ───────────────────────────────────────────────────

section "8 · LLM-as-Judge"

if [[ $NO_LLM -eq 1 ]]; then
  skip "POST /judge/batch (calls Anthropic API)"
  skip "GET /judge/summary"
else
  # Seed a dummy event without prompt/response — judge should skip it gracefully
  body=$(req POST "${BACKEND}/ingest/event" \
    -H "Content-Type: application/json" \
    -d '{
      "request": {"id": "test-judge-seed-'$(date +%s)'", "headers": {}, "body": ""},
      "response": {"status": 200, "body": ""},
      "ai": {"ai-proxy": {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}, "meta": {"provider_name": "anthropic", "response_model": "claude-haiku-4-5-20251001"}}},
      "latencies": {"request": 300},
      "started_at": 0
    }')
  assert_status "POST /ingest/event (seed test event)" "204"

  body=$(req POST "${BACKEND}/judge/batch?limit=3")
  assert_status "POST /judge/batch" "200"
  assert_json   "POST /judge/batch returns JSON" "$body"
  if echo "$body" | jq -e '.judged' >/dev/null 2>&1; then
    pass "Judge batch response has judged count"
  else
    fail "Judge batch response has judged count"
  fi

  body=$(req GET "${BACKEND}/judge/summary")
  assert_status "GET /judge/summary" "200"
  assert_json   "GET /judge/summary returns JSON" "$body"
  if echo "$body" | jq -e '.totals' >/dev/null 2>&1; then
    pass "Judge summary response has totals"
  else
    fail "Judge summary response has totals"
  fi
fi

# ── Section 9: Team config API ────────────────────────────────────────────────

section "9 · Team config API"

body=$(req GET "${BACKEND}/config/teams")
assert_status "GET /config/teams" "200"
assert_json   "GET /config/teams returns JSON" "$body"

TEAM_COUNT=$(echo "$body" | jq 'length' 2>/dev/null || echo "0")
if [[ "$TEAM_COUNT" -ge 4 ]]; then
  pass "GET /config/teams returns >= 4 teams ($TEAM_COUNT)"
else
  fail "GET /config/teams returns >= 4 teams" "got $TEAM_COUNT"
fi

# Verify the default teams are present
for team in nlp-platform data-science platform finance; do
  if echo "$body" | jq -e ".[] | select(.team_id == \"$team\")" >/dev/null 2>&1; then
    pass "Default team present: $team"
  else
    fail "Default team present: $team"
  fi
done

# Read current budget for nlp-platform, update it, verify, then restore.
ORIG_BUDGET=$(echo "$body" | jq '.[] | select(.team_id == "nlp-platform") | .budget_usd' 2>/dev/null || echo "1800")
NEW_BUDGET="9999.99"

body=$(req PUT "${BACKEND}/config/teams/nlp-platform" \
  -H "Content-Type: application/json" \
  -d "{\"budget_usd\": $NEW_BUDGET}")
assert_status "PUT /config/teams/nlp-platform (update budget)" "200"
UPDATED_BUDGET=$(echo "$body" | jq '.budget_usd' 2>/dev/null || echo "0")
if [[ "$UPDATED_BUDGET" == "$NEW_BUDGET" ]]; then
  pass "Budget updated to $NEW_BUDGET"
else
  fail "Budget updated to $NEW_BUDGET" "got $UPDATED_BUDGET"
fi

# Restore original budget
req PUT "${BACKEND}/config/teams/nlp-platform" \
  -H "Content-Type: application/json" \
  -d "{\"budget_usd\": $ORIG_BUDGET}" >/dev/null

body=$(req GET "${BACKEND}/config/teams")
RESTORED=$(echo "$body" | jq '.[] | select(.team_id == "nlp-platform") | .budget_usd' 2>/dev/null || echo "0")
if [[ "$RESTORED" == "$ORIG_BUDGET" ]]; then
  pass "Budget restored to original ($ORIG_BUDGET)"
else
  fail "Budget restored to original" "got $RESTORED"
fi

# Invalid enforcement value should be rejected
body=$(req PUT "${BACKEND}/config/teams/nlp-platform" \
  -H "Content-Type: application/json" \
  -d '{"enforcement": "nuclear"}')
if [[ "$HTTP_CODE" == "400" ]]; then
  pass "Invalid enforcement value rejected (HTTP 400)"
else
  fail "Invalid enforcement value rejected" "expected 400, got $HTTP_CODE"
fi

# Non-existent team should return 404
body=$(req PUT "${BACKEND}/config/teams/no-such-team-xyz" \
  -H "Content-Type: application/json" \
  -d '{"budget_usd": 100}')
if [[ "$HTTP_CODE" == "404" ]]; then
  pass "PUT /config/teams/{id} returns 404 for unknown team"
else
  fail "PUT /config/teams/{id} returns 404 for unknown team" "got $HTTP_CODE"
fi

body=$(req GET "${BACKEND}/config/models")
assert_status "GET /config/models" "200"
assert_json   "GET /config/models returns JSON" "$body"
MODEL_COUNT=$(echo "$body" | jq 'length' 2>/dev/null || echo "0")
if [[ "$MODEL_COUNT" -ge 3 ]]; then
  pass "GET /config/models returns >= 3 models ($MODEL_COUNT)"
else
  fail "GET /config/models returns >= 3 models" "got $MODEL_COUNT"
fi

# ── Section 10: Kong sync ─────────────────────────────────────────────────────

section "10 · Kong sync (POST /sync/kong)"

body=$(req POST "${BACKEND}/sync/kong")
if [[ "$HTTP_CODE" == "200" ]]; then
  assert_json "POST /sync/kong returns JSON" "$body"
  TEAMS_SYNCED=$(echo "$body" | jq '.teams_synced' 2>/dev/null || echo "0")
  if [[ "$TEAMS_SYNCED" -ge 4 ]]; then
    pass "Kong sync reports >= 4 teams synced ($TEAMS_SYNCED)"
  else
    fail "Kong sync reports >= 4 teams synced" "got $TEAMS_SYNCED"
  fi
  if echo "$body" | jq -e '.status == "synced"' >/dev/null 2>&1; then
    pass "Kong sync status is 'synced'"
  else
    fail "Kong sync status is 'synced'" "got: $(echo "$body" | jq -r '.status // empty')"
  fi
elif [[ "$HTTP_CODE" == "503" ]]; then
  fail "POST /sync/kong" "Kong Admin API unreachable (HTTP 503)"
else
  fail "POST /sync/kong" "HTTP $HTTP_CODE: $(echo "$body" | jq -r '.detail // .' 2>/dev/null | head -c 200)"
fi

# ── Section 11: CORS preflight ────────────────────────────────────────────────

section "11 · CORS preflight"

HEADERS_TMP=$(mktemp)
HTTP_CODE=$(curl -s -o /dev/null -D "$HEADERS_TMP" -w "%{http_code}" \
  -X OPTIONS "${KONG_PROXY}/chat" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  --max-time 10 2>/dev/null || echo "000")
HEADERS=$(cat "$HEADERS_TMP")
rm -f "$HEADERS_TMP"

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "204" ]]; then
  pass "OPTIONS preflight handled (HTTP $HTTP_CODE)"
else
  fail "OPTIONS preflight handled" "expected 200/204, got $HTTP_CODE"
fi

if echo "$HEADERS" | grep -qi "access-control-allow-origin"; then
  pass "CORS Access-Control-Allow-Origin header present"
else
  fail "CORS Access-Control-Allow-Origin header present"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  AIRA Test Results${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}Passed${RESET}  : $PASS"
echo -e "  ${RED}Failed${RESET}  : $FAIL"
echo -e "  ${YELLOW}Skipped${RESET} : $SKIP  (use without --no-llm to run all)"
echo -e "  Total   : $TOTAL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}RESULT: $FAIL test(s) failed.${RESET}"
  echo ""
  echo "  Tip: run with --verbose for response details"
  echo "       run without --no-llm to include LLM-dependent tests"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}RESULT: All $PASS tests passed.${RESET}"
  echo ""
  exit 0
fi