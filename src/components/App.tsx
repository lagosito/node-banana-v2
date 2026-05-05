"use client";

import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Header } from "@/components/Header";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { FloatingActionBar } from "@/components/FloatingActionBar";
import { AnnotationModal } from "@/components/AnnotationModal";
import { useWorkflowStore } from "@/store/workflowStore";

export default function App() {
  const initializeAutoSave = useWorkflowStore(
    (state) => state.initializeAutoSave
  );
  const cleanupAutoSave = useWorkflowStore((state) => state.cleanupAutoSave);

  useEffect(() => {
    initializeAutoSave();
    return () => cleanupAutoSave();
  }, [initializeAutoSave, cleanupAutoSave]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useWorkflowStore.getState();
      // For boards: save immediately via sendBeacon (fires even during page close)
      if (state.boardId && state.hasUnsavedChanges) {
        try {
          // Strip images to keep payload small (sendBeacon limit ~64KB)
          const IMAGE_FIELDS = ["image", "outputImage", "audioFile", "outputAudio", "video"];
          const strippedNodes = state.nodes.map(({ selected, ...rest }) => {
            const data = { ...rest.data } as Record<string, unknown>;
            for (const field of IMAGE_FIELDS) {
              if (typeof data[field] === "string" && (data[field] as string).startsWith("data:")) {
                data[field] = null;
              }
            }
            if (Array.isArray(data["inputImages"])) data["inputImages"] = [];
            return { ...rest, data };
          });

          const workflow = {
            version: 1,
            name: state.workflowName || "untitled",
            nodes: strippedNodes,
            edges: state.edges,
            edgeStyle: state.edgeStyle,
            groups: state.groups && Object.keys(state.groups).length > 0 ? state.groups : undefined,
          };
          const blob = new Blob(
            [JSON.stringify({ id: state.boardId, workflowData: JSON.stringify(workflow) })],
            { type: "application/json" }
          );
          navigator.sendBeacon("/api/boards", blob);
        } catch {
          // sendBeacon may fail on some browsers, that's OK
        }
        return; // Don't show prompt for boards
      }
      // For non-board workflows: show the save prompt
      if (state.hasUnsavedChanges) {
        e.preventDefault();
      }
    };

    // Also save when tab becomes hidden (before close, on mobile, etc.)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const state = useWorkflowStore.getState();
        if (state.boardId && state.hasUnsavedChanges) {
          state.saveToBoard();
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <ReactFlowProvider>
      <div className="h-screen flex flex-col">
        <Header />
        <WorkflowCanvas />
        <FloatingActionBar />
        <AnnotationModal />
      </div>
    </ReactFlowProvider>
  );
}
