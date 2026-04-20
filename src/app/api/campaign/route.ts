/**
 * Campaign Generator API Route
 *
 * Orchestrates a full campaign generation:
 * 1. LLM generates strategy (5 image prompts, 3 video prompts, 5 captions+hashtags)
 * 2. Images generated in parallel via Gemini
 * 3. Returns complete campaign package
 */
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 300; // 5 minutes
export const dynamic = "force-dynamic";

interface CampaignRequest {
  clientName: string;
  objective: string;
  platform: string;
  brandColors?: string;
  tone: string;
}

interface CampaignStrategy {
  imagePrompts: string[];
  videoPrompts: string[];
  captions: { text: string; hashtags: string[] }[];
}

async function generateStrategy(
  apiKey: string,
  req: CampaignRequest
): Promise<CampaignStrategy> {
  const ai = new GoogleGenAI({ apiKey });

  const platformContext: Record<string, string> = {
    instagram: "Instagram (square 1:1 or portrait 4:5 images, Reels for video)",
    facebook: "Facebook (landscape 16:9 or square 1:1, feed posts and stories)",
    tiktok: "TikTok (vertical 9:16 video-first, bold and trendy)",
    linkedin: "LinkedIn (professional, landscape 16:9, business-focused)",
    all: "All major platforms (Instagram, Facebook, TikTok, LinkedIn)",
  };

  const prompt = `You are a creative director for a marketing agency. Generate a complete campaign package for the following brief:

CLIENT: ${req.clientName}
OBJECTIVE: ${req.objective}
PLATFORM: ${platformContext[req.platform] || req.platform}
TONE: ${req.tone}
${req.brandColors ? `BRAND COLORS: ${req.brandColors}` : ""}

Generate the following in JSON format (respond ONLY with valid JSON, no markdown):

{
  "imagePrompts": [
    // 5 detailed image generation prompts for AI image generation (Gemini/nano-banana)
    // Each prompt should describe a COMPLETE scene with specific visual details
    // Include: subject, setting, lighting, mood, composition, style
    // Make them diverse: product shot, lifestyle, abstract, close-up, environment
    // Do NOT include text/typography in image prompts
  ],
  "videoPrompts": [
    // 3 video generation prompts
    // Each should describe a 5-15 second video clip
    // Include: opening shot, movement/action, closing shot, mood
    // Good for text-to-video AI generation
  ],
  "captions": [
    // 5 social media captions with hashtags
    // Each caption: engaging, ${req.tone} tone, platform-appropriate length
    // Include a clear CTA (call to action)
    // Each should pair well with one of the image prompts
  ]
}

IMPORTANT RULES:
- Image prompts must be in English (best AI generation results)
- Captions should be in the language of the objective (match the user's language)
- Hashtags should be relevant, mix of popular and niche
- Make the content specifically about: ${req.clientName} — ${req.objective}
- Be creative and specific, not generic`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      temperature: 0.8,
      maxOutputTokens: 4096,
    },
  });

  const text = response.text || "";

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      imagePrompts: parsed.imagePrompts?.slice(0, 5) || [],
      videoPrompts: parsed.videoPrompts?.slice(0, 3) || [],
      captions: parsed.captions?.slice(0, 5) || [],
    };
  } catch {
    console.error("[Campaign] Failed to parse LLM response:", text);
    throw new Error("Failed to parse campaign strategy. Please try again.");
  }
}

async function generateImage(
  apiKey: string,
  prompt: string,
  brandColors?: string
): Promise<{ prompt: string; base64?: string; error?: string }> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    const fullPrompt = brandColors
      ? `${prompt}. Brand colors: ${brandColors}. High quality, professional photography style.`
      : `${prompt}. High quality, professional photography style.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: fullPrompt,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    });

    // Extract image from response
    const candidates = response.candidates;
    if (!candidates?.[0]?.content?.parts) {
      return { prompt, error: "No image generated" };
    }

    for (const part of candidates[0].content.parts) {
      if (part.inlineData?.data) {
        return { prompt, base64: part.inlineData.data };
      }
    }

    return { prompt, error: "No image in response" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    console.error(`[Campaign] Image generation failed for prompt "${prompt.slice(0, 50)}...":`, msg);
    return { prompt, error: msg };
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: CampaignRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.clientName?.trim() || !body.objective?.trim()) {
    return NextResponse.json(
      { error: "clientName and objective are required" },
      { status: 400 }
    );
  }

  const requestId = `campaign-${Date.now()}`;
  console.log(`[${requestId}] Starting campaign for: ${body.clientName}`);

  try {
    // Step 1: Generate strategy via LLM
    console.log(`[${requestId}] Step 1: Generating strategy...`);
    const strategy = await generateStrategy(apiKey, body);
    console.log(
      `[${requestId}] Strategy ready: ${strategy.imagePrompts.length} images, ${strategy.videoPrompts.length} videos, ${strategy.captions.length} captions`
    );

    // Step 2: Generate images in parallel
    console.log(`[${requestId}] Step 2: Generating ${strategy.imagePrompts.length} images in parallel...`);
    const imageResults = await Promise.all(
      strategy.imagePrompts.map((prompt) =>
        generateImage(apiKey, prompt, body.brandColors)
      )
    );

    const successCount = imageResults.filter((r) => r.base64).length;
    console.log(`[${requestId}] Images done: ${successCount}/${imageResults.length} successful`);

    // Step 3: Return complete campaign
    return NextResponse.json({
      strategy,
      images: imageResults,
      videos: strategy.videoPrompts.map((prompt) => ({ prompt })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Campaign generation failed";
    console.error(`[${requestId}] Error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
