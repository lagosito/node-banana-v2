#!/bin/bash
# GEO-Check Debug Test — Run 11 control domains against preview
# Usage: ./test-debug.sh <PREVIEW_URL> <DEBUG_SECRET>

set -euo pipefail

URL="${1:?Usage: ./test-debug.sh <PREVIEW_URL> <DEBUG_SECRET>}"
SECRET="${2:?Usage: ./test-debug.sh <PREVIEW_URL> <DEBUG_SECRET>}"
OUTDIR="debug-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTDIR"

echo "Preview: $URL"
echo "Output:  $OUTDIR/"
echo "---"

# Control domains — con tipo de control y resultado esperado
# Formato: domain|expected_brand|vertical|region|control_type|expected_result
declare -a DOMAINS=(
  "stripe.com|Stripe|FinTech|Global|fuera_de_vertical|0 menciones, score bajo"
  "example.com|Example|Wein|Pfalz|edge_case_tecnico|0 menciones, crawl parcial declarado"
  "buerklin.de|Bürklin|Wein|Pfalz|fuera_de_vertical|0 menciones de vertical Wein"
  "schlenkerla.de|Schlenkerla|Wein|Franken|fuera_de_vertical|0 menciones de vertical Wein"
  "schwarzwaldmilch.de|Schwarzwaldmilch|Feinkost|Baden|fuera_de_vertical|0 menciones de vertical Feinkost"
  "weingut-kranz.de|Weingut Kranz|Wein|Pfalz|bodega_real|mención posible (2-4 runs)"
  "lieken.de|Lieken|Wein|Pfalz|fuera_de_vertical|0 menciones de vertical Wein"
  "frankenwein.de|Frankenwein|Wein|Franken|parked_domain|0 menciones, crawl parcial declarado"
  "stuckateur.de|Stuckateur|Wein|Pfalz|fuera_de_vertical|0 menciones de vertical Wein"
  "lammsbraeu.de|Lamm Bräu|Wein|Pfalz|fuera_de_vertical|0 menciones de vertical Wein"
  "oekonomierat-rebholz.com|Ökonomierat Rebholz|Wein|Pfalz|bodega_real|mención posible (2-4 runs)"
)

echo "domain|brandName|aliases|brandMentions|totalRuns|topCompetitor|providers|control_type|expected_result|pass" > "$OUTDIR/summary.csv"

for entry in "${DOMAINS[@]}"; do
  IFS='|' read -r domain expected_name vertical region control_type expected <<< "$entry"
  echo ""
  echo "=== $domain ($expected_name) [$control_type] ==="
  
  PAYLOAD=$(cat <<EOF
{
  "website_url": "https://$domain",
  "vertical": "$vertical",
  "region": "$region"
}
EOF
)
  
  RESP=$(curl -s -w "\n%{http_code}" \
    -X POST "$URL/api/geo-check/debug" \
    -H "Content-Type: application/json" \
    -H "x-debug-secret: $SECRET" \
    -d "$PAYLOAD" 2>&1)
  
  HTTP_CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  
  echo "HTTP $HTTP_CODE"
  
  if [ "$HTTP_CODE" = "200" ]; then
    echo "$BODY" | python3 -m json.tool > "$OUTDIR/${domain}.json" 2>/dev/null || echo "$BODY" > "$OUTDIR/${domain}.json"
    
    BRAND=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('brandName','?'))" 2>/dev/null || echo "?")
    ALIASES=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(';'.join(d.get('aliases',[])))" 2>/dev/null || echo "?")
    MENTIONS=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('brandMentions',0))" 2>/dev/null || echo "?")
    TOTAL=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalRuns',0))" 2>/dev/null || echo "?")
    COMP=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('topCompetitor',''))" 2>/dev/null || echo "?")
    PROVS=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(set(r['provider'] for r in d.get('llm_results',[]))))" 2>/dev/null || echo "?")
    
    # Determine pass/fail based on control type
    if [ "$control_type" = "bodega_real" ]; then
      if [ "$MENTIONS" -gt 0 ] 2>/dev/null; then
        PASS="✅ PASS"
      else
        PASS="⚠️ INVESTIGATE"
      fi
    elif [ "$control_type" = "parked_domain" ] || [ "$control_type" = "edge_case_tecnico" ]; then
      if [ "$MENTIONS" = "0" ] 2>/dev/null; then
        PASS="✅ PASS"
      else
        PASS="❌ UNEXPECTED"
      fi
    elif [ "$control_type" = "fuera_de_vertical" ]; then
      if [ "$MENTIONS" = "0" ] 2>/dev/null; then
        PASS="✅ PASS"
      else
        PASS="⚠️ CROSS-VERTICAL"
      fi
    else
      PASS="?"
    fi
    
    echo "  brand: $BRAND"
    echo "  aliases: $ALIASES"
    echo "  mentions: $MENTIONS/$TOTAL"
    echo "  top competitor: $COMP"
    echo "  providers: $PROVS"
    echo "  control: $control_type → $PASS"
    
    echo "$domain|$BRAND|$ALIASES|$MENTIONS|$TOTAL|$COMP|$PROVS|$control_type|$expected|$PASS" >> "$OUTDIR/summary.csv"
  else
    echo "  ERROR: $BODY"
    echo "$domain|ERROR|$HTTP_CODE||||$control_type|$expected|❌ ERROR" >> "$OUTDIR/summary.csv"
  fi
  
  sleep 2
done

echo ""
echo "=== SUMMARY TABLE ==="
echo ""
printf "%-30s %-20s %-8s %-8s %-20s %-10s\n" "DOMAIN" "BRAND" "MENTIONS" "TOTAL" "CONTROL TYPE" "PASS"
printf "%-30s %-20s %-8s %-8s %-20s %-10s\n" "---" "---" "---" "---" "---" "---"
tail -n +2 "$OUTDIR/summary.csv" | while IFS='|' read -r domain brand aliases mentions total comp provs ctrl expected pass; do
  printf "%-30s %-20s %-8s %-8s %-20s %-10s\n" "$domain" "${brand:0:20}" "$mentions" "$total" "$ctrl" "$pass"
done

echo ""
echo "Full results (JSON per domain) in: $OUTDIR/"
echo "CSV: $OUTDIR/summary.csv"
