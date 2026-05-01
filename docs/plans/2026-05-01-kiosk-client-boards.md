# El Kiosk Client Boards — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a multi-tenant client dashboard to Node Banana where the El Kiosk team can select a client, view their boards, create new boards with a pre-built 3-step content generation workflow, and search/filter across all client boards.

**Architecture:** Airtable stores board metadata (clientId, name, status, workflow path). Workflow JSON files are saved to disk per-client directory. New `/clients` page with client selector + board grid + search. Workflow template pre-populates the canvas with the 3-step flow.

**Tech Stack:** Next.js (App Router), React, Zustand, React Flow, Airtable API, TypeScript, Tailwind CSS

---

## Data Model

### Airtable: New "Boards" table in existing base `appuXgF7lJxG52Tqd`

| Field | Type | Description |
|-------|------|-------------|
| Board Name | string | Human-readable name (e.g. "Summer Campaign - Instagram") |
| Client ID | string | Airtable record ID from Clients table (`tblZ0fnEbWD6zwqR0`) |
| Client Name | string | Denormalized for easy display |
| Status | enum | `draft` / `in-progress` / `review` / `delivered` |
| Workflow Path | string | Filesystem path to the workflow JSON |
| Created At | date | Auto |
| Updated At | date | Auto |
| Notes | string | Optional team notes |

### Filesystem: Per-client workflow storage

```
~/.node-banana/clients/
  {clientId}/
    {boardId}/
      workflow.json          # Canvas state (nodes, edges, viewport)
      outputs/               # Generated images/videos
        gen-001.png
        gen-002.mp4
      references/            # Brand reference images
        brand-01.jpg
        brand-02.jpg
```

---

## Task 1: Create Airtable "Boards" table via API

**Objective:** Create the Boards table in the existing Airtable base programmatically.

**Files:**
- Create: `scripts/create-boards-table.ts` (one-time script, delete after)

**Step 1:** Create the table via Airtable REST API:

```bash
curl -X POST "https://api.airtable.com/v0/meta/bases/appuXgF7lJxG52Tqd/tables" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Boards",
    "fields": [
      {"name": "Board Name", "type": "singleLineText"},
      {"name": "Client ID", "type": "singleLineText"},
      {"name": "Client Name", "type": "singleLineText"},
      {"name": "Status", "type": "singleSelect", "options": {
        "choices": [
          {"name": "draft"},
          {"name": "in-progress"},
          {"name": "review"},
          {"name": "delivered"}
        ]
      }},
      {"name": "Workflow Path", "type": "singleLineText"},
      {"name": "Notes", "type": "multilineText"}
    ]
  }'
```

**Step 2:** Save the returned table ID (e.g. `tblXXXXX`) — will be used in all subsequent API routes.

**Step 3:** Verify by listing tables:
```bash
curl "https://api.airtable.com/v0/meta/bases/appuXgF7lJxG52Tqd/tables" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY"
```

**Step 4:** Delete the script file (one-time use).

---

## Task 2: Create `/api/boards` API route

**Objective:** CRUD API for boards — list by client, create, update, delete.

**Files:**
- Create: `src/app/api/boards/route.ts`

**Implementation:**

```typescript
// src/app/api/boards/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AIRTABLE_BASE_ID = "appuXgF7lJxG52Tqd";
const BOARDS_TABLE_ID = process.env.AIRTABLE_BOARDS_TABLE_ID || ""; // Set after Task 1

interface BoardRecord {
  id: string;
  fields: {
    "Board Name"?: string;
    "Client ID"?: string;
    "Client Name"?: string;
    "Status"?: string;
    "Workflow Path"?: string;
    "Notes"?: string;
    "Created At"?: string;
    "Updated At"?: string;
  };
}

export interface BoardInfo {
  id: string;
  boardName: string;
  clientId: string;
  clientName: string;
  status: string;
  workflowPath: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
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

// GET /api/boards?clientId=recXXX — list boards for a client
// GET /api/boards — list all boards
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const search = searchParams.get("search");

  try {
    let filterFormula = "";
    if (clientId) {
      filterFormula = `{Client ID}="${clientId}"`;
    }

    const params = new URLSearchParams();
    if (filterFormula) params.set("filterByFormula", filterFormula);
    params.set("sort[0][field]", "Updated At");
    params.set("sort[0][direction]", "desc");
    params.set("pageSize", "100");

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}?${params}`;
    const data = await airtableFetch(url);

    let boards: BoardInfo[] = (data.records || []).map((r: BoardRecord) => ({
      id: r.id,
      boardName: r.fields["Board Name"] || "",
      clientId: r.fields["Client ID"] || "",
      clientName: r.fields["Client Name"] || "",
      status: r.fields["Status"] || "draft",
      workflowPath: r.fields["Workflow Path"] || "",
      notes: r.fields["Notes"] || "",
      createdAt: r.fields["Created At"] || null,
      updatedAt: r.fields["Updated At"] || null,
    }));

    // Client-side search filter (name matching)
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
  try {
    const body = await request.json();
    const { boardName, clientId, clientName, status, workflowPath, notes } = body;

    if (!boardName || !clientId || !clientName) {
      return NextResponse.json(
        { error: "boardName, clientId, and clientName are required" },
        { status: 400 }
      );
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}`;
    const data = await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          "Board Name": boardName,
          "Client ID": clientId,
          "Client Name": clientName,
          Status: status || "draft",
          "Workflow Path": workflowPath || "",
          Notes: notes || "",
          "Created At": new Date().toISOString(),
          "Updated At": new Date().toISOString(),
        },
      }),
    });

    return NextResponse.json({
      board: {
        id: data.id,
        boardName,
        clientId,
        clientName,
        status: status || "draft",
        workflowPath: workflowPath || "",
        notes: notes || "",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/boards — update a board
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = {
      "Updated At": new Date().toISOString(),
    };
    if (fields.boardName) updateFields["Board Name"] = fields.boardName;
    if (fields.status) updateFields["Status"] = fields.status;
    if (fields.workflowPath !== undefined) updateFields["Workflow Path"] = fields.workflowPath;
    if (fields.notes !== undefined) updateFields["Notes"] = fields.notes;

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BOARDS_TABLE_ID}/${id}`;
    const data = await airtableFetch(url, {
      method: "PATCH",
      body: JSON.stringify({ fields: updateFields }),
    });

    return NextResponse.json({ board: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/boards?id=recXXX — delete a board
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
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
```

**Verification:** Start dev server, test endpoints:
```bash
# List all boards
curl http://localhost:3000/api/boards

# List boards for a client
curl "http://localhost:3000/api/boards?clientId=recXXX"

# Create a board
curl -X POST http://localhost:3000/api/boards \
  -H "Content-Type: application/json" \
  -d '{"boardName":"Test Board","clientId":"recXXX","clientName":"Acme Corp"}'
```

---

## Task 3: Create `/clients` page — Client Dashboard

**Objective:** Dashboard page with client selector, board grid, and search bar.

**Files:**
- Create: `src/app/clients/page.tsx`
- Create: `src/app/clients/ClientDashboard.tsx`

**Step 1:** Create the page entry point:

```typescript
// src/app/clients/page.tsx
import ClientDashboard from "./ClientDashboard";

export const metadata = {
  title: "Client Boards — El Kiosk",
  description: "Manage client content boards and workflows.",
};

export default function ClientsPage() {
  return <ClientDashboard />;
}
```

**Step 2:** Create the main dashboard component. Key features:
- Client dropdown selector (from `/api/clients`)
- "All Clients" option to see everything
- Search input that filters by board name or client name
- Board cards grid with: name, client, status badge, last updated
- "New Board" button that opens a creation modal
- Status color coding: draft=gray, in-progress=blue, review=yellow, delivered=green

**Step 3:** Implement the board cards with these details:
- Card click → navigates to canvas with that workflow loaded
- Status badge with color
- Relative time ("2 hours ago")
- Client name and logo (if available)

**Verification:** Navigate to `/clients`, select a client, see empty grid. Create a board via API, verify it appears.

---

## Task 4: Create Board Creation Modal

**Objective:** Modal to create a new board — select client, name the board, auto-create workflow directory.

**Files:**
- Create: `src/app/clients/CreateBoardModal.tsx`

**Implementation details:**
- If a client is already selected in the dashboard, pre-fill client
- Board name input
- "Create Board" button that:
  1. Calls `POST /api/boards` to create the Airtable record
  2. Creates the filesystem directory structure
  3. Generates a default workflow JSON with the 3-step template
  4. Navigates to the canvas with the new workflow loaded

**Verification:** Open modal, fill name, create board. Check Airtable has the record and filesystem has the directory.

---

## Task 5: Create the 3-step Workflow Template

**Objective:** Pre-built workflow JSON that creates the El Kiosk content generation flow on the canvas.

**Files:**
- Create: `src/lib/workflowTemplates/kioskContentTemplate.ts`

**Template structure (nodes and edges):**

```
Step 1: Brand Reference Images (10 ImageInput nodes in a Group)
   ↓ (image connections)
Step 2: Product Image (1 ImageInput) + Prompt (1 Prompt node)
   ↓ (image + text connections)
Step 3: NanoBanana Generate (connected to brand images + product + prompt)
   ↓
   Output Gallery
```

**Node layout:**

```
[Group: "Brand References"]
  ImageInput-1  ImageInput-2  ImageInput-3  ImageInput-4  ImageInput-5
  ImageInput-6  ImageInput-7  ImageInput-8  ImageInput-9  ImageInput-10

[Group: "Product"]
  ImageInput-Product     PromptNode

[Group: "Generation"]
  NanoBanana (10 image inputs + 1 text input)
     ↓
  OutputGallery
```

**Implementation:**

```typescript
// src/lib/workflowTemplates/kioskContentTemplate.ts
import { WorkflowNode, WorkflowEdge } from "@/types";
import { generateWorkflowId } from "@/store/utils/localStorage";

interface KioskTemplateResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export function createKioskContentTemplate(
  brandDna?: {
    primaryColor?: string;
    brandTone?: string;
    brandEssence?: string;
  }
): KioskTemplateResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // --- Step 1: Brand Reference Images (10 slots) ---
  const brandGroup = {
    id: "group-brand",
    name: "Brand References",
    color: "blue" as const,
    position: { x: 0, y: 0 },
    size: { width: 1100, height: 250 },
  };

  for (let i = 0; i < 10; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    nodes.push({
      id: `brand-img-${i}`,
      type: "imageInput",
      position: { x: 20 + col * 210, y: 40 + row * 120 },
      data: {
        image: null,
        filename: null,
        dimensions: null,
        isOptional: true, // Not all 10 slots required
        label: `Brand Ref ${i + 1}`,
      },
      groupId: "group-brand",
    });
  }

  // --- Step 2: Product Image + Prompt ---
  const productGroup = {
    id: "group-product",
    name: "Product",
    color: "green" as const,
    position: { x: 0, y: 320 },
    size: { width: 500, height: 250 },
  };

  nodes.push({
    id: "product-img",
    type: "imageInput",
    position: { x: 20, y: 40 },
    data: {
      image: null,
      filename: null,
      dimensions: null,
      isOptional: false,
      label: "Product Image",
    },
    groupId: "group-product",
  });

  // Pre-fill prompt with brand context if available
  const defaultPrompt = brandDna?.brandEssence
    ? `Create a professional marketing image for this product. Brand essence: ${brandDna.brandEssence}. ${brandDna.brandTone ? `Tone: ${brandDna.brandTone}.` : ""}\n\nDescribe your desired output here...`
    : "Describe your desired output here...";

  nodes.push({
    id: "prompt-1",
    type: "prompt",
    position: { x: 260, y: 40 },
    data: {
      prompt: defaultPrompt,
      label: "Content Prompt",
    },
    groupId: "group-product",
  });

  // --- Step 3: Generation ---
  const genGroup = {
    id: "group-generation",
    name: "Generation",
    color: "purple" as const,
    position: { x: 0, y: 640 },
    size: { width: 500, height: 350 },
  };

  nodes.push({
    id: "generate-1",
    type: "nanoBanana",
    position: { x: 20, y: 40 },
    data: {
      inputImages: [],
      inputPrompt: null,
      outputImage: null,
      aspectRatio: "1:1",
      resolution: "1024",
      model: "nano-banana-2",
      useGoogleSearch: false,
      useImageSearch: true,
      status: "idle",
      error: null,
      imageHistory: [],
      selectedHistoryIndex: -1,
      label: "AI Generate",
    },
    groupId: "group-generation",
  });

  nodes.push({
    id: "output-1",
    type: "outputGallery",
    position: { x: 20, y: 220 },
    data: {
      images: [],
      label: "Output Gallery",
    },
    groupId: "group-generation",
  });

  // --- Edges ---
  // Connect all brand images to generate node
  for (let i = 0; i < 10; i++) {
    edges.push({
      id: `edge-brand-${i}-gen`,
      source: `brand-img-${i}`,
      target: "generate-1",
      sourceHandle: "image",
      targetHandle: `image-${i}`,
    });
  }

  // Connect product image to generate
  edges.push({
    id: "edge-product-gen",
    source: "product-img",
    target: "generate-1",
    sourceHandle: "image",
    targetHandle: "image-10", // Next available image slot
  });

  // Connect prompt to generate
  edges.push({
    id: "edge-prompt-gen",
    source: "prompt-1",
    target: "generate-1",
    sourceHandle: "text",
    targetHandle: "text",
  });

  // Connect generate to output
  edges.push({
    id: "edge-gen-output",
    source: "generate-1",
    target: "output-1",
    sourceHandle: "image",
    targetHandle: "images",
  });

  return {
    nodes,
    edges,
    viewport: { x: 50, y: 50, zoom: 0.8 },
  };
}
```

**Verification:** Call `createKioskContentTemplate()` and verify it returns valid nodes/edges that the canvas can render.

---

## Task 6: Modify workflowStore for client-aware persistence

**Objective:** Extend the save/load system to associate workflows with clients and boards.

**Files:**
- Modify: `src/types/workflow.ts` — add `clientId` and `boardId` to `WorkflowSaveConfig`
- Modify: `src/store/workflowStore.ts` — add `loadFromBoard` action
- Modify: `src/store/utils/localStorage.ts` — add client-scoped helpers

**Changes to WorkflowSaveConfig:**

```typescript
// In src/types/workflow.ts, extend the existing interface:
export interface WorkflowSaveConfig {
  workflowId: string;
  name: string;
  directoryPath: string;
  generationsPath: string | null;
  lastSavedAt: number | null;
  useExternalImageStorage?: boolean;
  // NEW: Client/Board association
  clientId?: string;    // Airtable client record ID
  boardId?: string;     // Airtable board record ID
  clientName?: string;  // Denormalized for display
}
```

**New action in workflowStore:**

```typescript
// Add to workflowStore actions:
loadFromBoard: async (board: BoardInfo) => {
  // 1. If board has a workflowPath, load from disk
  // 2. If not, create from kioskContentTemplate and save
  // 3. Set clientId, boardId, clientName in the save config
};
```

**Verification:** Create a board, load it, verify the canvas shows the template. Save, reload, verify persistence.

---

## Task 7: Wire up navigation — Board card click → Canvas

**Objective:** Clicking a board card in the dashboard navigates to the canvas with that workflow loaded.

**Files:**
- Modify: `src/app/clients/ClientDashboard.tsx` — add click handler
- Modify: `src/components/Header.tsx` — add "Clients" nav link

**Implementation:**
- Board card click → `router.push(`/?boardId=${board.id}`)` 
- On canvas load, check URL params for `boardId`, if present → load that board's workflow
- Add a breadcrumb or back button to return to `/clients`

**Verification:** From dashboard, click a board. Canvas loads with the correct workflow. Click "Back to Clients" to return.

---

## Task 8: Add search bar to Client Dashboard

**Objective:** Search input that filters boards by name or client name in real-time.

**Files:**
- Modify: `src/app/clients/ClientDashboard.tsx`

**Implementation:**
- Debounced search input (300ms) at the top of the dashboard
- Filters on client-side first (boards already loaded)
- If > 50 boards, switch to server-side search via `?search=` param on `/api/boards`
- Clear button on the search input

**Verification:** Type a partial board name → grid filters instantly. Clear → all boards return.

---

## Task 9: Add "Clients" link to Header navigation

**Objective:** Easy access to the client dashboard from anywhere in the app.

**Files:**
- Modify: `src/components/Header.tsx`

**Changes:**
- Add a "Clients" button/link next to existing header actions
- Active state when on `/clients` route
- Icon: users or folder icon

**Verification:** From any page, click "Clients" → navigates to dashboard. Active state highlights correctly.

---

## Task 10: End-to-end test of the full flow

**Objective:** Verify the complete flow works: select client → create board → load template → generate content → save.

**Steps:**
1. Navigate to `/clients`
2. Select a client from the dropdown
3. Click "New Board" → name it "Test Campaign" → create
4. Canvas loads with the 3-step template (10 brand image slots, product image, prompt, generator, output)
5. Upload a brand image to slot 1
6. Upload a product image
7. Edit the prompt
8. Run generation
9. Output appears in the Output Gallery
10. Save → navigate back to `/clients` → board appears with status "in-progress"

---

## Environment Variables Needed

```env
# Already exists:
AIRTABLE_API_KEY=patXXXX

# New:
AIRTABLE_BOARDS_TABLE_ID=tblXXXX  # From Task 1
```

## Execution Order

1. Task 1 — Create Airtable table (manual, get table ID)
2. Task 2 — `/api/boards` API route
3. Task 5 — Workflow template (can be done in parallel with 2)
4. Task 6 — Store modifications
5. Task 3 — Client Dashboard page
6. Task 4 — Create Board Modal
7. Task 7 — Navigation wiring
8. Task 8 — Search bar
9. Task 9 — Header link
10. Task 10 — E2E verification

## Dependencies

- Tasks 1 → 2 (need table ID for API)
- Tasks 2, 5 → 3, 4 (dashboard needs API + template)
- Tasks 3, 6 → 7 (navigation needs dashboard + store changes)
- All → 10 (E2E needs everything)
