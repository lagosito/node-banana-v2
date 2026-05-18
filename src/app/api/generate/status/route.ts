/**
 * Generate Status API Route (GET)
 *
 * Polls BytePlus/Volcengine ARK API for task status.
 * When succeeded, downloads the video server-side and returns base64
 * (the BytePlus TOS URLs don't have CORS headers, so browser can't load them directly).
 *
 * GET /api/generate/status?taskId=xxx
 *
 * Returns:
 * - { status: "processing" } - Still queued or running
 * - { status: "succeeded", video: "data:video/mp4;base64,..." } - Done
 * - { status: "failed", error: "..." } - Failed or expired
 */

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30; // Need time to download video on success
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "taskId query parameter is required" },
      { status: 400 }
    );
  }

  // Determine which API key and base URL to use
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

    console.log(`[Status] Task ${taskId} — status: "${currentStatus}"`);

    // Handle terminal states
    if (currentStatus === "succeeded") {
      // Extract video URL from content
      let videoUrl: string | undefined;
      if (pollData.content && typeof pollData.content === "object" && !Array.isArray(pollData.content)) {
        videoUrl = (pollData.content as Record<string, unknown>).video_url as string;
      } else if (Array.isArray(pollData.content)) {
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

      // Download video server-side (BytePlus TOS URLs don't have CORS)
      console.log(`[Status] Downloading video from BytePlus: ${videoUrl.substring(0, 80)}...`);
      const videoResponse = await fetch(videoUrl);

      if (!videoResponse.ok) {
        console.error(`[Status] Failed to download video: ${videoResponse.status}`);
        // Fallback: return URL anyway (may work in some contexts)
        return NextResponse.json({ status: "succeeded", videoUrl });
      }

      const videoBuffer = await videoResponse.arrayBuffer();
      const videoBase64 = Buffer.from(videoBuffer).toString("base64");
      const contentType = videoResponse.headers.get("content-type") || "video/mp4";
      const sizeMB = videoBuffer.byteLength / (1024 * 1024);

      console.log(`[Status] Video downloaded: ${contentType}, ${sizeMB.toFixed(2)}MB`);

      // For very large videos (>20MB), return URL only
      if (sizeMB > 20) {
        console.log(`[Status] Video too large for base64, returning URL`);
        return NextResponse.json({ status: "succeeded", videoUrl });
      }

      return NextResponse.json({
        status: "succeeded",
        video: `data:${contentType};base64,${videoBase64}`,
      });
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
