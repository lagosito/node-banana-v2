/**
 * El Kiosk - Client Debug Endpoint
 *
 * Returns raw Airtable responses to diagnose why the client dropdown is empty.
 * Tests multiple query strategies to identify which one works.
 *
 * GET /api/client/debug
 */

import { NextResponse } from "next/server";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const AIRTABLE_CLIENTS_TABLE = "tblZ0fnEbWD6zwqR0";
const CLIENT_NAME_FIELD_ID = "fld3CMtzrLHzyh4o7";

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

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { __parse_error: true, raw: text };
  }

  return { status: res.status, ok: res.ok, data: parsed };
}

export async function GET() {
  const results: Record<string, unknown> = {};

  // Strategy 1: No filter, no field restrictions — raw dump (first 3 records)
  try {
    const url1 = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?pageSize=3`;
    const r1 = await airtableFetch(url1);
    const records = (r1.data as { records?: AirtableRecord[] })?.records ?? [];
    results.strategy1_no_filter = {
      status: r1.status,
      recordCount: records.length,
      sampleRecords: records.map((rec) => ({
        id: rec.id,
        fieldKeys: Object.keys(rec.fields || {}),
        fields: rec.fields,
      })),
    };
  } catch (err) {
    results.strategy1_no_filter = { error: (err as Error).message };
  }

  // Strategy 2: Using field ID in filterByFormula (current broken approach)
  try {
    const formula2 = `NOT({${CLIENT_NAME_FIELD_ID}}="")`;
    const url2 = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?pageSize=5&filterByFormula=${encodeURIComponent(formula2)}`;
    const r2 = await airtableFetch(url2);
    const records = (r2.data as { records?: AirtableRecord[] })?.records ?? [];
    results.strategy2_fieldId_in_formula = {
      status: r2.status,
      recordCount: records.length,
      formula: formula2,
      sampleNames: records.map((rec) => rec.fields?.[CLIENT_NAME_FIELD_ID]),
    };
  } catch (err) {
    results.strategy2_fieldId_in_formula = { error: (err as Error).message };
  }

  // Strategy 3: Using field NAME "Client Name" in filterByFormula
  try {
    const formula3 = `NOT({Client Name}="")`;
    const url3 = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?pageSize=5&filterByFormula=${encodeURIComponent(formula3)}`;
    const r3 = await airtableFetch(url3);
    const records = (r3.data as { records?: AirtableRecord[] })?.records ?? [];
    results.strategy3_fieldName_in_formula = {
      status: r3.status,
      recordCount: records.length,
      formula: formula3,
      sampleRecords: records.map((rec) => ({
        id: rec.id,
        nameByFieldId: rec.fields?.[CLIENT_NAME_FIELD_ID],
        nameByFieldName: rec.fields?.["Client Name"],
        allFields: rec.fields,
      })),
    };
  } catch (err) {
    results.strategy3_fieldName_in_formula = { error: (err as Error).message };
  }

  // Strategy 4: returnFieldsByFieldId=true (returns fields keyed by ID instead of name)
  try {
    const formula4 = `NOT({Client Name}="")`;
    const url4 = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?pageSize=5&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula4)}`;
    const r4 = await airtableFetch(url4);
    const records = (r4.data as { records?: AirtableRecord[] })?.records ?? [];
    results.strategy4_returnFieldsByFieldId = {
      status: r4.status,
      recordCount: records.length,
      formula: formula4,
      sampleRecords: records.map((rec) => ({
        id: rec.id,
        fieldKeys: Object.keys(rec.fields || {}),
        nameByFieldId: rec.fields?.[CLIENT_NAME_FIELD_ID],
      })),
    };
  } catch (err) {
    results.strategy4_returnFieldsByFieldId = { error: (err as Error).message };
  }

  // Strategy 5: Use specific view
  try {
    const url5 = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENTS_TABLE}?pageSize=5&view=viwuHcm2cjn8sDncI`;
    const r5 = await airtableFetch(url5);
    const records = (r5.data as { records?: AirtableRecord[] })?.records ?? [];
    results.strategy5_specific_view = {
      status: r5.status,
      recordCount: records.length,
      sampleRecords: records.map((rec) => ({
        id: rec.id,
        fields: rec.fields,
      })),
    };
  } catch (err) {
    results.strategy5_specific_view = { error: (err as Error).message };
  }

  // Meta info
  results.__meta = {
    baseId: AIRTABLE_BASE_ID,
    tableId: AIRTABLE_CLIENTS_TABLE,
    clientNameFieldId: CLIENT_NAME_FIELD_ID,
    apiKeyConfigured: !!process.env.AIRTABLE_API_KEY,
    apiKeyPrefix: process.env.AIRTABLE_API_KEY?.slice(0, 7) + "...",
  };

  return NextResponse.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
