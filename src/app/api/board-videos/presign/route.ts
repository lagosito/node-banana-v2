import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";

export const dynamic = "force-dynamic";

/**
 * POST /api/board-videos/presign
 * Returns a presigned upload URL + store ID for direct client-to-Blob upload.
 * Body: { boardId: string, videoKey: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { boardId, videoKey } = body;

    if (!boardId || !videoKey) {
      return NextResponse.json(
        { error: "boardId and videoKey are required" },
        { status: 400 }
      );
    }

    // Generate a unique blob path
    const safeKey = videoKey.replace(/[^a-zA-Z0-9]/g, "_");
    const blobPath = `board-videos/${boardId}/${safeKey}-${Date.now()}.mp4`;

    // Issue a signed token for upload
    const signedToken = await issueSignedToken({
      pathname: blobPath,
      operations: ["put"],
      validUntil: Date.now() + 3600 * 1000, // 1 hour
    });

    // Generate the presigned upload URL
    const { presignedUrl } = await presignUrl(signedToken, {
      pathname: blobPath,
      operation: "put",
      access: "public",
    });

    // Extract store ID from BLOB_READ_WRITE_TOKEN (format: vercel_blob_rw_{storeId}_{secret})
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN || "";
    const tokenParts = blobToken.split("_");
    const storeId = tokenParts[3] || "";

    // Construct the public CDN URL
    const publicUrl = storeId
      ? `https://${storeId}.public.blob.vercel-storage.com/${blobPath}`
      : undefined;

    console.log(`[board-videos/presign] Generated presigned URL for ${blobPath}`);

    return NextResponse.json({ presignedUrl, publicUrl, pathname: blobPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate presigned URL";
    console.error("[board-videos/presign] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
