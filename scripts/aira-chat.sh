#!/usr/bin/env bash
# aira-chat.sh — Send a message to an LLM through the AIRA Kong AI Gateway
#
# Usage:
#   ./scripts/aira-chat.sh "Your message here"
#   ./scripts/aira-chat.sh "Your message here" --provider openrouter --model google/gemini-pro-1.5
#   ./scripts/aira-chat.sh "Your message here" --provider anthropic
#   ./scripts/aira-chat.sh "Your message here" --role finops
#
# Options:
#   --provider  anthropic | openai | openrouter  (default: anthropic)
#   --model     model name to pass to the provider (only used for openrouter, e.g. google/gemini-pro-1.5)
#   --role      engineering | finops | admin | datascience  (default: engineering)

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
KONG_PROXY="http://localhost:8000"
IDP_URL="http://localhost:8080/default/token"
CLIENT_ID="aira-local"
CLIENT_SECRET="aira-secret"
PROVIDER="anthropic"
ROLE="engineering"
MODEL=""

# ── Parse args ───────────────────────────────────────────────────────────────
MESSAGE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --provider) PROVIDER="$2"; shift 2 ;;
    --role)     ROLE="$2";     shift 2 ;;
    --model)    MODEL="$2";    shift 2 ;;
    *)          MESSAGE="$1";  shift   ;;
  esac
done

if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $0 \"Your message\" [--provider anthropic|openai|openrouter] [--model <model-name>] [--role engineering|finops|admin|datascience]"
  exit 1
fi

# ── Get JWT token ────────────────────────────────────────────────────────────
TOKEN=$(curl -sf -X POST "$IDP_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=${ROLE}" \
  | jq -r .access_token)

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "Error: failed to get token from IdP (is mock-oauth2 running?)"
  exit 1
fi

# ── Build request body ───────────────────────────────────────────────────────
BODY=$(jq -n \
  --argjson content "$(echo "$MESSAGE" | jq -Rs .)" \
  --arg model "$MODEL" \
  '{messages: [{role: "user", content: $content}]} + (if $model != "" then {model: $model} else {} end)')

# ── Call Kong AI Gateway ──────────────────────────────────────────────────────
RESPONSE=$(curl -sf -X POST "${KONG_PROXY}/${PROVIDER}/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

# ── Print result ─────────────────────────────────────────────────────────────
echo ""
echo "Provider : $PROVIDER"
echo "Model    : $(echo "$RESPONSE" | jq -r .model) ${MODEL:+(requested: $MODEL)}"
echo "Role     : $ROLE"
echo ""
echo "Response :"
echo "$RESPONSE" | jq -r '.choices[0].message.content'
echo ""
echo "Tokens   : prompt=$(echo "$RESPONSE" | jq -r .usage.prompt_tokens) completion=$(echo "$RESPONSE" | jq -r .usage.completion_tokens) total=$(echo "$RESPONSE" | jq -r .usage.total_tokens)"
