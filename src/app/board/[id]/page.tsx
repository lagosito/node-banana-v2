"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkflowStore } from "@/store/workflowStore";

export default function SharedBoardPage() {
  const params = useParams();
  const router = useRouter();
  const boardId = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!boardId) return;

    const loadBoard = async () => {
      try {
        // Fetch board data from API
        const res = await fetch(`/api/boards?id=${boardId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Board not found");
          } else {
            setError("Failed to load board");
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        if (!data.workflowData) {
          setError("This board has no workflow data yet");
          setLoading(false);
          return;
        }

        // Load into the workflow store
        const { loadFromBoard } = useWorkflowStore.getState();
        await loadFromBoard({
          id: data.board.id,
          boardName: data.board.boardName || "Shared Board",
          clientId: data.board.clientId || "shared",
          clientName: data.board.clientName || "",
          hasWorkflowData: true,
        });

        // Redirect to main canvas with the board loaded
        router.replace("/");
      } catch (e) {
        setError(`Error loading board: ${e instanceof Error ? e.message : "Unknown error"}`);
        setLoading(false);
      }
    };

    loadBoard();
  }, [boardId, router]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--c-bg, #1a1a1a)", color: "var(--c-text, #e0e0e0)" }}>
        <div className="text-center">
          <img src="/icon.png" alt="El Kiosk" className="w-16 h-16 mx-auto mb-4 rounded-lg" />
          <h1 className="text-xl font-semibold mb-2">El Kiosk</h1>
          <p className="text-[var(--c-text-secondary, #999)] mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 rounded-lg bg-[var(--c-surface, #2a2a2a)] hover:bg-[var(--c-surface-hover, #333)] transition-colors"
          >
            Go to Editor
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "var(--c-bg, #1a1a1a)", color: "var(--c-text, #e0e0e0)" }}>
      <div className="text-center">
        <img src="/icon.png" alt="El Kiosk" className="w-16 h-16 mx-auto mb-4 rounded-lg animate-pulse" />
        <h1 className="text-xl font-semibold mb-2">Loading board...</h1>
        <p className="text-[var(--c-text-secondary, #999)]">Setting up the workflow editor</p>
      </div>
    </div>
  );
}