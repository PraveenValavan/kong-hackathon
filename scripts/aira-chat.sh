#!/usr/bin/env bash
# aira-chat.sh — Send a message to an LLM through the AIRA Kong AI Gateway
#
# Usage:
#   ./scripts/aira-chat.sh "Your message here"
#   ./scripts/aira-chat.sh "Your message here" --role finops
#   ./scripts/aira-chat.sh "Your message here" --session <uuid>
#
# Options:
#   --role     engineering | finops | admin | datascience  (default: engineering)
#   --session  UUID to group requests into a session (auto-generated if omitted)
#
# Kong's ai-proxy-advanced balances traffic between claude-haiku (2/3) and
# claude-sonnet (1/3). The model selected for each call is shown in the output.

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
KONG_PROXY="http://localhost:8000"
IDP_URL="http://localhost:8080/default/token"
CLIENT_ID="${AIRA_CLIENT_ID:-aira-local}"
CLIENT_SECRET="${AIRA_CLIENT_SECRET:-aira-secret}"
ROLE="engineering"
SESSION_ID=""

# ── Parse args ────────────────────────────────────────────────────────────────
MESSAGE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --role)    ROLE="$2";       shift 2 ;;
    --session) SESSION_ID="$2"; shift 2 ;;
    *)         MESSAGE="$1";    shift   ;;
  esac
done

if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $0 \"Your message\" [--role engineering|finops|admin|datascience] [--session <uuid>]"
  exit 1
fi

# Auto-generate session ID if not provided
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID=$(uuidgen 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")
fi

# ── Get JWT token ─────────────────────────────────────────────────────────────
TOKEN=$(curl -sf -X POST "$IDP_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=${ROLE}" \
  | jq -r .access_token)

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "Error: failed to get token from IdP (is mock-oauth2 running?)"
  exit 1
fi

# ── Build request body ────────────────────────────────────────────────────────
# No model field — ai-proxy-advanced selects the model via round-robin balancer.
BODY=$(jq -n \
  --argjson content "$(echo "$MESSAGE" | jq -Rs .)" \
  '{max_tokens: 1024, messages: [{role: "user", content: $content}]}')

# ── Call Kong AI Gateway ──────────────────────────────────────────────────────
RESPONSE=$(curl -sf -X POST "${KONG_PROXY}/chat/v1/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $SESSION_ID" \
  -d "$BODY")

# ── Print result ──────────────────────────────────────────────────────────────
echo ""
echo "Model    : $(echo "$RESPONSE" | jq -r .model)"
echo "Role     : $ROLE"
echo "Session  : $SESSION_ID"
echo ""
echo "Response :"
echo "$RESPONSE" | jq -r '.choices[0].message.content'
echo ""
echo "Tokens   : prompt=$(echo "$RESPONSE" | jq -r .usage.prompt_tokens) completion=$(echo "$RESPONSE" | jq -r .usage.completion_tokens) total=$(echo "$RESPONSE" | jq -r .usage.total_tokens)"
