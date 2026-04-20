/**
 * El Kiosk - Client Brand DNA API Route
 *
 * Reads client data from Airtable and returns Brand DNA
 * for injecting into Node Banana workflow templates.
 *
 * GET /api/client?name=ClientName
 * GET /api/client  (returns all clients list)
 *
 * IMPORTANT: Airtable's filterByFormula does NOT resolve field IDs.
 * We must use field NAMES inside {} in formulas. The API response also
 * keys fields by name (not ID) unless returnFieldsByFieldId=true is passed.
 */

import { NextRequest, NextResponse } from "next/server";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const AIRTABLE_CLIENTS_TABLE = "tblZ0fnEbWD6zwqR0";
const AIRTABLE_BRAND_DNA_TABLE = "tbl1OX9uas15XkE5F";

// Field NAMES (as they appear in Airtable UI).
// We use names in filterByFormula and when reading fields from the response.
// See debug endpoint /api/client/debug for why field IDs don't work in formulas.
const CLIENT_FIELDS = {
  clientName: "Client Name",
  firstName: "First Name",
  email: "Email",
  website: "Website",
  status: "Status",
  brandLogoUrl: "brand_logo_url",
  brandDNA: "Brand DNA",
};

const BRAND_DNA_FIELDS = {
  clientName: "Client Name",
  logo: "Logo",
  primaryColor: "Primary Color",
  secondaryColor: "Secondary Color",
  accentColor: "Accent Color",
  darkColor: "Dark Color",
  lightColor: "Light Color",
  displayFont: "Display Font",
  bodyFont: "Body Font",
  tagline: "Tagline",
  toneTags: "Tone Tags",
  aestheticTags: "Aesthetic Tags",
  dos: "Do's",
  donts: "Don'ts",
};

/**
 * Brand DNA parsed from the JSON string stored in the Clients table.
 * The Clients table has a "Brand DNA" column containing JSON, which
 * we parse to extract structured brand info.
 */
interface BrandDNAJson {
  brandName?: string;
  website?: string;
  brandEssence?: string;
  colors?: Array<{ hex: string; light?: boolean; name?: string }>;
  fonts?: { display?: string; body?: string };
  values?: string[];
  aesthetic?: string[];
  tones?: string[];
  businessOverview?: string;
  logoUrl?: string;
  logoBgColor?: string;
  aiBriefing?: string;
  targetAudience?: string;
  contentOpportunities?: string;
  positioning?: string;
  platforms?: string;
  contentStrategy?: string;
  instagramHandle?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ClientBrandDNA {
  clientName: string;
  firstName: string;
  email: string;
  website: string;
  status: string;
  brandLogoUrl: string;
  customizations: string;
  // Brand DNA (flattened from JSON for easy UI consumption)
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  darkColor: string;
  lightColor: string;
  displayFont: string;
  bodyFont: string;
  tagline: string;
  toneTags: string;
  aestheticTags: string;
  dos: string;
  donts: string;
  // Extra narrative fields from the JSON Brand DNA
  brandEssence: string;
  businessOverview: string;
  aiBriefing: string;
  targetAudience: string;
  positioning: string;
  platforms: string;
  instagramHandle: string;
}

interface AirtableRecord {
  id: string;
  createdTime: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>;
}

async function airtableFetch(url: string) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable error ${res.status}: ${err}`);
  }

  return res.json();
}

/**
 * Parses the "Brand DNA" JSON string stored in the Clients table.
 * Returns null if the string is missing or invalid JSON.
 */
function parseBrandDNAField(raw: unknown): BrandDNAJson | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw) as BrandDNAJson;
  } catch {
    return null;
  }
}

/**
 * Fetches all records for a table, following pagination until no more offset.
 * Airtable caps each page at 100 records.
 */
async function fetchAllRecords(tableId: string, extraParams: string): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  let safety = 0;

  do {
    const offsetParam = offset ? `&offset=${encodeURIComponent(offset)}` : "";
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}?${extraParams}${offsetParam}`;
    const data = (await airtableFetch(url)) as { records?: AirtableRecord[]; offset?: string };
    if (Array.isArray(data.records)) all.push(...data.records);
    offset = data.offset;
    safety += 1;
    if (safety > 20) break; // max 2000 records; prevents runaway loops
  } while (offset);

  return all;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientName = searchParams.get("name");

  try {
    if (!clientName) {
      // List mode: return all clients with non-empty Client Name, sorted alphabetically.
      // Uses field NAMES (not IDs) in filterByFormula because Airtable ignores field IDs there.
      const formula = encodeURIComponent(`NOT({${CLIENT_FIELDS.clientName}}="")`);
      const params = [
        `fields[]=${encodeURIComponent(CLIENT_FIELDS.clientName)}`,
        `fields[]=${encodeURIComponent(CLIENT_FIELDS.firstName)}`,
        `fields[]=${encodeURIComponent(CLIENT_FIELDS.status)}`,
        `sort[0][field]=${encodeURIComponent(CLIENT_FIELDS.clientName)}`,
        `sort[0][direction]=asc`,
        `filterByFormula=${formula}`,
        `pageSize=100`,
      ].join("&");

      const records = await fetchAllRecords(AIRTABLE_CLIENTS_TABLE, params);

      // Dedupe by client name (keep first occurrence). Multiple records with the
      // same brand name are an artifact of the intake flow creating duplicates.
      const seen = new Set<string>();
      const clients = records
        .map((r) => ({
          id: r.id,
          clientName: String(r.fields[CLIENT_FIELDS.clientName] || "").trim(),
          firstName: String(r.fields[CLIENT_FIELDS.firstName] || ""),
          status:
            typeof r.fields[CLIENT_FIELDS.status] === "object" && r.fields[CLIENT_FIELDS.status] !== null
              ? (r.fields[CLIENT_FIELDS.status] as { name?: string }).name || ""
              : String(r.fields[CLIENT_FIELDS.status] || ""),
        }))
        .filter((c) => {
          if (!c.clientName) return false;
          const key = c.clientName.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      return NextResponse.json({ clients, total: clients.length });
    }

    // Detail mode: fetch a specific client by name and enrich with Brand DNA.
    const safeName = clientName.replace(/"/g, '\\"');
    const clientFormula = encodeURIComponent(
      `LOWER({${CLIENT_FIELDS.clientName}})=LOWER("${safeName}")`
    );
    const clientUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?filterByFormula=${clientFormula}&pageSize=1`;
    const clientData = (await airtableFetch(clientUrl)) as { records?: AirtableRecord[] };

    if (!clientData.records || clientData.records.length === 0) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const clientRecord = clientData.records[0];
    const cf = clientRecord.fields;

    // The Brand DNA JSON is stored as a string in the "Brand DNA" column.
    const brandFromJson = parseBrandDNAField(cf[CLIENT_FIELDS.brandDNA]);

    // Also try to fetch a structured record from the Brand DNA table (if present).
    const brandFormula = encodeURIComponent(
      `LOWER({${BRAND_DNA_FIELDS.clientName}})=LOWER("${safeName}")`
    );
    const brandUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_BRAND_DNA_TABLE}?filterByFormula=${brandFormula}&pageSize=1`;
    let brandTableData: { records?: AirtableRecord[] } = {};
    try {
      brandTableData = (await airtableFetch(brandUrl)) as { records?: AirtableRecord[] };
    } catch {
      // Brand DNA table may not have a matching record — fall back to JSON parse only.
    }
    const brandRecord = brandTableData.records?.[0];
    const bf = brandRecord?.fields || {};

    // Build the response by merging: Brand DNA table (authoritative) → JSON in Client row → empty.
    const colors = brandFromJson?.colors || [];
    const getColor = (idx: number) => colors[idx]?.hex || "";

    const statusValue =
      typeof cf[CLIENT_FIELDS.status] === "object" && cf[CLIENT_FIELDS.status] !== null
        ? (cf[CLIENT_FIELDS.status] as { name?: string }).name || ""
        : String(cf[CLIENT_FIELDS.status] || "");

    const result: ClientBrandDNA = {
      clientName: String(cf[CLIENT_FIELDS.clientName] || brandFromJson?.brandName || ""),
      firstName: String(cf[CLIENT_FIELDS.firstName] || ""),
      email: String(cf[CLIENT_FIELDS.email] || ""),
      website: String(cf[CLIENT_FIELDS.website] || brandFromJson?.website || ""),
      status: statusValue,
      brandLogoUrl: String(cf[CLIENT_FIELDS.brandLogoUrl] || brandFromJson?.logoUrl || ""),
      customizations: "",
      logo:
        String(bf[BRAND_DNA_FIELDS.logo] || "") ||
        String(brandFromJson?.logoUrl || "") ||
        String(cf[CLIENT_FIELDS.brandLogoUrl] || ""),
      primaryColor: String(bf[BRAND_DNA_FIELDS.primaryColor] || getColor(0)),
      secondaryColor: String(bf[BRAND_DNA_FIELDS.secondaryColor] || getColor(1)),
      accentColor: String(bf[BRAND_DNA_FIELDS.accentColor] || getColor(2)),
      darkColor: String(bf[BRAND_DNA_FIELDS.darkColor] || getColor(3)),
      lightColor: String(bf[BRAND_DNA_FIELDS.lightColor] || ""),
      displayFont: String(bf[BRAND_DNA_FIELDS.displayFont] || brandFromJson?.fonts?.display || ""),
      bodyFont: String(bf[BRAND_DNA_FIELDS.bodyFont] || brandFromJson?.fonts?.body || ""),
      tagline: String(bf[BRAND_DNA_FIELDS.tagline] || brandFromJson?.brandEssence || ""),
      toneTags:
        String(bf[BRAND_DNA_FIELDS.toneTags] || "") ||
        (brandFromJson?.tones || []).join(", "),
      aestheticTags:
        String(bf[BRAND_DNA_FIELDS.aestheticTags] || "") ||
        (brandFromJson?.aesthetic || []).join(", "),
      dos: String(bf[BRAND_DNA_FIELDS.dos] || ""),
      donts: String(bf[BRAND_DNA_FIELDS.donts] || ""),
      brandEssence: String(brandFromJson?.brandEssence || ""),
      businessOverview: String(brandFromJson?.businessOverview || ""),
      aiBriefing: String(brandFromJson?.aiBriefing || ""),
      targetAudience: String(brandFromJson?.targetAudience || ""),
      positioning: String(brandFromJson?.positioning || ""),
      platforms: String(brandFromJson?.platforms || ""),
      instagramHandle: String(brandFromJson?.instagramHandle || ""),
    };

    return NextResponse.json({ client: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
