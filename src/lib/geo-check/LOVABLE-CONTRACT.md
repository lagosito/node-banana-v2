# GEO-Check Frontend Contract (for Lovable)

## Overview
Two-step funnel: quick check (anonymous, instant results) → full check (with email, async processing).

**Backend URL:** `https://node-banana-v2.vercel.app`

---

## Step 1: Quick Check

### POST `/api/geo-check/quick`

**Request:**
```json
{
  "website_url": "https://www.buerklin-wolf.de",
  "vertical": "Wein",
  "region": "Pfalz",
  "_hp": ""  // honeypot: hidden field, leave empty
}
```

**Response 200:**
```json
{
  "brand_mentions": 0,
  "total_runs": 4,
  "top_competitor_mentions": 2
}
```

**Error Responses:**
- `400` — Missing fields or invalid URL/domain unreachable
- `429` — Rate limit exceeded (5 per day per IP)

**Frontend behavior:**
- Show results inline: "Ihre Marke wurde in X von Y KI-Antworten erwähnt"
- Show CTA: "Vollständigen Check anfordern" → expands Step 2 form
- Honeypot: hidden input field `_hp` that bots fill, humans don't

---

## Step 2: Full Check (with email)

### POST `/api/geo-check/full`

**Request:**
```json
{
  "website_url": "https://www.buerklin-wolf.de",
  "vertical": "Wein",
  "region": "Pfalz",
  "email": "user@example.com",
  "_hp": ""  // honeypot
}
```

**Response 202:**
```json
{
  "success": true,
  "message": "Vielen Dank! Wir senden Ihnen die Ergebnisse in Kürze per E-Mail."
}
```

**Error Responses:**
- `400` — Missing fields or invalid email
- `400` — Domain unreachable

**Frontend behavior:**
- After 202: show thank-you message
- Email arrives within ~30 seconds with full results

---

## Form Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `website_url` | text input | ✅ | Placeholder: "https://ihre-website.de" |
| `vertical` | select | ✅ | Options: Wein, Feinkost, Craft Beer, Fitness, Gastro, Beauty, Sonstiges |
| `region` | text input | ✅ | Placeholder: "z.B. Pfalz, Hamburg" |
| `email` | email input | Step 2 only | Validated client-side |
| `_hp` | hidden input | — | Must be empty (honeypot) |

---

## UX Flow

```
[Step 1 Form]
  URL + Vertical + Region + [Prüfen] button
  
  ↓ (after ~18s)
  
[Results inline]
  "Ihre Marke wurde in 0 von 4 KI-Antworten erwähnt"
  "Ihr stärkster Konkurrent: [Name] mit [X] Erwähnungen"
  
  [Vollständigen Check anfordern] button
  
  ↓
  
[Step 2 Form - expands]
  Email field + [Jetzt anfordern] button
  
  ↓ (after ~202)
  
[Thank you]
  "Vielen Dank! Die Ergebnisse kommen per E-Mail."
```

---

## CORS
All endpoints return `Access-Control-Allow-Origin: *` — safe for Lovable frontend.

## Rate Limiting
- 5 quick checks per IP per day
- Same domain cached for 30 days (no duplicate API calls)

## Notes
- Quick check takes ~18 seconds (2 providers × 2 prompts)
- Full check runs async, email arrives separately
- Brand name is auto-extracted from domain (e.g., "buerklin-wolf.de" → "Buerklin Wolf")
