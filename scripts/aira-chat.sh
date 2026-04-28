#!/usr/bin/env bash
# aira-chat.sh — Send a message to an LLM through the AIRA Kong AI Gateway
#
# Usage:
#   ./scripts/aira-chat.sh "Your message here"
#   ./scripts/aira-chat.sh "Your message here" --model claude-sonnet-4-6
#   ./scripts/aira-chat.sh "Your message here" --role finops
#   ./scripts/aira-chat.sh "Your message here" --session <uuid>
#
# Options:
#   --model    claude-haiku-4-5-20251001 | claude-sonnet-4-6  (default: let Kong balance)
#   --role     engineering | finops | admin | datascience      (default: engineering)
#   --session  UUID to group requests into a session           (auto-generated if omitted)

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
KONG_PROXY="http://localhost:8000"
IDP_URL="http://localhost:8080/default/token"
CLIENT_ID="${AIRA_CLIENT_ID:-aira-local}"
CLIENT_SECRET="${AIRA_CLIENT_SECRET:-aira-secret}"
ROLE="engineering"
SESSION_ID=""
MODEL=""

# ── Parse args ────────────────────────────────────────────────────────────────
MESSAGE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --model)   MODEL="$2";      shift 2 ;;
    --role)    ROLE="$2";       shift 2 ;;
    --session) SESSION_ID="$2"; shift 2 ;;
    *)         MESSAGE="$1";    shift   ;;
  esac
done

if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $0 \"Your message\" [--model claude-haiku-4-5-20251001|claude-sonnet-4-6] [--role engineering|finops|admin|datascience] [--session <uuid>]"
  exit 1
fi

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
# Do NOT include model in the body — ai-proxy-advanced's round-robin selects
# the target first, then validates the request model matches. Sending a model
# field conflicts whenever the balancer picks the other target.
# The --model flag is recorded and shown if it matches what Kong selected.
BODY=$(jq -n \
  --arg content "$MESSAGE" \
  '{max_tokens: 1024, messages: [{role: "user", content: $content}]}')

# ── Call Kong AI Gateway ──────────────────────────────────────────────────────
BODY_FILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$BODY_FILE" -w "%{http_code}" -X POST "${KONG_PROXY}/chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: $SESSION_ID" \
  -d "$BODY")
HTTP_BODY=$(cat "$BODY_FILE")
rm -f "$BODY_FILE"

# ── Handle errors ─────────────────────────────────────────────────────────────
if [[ "$HTTP_CODE" != "200" ]]; then
  ERROR_MSG=$(echo "$HTTP_BODY" | jq -r '.error.message // empty' 2>/dev/null)
  if [[ "$HTTP_CODE" == "400" && "$ERROR_MSG" == "bad request" ]]; then
    echo ""
    echo "BLOCKED  : Request rejected by Kong PII guard"
    echo "           Remove sensitive data (SSN, credit card, credentials) and retry."
    echo ""
    exit 2
  fi
  echo "Error: Kong returned HTTP $HTTP_CODE — $ERROR_MSG"
  exit 1
fi

# ── Print result ──────────────────────────────────────────────────────────────
ACTUAL_MODEL=$(echo "$HTTP_BODY" | jq -r .model)
MODEL_LINE="$ACTUAL_MODEL"
if [[ -n "$MODEL" && "$MODEL" != "$ACTUAL_MODEL" ]]; then
  MODEL_LINE="$ACTUAL_MODEL  (requested: $MODEL — Kong balancer overrides model selection)"
fi

echo ""
echo "Model    : $MODEL_LINE"
echo "Role     : $ROLE"
echo "Session  : $SESSION_ID"
echo ""
echo "Response :"
echo "$HTTP_BODY" | jq -r '.choices[0].message.content'
echo ""
echo "Tokens   : prompt=$(echo "$HTTP_BODY" | jq -r .usage.prompt_tokens) completion=$(echo "$HTTP_BODY" | jq -r .usage.completion_tokens) total=$(echo "$HTTP_BODY" | jq -r .usage.total_tokens)"
