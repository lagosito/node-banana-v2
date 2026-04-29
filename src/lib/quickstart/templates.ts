import { WorkflowFile } from "@/store/workflowStore";
import { TemplateCategory, TemplateMetadata } from "@/types/quickstart";

export type ContentLevel = "empty" | "minimal" | "full";

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // SVG path or emoji
  category: TemplateCategory;
  tags: string[]; // Provider tags (e.g., "Gemini", "Replicate")
  workflow: Omit<WorkflowFile, "id">;
}

// Sample images from public/sample-images folder
export const SAMPLE_IMAGES = {
  // Products
  appleWatch: "/sample-images/apple-watch.jpg",
  watch: "/sample-images/watch.jpg",
  cosmetics: "/sample-images/cosmetics.jpg",
  skincare: "/sample-images/skincare.jpg",
  nikeShoe: "/sample-images/nike-shoe.jpg",
  shoes: "/sample-images/shoes.jpg",
  rayban: "/sample-images/rayban.jpg",
  // Models
  model: "/sample-images/model.png",
  model2: "/sample-images/model-2.jpg",
  model3: "/sample-images/model-3.jpg",
  model4: "/sample-images/model-4.jpg",
  model5: "/sample-images/model-5.jpg",
  model6: "/sample-images/model-6.jpg",
  model7: "/sample-images/model-7.jpg",
  // Scenes
  buildingSide: "/sample-images/building-side.jpg",
  desert: "/sample-images/desert.jpg",
  greenWallStreet: "/sample-images/green-wall-street.jpg",
  houseLake: "/sample-images/house-lake.jpg",
  nyStreet: "/sample-images/ny-street.jpg",
  nyStreet2: "/sample-images/ny-street-2.jpg",
  streetScene: "/sample-images/street-scene.jpg",
  streetScene1: "/sample-images/street-scene-1.jpg",
  streetScene2: "/sample-images/street-scene-2.jpg",
  // Colors/Textures
  colorPaint: "/sample-images/color-paint.jpg",
  colorPastel: "/sample-images/color-pastel.jpg",
  colorWall: "/sample-images/color-wall.jpg",
  // Animals
  donkey: "/sample-images/donkey.jpg",
  owl: "/sample-images/owl.jpg",
  // Reference images for templates
  newBgModelProduct: "/sample-images/new-bg-model-product.png",
  styleTransferReference: "/sample-images/style-transfer-reference.png",
};

// Default node dimensions for consistent layouts
const NODE_DIMENSIONS = {
  imageInput: { width: 300, height: 280 },
  annotation: { width: 300, height: 280 },
  prompt: { width: 320, height: 220 },
  promptConstructor: { width: 340, height: 300 },
  array: { width: 320, height: 360 },
  nanoBanana: { width: 300, height: 300 },
  llmGenerate: { width: 320, height: 360 },
  output: { width: 320, height: 320 },
  outputGallery: { width: 360, height: 400 },
};

// Default node data factories
const createImageInputData = (imageUrl: string | null = null, filename: string | null = null) => ({
  image: imageUrl,
  filename: filename,
  dimensions: imageUrl ? { width: 800, height: 600 } : null,
});

const createPromptData = (prompt: string = "") => ({
  prompt,
});

const createNanoBananaData = () => ({
  inputImages: [],
  inputPrompt: null,
  outputImage: null,
  aspectRatio: "1:1" as const,
  resolution: "1K" as const,
  model: "nano-banana-pro" as const,
  useGoogleSearch: false,
  useImageSearch: false,
  status: "idle" as const,
  error: null,
  imageHistory: [],
  selectedHistoryIndex: 0,
});

const createLLMGenerateData = () => ({
  inputPrompt: null,
  inputImages: [],
  outputText: null,
  provider: "google" as const,
  model: "gemini-3-flash-preview" as const,
  temperature: 0.7,
  maxTokens: 8192,
  status: "idle" as const,
  error: null,
});

const createAnnotationData = () => ({
  sourceImage: null,
  annotations: [],
  outputImage: null,
});

const createOutputData = () => ({
  image: null,
});

// Content for each template at each level
interface TemplateContent {
  prompts: Record<string, string>; // nodeId -> prompt content
  images: Record<string, { url: string; filename: string }>; // nodeId -> image info
}

const TEMPLATE_CONTENT: Record<string, Record<ContentLevel, TemplateContent>> = {
  "kiosk-campaign": {
    empty: {
      prompts: {},
      images: {},
    },
    minimal: {
      prompts: {},
      images: {},
    },
    full: {
      prompts: {},
      images: {},
    },
  },
  "product-shot": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Place the product in the scene shown in the reference image.\n\nConsider:\n- Match the lighting direction and quality\n- Maintain realistic scale and perspective\n- Blend shadows naturally\n- Keep product details sharp and clear",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Place the Nike shoe on the desert sand dunes. Match the warm golden hour lighting from the desert scene. Position the shoe at a dynamic angle showing the sole and side profile. Add subtle sand particles around the shoe and soft shadows that match the desert lighting direction. The final image should look like a professional outdoor product shoot.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.nikeShoe, filename: "nike-shoe.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.desert, filename: "desert.jpg" },
      },
    },
  },
  "model-product": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Show the model wearing or using the product.\n\nConsider:\n- Natural pose and interaction with product\n- Consistent lighting between model and product\n- Realistic scale and proportions\n- Professional fashion/lifestyle photography style",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a fashion advertisement showing the model wearing the Ray-Ban sunglasses. The model should be in a confident, stylish pose with the sunglasses naturally positioned. Use the urban street scene as the background. Match the lighting to create a cohesive lifestyle shot. The result should look like a high-end eyewear campaign photo.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.model, filename: "model.png" },
        "imageInput-2": { url: SAMPLE_IMAGES.rayban, filename: "rayban.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.newBgModelProduct, filename: "new-bg-model-product.png" },
      },
    },
  },
  "color-variations": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Generate color variations of the product using the color palette from the reference images.\n\nConsider:\n- Extract dominant colors from each reference\n- Apply colors naturally to the product\n- Maintain product shape and details\n- Keep realistic material properties",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a new version of the Apple Watch using the vibrant color palette from the paint and pastel reference images. Apply a gradient or color-blocked design inspired by these colors. Keep the watch's shape, screen, and details intact. The result should look like a special edition colorway that could be part of a product line expansion.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.appleWatch, filename: "apple-watch.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.colorPaint, filename: "color-paint.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.colorPastel, filename: "color-pastel.jpg" },
      },
    },
  },
  "background-swap": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Place the subject from the first image into the new background scene.\n\nConsider:\n- Extract subject cleanly from original\n- Match perspective and scale to new scene\n- Adjust lighting to match background\n- Blend edges naturally",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Place the model in front of the colorful wall background. Adjust the lighting on the model to match the soft, diffused light in the wall scene. Position the model naturally as if they were photographed in this location. Ensure smooth edge blending and consistent color temperature throughout the composite.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.model3, filename: "model-3.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.colorWall, filename: "color-wall.jpg" },
      },
    },
  },
  "style-transfer": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Apply the visual style from the first image to the content of the second image.\n\nConsider:\n- Extract color palette and mood\n- Apply texture and lighting style\n- Maintain subject recognizability\n- Create cohesive final result",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Transform the uploaded owl photo into a soft watercolor children's book illustration, matching a delicate hand-painted storybook style. Show me only the owl with no background",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.styleTransferReference, filename: "style-transfer-reference.png" },
        "imageInput-2": { url: SAMPLE_IMAGES.owl, filename: "owl.jpg" },
      },
    },
  },
  "scene-composite": {
    empty: {
      prompts: { "prompt-1": "" },
      images: {},
    },
    minimal: {
      prompts: {
        "prompt-1": "Combine elements from multiple scene images into a cohesive new scene.\n\nConsider:\n- Select complementary elements from each\n- Unify lighting direction and quality\n- Create natural depth and composition\n- Blend atmospheres seamlessly",
      },
      images: {},
    },
    full: {
      prompts: {
        "prompt-1": "Create a new urban scene that combines the architectural elements from the NY street views with the greenery and plants from the green wall street image. Imagine a futuristic eco-city where nature has reclaimed urban spaces. Vines and plants grow on building facades, green walls line the streets, but the classic NY architecture remains visible. Unify the lighting to suggest late afternoon golden hour.",
      },
      images: {
        "imageInput-1": { url: SAMPLE_IMAGES.nyStreet, filename: "ny-street.jpg" },
        "imageInput-2": { url: SAMPLE_IMAGES.nyStreet2, filename: "ny-street-2.jpg" },
        "imageInput-3": { url: SAMPLE_IMAGES.greenWallStreet, filename: "green-wall-street.jpg" },
      },
    },
  },
};

const createOutputGalleryData = () => ({
  images: [],
});

const createPromptConstructorData = (template: string = "") => ({
  template,
  outputText: null,
  unresolvedVars: [],
});

const createArrayData = () => ({
  inputText: null,
  splitMode: "delimiter" as const,
  delimiter: "*",
  regexPattern: "",
  trimItems: true,
  removeEmpty: true,
  batchMode: false,
  selectedOutputIndex: null,
  outputItems: [],
  outputText: null,
  error: null,
});

// Visual Bible system prompt (fixed, not editable by user)
const VISUAL_BIBLE_SYSTEM_PROMPT =
  "You have been given a brand's images. Create a visual guide that can be used to produce more visuals in the style of this brand.";

// Creative Director system prompt (fixed)
const CREATIVE_DIRECTOR_SYSTEM_PROMPT = `You are a professional magazine photographer who specialises in creating art directed prompts for AI image generators such as Nano Banana Pro.

You will be given an idea for a prompt and an image of a product.

Your task is to generate 10 diverse, high-end prompts for image generation.

Take the user prompt into high account when creating your new prompts.

FORMAT:
- Separate each prompt by a *
- Output as a list: prompt1* prompt2* prompt3*
- No additional context, commentary, thoughts, analysis (just the raw prompts)`;

// Prompt Constructor template — concatenates system prompt + Visual Bible output
const PROMPT_CONSTRUCTOR_TEMPLATE = `@system_prompt

Here is the visual style guide for this brand:

@visual_bible`;

// Preset templates
export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "kiosk-campaign",
    name: "Kiosk Campaign",
    description: "10 brand images → Visual Bible → Creative Director → 10 product shots",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    category: "advanced",
    tags: ["Gemini", "Kiosk"],
    workflow: {
      version: 1,
      name: "Kiosk Campaign",
      edgeStyle: "curved",
      nodes: [
        // ── Phase 1: Visual Bible — 10 brand image inputs (5×2 grid) ──
        ...Array.from({ length: 10 }, (_, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          return {
            id: `brand-${i + 1}`,
            type: "imageInput" as const,
            position: { x: 50 + col * 320, y: 50 + row * 300 },
            data: createImageInputData(),
            style: NODE_DIMENSIONS.imageInput,
          };
        }),
        // Visual Bible system prompt (fixed)
        {
          id: "vb-system",
          type: "prompt" as const,
          position: { x: 50, y: 1570 },
          data: createPromptData(VISUAL_BIBLE_SYSTEM_PROMPT),
          style: { ...NODE_DIMENSIONS.prompt, height: 280 },
        },
        // Visual Bible LLM (Gemini 3 Pro with vision)
        {
          id: "visual-bible",
          type: "llmGenerate" as const,
          position: { x: 720, y: 600 },
          data: {
            ...createLLMGenerateData(),
            model: "gemini-3-pro-preview" as const,
            maxTokens: 4096,
            customTitle: "Visual Bible",
          },
          style: NODE_DIMENSIONS.llmGenerate,
        },

        // ── Phase 2: Creative Director ──
        // Product image input
        {
          id: "product",
          type: "imageInput" as const,
          position: { x: 50, y: 1920 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        // User prompt (loose description of desired output)
        {
          id: "user-prompt",
          type: "prompt" as const,
          position: { x: 50, y: 2260 },
          data: createPromptData("messy bathroom image with the product on the bench top"),
          style: NODE_DIMENSIONS.prompt,
        },
        // System prompt for Creative Director (named variable)
        {
          id: "cd-system",
          type: "prompt" as const,
          position: { x: 50, y: 2540 },
          data: {
            ...createPromptData(CREATIVE_DIRECTOR_SYSTEM_PROMPT),
            variableName: "system_prompt",
          },
          style: { ...NODE_DIMENSIONS.prompt, height: 380 },
        },
        // Prompt Constructor — concatenates cd-system + Visual Bible output
        {
          id: "concat",
          type: "promptConstructor" as const,
          position: { x: 1120, y: 1920 },
          data: createPromptConstructorData(PROMPT_CONSTRUCTOR_TEMPLATE),
          style: NODE_DIMENSIONS.promptConstructor,
        },
        // Creative Director LLM
        {
          id: "creative-director",
          type: "llmGenerate" as const,
          position: { x: 1520, y: 1920 },
          data: {
            ...createLLMGenerateData(),
            model: "gemini-3-pro-preview" as const,
            maxTokens: 8192,
            customTitle: "Creative Director",
          },
          style: NODE_DIMENSIONS.llmGenerate,
        },

        // ── Phase 3: Split & Generate ──
        // Array node — splits Creative Director output by "*"
        {
          id: "prompts-array",
          type: "array" as const,
          position: { x: 1920, y: 1920 },
          data: createArrayData(),
          style: NODE_DIMENSIONS.array,
        },
      ],
      edges: [
        // ── Phase 1: brand images → Visual Bible ──
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `edge-brand-${i + 1}-vb`,
          source: `brand-${i + 1}`,
          sourceHandle: "image",
          target: "visual-bible",
          targetHandle: "image",
        })),
        // vb-system prompt → Visual Bible (text input)
        {
          id: "edge-vb-system-vb",
          source: "vb-system",
          sourceHandle: "text",
          target: "visual-bible",
          targetHandle: "text",
        },

        // ── Phase 2: Prompt Constructor ──
        // cd-system → concat (text input)
        {
          id: "edge-cd-system-concat",
          source: "cd-system",
          sourceHandle: "text",
          target: "concat",
          targetHandle: "text",
        },
        // Visual Bible output → concat (text input — <var> tags parsed)
        {
          id: "edge-vb-concat",
          source: "visual-bible",
          sourceHandle: "text",
          target: "concat",
          targetHandle: "text",
        },
        // Prompt Constructor → Creative Director (system prompt)
        {
          id: "edge-concat-cd",
          source: "concat",
          sourceHandle: "text",
          target: "creative-director",
          targetHandle: "text",
        },
        // Product image → Creative Director
        {
          id: "edge-product-cd",
          source: "product",
          sourceHandle: "image",
          target: "creative-director",
          targetHandle: "image",
        },

        // ── Phase 3: Creative Director → Array ──
        {
          id: "edge-cd-array",
          source: "creative-director",
          sourceHandle: "text",
          target: "prompts-array",
          targetHandle: "text",
        },
      ],
      groups: {
        "group-phase1": {
          id: "group-phase1",
          name: "Step 1: Visual Bible — Upload brand images",
          color: "blue",
          position: { x: 20, y: 20 },
          size: { width: 1380, height: 1880 },
        },
        "group-phase2": {
          id: "group-phase2",
          name: "Step 2: Creative Director — Upload product + write prompt",
          color: "purple",
          position: { x: 20, y: 1890 },
          size: { width: 2260, height: 1080 },
        },
        "group-phase3": {
          id: "group-phase3",
          name: "Step 3: Click \"Auto-route\" on Array node → generates 10 image branches",
          color: "green",
          position: { x: 1890, y: 1890 },
          size: { width: 380, height: 1080 },
        },
      },
    },
  },
  {
    id: "product-shot",
    name: "Product Shot",
    description: "Place product in a new scene or environment",
    icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Product Shot",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "model-product",
    name: "Model + Product",
    description: "Combine model, product, and scene",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Model + Product",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "color-variations",
    name: "Color Variations",
    description: "Generate product color variants from references",
    icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Color Variations",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "background-swap",
    name: "Background Swap",
    description: "Place subject in a new background",
    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Background Swap",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "style-transfer",
    name: "Style Transfer",
    description: "Apply style from one image to another",
    icon: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Style Transfer",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 430 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 760 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "scene-composite",
    name: "Scene Composite",
    description: "Combine elements from multiple scenes",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    category: "simple",
    tags: ["Gemini"],
    workflow: {
      version: 1,
      name: "Scene Composite",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 650 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 300 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 290 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
];

/**
 * Get a preset template with content adjusted for the specified level
 */
export function getPresetTemplate(
  templateId: string,
  contentLevel: ContentLevel
): WorkflowFile {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const content = TEMPLATE_CONTENT[templateId]?.[contentLevel];
  if (!content) {
    throw new Error(`Content not found for ${templateId} at level ${contentLevel}`);
  }

  // Clone the workflow and apply content
  const workflow: WorkflowFile = {
    ...template.workflow,
    id: `wf_${Date.now()}_${templateId}`,
    nodes: template.workflow.nodes.map((node) => {
      const clonedNode = { ...node, data: { ...node.data } };

      // Apply prompt content
      if (node.type === "prompt" && content.prompts[node.id] !== undefined) {
        clonedNode.data = {
          ...clonedNode.data,
          prompt: content.prompts[node.id],
        };
      }

      // Apply image content for "full" level
      if (node.type === "imageInput" && content.images[node.id]) {
        const imageInfo = content.images[node.id];
        clonedNode.data = {
          ...clonedNode.data,
          image: imageInfo.url,
          filename: imageInfo.filename,
          dimensions: { width: 800, height: 600 },
        };
      }

      return clonedNode;
    }),
    edges: template.workflow.edges.map((edge) => ({ ...edge })),
  };

  return workflow;
}

/**
 * Get all preset templates for display
 */
export function getAllPresets(): Pick<PresetTemplate, "id" | "name" | "description" | "icon" | "category" | "tags">[] {
  return PRESET_TEMPLATES.map(({ id, name, description, icon, category, tags }) => ({
    id,
    name,
    description,
    icon,
    category,
    tags,
  }));
}

/**
 * Get metadata for a template, extracting node count from workflow
 */
export function getTemplateMetadata(template: PresetTemplate): TemplateMetadata {
  return {
    nodeCount: template.workflow.nodes.length,
    category: template.category,
    tags: template.tags,
  };
}

/**
 * Get a preset template with full data including metadata
 */
export function getPresetWithMetadata(templateId: string): (PresetTemplate & { metadata: TemplateMetadata }) | null {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return null;
  }
  return {
    ...template,
    metadata: getTemplateMetadata(template),
  };
}

/**
 * Export template content for use in API route (for fetching images)
 */
export function getTemplateContent(templateId: string, contentLevel: ContentLevel): TemplateContent | null {
  return TEMPLATE_CONTENT[templateId]?.[contentLevel] || null;
}
