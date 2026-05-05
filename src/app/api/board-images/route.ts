import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const BOARDS_TABLE_ID = process.env.AIRTABLE_BOARDS_TABLE_ID || "";
const BOARD_IMAGES_TABLE_ID = process.env.AIRTABLE_BOARD_IMAGES_TABLE_ID || "";

async function airtableFetch(url: string, options?: RequestInit) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) throw new Error("AIRTABLE_API_KEY not configured");

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable error ${res.status}: ${err}`);
  }
  return res.json();
}

// GET /api/board-images?boardId=recXXX
// Returns all images for a board
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId");

  if (!BOARD_IMAGES_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARD_IMAGES_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }

  try {
    const filterFormula = `{Board ID}="${boardId}"`;
    const params = new URLSearchParams();
    params.set("filterByFormula", filterFormula);
    params.set("pageSize", "100");

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}?${params}`;
    const data = await airtableFetch(url);

    const images: Record<string, string> = {};
    if (Array.isArray(data.records)) {
      for (const record of data.records) {
        const nodeId = String(record.fields["Node ID"] || "");
        const imageKey = String(record.fields["Image Key"] || "");
        const imageData = String(record.fields["Image Data"] || "");
        if (nodeId && imageKey && imageData) {
          // Key format: nodeId:imageKey (e.g., "imageInput-1:image")
          images[`${nodeId}:${imageKey}`] = imageData;
        }
      }
    }

    return NextResponse.json({ images, total: Object.keys(images).length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/board-images — save images for a board (bulk upsert)
// Body: { boardId: string, images: { "nodeId:imageKey": "data:image/...;base64,..." } }
export async function POST(request: NextRequest) {
  if (!BOARD_IMAGES_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARD_IMAGES_TABLE_ID not configured" },
      { status: 500 }
    );
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

    // First, delete existing images for this board
    const filterFormula = `{Board ID}="${boardId}"`;
    const listParams = new URLSearchParams();
    listParams.set("filterByFormula", filterFormula);
    listParams.set("pageSize", "100");

    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}?${listParams}`;
    const existing = await airtableFetch(listUrl);

    if (Array.isArray(existing.records) && existing.records.length > 0) {
      // Delete in batches of 10 (Airtable limit)
      for (let i = 0; i < existing.records.length; i += 10) {
        const batch = existing.records.slice(i, i + 10);
        const deleteParams = new URLSearchParams();
        batch.forEach((r: { id: string }) => deleteParams.append("records[]", r.id));
        const deleteUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}?${deleteParams}`;
        await airtableFetch(deleteUrl, { method: "DELETE" });
      }
    }

    // Create new image records in batches of 10
    const entries = Object.entries(images);
    let created = 0;

    for (let i = 0; i < entries.length; i += 10) {
      const batch = entries.slice(i, i + 10);
      const records = batch.map(([key, imageData]) => {
        const [nodeId, ...keyParts] = key.split(":");
        const imageKey = keyParts.join(":");
        return {
          fields: {
            "Board ID": boardId,
            "Node ID": nodeId,
            "Image Key": imageKey,
            "Image Data": imageData as string,
          },
        };
      });

      const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}`;
      await airtableFetch(createUrl, {
        method: "POST",
        body: JSON.stringify({ records }),
      });
      created += records.length;
    }

    return NextResponse.json({ success: true, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/board-images?boardId=recXXX — delete all images for a board
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId");

  if (!BOARD_IMAGES_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARD_IMAGES_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required" }, { status: 400 });
  }

  try {
    const filterFormula = `{Board ID}="${boardId}"`;
    const params = new URLSearchParams();
    params.set("filterByFormula", filterFormula);
    params.set("pageSize", "100");

    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}?${params}`;
    const existing = await airtableFetch(listUrl);

    if (Array.isArray(existing.records) && existing.records.length > 0) {
      for (let i = 0; i < existing.records.length; i += 10) {
        const batch = existing.records.slice(i, i + 10);
        const deleteParams = new URLSearchParams();
        batch.forEach((r: { id: string }) => deleteParams.append("records[]", r.id));
        const deleteUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARD_IMAGES_TABLE_ID}?${deleteParams}`;
        await airtableFetch(deleteUrl, { method: "DELETE" });
      }
    }

    return NextResponse.json({ success: true, deleted: existing.records?.length || 0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete board images";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
