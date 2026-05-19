"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useWorkflowStore } from "@/store/workflowStore";
import { useToast } from "@/components/Toast";

interface ClientInfo {
  id: string;
  name: string;
  website: string;
  status: string;
  brandDna: {
    brandName: string;
    primaryColor?: string;
    secondaryColor?: string;
    brandTone?: string;
    brandEssence?: string;
    logoUrl?: string;
  } | null;
  logoUrl: string | null;
}

interface BoardInfo {
  id: string;
  boardName: string;
  clientId: string;
  clientName: string;
  status: string;
  workflowPath: string;
  notes: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasWorkflowData: boolean;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  draft: { bg: "bg-neutral-700", text: "text-neutral-300", dot: "bg-neutral-400" },
  "in-progress": { bg: "bg-blue-900/40", text: "text-blue-300", dot: "bg-blue-400" },
  review: { bg: "bg-yellow-900/40", text: "text-yellow-300", dot: "bg-yellow-400" },
  delivered: { bg: "bg-green-900/40", text: "text-green-300", dot: "bg-green-400" },
};

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

export default function ClientDashboard() {
  const router = useRouter();
  const loadFromBoard = useWorkflowStore((s) => s.loadFromBoard);

  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BoardInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  // Load clients
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data) => { if (data.clients) setClients(data.clients); })
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

  // Load boards (all or filtered by client)
  const loadBoards = useCallback(async () => {
    setBoardsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedClientId) params.set("clientId", selectedClientId);
      if (search) params.set("search", search);
      const res = await fetch(`/api/boards?${params}`);
      const data = await res.json();
      if (data.boards) setBoards(data.boards);
    } catch {} finally {
      setBoardsLoading(false);
    }
  }, [selectedClientId, search]);

  useEffect(() => { loadBoards(); }, [loadBoards]);

  // Filter boards by search (client-side for instant feedback)
  const filteredBoards = useMemo(() => {
    if (!search) return boards;
    const q = search.toLowerCase();
    return boards.filter(
      (b) => b.boardName.toLowerCase().includes(q) || b.clientName.toLowerCase().includes(q)
    );
  }, [boards, search]);

  // Get selected client info
  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // Open board in canvas
  const handleOpenBoard = useCallback(async (board: BoardInfo) => {
    await loadFromBoard({
      id: board.id,
      boardName: board.boardName,
      clientId: board.clientId,
      clientName: board.clientName,
      workflowPath: board.workflowPath || undefined,
      status: board.status,
      hasWorkflowData: board.hasWorkflowData,
      brandDna: selectedClient?.brandDna || undefined,
    });
    router.push("/");
  }, [loadFromBoard, selectedClient, router]);

  // Create new board
  const handleCreateBoard = useCallback(async () => {
    if (!newBoardName.trim()) return;
    if (!selectedClientId || !selectedClient) {
      alert("Please select a client first");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardName: newBoardName.trim(),
          clientId: selectedClientId,
          clientName: selectedClient.name,
          status: "draft",
        }),
      });
      const data = await res.json();
      if (data.board) {
        setShowCreateModal(false);
        setNewBoardName("");
        // Load the new board immediately
        await handleOpenBoard(data.board);
      }
    } catch (e) {
      console.error("Failed to create board:", e);
    } finally {
      setCreating(false);
    }
  }, [newBoardName, selectedClientId, selectedClient, handleOpenBoard]);

  // Delete board
  const handleDeleteBoard = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/boards?id=${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.show(`"${deleteTarget.boardName}" deleted`, "success");
        setBoards((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      } else {
        toast.show("Failed to delete board", "error");
      }
    } catch {
      toast.show("Failed to delete board", "error");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }, [deleteTarget, toast]);

  // Share board link
  const handleShareBoard = useCallback((board: BoardInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/board/${board.id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.show("Link copied to clipboard", "success"),
      () => toast.show("Failed to copy link", "error")
    );
  }, [toast]);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      {/* Header */}
      <div className="border-b border-neutral-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              ← Canvas
            </button>
            <h1 className="text-xl font-semibold">Client Boards</h1>
          </div>
          <button
            onClick={() => router.push("/campaign")}
            className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Campaign Generator →
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Controls bar */}
        <div className="flex items-center gap-4 mb-6">
          {/* Client selector */}
          <div className="relative">
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 pr-10 text-sm appearance-none cursor-pointer hover:border-neutral-600 focus:border-blue-500 focus:outline-none min-w-[200px]"
              disabled={clientsLoading}
            >
              <option value="">All Clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
              ▾
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Search boards..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 pl-10 text-sm placeholder-neutral-500 hover:border-neutral-600 focus:border-blue-500 focus:outline-none"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">
              🔍
            </span>
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
              >
                ✕
              </button>
            )}
          </div>

          {/* New Board button */}
          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!selectedClientId}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              selectedClientId
                ? "bg-blue-600 hover:bg-blue-500 text-white"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed"
            }`}
          >
            + New Board
          </button>
        </div>

        {/* Client info card (when selected) */}
        {selectedClient && (
          <div className="mb-6 p-4 bg-neutral-800/50 border border-neutral-700 rounded-xl flex items-center gap-4">
            {selectedClient.logoUrl && (
              <img
                src={selectedClient.logoUrl}
                alt={selectedClient.name}
                className="w-10 h-10 rounded-lg object-contain bg-white/10"
              />
            )}
            <div>
              <h2 className="font-medium">{selectedClient.name}</h2>
              <p className="text-sm text-neutral-400">
                {selectedClient.website && (
                  <a href={selectedClient.website} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                    {selectedClient.website}
                  </a>
                )}
                {selectedClient.brandDna?.brandTone && (
                  <span className="ml-2 text-neutral-500">• {selectedClient.brandDna.brandTone}</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Boards grid */}
        {boardsLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-neutral-500">Loading boards...</div>
          </div>
        ) : filteredBoards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-lg font-medium text-neutral-300 mb-1">No boards yet</h3>
            <p className="text-sm text-neutral-500">
              {selectedClientId
                ? "Select a client and create a new board to get started."
                : "Select a client from the dropdown to view their boards."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredBoards.map((board) => {
              const statusStyle = STATUS_COLORS[board.status] || STATUS_COLORS.draft;
              return (
                <div
                  key={board.id}
                  className="text-left bg-neutral-800 border border-neutral-700 rounded-xl p-4 hover:border-neutral-500 hover:bg-neutral-750 transition-all group"
                >
                  <button
                    onClick={() => handleOpenBoard(board)}
                    className="w-full text-left"
                  >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-sm group-hover:text-blue-400 transition-colors line-clamp-2">
                      {board.boardName}
                    </h3>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${statusStyle.bg} ${statusStyle.text} shrink-0 ml-2`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                      {board.status}
                    </span>
                  </div>
                  </button>
                  {!selectedClientId && (
                    <p className="text-xs text-neutral-500 mb-2">{board.clientName}</p>
                  )}
                  <p className="text-xs text-neutral-600 mb-3">
                    Updated {timeAgo(board.updatedAt || board.createdAt)}
                  </p>
                  <div className="flex items-center gap-1 pt-2 border-t border-neutral-700/50">
                    <button
                      onClick={(e) => handleShareBoard(board, e)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-blue-400 hover:bg-neutral-700 transition-colors"
                      title="Share board link"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                      </svg>
                      Share
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(board); }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-neutral-500 hover:text-red-400 hover:bg-neutral-700 transition-colors ml-auto"
                      title="Delete board"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Board Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreateModal(false)}>
          <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">New Board</h2>
            <p className="text-sm text-neutral-400 mb-4">
              Creating board for <strong>{selectedClient?.name}</strong>
            </p>
            <input
              type="text"
              placeholder="Board name (e.g. Summer Campaign - Instagram)"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBoard()}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-4 py-3 text-sm placeholder-neutral-500 focus:border-blue-500 focus:outline-none mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBoard}
                disabled={!newBoardName.trim() || creating}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-lg text-sm font-medium transition-colors"
              >
                {creating ? "Creating..." : "Create & Open"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteTarget(null)}>
          <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">Delete Board</h2>
            <p className="text-sm text-neutral-400 mb-6">
              Are you sure you want to delete <strong>"{deleteTarget.boardName}"</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteBoard}
                disabled={deleting}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-lg text-sm font-medium transition-colors"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
