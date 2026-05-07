"use client";

import { useState, useEffect, useCallback } from "react";
import { useShallow } from "zustand/shallow";
import { useWorkflowStore } from "@/store/workflowStore";
import type { ClientBrandDNA } from "@/app/api/client/route";
import type { WorkflowFile } from "@/store/workflowStore";

const TIER_WORKFLOWS: Record<string, string> = {
  starter:   "/workflows/elkiosk-starter.json",
  essential: "/workflows/elkiosk-essential.json",
  advanced:  "/workflows/elkiosk-advanced.json",
};

const TIER_LABEL: Record<string, string> = {
  starter:   "🌱 Starter  (€349 — 10 posts)",
  essential: "⭐ Essential (€599 — 20 posts)",
  advanced:  "🚀 Advanced  (€999 — 40+ posts)",
};

interface ClientEntry {
  id: string;
  clientName: string;
  firstName: string;
  status: string;
}

interface BoardEntry {
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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_DOT_COLORS: Record<string, string> = {
  draft: "bg-neutral-400",
  "in-progress": "bg-blue-400",
  review: "bg-yellow-400",
  delivered: "bg-green-400",
};

function buildBrandPrompt(c: ClientBrandDNA): string {
  return [
    `Brand: ${c.clientName}`,
    `Website: ${c.website}`,
    `Logo: ${c.logo || c.brandLogoUrl || "—"}`,
    ``,
    `Colors:`,
    `  Primary: ${c.primaryColor || "—"}`,
    `  Secondary: ${c.secondaryColor || "—"}`,
    `  Accent: ${c.accentColor || "—"}`,
    `  Dark: ${c.darkColor || "—"}`,
    `  Light: ${c.lightColor || "—"}`,
    ``,
    `Typography:`,
    `  Display: ${c.displayFont || "—"}`,
    `  Body: ${c.bodyFont || "—"}`,
    ``,
    `Tagline: ${c.tagline || "—"}`,
    `Tone: ${c.toneTags || "—"}`,
    `Aesthetic: ${c.aestheticTags || "—"}`,
    ``,
    `Do's: ${c.dos || "—"}`,
    `Don'ts: ${c.donts || "—"}`,
    ``,
    c.customizations ? `Extra notes: ${c.customizations}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n")
    .trim();
}

type Tab = "client" | "workflow" | "boards";

export function ClientLoader() {
  const [tab, setTab] = useState<Tab>("client");
  const [isOpen, setIsOpen] = useState(false);

  const [clients, setClients] = useState<ClientEntry[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedTier, setSelectedTier] = useState("starter");
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingClient, setLoadingClient] = useState(false);
  const [currentClient, setCurrentClient] = useState<ClientBrandDNA | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedWorkflow, setSelectedWorkflow] = useState("starter");
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  // Boards state
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [loadingBoardId, setLoadingBoardId] = useState<string | null>(null);

  const { nodes, updateNodeData, loadWorkflow, setBoardAssociation, markAsUnsaved, loadFromBoard } = useWorkflowStore(useShallow((state) => ({
    nodes: state.nodes,
    updateNodeData: state.updateNodeData,
    loadWorkflow: state.loadWorkflow,
    setBoardAssociation: state.setBoardAssociation,
    markAsUnsaved: state.markAsUnsaved,
    loadFromBoard: state.loadFromBoard,
  })));

  useEffect(() => {
    if (!isOpen || clients.length > 0) return;
    setLoadingClients(true);
    fetch("/api/client")
      .then((r) => r.json())
      .then((data) => { setClients(data.clients || []); setLoadingClients(false); })
      .catch(() => { setError("Failed to load clients from Airtable"); setLoadingClients(false); });
  }, [isOpen, clients.length]);

  // Load boards when clientId changes (for the Boards tab)
  const loadBoards = useCallback(async (clientId: string) => {
    if (!clientId) { setBoards([]); return; }
    setBoardsLoading(true);
    setBoardsError(null);
    try {
      const res = await fetch(`/api/boards?clientId=${clientId}`);
      const data = await res.json();
      if (data.boards) setBoards(data.boards);
      else setBoards([]);
    } catch {
      setBoardsError("Failed to load boards");
    } finally {
      setBoardsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) loadBoards(selectedClientId);
    else setBoards([]);
  }, [selectedClientId, loadBoards]);

  const injectBrandDNA = useCallback((client: ClientBrandDNA) => {
    const brandPrompt = buildBrandPrompt(client);
    const brandNode = nodes.find(
      (n) => n.type === "prompt" && (n.data as { variableName?: string }).variableName === "brand_context"
    );
    if (brandNode) {
      updateNodeData(brandNode.id, { prompt: brandPrompt } as never);
    } else {
      console.warn("[ElKiosk] No 'brand_context' prompt node found");
    }
  }, [nodes, updateNodeData]);

  const handleLoadClient = useCallback(async () => {
    if (!selectedName) return;
    setLoadingClient(true);
    setError(null);
    try {
      const res = await fetch(`/api/client?name=${encodeURIComponent(selectedName)}`);
      const data = await res.json();
      if (!res.ok || !data.client) throw new Error(data.error || "Client not found");
      const client: ClientBrandDNA = data.client;
      setCurrentClient(client);

      const workflowUrl = TIER_WORKFLOWS[selectedTier];
      if (workflowUrl) {
        const wRes = await fetch(workflowUrl);
        if (wRes.ok) {
          const workflow = (await wRes.json()) as WorkflowFile;
          workflow.name = `${client.clientName} — ${selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)}`;
          await loadWorkflow(workflow);
          setTimeout(() => injectBrandDNA(client), 100);
        }
      } else {
        injectBrandDNA(client);
      }

      // Create a board in Airtable so auto-save works
      try {
        const boardName = `${client.clientName} — ${selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)}`;
        const clientEntry = clients.find(c => c.clientName === selectedName);
        const clientId = clientEntry?.id || selectedName;
        const boardRes = await fetch("/api/boards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardName,
            clientId,
            clientName: client.clientName,
            status: "draft",
          }),
        });
        if (boardRes.ok) {
          const boardData = await boardRes.json();
          if (boardData.board?.id) {
            setBoardAssociation(boardData.board.id, client.clientName);
            markAsUnsaved();
          }
        }
      } catch (boardErr) {
        console.warn("[ClientLoader] Failed to create board (non-fatal):", boardErr);
      }

      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingClient(false);
    }
  }, [selectedName, selectedTier, clients, loadWorkflow, injectBrandDNA, setBoardAssociation, markAsUnsaved]);

  const handleInjectOnly = useCallback(async () => {
    if (!selectedName) return;
    setLoadingClient(true);
    setError(null);
    try {
      const res = await fetch(`/api/client?name=${encodeURIComponent(selectedName)}`);
      const data = await res.json();
      if (!res.ok || !data.client) throw new Error(data.error || "Client not found");
      setCurrentClient(data.client);
      injectBrandDNA(data.client);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingClient(false);
    }
  }, [selectedName, injectBrandDNA]);

  const handleLoadWorkflowOnly = useCallback(async () => {
    setLoadingWorkflow(true);
    setWorkflowError(null);
    try {
      const workflowUrl = TIER_WORKFLOWS[selectedWorkflow];
      const wRes = await fetch(workflowUrl);
      if (!wRes.ok) throw new Error("Failed to fetch workflow template");
      const workflow = (await wRes.json()) as WorkflowFile;
      workflow.name = `${selectedWorkflow.charAt(0).toUpperCase() + selectedWorkflow.slice(1)} Template`;
      await loadWorkflow(workflow);
      setIsOpen(false);
    } catch (err) {
      setWorkflowError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoadingWorkflow(false);
    }
  }, [selectedWorkflow, loadWorkflow]);

  // Open an existing board from the Boards tab
  const handleOpenBoard = useCallback(async (board: BoardEntry) => {
    setLoadingBoardId(board.id);
    try {
      await loadFromBoard({
        id: board.id,
        boardName: board.boardName,
        clientId: board.clientId,
        clientName: board.clientName,
        status: board.status,
        hasWorkflowData: board.hasWorkflowData,
        brandDna: currentClient ? {
          primaryColor: currentClient.primaryColor,
          brandTone: currentClient.toneTags,
          brandEssence: currentClient.tagline,
        } : undefined,
      });
      setIsOpen(false);
    } catch (err) {
      console.error("Failed to load board:", err);
    } finally {
      setLoadingBoardId(null);
    }
  }, [loadFromBoard, currentClient]);

  // Sync clientId when client name is selected
  const handleClientNameChange = useCallback((name: string) => {
    setSelectedName(name);
    const client = clients.find(c => c.clientName === name);
    setSelectedClientId(client?.id || "");
  }, [clients]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium bg-yellow-400 hover:bg-yellow-300 text-black transition-colors"
        title="El Kiosk — Load client, workflow, or board"
      >
        {currentClient ? currentClient.clientName : "Load Client"}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 z-50 w-[380px] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">El Kiosk</h3>
            <button onClick={() => setIsOpen(false)} className="text-zinc-400 hover:text-white text-lg leading-none">×</button>
          </div>

          <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setTab("client")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "client" ? "bg-yellow-400 text-black" : "text-zinc-400 hover:text-white"}`}
            >
              👤 Client
            </button>
            <button
              onClick={() => setTab("workflow")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "workflow" ? "bg-yellow-400 text-black" : "text-zinc-400 hover:text-white"}`}
            >
              📋 Workflow
            </button>
            <button
              onClick={() => setTab("boards")}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === "boards" ? "bg-yellow-400 text-black" : "text-zinc-400 hover:text-white"}`}
            >
              🗂️ Boards
            </button>
          </div>

          {tab === "client" && (
            <div>
              {error && (
                <div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">{error}</div>
              )}

              <div className="mb-3">
                <label className="block text-xs text-zinc-400 mb-1">Client</label>
                {loadingClients ? (
                  <div className="text-xs text-zinc-500">Loading clients…</div>
                ) : (
                  <select
                    value={selectedName}
                    onChange={(e) => handleClientNameChange(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-yellow-400"
                  >
                    <option value="">— Select client —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.clientName}>
                        {c.clientName}{c.status ? ` (${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-xs text-zinc-400 mb-1">Tier / Workflow</label>
                <select
                  value={selectedTier}
                  onChange={(e) => setSelectedTier(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-yellow-400"
                >
                  {Object.entries(TIER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleLoadClient}
                  disabled={!selectedName || loadingClient}
                  className="flex-1 py-2 rounded-md text-sm font-medium bg-yellow-400 hover:bg-yellow-300 text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingClient ? "Loading…" : "Load Workflow + Brand"}
                </button>
                <button
                  onClick={handleInjectOnly}
                  disabled={!selectedName || loadingClient}
                  className="px-3 py-2 rounded-md text-sm bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Inject Brand DNA without changing the current workflow"
                >
                  DNA only
                </button>
              </div>

              {currentClient && (
                <div className="mt-4 p-3 bg-zinc-800 rounded-lg text-xs space-y-1 text-zinc-300">
                  <div className="font-semibold text-white text-sm mb-2">✅ {currentClient.clientName}</div>
                  <div className="flex gap-2 flex-wrap">
                    {[currentClient.primaryColor, currentClient.secondaryColor, currentClient.accentColor]
                      .filter(Boolean).map((color, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <span className="w-3 h-3 rounded-full border border-zinc-600 inline-block" style={{ backgroundColor: color }} />
                          <span className="text-zinc-400">{color}</span>
                        </span>
                      ))}
                  </div>
                  {currentClient.toneTags && <div><span className="text-zinc-500">Tone:</span> {currentClient.toneTags}</div>}
                  {currentClient.displayFont && <div><span className="text-zinc-500">Font:</span> {currentClient.displayFont}</div>}
                </div>
              )}
            </div>
          )}

          {tab === "workflow" && (
            <div>
              {workflowError && (
                <div className="mb-3 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">{workflowError}</div>
              )}
              <p className="text-xs text-zinc-400 mb-3">
                Load a base workflow without a client. You can inject the Brand DNA later from the Client tab.
              </p>
              <div className="mb-4">
                <label className="block text-xs text-zinc-400 mb-1">Template</label>
                <select
                  value={selectedWorkflow}
                  onChange={(e) => setSelectedWorkflow(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-yellow-400"
                >
                  {Object.entries(TIER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleLoadWorkflowOnly}
                disabled={loadingWorkflow}
                className="w-full py-2 rounded-md text-sm font-medium bg-yellow-400 hover:bg-yellow-300 text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loadingWorkflow ? "Loading…" : "Load Workflow"}
              </button>
            </div>
          )}

          {tab === "boards" && (
            <div>
              {/* Client selector for boards */}
              <div className="mb-3">
                <label className="block text-xs text-zinc-400 mb-1">Client</label>
                {loadingClients ? (
                  <div className="text-xs text-zinc-500">Loading clients…</div>
                ) : (
                  <select
                    value={selectedClientId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setSelectedClientId(cid);
                      const client = clients.find(c => c.id === cid);
                      setSelectedName(client?.clientName || "");
                    }}
                    className="w-full bg-zinc-800 border border-zinc-600 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-yellow-400"
                  >
                    <option value="">— Select client —</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.clientName}{c.status ? ` (${c.status})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Boards list */}
              {!selectedClientId ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  Select a client to see their boards
                </div>
              ) : boardsLoading ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  Loading boards…
                </div>
              ) : boardsError ? (
                <div className="p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                  {boardsError}
                </div>
              ) : boards.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  No boards yet for this client
                </div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto space-y-1.5 pr-1">
                  {boards.map((board) => {
                    const dotColor = STATUS_DOT_COLORS[board.status] || STATUS_DOT_COLORS.draft;
                    const isLoading = loadingBoardId === board.id;
                    return (
                      <button
                        key={board.id}
                        onClick={() => handleOpenBoard(board)}
                        disabled={isLoading}
                        className="w-full text-left p-3 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-500 rounded-lg transition-all disabled:opacity-50 group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <h4 className="text-sm font-medium text-zinc-200 group-hover:text-yellow-400 transition-colors line-clamp-1 flex-1">
                            {isLoading ? "Loading…" : board.boardName}
                          </h4>
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-zinc-400">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                            {board.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-zinc-500">
                          <span>{formatDate(board.updatedAt || board.createdAt)}</span>
                          <span>{timeAgo(board.updatedAt || board.createdAt)}</span>
                        </div>
                        {board.hasWorkflowData && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-[10px] text-zinc-600">has workflow data</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
