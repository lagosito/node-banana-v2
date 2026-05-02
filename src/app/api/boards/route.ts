import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const BOARDS_TABLE_ID = process.env.AIRTABLE_BOARDS_TABLE_ID || "";

interface BoardRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface BoardInfo {
  id: string;
  boardName: string;
  clientId: string;
  clientName: string;
  status: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasWorkflowData: boolean;
}

function mapRecord(r: BoardRecord): BoardInfo {
  const workflowData = r.fields["Workflow Data"];
  return {
    id: r.id,
    boardName: String(r.fields["Board Name"] || ""),
    clientId: String(r.fields["Client ID"] || ""),
    clientName: String(r.fields["Client Name"] || ""),
    status: String(r.fields["Status"] || "draft"),
    notes: String(r.fields["Notes"] || ""),
    createdAt: r.fields["Created At"] ? String(r.fields["Created At"]) : null,
    updatedAt: r.fields["Updated At"] ? String(r.fields["Updated At"]) : null,
    hasWorkflowData: !!workflowData && String(workflowData).length > 10,
  };
}

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

async function fetchAllBoards(filterFormula?: string): Promise<BoardInfo[]> {
  const all: BoardRecord[] = [];
  let offset: string | undefined;
  let safety = 0;

  do {
    const params = new URLSearchParams();
    if (filterFormula) params.set("filterByFormula", filterFormula);
    params.set("sort[0][field]", "Updated At");
    params.set("sort[0][direction]", "desc");
    params.set("pageSize", "100");
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}?${params}`;
    const data = await airtableFetch(url);
    if (Array.isArray(data.records)) all.push(...data.records);
    offset = data.offset;
    safety++;
  } while (offset && safety < 20);

  return all.map(mapRecord);
}

// GET /api/boards?clientId=recXXX&search=term
// GET /api/boards?id=recXXX  (returns full board WITH workflow data)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const search = searchParams.get("search");
  const id = searchParams.get("id");

  if (!BOARDS_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARDS_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  try {
    // Single board fetch (with workflow data)
    if (id) {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}/${id}`;
      const data = await airtableFetch(url);
      const board = mapRecord(data);
      let workflowData = null;
      if (data.fields["Workflow Data"]) {
        try {
          workflowData = JSON.parse(String(data.fields["Workflow Data"]));
        } catch {
          // invalid JSON
        }
      }
      return NextResponse.json({ board, workflowData });
    }

    // List boards
    let filterFormula: string | undefined;
    if (clientId) {
      filterFormula = `{Client ID}="${clientId}"`;
    }

    let boards = await fetchAllBoards(filterFormula);

    if (search) {
      const q = search.toLowerCase();
      boards = boards.filter(
        (b) =>
          b.boardName.toLowerCase().includes(q) ||
          b.clientName.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ boards, total: boards.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch boards";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/boards — create a new board
export async function POST(request: NextRequest) {
  if (!BOARDS_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARDS_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { boardName, clientId, clientName, status, notes, workflowData } =
      body;

    if (!boardName || !clientId || !clientName) {
      return NextResponse.json(
        { error: "boardName, clientId, and clientName are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}`;
    const fields: Record<string, unknown> = {
      "Board Name": boardName,
      "Client ID": clientId,
      "Client Name": clientName,
      Status: status || "draft",
      Notes: notes || "",
      "Created At": now,
      "Updated At": now,
    };

    // Store workflow JSON if provided
    if (workflowData) {
      fields["Workflow Data"] =
        typeof workflowData === "string"
          ? workflowData
          : JSON.stringify(workflowData);
    }

    const data = await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });

    return NextResponse.json({
      board: {
        id: data.id,
        boardName,
        clientId,
        clientName,
        status: status || "draft",
        notes: notes || "",
        createdAt: now,
        updatedAt: now,
        hasWorkflowData: !!workflowData,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/boards — update a board (metadata or workflow data)
export async function PATCH(request: NextRequest) {
  if (!BOARDS_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARDS_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { id, workflowData, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = {
      "Updated At": new Date().toISOString(),
    };
    if (fields.boardName) updateFields["Board Name"] = fields.boardName;
    if (fields.status) updateFields["Status"] = fields.status;
    if (fields.notes !== undefined) updateFields["Notes"] = fields.notes;

    // Update workflow data if provided
    if (workflowData !== undefined) {
      updateFields["Workflow Data"] =
        typeof workflowData === "string"
          ? workflowData
          : JSON.stringify(workflowData);
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}/${id}`;
    const data = await airtableFetch(url, {
      method: "PATCH",
      body: JSON.stringify({ fields: updateFields }),
    });

    return NextResponse.json({ board: mapRecord(data) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/boards?id=recXXX
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  if (!BOARDS_TABLE_ID) {
    return NextResponse.json(
      { error: "AIRTABLE_BOARDS_TABLE_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}/${id}`;
    await airtableFetch(url, { method: "DELETE" });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
