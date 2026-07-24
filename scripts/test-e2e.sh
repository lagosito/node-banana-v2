#!/bin/bash
# GEO-Check End-to-End Test — 11 control domains
# Runs Phase 1 (crawl + score) + Phase 2 (3 providers) for each domain
# Usage: ./scripts/test-e2e.sh [--phase1-only] [--domain=DOMAIN]

set -euo pipefail

BASE_URL="${GEO_CHECK_URL:-http://localhost:3000}"
PHASE1_ONLY=false
SINGLE_DOMAIN=""

for arg in "$@"; do
  case $arg in
    --phase1-only) PHASE1_ONLY=true ;;
    --domain=*) SINGLE_DOMAIN="${arg#*=}" ;;
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
echo "GEO-Check E2E Test — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target: ${BASE_URL}"
echo "Domains: ${#DOMAINS[@]}"
echo "Phase 1 only: ${PHASE1_ONLY}"
echo "═══════════════════════════════════════"

RESULTS_DIR="scripts/e2e-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

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

  if [[ "$PHASE1_ONLY == true" ]]; then
    continue
  fi

  if [[ -z "$REPORT_ID" ]]; then
    echo "  ✗ No report ID, skipping Phase 2"
    continue
  fi

  # Phase 2: LLM providers
  echo "  Phase 2: running LLM providers..."
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
    echo "$LLM_BODY" > "${RESULTS_DIR}/${DOMAIN}-phase2-error.json"
    continue
  fi

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

  # Phase 3: Read report (gated)
  REPORT_RESPONSE=$(curl -s --max-time 10 \
    "${BASE_URL}/api/geo-check/report/${REPORT_ID}" 2>/dev/null || echo "{}")
  GATED=$(echo "$REPORT_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('gated','?'))" 2>/dev/null || echo "?")
  echo "  ✓ Report: gated=${GATED}"

  sleep 1  # Rate limit courtesy
done

echo ""
echo "═══════════════════════════════════════"
echo "Results saved to: ${RESULTS_DIR}/"
echo "═══════════════════════════════════════"

# Summary
echo ""
echo "SUMMARY:"
for f in "${RESULTS_DIR}"/*-phase1.json; do
  [[ -f "$f" ]] || continue
  domain=$(basename "$f" | sed 's/-phase1.json//')
  score=$(python3 -c "import sys,json; print(json.load(open('$f')).get('overallScore','?'))" 2>/dev/null || echo "?")
  echo "  ${domain}: score=${score}"
done
