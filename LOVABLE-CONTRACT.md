# GEO-Check — Frontend Contract (LOVABLE)

## Overview

Two-step funnel for El Kiosk's GEO visibility check tool.
Public page on elkiosk.ai where prospects enter their website URL and get instant AI visibility results.

---

## Step 1: Quick Check (anonymous, instant)

**Endpoint:** `POST /api/geo-check/quick`

### Request
```json
{
  "website_url": "https://www.example.de",
  "vertical": "Reinigungsmittel Gastronomie",
  "region": "DE",
  "_hp": ""  // honeypot field (must be empty)
}
```

### Response (200 OK)
```json
{
  "brand_mentions": 1,
  "total_runs": 4,
  "top_competitor_mentions": 3
}
```

### Error Responses
- `400` — Missing required fields or invalid URL
- `429` — Rate limit exceeded (5/day per IP)
- `500` — Server error

### UI Requirements
- Form fields: Website URL (text input), Vertical (dropdown), Region (dropdown)
- Submit button: "Jetzt prüfen" (with loading spinner)
- Honeypot field: hidden `_hp` input (anti-bot)
- Results display:
  - Score circle: "X von Y Erwähnungen" (brand mentions / total AI answers)
  - Color: green (≥50%), yellow (25-49%), red (<25%)
  - Competitor bar: "Top-Wettbewerber: X (Z/N)"
  - CTA: "Vollständiges Ergebnis per E-Mail erhalten →"
- Transitions: fade-in results, animated score counter

---

## Step 2: Full Check (with email, async)

**Endpoint:** `POST /api/geo-check/full`

### Request
```json
{
  "website_url": "https://www.example.de",
  "vertical": "Reinigungsmittel Gastronomie",
  "region": "DE",
  "email": "user@example.de",
  "_hp": ""  // honeypot field (must be empty)
}
```

### Response (202 Accepted)
```json
{
  "success": true,
  "message": "Vielen Dank! Wir senden Ihnen die Ergebnisse in Kürze per E-Mail."
}
```

### Error Responses
- `400` — Missing required fields, invalid URL, or invalid email
- `429` — Rate limit exceeded
- `500` — Server error

### UI Requirements
- Email input field (with validation)
- Submit button: "Ergebnisse per E-Mail erhalten" (with loading spinner)
- Honeypot field: hidden `_hp` input (anti-bot)
- Success state: checkmark animation + "Vielen Dank!" message
- Error state: inline error message below form

---

## Dropdown Options

### Verticals (Branche)
```json
[
  { "value": "Wein", "label": "Wein" },
  { "value": "Feinkost", "label": "Feinkost" },
  { "value": "Craft Beer", "label": "Craft Beer" },
  { "value": "Fitness", "label": "Fitness" },
  { "value": "Gastro", "label": "Gastro" }
]
```

### Regions
```json
[
  { "value": "DE", "label": "Deutschland" },
  { "value": "AT", "label": "Österreich" },
  { "value": "CH", "label": "Schweiz" },
  { "value": "DACH", "label": "DACH (alle)" }
]
```

---

## Design Specs

### Colors
- Primary: `#186af8` (El Kiosk blue)
- Background: `#ffffff`
- Text: `#3b3f44`
- Muted: `#858588`
- Success: `#22c55e`
- Warning: `#f59e0b`
- Error: `#ef4444`

### Typography
- Font: Inter (or system font stack)
- Headings: 600 weight
- Body: 400 weight, 16px, line-height 1.5

### Layout
- Max width: 500px (matches email template)
- Centered on page
- Mobile-first responsive
- Card-based design with subtle shadows

### Animations
- Score counter: count-up animation (0 → X over 1s)
- Results: fade-in + slide-up (300ms ease-out)
- Button loading: pulsing dots or spinner
- Success state: checkmark scale-in

---

## Brand Name

The API returns the **real brand name** extracted from the website's `<title>` or `og:title` tag (e.g., "Weingut Dr. Bürklin-Wolf"), not a slug derived from the domain. Use this name in all UI text.

---

## Email Template

The email sent after Step 2 uses this structure:
- Header GIF (El Kiosk branding)
- Body: "Ihr GEO-Check" heading
- Results box: mentions count, competitor, context line
- CTA button: "GEO-Audit anfragen" (mailto:info@elkiosk.ai)
- Offer text: 390 EUR, PDF report
- Footer GIF

**Subject line:** `Ihr GEO-Check: {Brand} vs. {Competitor}`

---

## CORS

Both endpoints return:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Frontend can call from any origin (including Lovable preview URLs).

---

## Environment Variables (required in Vercel)

| Variable | Purpose | Status |
|----------|---------|--------|
| `BREVO_API_KEY` | Transactional email | ✅ Required |
| `AIRTABLE_API_KEY` | Audit record storage | ✅ Required |
| `GEMINI_API_KEY` | AI provider (Gemini) | ⚠️ Optional (Perplexity fallback) |
| `OPENROUTER_API_KEY` | AI provider (Perplexity) | ✅ Required |
| `SLACK_WEBHOOK_URL` | Internal notifications | ⚠️ Optional |
| `GEO_AUDIT_BASE_ID` | Airtable base (default: appL4ES7bjExT6908) | ⚠️ Optional |

---

## Error Handling

- All errors return `{ error: "German error message" }` with appropriate HTTP status
- Network errors: show "Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut."
- Rate limit: show "Zu viele Anfragen. Bitte versuchen Sie es morgen erneut."
- Invalid email: show "Bitte geben Sie eine gültige E-Mail-Adresse ein."

---

## Testing

Quick test:
```bash
curl -X POST http://localhost:3000/api/geo-check/quick \
  -H "Content-Type: application/json" \
  -d '{"website_url":"https://www.buerklin-wolf.de","vertical":"Reinigungsmittel Gastronomie","region":"DE"}'
```

Full test:
```bash
curl -X POST http://localhost:3000/api/geo-check/full \
  -H "Content-Type: application/json" \
  -d '{"website_url":"https://www.buerklin-wolf.de","vertical":"Reinigungsmittel Gastronomie","region":"DE","email":"test@example.de"}'
```
