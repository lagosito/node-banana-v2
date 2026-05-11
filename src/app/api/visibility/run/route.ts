/**
 * /api/visibility/run — Next.js App Router route handler
 * Wraps the visibility pipeline for Vercel deployment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runFullPipeline } from '@/lib/visibility/pipeline';

export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  // Webhook auth
  const expected = process.env.VISIBILITY_WEBHOOK_SECRET;
  const provided = request.headers.get('x-visibility-secret');
  if (expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await runFullPipeline(body);

    return NextResponse.json({
      brand_id: result.brand_id,
      score: result.score,
      duration_ms: result.duration_ms,
    });
  } catch (err) {
    console.error('[visibility] pipeline error:', err);
    return NextResponse.json(
      { error: 'pipeline_failed', message: String(err) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    module: 'ai-visibility-score',
    endpoint: 'POST /api/visibility/run',
  });
}
