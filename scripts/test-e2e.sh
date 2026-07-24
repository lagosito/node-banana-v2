#!/bin/bash
# GEO-Check E2E Test v2 — Phase 1 all 11, Phase 2 only 4 (Gemini quota safe)
# Usage: ./scripts/test-e2e.sh [--phase1-only] [--domain=DOMAIN] [--phase2-domains=4]

set -euo pipefail

BASE_URL="${GEO_CHECK_URL:-http://localhost:3000}"
PHASE1_ONLY=false
SINGLE_DOMAIN=""
PHASE2_COUNT=4  # Gemini quota: 20/day, 4 domains × 4 questions = 16 calls

for arg in "$@"; do
  case $arg in
    --phase1-only) PHASE1_ONLY=true ;;
    --domain=*) SINGLE_DOMAIN="${arg#*=}" ;;
    --phase2-domains=*) PHASE2_COUNT="${arg#*=}" ;;
  esac
done

DOMAINS=(
  "stripe.com"
  "example.com"
  "buerklin-wolf.de"
  "schlenkerla.de"
  "schwarzwaldmilch.de"
  "weingut-kranz.de"
  "lieken.de"
  "frankenwein.de"
  "stuckateur-berlin.de"
  "lammsbraeu.de"
  "heise.de"
)

echo "═══════════════════════════════════════"
echo "GEO-Check E2E Test v2 — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target: ${BASE_URL}"
echo "Phase 1: ALL ${#DOMAINS[@]} domains"
echo "Phase 2: ${PHASE2_COUNT} domains (Gemini quota safe)"
echo "═══════════════════════════════════════"

RESULTS_DIR="scripts/e2e-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

PHASE2_DONE=0
REPORT_IDS=()

for domain in "${DOMAINS[@]}"; do
  if [[ -n "$SINGLE_DOMAIN" && "$domain" != "$SINGLE_DOMAIN" ]]; then
    continue
  fi

  echo ""
  echo "── ${domain} ──"

  # Phase 1: Crawl + Score
  echo "  Phase 1: crawling..."
  START=$(date +%s%N)
  RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 60 \
    -X POST "${BASE_URL}/api/geo-check/quick" \
    -H "Content-Type: application/json" \
    -d "{\"website_url\": \"https://${domain}\"}")
  END=$(date +%s%N)
  ELAPSED_MS=$(( (END - START) / 1000000 ))

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "  ✗ Phase 1 failed: HTTP ${HTTP_CODE}"
    echo "$BODY" > "${RESULTS_DIR}/${domain}-phase1-error.json"
    continue
  fi

  REPORT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('reportId',''))" 2>/dev/null || echo "")
  SHORT_SLUG=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('shortSlug',''))" 2>/dev/null || echo "")
  OVERALL_SCORE=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('overallScore',''))" 2>/dev/null || echo "")
  STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")

  echo "  ✓ Phase 1: ${ELAPSED_MS}ms | score=${OVERALL_SCORE} | status=${STATUS} | id=${REPORT_ID}"
  echo "$BODY" > "${RESULTS_DIR}/${domain}-phase1.json"

  if [[ "$PHASE1_ONLY == true" || -z "$REPORT_ID" ]]; then
    continue
  fi

  # Phase 2: LLM providers (only first N domains)
  if [[ $PHASE2_DONE -lt $PHASE2_COUNT ]]; then
    echo "  Phase 2: running LLM providers (${PHASE2_DONE}/${PHASE2_COUNT})..."
    START=$(date +%s%N)
    LLM_RESPONSE=$(curl -s -w "\n%{http_code}" --max-time 90 \
      -X POST "${BASE_URL}/api/geo-check/llm" \
      -H "Content-Type: application/json" \
      -d "{\"reportId\": \"${REPORT_ID}\"}")
    END=$(date +%s%N)
    ELAPSED_MS=$(( (END - START) / 1000000 ))

    LLM_HTTP=$(echo "$LLM_RESPONSE" | tail -1)
    LLM_BODY=$(echo "$LLM_RESPONSE" | sed '$d')

    if [[ "$LLM_HTTP" != "200" ]]; then
      echo "  ✗ Phase 2 failed: HTTP ${LLM_HTTP}"
      echo "$LLM_BODY" > "${RESULTS_DIR}/${domain}-phase2-error.json"
    else
      LLM_STATUS=$(echo "$LLM_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
      PROVIDER_STATUS=$(echo "$LLM_BODY" | python3 -c "
import sys,json
d = json.load(sys.stdin)
ps = d.get('providerStatus',{})
parts = []
for p in ['gemini','openai','perplexity']:
    s = ps.get(p,{}).get('status','?')
    parts.append(f'{p}={s}')
print(' | '.join(parts))
" 2>/dev/null || echo "parse error")

      echo "  ✓ Phase 2: ${ELAPSED_MS}ms | status=${LLM_STATUS} | ${PROVIDER_STATUS}"
      echo "$LLM_BODY" > "${RESULTS_DIR}/${domain}-phase2.json"
      REPORT_IDS+=("${REPORT_ID}")
    fi

    PHASE2_DONE=$((PHASE2_DONE + 1))
    sleep 2  # Rate limit courtesy between providers
  else
    echo "  Phase 2: skipped (quota limit: ${PHASE2_COUNT} domains)"
  fi

  # Phase 3: Read report (gated)
  REPORT_RESPONSE=$(curl -s --max-time 10 \
    "${BASE_URL}/api/geo-check/report/${REPORT_ID}" 2>/dev/null || echo "{}")
  GATED=$(echo "$REPORT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('gated','?'))" 2>/dev/null || echo "?")
  echo "  ✓ Report: gated=${GATED}"

  sleep 1
done

echo ""
echo "═══════════════════════════════════════"
echo "Results saved to: ${RESULTS_DIR}/"
echo "Phase 1: ${#DOMAINS[@]} domains crawled"
echo "Phase 2: ${PHASE2_DONE} domains with LLM"
echo "═══════════════════════════════════════"

# Summary table
echo ""
echo "SUMMARY:"
echo "Domain                  | Score | Phase 2 | Status"
echo "------------------------|-------|---------|-------"
for f in "${RESULTS_DIR}"/*-phase1.json; do
  [[ -f "$f" ]] || continue
  domain=$(basename "$f" | sed 's/-phase1.json//')
  score=$(python3 -c "import sys,json; print(json.load(open('$f')).get('overallScore','?'))" 2>/dev/null || echo "?")
  has_phase2="no"
  [[ -f "${RESULTS_DIR}/${domain}-phase2.json" ]] && has_phase2="yes"
  status=$(python3 -c "import sys,json; print(json.load(open('${RESULTS_DIR}/${domain}-phase1.json')).get('status','?'))" 2>/dev/null || echo "?")
  printf "%-24s| %-5s | %-7s | %s\n" "$domain" "$score" "$has_phase2" "$status"
done
