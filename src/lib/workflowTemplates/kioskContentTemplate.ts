/**
 * Kiosk Content Workflow Template
 *
 * Pre-built 3-step workflow for El Kiosk content generation:
 * Step 1: Brand Reference Images (up to 10 slots)
 * Step 2: Product Image + Prompt
 * Step 3: AI Generation → Output Gallery
 */

import type { WorkflowNode, WorkflowEdge } from "@/types";

interface BrandDnaContext {
  primaryColor?: string;
  brandTone?: string;
  brandEssence?: string;
}

interface KioskTemplateResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export function createKioskContentTemplate(
  brandDna?: BrandDnaContext
): KioskTemplateResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // ── Step 1: Brand Reference Images (10 slots, 2 rows of 5) ──────────
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
        isOptional: true,
        label: `Brand Ref ${i + 1}`,
      } as any,
      groupId: "group-brand",
    } as WorkflowNode);
  }

  // ── Step 2: Product Image + Prompt ────────────────────────────────────
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
    } as any,
    groupId: "group-product",
  } as WorkflowNode);

  const defaultPrompt = brandDna?.brandEssence
    ? `Create a professional marketing image for this product.\nBrand essence: ${brandDna.brandEssence}${brandDna.brandTone ? `\nTone: ${brandDna.brandTone}` : ""}\n\nDescribe your desired output here...`
    : "Describe your desired output here...";

  nodes.push({
    id: "prompt-1",
    type: "prompt",
    position: { x: 260, y: 40 },
    data: {
      prompt: defaultPrompt,
      label: "Content Prompt",
    } as any,
    groupId: "group-product",
  } as WorkflowNode);

  // ── Step 3: Generation ────────────────────────────────────────────────
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
    } as any,
    groupId: "group-generation",
  } as WorkflowNode);

  nodes.push({
    id: "output-1",
    type: "outputGallery",
    position: { x: 20, y: 220 },
    data: {
      images: [],
      label: "Output Gallery",
    } as any,
    groupId: "group-generation",
  } as WorkflowNode);

  // ── Edges ─────────────────────────────────────────────────────────────
  // Brand images → generate (10 image inputs)
  for (let i = 0; i < 10; i++) {
    edges.push({
      id: `edge-brand-${i}-gen`,
      source: `brand-img-${i}`,
      target: "generate-1",
      sourceHandle: "image",
      targetHandle: `image-${i}`,
    } as WorkflowEdge);
  }

  // Product image → generate (slot 10)
  edges.push({
    id: "edge-product-gen",
    source: "product-img",
    target: "generate-1",
    sourceHandle: "image",
    targetHandle: "image-10",
  } as WorkflowEdge);

  // Prompt → generate
  edges.push({
    id: "edge-prompt-gen",
    source: "prompt-1",
    target: "generate-1",
    sourceHandle: "text",
    targetHandle: "text",
  } as WorkflowEdge);

  // Generate → output gallery
  edges.push({
    id: "edge-gen-output",
    source: "generate-1",
    target: "output-1",
    sourceHandle: "image",
    targetHandle: "images",
  } as WorkflowEdge);

  return {
    nodes,
    edges,
    viewport: { x: 50, y: 50, zoom: 0.8 },
  };
}
