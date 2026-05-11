/**
 * /api/visibility/score — Fetch visibility score by token
 * GET /api/visibility/score?token=xxx
 * Returns the latest score data for the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import Airtable from 'airtable';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || 'appuXgF7lJxG52Tqd';
  if (!apiKey) {
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }

  const base = new Airtable({ apiKey }).base(baseId);

  try {
    // Token is the Airtable record ID of the score
    const record = await base('scores').find(token);

    const fields = record.fields as Record<string, unknown>;

    // Also fetch the brand name from Brand DNA
    const brandId = Array.isArray(fields.brand_id) ? fields.brand_id[0] : fields.brand_id;
    let brandName = 'Unknown Brand';
    if (brandId) {
      try {
        const brand = await base('Brand DNA').find(brandId as string);
        brandName = (brand.fields['Client Name'] as string) || 'Unknown Brand';
      } catch {
        // Brand not found, use default
      }
    }

    return NextResponse.json({
      brand_name: brandName,
      period: fields.period,
      visibility_pct: fields.visibility_pct,
      position_avg: fields.position_avg,
      sentiment_avg: fields.sentiment_avg,
      share_of_voice: safeJSON(fields.share_of_voice as string),
      by_model: safeJSON(fields.by_model as string),
      by_category: safeJSON(fields.by_category as string),
      sentiment_distribution: safeJSON(fields.sentiment_distribution as string),
      total_answers: fields.total_answers,
      successful_answers: fields.successful_answers,
      mentions: fields.mentions,
      generated_at: fields.generated_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOT_FOUND')) {
      return NextResponse.json({ error: 'score_not_found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'fetch_failed', message: msg }, { status: 500 });
  }
}

function safeJSON(str: string | undefined): unknown {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}
