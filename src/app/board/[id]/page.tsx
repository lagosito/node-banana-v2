"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useWorkflowStore } from "@/store/workflowStore";

export default function SharedBoardPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params?.id as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    const loadBoard = async () => {
      try {
        // The slug format is: {clientName}-{first8CharsOfUUID} or just {first8CharsOfUUID}
        const parts = slug.split("-");
        const lastPart = parts[parts.length - 1];

        // Try direct ID lookup first (full UUID or legacy)
        let res = await fetch(`/api/boards?id=${encodeURIComponent(slug)}`);
        let data = await res.json();

        // If not found and slug has a UUID prefix, search by prefix
        if (!data.board && lastPart.length >= 6) {
          const searchRes = await fetch(`/api/boards?search=${encodeURIComponent(lastPart)}`);
          const searchData = await searchRes.json();
          if (searchData.boards && searchData.boards.length > 0) {
            const match = searchData.boards.find((b: { id: string }) =>
              b.id.startsWith(lastPart)
            );
            if (match) {
              // Fetch the full board data with workflow
              res = await fetch(`/api/boards?id=${match.id}`);
              data = await res.json();
            }
          }
        }

        if (!res.ok || !data.board) {
          setError("Board not found");
          setLoading(false);
          return;
        }

        if (!data.workflowData) {
          setError("This board has no workflow data yet");
          setLoading(false);
          return;
        }

        // Load into the workflow store (this also sets the URL via replaceState)
        const { loadFromBoard } = useWorkflowStore.getState();
        await loadFromBoard({
          id: data.board.id,
          boardName: data.board.boardName || "Shared Board",
          clientId: data.board.clientId || "shared",
          clientName: data.board.clientName || "",
          hasWorkflowData: true,
        });

        // Navigate to editor — the store already set the URL to /board/{slug}
        // Use setTimeout to let replaceState apply first
        setTimeout(() => {
          router.replace("/");
        }, 50);
      } catch (e) {
        setError(`Error loading board: ${e instanceof Error ? e.message : "Unknown error"}`);
        setLoading(false);
      }
    };

    loadBoard();
  }, [slug, router]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--c-bg, #1a1a1a)", color: "var(--c-text, #e0e0e0)" }}>
        <div className="text-center">
          <img src="/icon.png" alt="El Kiosk" className="w-16 h-16 mx-auto mb-4 rounded-lg" />
          <h1 className="text-xl font-semibold mb-2">El Kiosk</h1>
          <p className="text-[var(--c-text-secondary, #999)] mb-4">{error}</p>
          <button onClick={() => router.push("/")} className="px-4 py-2 rounded-lg bg-[var(--c-surface, #2a2a2a)] hover:bg-[var(--c-surface-hover, #333)] transition-colors">Go to Editor</button>
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
