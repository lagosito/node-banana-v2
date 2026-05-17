import { NextRequest, NextResponse } from "next/server";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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

function mapRow(row: Record<string, unknown>): BoardInfo {
  const wf = row.workflow_data;
  return {
    id: String(row.id),
    boardName: String(row.board_name || ""),
    clientId: String(row.client_id || ""),
    clientName: String(row.client_name || ""),
    status: String(row.status || "draft"),
    notes: String(row.notes || ""),
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    hasWorkflowData: !!wf && (typeof wf === "object" ? Object.keys(wf).length > 0 : String(wf).length > 10),
  };
}

// GET /api/boards?clientId=xxx&search=term
// GET /api/boards?id=xxx  (returns full board WITH workflow data)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const search = searchParams.get("search");
  const id = searchParams.get("id");

  try {
    if (id) {
      const { data, error } = await getSupabase()
        .from("boards")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      if (!data) return NextResponse.json({ error: "Board not found" }, { status: 404 });

      const board = mapRow(data);
      return NextResponse.json({ board, workflowData: data.workflow_data || null });
    }

    let query = getSupabase()
      .from("boards")
      .select("id, board_name, client_id, client_name, status, notes, workflow_data, created_at, updated_at")
      .order("updated_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;
    if (error) throw error;

    let boards = (data || []).map(mapRow);

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

// POST /api/boards — create a new board OR update if id is provided (for sendBeacon)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();

    if (body.id) {
      const updateFields: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (body.workflowData !== undefined) {
        updateFields["workflow_data"] = typeof body.workflowData === "string"
          ? JSON.parse(body.workflowData)
          : body.workflowData;
      }

      const { error } = await getSupabase()
        .from("boards")
        .update(updateFields)
        .eq("id", body.id);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    const { boardName, clientId, clientName, status, notes, workflowData } = body;

    if (!boardName) {
      return NextResponse.json(
        { error: "boardName is required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const insertData: Record<string, unknown> = {
      board_name: boardName,
      client_id: clientId || "personal",
      client_name: clientName || "",
      status: status || "draft",
      notes: notes || "",
      created_at: now,
      updated_at: now,
    };

    if (workflowData) {
      insertData.workflow_data = typeof workflowData === "string"
        ? JSON.parse(workflowData)
        : workflowData;
    }

    const { data, error } = await getSupabase()
      .from("boards")
      .insert(insertData)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      board: mapRow(data),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/boards — update a board (metadata or workflow data)
export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { id, workflowData, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (fields.boardName) updateFields.board_name = fields.boardName;
    if (fields.status) updateFields.status = fields.status;
    if (fields.notes !== undefined) updateFields.notes = fields.notes;

    if (workflowData !== undefined) {
      updateFields.workflow_data = typeof workflowData === "string"
        ? JSON.parse(workflowData)
        : workflowData;
    }

    const { data, error } = await getSupabase()
      .from("boards")
      .update(updateFields)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ board: mapRow(data) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/boards?id=xxx
export async function DELETE(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const { error } = await getSupabase().from("boards").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
