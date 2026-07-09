import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

/**
 * POST /api/board-videos
 * Receives base64 video data, uploads to Vercel Blob, returns the public URL.
 * Body: { boardId: string, videoKey: string, dataUrl: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { boardId, videoKey, dataUrl } = body;

    if (!boardId || !videoKey || !dataUrl) {
      return NextResponse.json(
        { error: "boardId, videoKey, and dataUrl are required" },
        { status: 400 }
      );
    }

    if (!dataUrl.startsWith("data:")) {
      return NextResponse.json(
        { error: "dataUrl must be a data: URL" },
        { status: 400 }
      );
    }

    // Parse the data URL
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Invalid data URL format" },
        { status: 400 }
      );
    }

    const [, mimeType, base64] = match;
    const buffer = Buffer.from(base64, "base64");
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);

    // Determine extension
    const ext = mimeType.includes("mp4") ? "mp4"
      : mimeType.includes("webm") ? "webm"
      : mimeType.includes("quicktime") || mimeType.includes("mov") ? "mov"
      : "mp4";

    const safeKey = videoKey.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `board-videos/${boardId}/${safeKey}-${Date.now()}.${ext}`;

    console.log(`[board-videos] Uploading ${sizeMB}MB: ${filename}`);

    const blob = await put(filename, buffer, {
      access: "public",
      contentType: mimeType,
    });

    console.log(`[board-videos] ✅ Uploaded: ${blob.url}`);

    return NextResponse.json({
      success: true,
      url: blob.url,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to upload video";
    console.error("[board-videos] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
