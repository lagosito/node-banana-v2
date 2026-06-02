/**
 * Brand DNA Save + Email Route
 *
 * POST /api/brand-dna/save
 *
 * Saves Brand DNA changes to Airtable and sends a transactional
 * email via Brevo with a summary of the changes and a link to the report.
 *
 * Body:
 *   - clientId: string (Airtable record ID)
 *   - email: string (recipient)
 *   - brandName: string
 *   - tagline: string
 *   - colors: string (comma-separated hex values)
 *   - fonts: string (display + body)
 *   - tone: string
 *   - targetAudience: string
 *   - changes: string (description of what changed)
 */

import { NextRequest, NextResponse } from "next/server";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const AIRTABLE_CLIENTS_TABLE = "tblZ0fnEbWD6zwqR0";
const BREVO_API_URL = "https://api.brevo.com/v3";
const BRAND_DNA_EMAIL_TEMPLATE_ID = 10;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface SaveRequest {
  clientId: string;
  email: string;
  brandName?: string;
  tagline?: string;
  colors?: string;
  fonts?: string;
  tone?: string;
  targetAudience?: string;
  changes?: string;
  brandDnaUrl?: string;
  /** Raw Brand DNA JSON to persist in Airtable (optional) */
  brandDnaData?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const brevoKey = process.env.BREVO_API_KEY;
  const airtableKey = process.env.AIRTABLE_API_KEY;

  if (!brevoKey) {
    return corsJson({ error: "BREVO_API_KEY not configured" }, { status: 500 });
  }
  if (!airtableKey) {
    return corsJson({ error: "AIRTABLE_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body = (await req.json()) as SaveRequest;
    const { clientId, email, brandName, tagline, colors, fonts, tone, targetAudience, changes, brandDnaUrl } = body;
    if (!email || !email.includes("@")) {
      return corsJson({ error: "Valid email required" }, { status: 400 });
    }
    // ── Step 1: Create/update contact in Brevo ──
    try {
      const contactRes = await fetch(`${BREVO_API_URL}/contacts`, {
        method: "POST",
        headers: {
          "api-key": brevoKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          email,
          attributes: {
            FIRSTNAME: brandName || "",
            LASTNAME: "",
            SOURCE: "brand-dna",
          },
          listIds: [],
          updateEnabled: true,
        }),
      });
      if (!contactRes.ok) {
        // 204 = already exists, 400 = duplicate — both are fine
        const status = contactRes.status;
        if (status !== 204 && status !== 400) {
          console.warn("[brand-dna/save] Brevo contact warning:", status);
        }
      }
    } catch (err) {
      console.warn("[brand-dna/save] Brevo contact save failed:", err);
    }

    // ── Step 2: Update Airtable (if clientId provided) ──
    if (clientId) {
      try {
        const patchFields: Record<string, unknown> = { Email: email };
        // Persist Brand DNA data if provided
        if (body.brandDnaData) {
          patchFields["Brand DNA"] = JSON.stringify(body.brandDnaData);
        }
        const airtableRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}/${clientId}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${airtableKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fields: patchFields }),
          }
        );

        if (!airtableRes.ok) {
          const errText = await airtableRes.text();
          console.error("[brand-dna/save] Airtable error:", airtableRes.status, errText);
          // Continue even if Airtable update fails — email is more important
        }
      } catch (err) {
        console.error("[brand-dna/save] Airtable update failed:", err);
      }
    }

    // ── Step 2: Send email via Brevo ──
    const reportUrl = brandDnaUrl || `https://app.elkiosk.ai`;

    const brevoPayload = {
      sender: { name: "el Kiosk", email: "info@elkiosk.ai" },
      to: [{ email, name: brandName || "" }],
      templateId: BRAND_DNA_EMAIL_TEMPLATE_ID,
      params: {
        BRAND_NAME: brandName || "Deine Marke",
        TAGLINE: tagline || "—",
        COLORS: colors || "—",
        FONTS: fonts || "—",
        TONE: tone || "—",
        TARGET_AUDIENCE: targetAudience || "—",
        CHANGES: changes || "Brand DNA aktualisiert",
        BRAND_DNA_URL: reportUrl,
      },
    };

    const brevoRes = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(brevoPayload),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error("[brand-dna/save] Brevo error:", brevoRes.status, errText);
      return corsJson(
        { error: "Failed to send email", details: errText },
        { status: 502 }
      );
    }

    const brevoResult = await brevoRes.json();

    return corsJson({
      success: true,
      message: "Brand DNA saved, contact synced, and email sent",
      emailMessageId: brevoResult.messageId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[brand-dna/save] Error:", message);
    return corsJson({ error: message }, { status: 500 });
  }
}
