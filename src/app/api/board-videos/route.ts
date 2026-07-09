import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

/**
 * POST /api/board-videos
 * Receives base64 video data, uploads to Vercel Blob, returns the public URL.
 * Body: { boardId: string, videos: Record<string, string> }
 *   where key = "nodeId:video" and value = base64 data URL
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { boardId, videos } = body;

    if (!boardId || !videos || typeof videos !== "object") {
      return NextResponse.json(
        { error: "boardId and videos are required" },
        { status: 400 }
      );
    }

    const entries = Object.entries(videos);
    if (entries.length === 0) {
      return NextResponse.json({ success: true, uploaded: 0 });
    }

    const results: Record<string, string> = {};

    for (const [key, dataUrl] of entries) {
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) continue;

      // Parse the data URL to get the MIME type and decode the base64
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) continue;

      const mimeType = match[1];
      const base64 = match[2];

      // Decode base64 to buffer
      const buffer = Buffer.from(base64, "base64");
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

      // Determine file extension from MIME type
      const ext = mimeType.includes("mp4")
        ? "mp4"
        : mimeType.includes("webm")
          ? "webm"
          : mimeType.includes("quicktime") || mimeType.includes("mov")
            ? "mov"
            : "mp4";

      const filename = `board-videos/${boardId}/${key.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}.${ext}`;

      console.log(
        `[board-videos] Uploading ${sizeMB}MB video: ${filename}`
      );

      try {
        const blob = await put(filename, buffer, {
          access: "public",
          contentType: mimeType,
        });

        results[key] = blob.url;
        console.log(`[board-videos] ✅ Uploaded: ${blob.url}`);
      } catch (err) {
        console.error(`[board-videos] ❌ Failed to upload ${key}:`, err);
        // Skip this video but continue with others
      }
    }

    return NextResponse.json({
      success: true,
      uploaded: Object.keys(results).length,
      urls: results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to upload videos";
    console.error("[board-videos] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
