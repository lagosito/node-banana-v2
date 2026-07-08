# GEO-Check E-Mail Template (German, formal Sie)

## Betreff
```
Ihr GEO-Check: {BrandName} vs. {TopCompetitor}
```

## Körper (HTML)

### Fall: Marke sichtbar (≥50% Erwähnungen)

```html
<h2>Ihr GEO-Check: {BrandName}</h2>

<p>Gute Nachrichten: <strong>{BrandName}</strong> ist in unseren Tests bereits gut sichtbar.</p>

<p><strong>{BrandName}</strong> wurde in {brandMentions} von {totalRuns} KI-Antworten erwähnt. Das ist ein solider Wert.</p>

<p>Möchten Sie herausfinden, wie Sie noch sichtbarer werden können?</p>

<a href="mailto:info@elkiosk.ai?subject=GEO-Audit%20für%20{BrandName}">
  Vollständiges GEO-Audit anfragen
</a>

<p style="font-size: 14px; color: #666;">
  Das vollständige GEO-Audit umfasst 5 konkrete Handlungsempfehlungen und eine detaillierte Wettbewerbsanalyse.
  Preis: 390 EUR (einmalig).
</p>

<hr>
<p style="font-size: 12px; color: #999;">
  el Kiosk · info@elkiosk.ai · elkiosk.ai
</p>
```

### Fall: Marke wenig sichtbar (<50% Erwähnungen)

```html
<h2>Ihr GEO-Check: {BrandName}</h2>

<p>Wir haben getestet, wie sichtbar <strong>{BrandName}</strong> in KI-Antworten ist – und dabei haben wir interessante Ergebnisse gefunden.</p>

<p><strong>{BrandName}</strong> wurde in {brandMentions} von {totalRuns} KI-Antworten erwähnt. Zum Vergleich: <strong>{TopCompetitor}</strong> taucht in {topCompetitorMentions} Fällen auf.</p>

<p>Möchten Sie wissen, wie Sie die Sichtbarkeit steigern können?</p>

<a href="mailto:info@elkiosk.ai?subject=GEO-Audit%20für%20{BrandName}">
  Vollständiges GEO-Audit anfragen
</a>

<p style="font-size: 14px; color: #666;">
  Das vollständige GEO-Audit umfasst 5 konkrete Handlungsempfehlungen und eine detaillierte Wettbewerbsanalyse.
  Preis: 390 EUR (einmalig).
</p>

<hr>
<p style="font-size: 12px; color: #999;">
  el Kiosk · info@elkiosk.ai · elkiosk.ai
</p>
```

## Variablen
- `{BrandName}` — Markenname (aus Domain extrahiert)
- `{brandMentions}` — Anzahl Erwähnungen in KI-Antworten
- `{totalRuns}` — Gesamtzahl getesteter KI-Antworten
- `{TopCompetitor}` — Name des sichtbarsten Konkurrenten
- `{topCompetitorMentions}` — Erwähnungen des Konkurrenten

## Hinweise
- Kein Score, keine Findings, keine zitierten Domains → das ist das Audit
- CTA immer gleiche Adresse: info@elkiosk.ai
- Preis: 390 EUR (einmalig)
- Sprache: Deutsch, formal Sie
