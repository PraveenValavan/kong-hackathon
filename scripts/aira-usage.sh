#!/usr/bin/env bash
# aira-usage.sh — Query the AIRA usage & cost backend
#
# Usage:
#   ./scripts/aira-usage.sh <command> [options]
#
# Commands:
#   dashboard          Full cost overview (all sections)
#   events             Raw request log
#   sessions           Sessions grouped by GUID
#   session <id>       Detail for one session
#   cost-by-user       Cost ranked by user
#   cost-user <id>     Cost detail for one user
#   cost-by-dept       Cost ranked by department
#   cost-dept <dept>   Cost detail for one department
#   db                 Open SQLite shell inside the container
#
# Filters (apply to most commands):
#   --since      YYYY-MM-DD
#   --until      YYYY-MM-DD
#   --user       user_id
#   --dept       department
#   --provider   anthropic | openai | gemini
#   --session    session_id
#   --limit      number (default: 50)

set -euo pipefail

BASE="http://localhost:8002"

# ── Parse command ─────────────────────────────────────────────────────────────
CMD="${1:-help}"; shift || true

# ── Parse flags ───────────────────────────────────────────────────────────────
SINCE=""; UNTIL=""; USER_ID=""; DEPT=""; PROVIDER=""; SESSION_ID=""; LIMIT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --since)    SINCE="$2";      shift 2 ;;
    --until)    UNTIL="$2";      shift 2 ;;
    --user)     USER_ID="$2";    shift 2 ;;
    --dept)     DEPT="$2";       shift 2 ;;
    --provider) PROVIDER="$2";   shift 2 ;;
    --session)  SESSION_ID="$2"; shift 2 ;;
    --limit)    LIMIT="$2";      shift 2 ;;
    *)          POSITIONAL="$1"; shift   ;;
  esac
done

# ── Build query string ────────────────────────────────────────────────────────
qs() {
  local q=""
  [[ -n "$SINCE" ]]      && q+="&since=${SINCE}"
  [[ -n "$UNTIL" ]]      && q+="&until=${UNTIL}"
  [[ -n "$USER_ID" ]]    && q+="&user_id=${USER_ID}"
  [[ -n "$DEPT" ]]       && q+="&department=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DEPT}'))")"
  [[ -n "$PROVIDER" ]]   && q+="&provider=${PROVIDER}"
  [[ -n "$SESSION_ID" ]] && q+="&session_id=${SESSION_ID}"
  [[ -n "$LIMIT" ]]      && q+="&limit=${LIMIT}"
  echo "${q:1}"  # strip leading &
}

get() {
  local url="$1"
  local q; q=$(qs)
  [[ -n "$q" ]] && url="${url}?${q}"
  curl -sf "$url" | jq .
}

# ── Commands ──────────────────────────────────────────────────────────────────
case "$CMD" in

  dashboard)
    echo "▶ Dashboard $([ -n "$(qs)" ] && echo "($(qs))" || echo "(all time)")"
    get "${BASE}/usage/dashboard"
    ;;

  events)
    echo "▶ Events"
    get "${BASE}/usage/events"
    ;;

  sessions)
    echo "▶ Sessions"
    get "${BASE}/usage/sessions"
    ;;

  session)
    ID="${POSITIONAL:-}"
    if [[ -z "$ID" ]]; then echo "Usage: $0 session <session-id>"; exit 1; fi
    echo "▶ Session: $ID"
    curl -sf "${BASE}/usage/sessions/${ID}" | jq .
    ;;

  cost-by-user)
    echo "▶ Cost by user"
    get "${BASE}/usage/cost/by-user"
    ;;

  cost-user)
    ID="${POSITIONAL:-}"
    if [[ -z "$ID" ]]; then echo "Usage: $0 cost-user <user-id>"; exit 1; fi
    echo "▶ Cost for user: $ID"
    Q=$(qs); URL="${BASE}/usage/cost/by-user/${ID}"
    [[ -n "$Q" ]] && URL="${URL}?${Q}"
    curl -sf "$URL" | jq .
    ;;

  cost-by-dept)
    echo "▶ Cost by department"
    get "${BASE}/usage/cost/by-department"
    ;;

  cost-dept)
    DEPT_ARG="${POSITIONAL:-$DEPT}"
    if [[ -z "$DEPT_ARG" ]]; then echo "Usage: $0 cost-dept <department>"; exit 1; fi
    echo "▶ Cost for department: $DEPT_ARG"
    ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${DEPT_ARG}'))")
    Q=$(qs); URL="${BASE}/usage/cost/by-department/${ENCODED}"
    [[ -n "$Q" ]] && URL="${URL}?${Q}"
    curl -sf "$URL" | jq .
    ;;

  db)
    echo "▶ Opening SQLite shell (type .quit to exit)"
    docker exec -it aira-backend sqlite3 /data/aira-usage.db \
      -cmd ".headers on" -cmd ".mode column"
    ;;

  help|*)
    cat <<'EOF'
AIRA Usage Script

Commands:
  dashboard                  Full cost overview
  events                     Raw request log
  sessions                   All sessions
  session   <id>             Detail for one session
  cost-by-user               All users ranked by cost
  cost-user <user-id>        Cost detail for one user
  cost-by-dept               All departments ranked by cost
  cost-dept <department>     Cost detail for one department
  db                         Open SQLite shell in the container

Filters (combine freely):
  --since 2026-04-01         From date
  --until 2026-04-30         To date
  --user  engineer-001       Filter by user
  --dept  "R&D"              Filter by department
  --provider anthropic       Filter by LLM provider
  --limit 20                 Max rows returned

Examples:
  ./scripts/aira-usage.sh dashboard
  ./scripts/aira-usage.sh dashboard --since 2026-04-01 --dept "R&D"
  ./scripts/aira-usage.sh cost-by-user --since 2026-04-01
  ./scripts/aira-usage.sh cost-user engineer-001
  ./scripts/aira-usage.sh cost-dept Finance --since 2026-04-26
  ./scripts/aira-usage.sh session FD41C6A4-C493-48B1-945C-FC66F41679C0
  ./scripts/aira-usage.sh events --user finops-001 --limit 10
  ./scripts/aira-usage.sh db
EOF
    ;;
esac
