#!/usr/bin/env bash
# aira-judge.sh — LLM-as-Judge demo for AIRA Kong Hackathon
#
# Usage:
#   ./scripts/aira-judge.sh                    # batch-judge 10 recent un-judged events
#   ./scripts/aira-judge.sh --event <event_id> # judge a specific event
#   ./scripts/aira-judge.sh --summary          # show quality score dashboard
#   ./scripts/aira-judge.sh --demo             # full demo: chat → judge → summary

set -euo pipefail

BACKEND="http://localhost:8002"
MODE="batch"
EVENT_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --event)   MODE="single"; EVENT_ID="$2"; shift 2 ;;
    --summary) MODE="summary"; shift ;;
    --demo)    MODE="demo"; shift ;;
    --limit)   LIMIT="$2"; shift 2 ;;
    *) shift ;;
  esac
done
LIMIT="${LIMIT:-10}"

# ── Helpers ───────────────────────────────────────────────────────────────────

hr() { printf '%.0s─' {1..60}; echo; }

print_verdict() {
  local verdict="$1"
  local score
  score=$(echo "$verdict" | jq -r '.score // "?"')
  local v
  v=$(echo "$verdict" | jq -r '.verdict // "?"')
  local color
  case "$v" in
    pass) color="\033[32m" ;;   # green
    flag) color="\033[33m" ;;   # yellow
    fail) color="\033[31m" ;;   # red
    *)    color="\033[0m" ;;
  esac
  printf "  Score: ${color}%.1f/10  Verdict: %s\033[0m\n" "$score" "$v"
  echo "  Reason: $(echo "$verdict" | jq -r '.reason // ""')"
  printf "  Breakdown → relevance:%s  safety:%s  conciseness:%s  cost_efficiency:%s\n" \
    "$(echo "$verdict" | jq -r '.relevance // "?"')" \
    "$(echo "$verdict" | jq -r '.safety // "?"')" \
    "$(echo "$verdict" | jq -r '.conciseness // "?"')" \
    "$(echo "$verdict" | jq -r '.cost_efficiency // "?"')"
}

# ── Modes ─────────────────────────────────────────────────────────────────────

run_single() {
  echo ""
  echo "Judging event: $EVENT_ID"
  hr
  RESULT=$(curl -sf -X POST "${BACKEND}/judge/evaluate/${EVENT_ID}")
  print_verdict "$RESULT"
  echo ""
}

run_batch() {
  echo ""
  echo "Batch judging up to $LIMIT un-graded events..."
  hr
  RESULT=$(curl -sf -X POST "${BACKEND}/judge/batch?limit=${LIMIT}")
  JUDGED=$(echo "$RESULT" | jq -r '.judged')
  echo "Judged: $JUDGED events"
  echo ""
  echo "$RESULT" | jq -r '.results[] | "  [\(.verdict // "error")] \(.event_id[:16])...  score=\(.score // "—")  \(.reason // .reason // "")"'
  echo ""
}

run_summary() {
  echo ""
  echo "Quality Score Summary"
  hr
  RESULT=$(curl -sf "${BACKEND}/judge/summary")

  TOTAL=$(echo "$RESULT" | jq -r '.totals.judged_events')
  AVG=$(echo "$RESULT" | jq -r '.totals.avg_score')
  PASS=$(echo "$RESULT" | jq -r '.totals.pass_count')
  FLAG=$(echo "$RESULT" | jq -r '.totals.flag_count')
  FAIL=$(echo "$RESULT" | jq -r '.totals.fail_count')

  printf "  Total judged : %s events\n" "$TOTAL"
  printf "  Avg score    : %.1f / 10\n" "$AVG"
  printf "  \033[32mPass\033[0m / \033[33mFlag\033[0m / \033[31mFail\033[0m : %s / %s / %s\n" "$PASS" "$FLAG" "$FAIL"
  echo ""
  echo "  By model:"
  echo "$RESULT" | jq -r '.by_model[] | "    \(.model): avg \(.avg_score)/10  (\(.judged_events) judged)"'
  echo ""

  LOW=$(echo "$RESULT" | jq '.low_quality | length')
  if [[ "$LOW" -gt 0 ]]; then
    echo "  Low-quality events (score < 6):"
    echo "$RESULT" | jq -r '.low_quality[] | "    score=\(.quality_score)  model=\(.model)  user=\(.user_id)  event=\(.event_id[:16])..."'
  fi
  echo ""
}

run_demo() {
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║       AIRA  ·  LLM-as-Judge Demo                ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "Step 1: Check for un-judged events in the DB..."
  hr
  UNJUDGED=$(curl -sf "${BACKEND}/usage/events?limit=5" | jq '[.[] | select(.quality_score == null)] | length')
  echo "  Un-judged events available: $UNJUDGED"
  echo ""

  if [[ "$UNJUDGED" -eq 0 ]]; then
    echo "  No un-judged events. Run aira-chat.sh first, wait ~5s for Kong http-log flush, then re-run."
    echo "  Example: ./scripts/aira-chat.sh 'What is the capital of France?'"
    echo ""
    echo "  Note: Kong must be configured to log request/response bodies for full judging."
    echo "  Without bodies, judge endpoint returns 422. Batch will show 0 judged."
    exit 0
  fi

  echo "Step 2: Batch-judge recent events with Claude Haiku..."
  hr
  run_batch

  echo "Step 3: Quality score summary..."
  hr
  run_summary
}

case "$MODE" in
  single)  run_single ;;
  batch)   run_batch ;;
  summary) run_summary ;;
  demo)    run_demo ;;
esac
