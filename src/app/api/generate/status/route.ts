/**
 * Generate Status API Route (GET)
 *
 * Polls BytePlus/Volcengine ARK API for task status.
 * Used by the frontend to check Seedance video generation progress
 * after the initial POST /api/generate returns a taskId.
 *
 * This is needed because Vercel Hobby plan has a 60-second function timeout,
 * but Seedance video generation takes 2-5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 10; // Quick single API call, no long polling
export const dynamic = "force-dynamic";

/**
 * Poll the status of a Volcengine/BytePlus video generation task.
 *
 * GET /api/generate/status?taskId=xxx
 *
 * Returns:
 * - { status: "processing" } - Still queued or running
 * - { status: "succeeded", videoUrl: "https://..." } - Done
 * - { status: "failed", error: "..." } - Failed or expired
 * - { status: 400, error: "..." } - Missing taskId
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId query parameter is required" },
      { status: 400 }
    );
  }

  // Determine which API key and base URL to use (same logic as volcengine.ts)
  const byteplusApiKey = process.env.BYTEPLUS_API_KEY;
  const volcengineApiKey = process.env.VOLCENGINE_API_KEY;
  const apiKey = byteplusApiKey || volcengineApiKey;
  const isByteplus = !!byteplusApiKey;

  if (!apiKey) {
    return NextResponse.json(
      {
        status: "failed",
        error: "ARK API key not configured. Add BYTEPLUS_API_KEY or VOLCENGINE_API_KEY to .env.local.",
      },
      { status: 500 }
    );
  }

  const ARK_API_BASE = isByteplus
    ? "https://ark.ap-southeast.bytepluses.com/api/v3"
    : "https://ark.cn-beijing.volces.com/api/v3";

  try {
    const pollUrl = `${ARK_API_BASE}/contents/generations/tasks/${taskId}`;
    console.log(`[Status] Polling task: ${taskId} via ${isByteplus ? "BytePlus" : "Volcengine CN"}`);

    const pollResponse = await fetch(pollUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!pollResponse.ok) {
      const errorText = await pollResponse.text();
      let errorDetail = errorText || `HTTP ${pollResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetail = errorJson.error?.message || errorJson.error || errorJson.message || errorJson.detail || errorDetail;
      } catch {
        // Keep original text
      }
      console.error(`[Status] Poll failed: ${pollResponse.status} - ${errorDetail}`);

      return NextResponse.json(
        { status: "failed", error: errorDetail },
        { status: pollResponse.status }
      );
    }

    const pollData = await pollResponse.json();
    const currentStatus: string = pollData.status || "unknown";

    console.log(`[Status] Task ${taskId} — status: "${currentStatus}", content type: ${typeof pollData.content}, is array: ${Array.isArray(pollData.content)}`);
    if (currentStatus === "succeeded") {
      console.log(`[Status] Task ${taskId} — succeeded content: ${JSON.stringify(pollData.content).substring(0, 500)}`);
    }

    // Handle terminal states
    if (currentStatus === "succeeded") {
      // Extract video URL from content
      let videoUrl: string | undefined;
      if (pollData.content && typeof pollData.content === "object" && !Array.isArray(pollData.content)) {
        // Direct object format: { video_url: "https://..." }
        videoUrl = (pollData.content as Record<string, unknown>).video_url as string;
      } else if (Array.isArray(pollData.content)) {
        // Array format: [{ type: "video_url", video_url: { url: "..." } }]
        const videoContent = pollData.content.find((c: { type?: string }) => c.type === "video_url");
        videoUrl = videoContent?.video_url?.url;
      }

      if (!videoUrl) {
        console.error(`[Status] No video URL in succeeded response for task ${taskId}`);
        return NextResponse.json(
          { status: "failed", error: "No video URL in generation result" },
          { status: 500 }
        );
      }

      return NextResponse.json({ status: "succeeded", videoUrl });
    }

    if (currentStatus === "failed" || currentStatus === "expired") {
      const reason = pollData.error?.message || `Generation ${currentStatus}`;
      return NextResponse.json({ status: currentStatus, error: reason });
    }

    // Still queued or running — return processing
    return NextResponse.json({ status: "processing" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Status] Poll error for task ${taskId}: ${message}`);
    return NextResponse.json(
      { status: "failed", error: message },
      { status: 500 }
    );
  }
}
