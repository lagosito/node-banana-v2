/**
 * Airtable Clients API Route
 * Fetches client list with Brand DNA from El Kiosk - Brand DNA base
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const CLIENTS_TABLE_ID = "tblZ0fnEbWD6zwqR0";

interface AirtableRecord {
  id: string;
  fields: {
    "Client Name"?: string;
    "First Name"?: string;
    Email?: string;
    Website?: string;
    Status?: string;
    "Brand DNA"?: string;
    brand_logo_url?: string;
    Customizations?: string;
  };
}

export interface ClientInfo {
  id: string;
  name: string;
  website: string;
  status: string;
  brandDna: {
    brandName: string;
    website: string;
    primaryColor?: string;
    secondaryColor?: string;
    brandColors?: string[];
    brandFonts?: string[];
    brandTone?: string;
    targetAudience?: string;
    industry?: string;
    logoUrl?: string;
  } | null;
  logoUrl: string | null;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AIRTABLE_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all records (paginated if needed)
    let allRecords: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      const url = new URL(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${CLIENTS_TABLE_ID}`
      );
      url.searchParams.set("maxRecords", "100");
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[Airtable] API error:", res.status, err);
        return NextResponse.json(
          { error: `Airtable API error: ${res.status}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    // Deduplicate by client name (keep first occurrence)
    const seen = new Set<string>();
    const clients: ClientInfo[] = [];

    for (const record of allRecords) {
      const name = record.fields["Client Name"]?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      let brandDna = null;
      try {
        if (record.fields["Brand DNA"]) {
          brandDna = JSON.parse(record.fields["Brand DNA"]);
        }
      } catch {
        // Brand DNA is not valid JSON, skip
      }

      clients.push({
        id: record.id,
        name,
        website: record.fields.Website || "",
        status: record.fields.Status || "Lead",
        brandDna,
        logoUrl: record.fields.brand_logo_url || brandDna?.logoUrl || null,
      });
    }

    // Sort: Active first, then alphabetically
    clients.sort((a, b) => {
      if (a.status === "Active" && b.status !== "Active") return -1;
      if (b.status === "Active" && a.status !== "Active") return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ clients });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch clients";
    console.error("[Airtable] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
