import { NextRequest, NextResponse } from "next/server";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/board-images?boardId=xxx
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId");

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabase()
      .from("board_images")
      .select("image_key, image_data")
      .eq("board_id", boardId);

    if (error) throw error;

    const images: Record<string, string> = {};
    for (const row of data || []) {
      images[row.image_key] = row.image_data;
    }

    return NextResponse.json({ images, total: Object.keys(images).length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/board-images — save images for a board (bulk upsert)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { boardId, images } = body;

    if (!boardId || !images || typeof images !== "object") {
      return NextResponse.json(
        { error: "boardId and images object are required" },
        { status: 400 }
      );
    }

    const entries = Object.entries(images);
    if (entries.length === 0) {
      return NextResponse.json({ success: true, created: 0 });
    }

    const rows = entries.map(([key, imageData]) => ({
      board_id: boardId,
      image_key: key,
      image_data: imageData as string,
    }));

    let created = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await getSupabase()
        .from("board_images")
        .upsert(batch, { onConflict: "board_id,image_key" });

      if (error) throw error;
      created += batch.length;
    }

    return NextResponse.json({ success: true, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/board-images?boardId=xxx
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId");

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }

  try {
    const { error, count } = await getSupabase()
      .from("board_images")
      .delete({ count: "exact" })
      .eq("board_id", boardId);

    if (error) throw error;
    return NextResponse.json({ success: true, deleted: count || 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
