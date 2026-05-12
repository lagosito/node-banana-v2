/**
 * Volcengine ARK (Seedance 2.0) Provider for Generate API Route
 *
 * Handles video generation using Volcengine ARK API (Seedance 2.0).
 * Uses async task submission + polling pattern.
 *
 * API Docs:
 * - Base: https://ark.cn-beijing.volces.com/api/v3
 * - POST /contents/generations/tasks (create task)
 * - GET  /contents/generations/tasks/{task_id} (query task)
 */

import { GenerationInput, GenerationOutput } from "@/lib/providers/types";
import { validateMediaUrl } from "@/utils/urlValidation";

/** Volcengine task status values */
type VolcengineStatus = "queued" | "running" | "succeeded" | "failed" | "expired";

/**
 * Volcengine ARK API — Create task response
 * Format: { id: "task-id-here" }
 */
interface VolcengineCreateResponse {
  id?: string;
  error?: {
    message?: string;
  };
}

/**
 * Volcengine ARK API — Query task response
 * Format: { id, status, content: [{ type, video_url: { url } }], error: { message } }
 */
interface VolcengineQueryResponse {
  id?: string;
  status?: VolcengineStatus;
  content?: Array<{
    type?: string;
    video_url?: {
      url?: string;
    };
    image_url?: {
      url?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
  };
}

/**
 * Volcengine content item for the request body
 */
interface VolcengineContentItem {
  type: "text" | "image_url" | "video_url" | "audio_url";
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: string;
}

  // Map from our model IDs to actual BytePlus/Volcengine model IDs
function getVolcengineModelId(modelId: string): string {
  const map: Record<string, string> = {
    "seedance-2.0/text-to-video": "dreamina-seedance-2-0-260128",
    "seedance-2.0/image-to-video": "dreamina-seedance-2-0-260128",
    "seedance-2.0-fast/text-to-video": "dreamina-seedance-2-0-fast-260128",
    "seedance-2.0-fast/image-to-video": "dreamina-seedance-2-0-fast-260128",
  };
  return map[modelId] || modelId;
}

/**
 * Determine if a model is image-to-video (has image inputs)
 */
function isImageToVideo(modelId: string): boolean {
  return modelId.includes("image-to-video");
}

/**
 * Build the content array for the Volcengine ARK API request body.
 *
 * The content array supports multiple content types with roles:
 * - text: the prompt text
 * - image_url (role: "first_frame", "last_frame", or "reference_image")
 * - video_url (role: "reference_video")
 * - audio_url (role: "reference_audio")
 */
function buildContentArray(
  input: GenerationInput,
  modelId: string
): VolcengineContentItem[] {
  const content: VolcengineContentItem[] = [];

  // Add prompt text (always)
  content.push({ type: "text", text: input.prompt });

  // Process dynamic inputs for media content
  if (input.dynamicInputs && Object.keys(input.dynamicInputs).length > 0) {
    for (const [key, value] of Object.entries(input.dynamicInputs)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      const val = Array.isArray(value) ? value[0] : value;
      if (!val) continue;

      if (key === "first_frame" || key === "last_frame" || key === "reference_image") {
        content.push({
          type: "image_url",
          image_url: { url: val },
          role: key,
        });
      } else if (key === "reference_video") {
        content.push({
          type: "video_url",
          video_url: { url: val },
          role: key,
        });
      } else if (key === "reference_audio") {
        content.push({
          type: "audio_url",
          audio_url: { url: val },
          role: key,
        });
      }
    }
  } else if (input.images && input.images.length > 0) {
    // Fallback: images array becomes first_frame
    content.push({
      type: "image_url",
      image_url: { url: input.images[0] },
      role: "first_frame",
    });
  }

  return content;
}

/**
 * Generate video using Volcengine ARK API (Seedance 2.0)
 * Uses async task submission + polling with 2-second interval, 5-minute timeout.
 */
export async function generateWithVolcengine(
  requestId: string,
  volcengineApiKey: string,
  input: GenerationInput,
  byteplusApiKey?: string
): Promise<GenerationOutput> {
  // Support both BytePlus ARK (international) and Volcengine ARK (China)
  const apiKey = byteplusApiKey || volcengineApiKey;
  const isByteplus = !!byteplusApiKey;
  const ARK_API_BASE = isByteplus
    ? "https://ark.ap-southeast.bytepluses.com/api/v3"
    : "https://ark.cn-beijing.volces.com/api/v3";

  console.log(`[API:${requestId}] Volcengine generation (${isByteplus ? 'BytePlus' : 'Volcengine CN'}) - Model: ${input.model.id}, Prompt: ${input.prompt.length} chars`);

  const modelId = input.model.id;

  // Validate modelId to prevent injection
  if (/[^a-zA-Z0-9\-_/.]/.test(modelId) || modelId.includes('..')) {
    return { success: false, error: `Invalid model ID: ${modelId}` };
  }

  // Map to actual Volcengine model/endpoint ID
  const volcengineModelId = getVolcengineModelId(modelId);
  const isVideoModel = true; // All Volcengine models are video models

  // Build the content array
  const content = buildContentArray(input, modelId);

  // Build payload with parameters
  const payload: Record<string, unknown> = {
    model: volcengineModelId,
    content,
  };

  // Apply parameters (ratio, duration, resolution, generate_audio, watermark, seed)
  if (input.parameters) {
    if (input.parameters.ratio) payload.ratio = input.parameters.ratio;
    if (input.parameters.duration !== undefined && input.parameters.duration !== null && input.parameters.duration !== -1) {
      payload.duration = input.parameters.duration;
    }
    if (input.parameters.resolution) payload.resolution = input.parameters.resolution;
    if (input.parameters.generate_audio !== undefined) {
      payload.generate_audio = input.parameters.generate_audio;
    }
    if (input.parameters.watermark !== undefined) {
      payload.watermark = input.parameters.watermark;
    }
    if (input.parameters.seed !== undefined && input.parameters.seed !== -1) {
      payload.seed = input.parameters.seed;
    }
  }

  console.log(`[API:${requestId}] Volcengine payload: ${JSON.stringify({ ...payload, content: `${content.length} items` }).substring(0, 500)}`);

  // Submit task
  const submitUrl = `${ARK_API_BASE}/contents/generations/tasks`;
  console.log(`[API:${requestId}] Volcengine submit URL: ${submitUrl}`);

  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    let errorDetail = errorText || `HTTP ${submitResponse.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorDetail = errorJson.error?.message || errorJson.error || errorJson.message || errorJson.detail || errorDetail;
    } catch {
      // Keep original text
    }

    console.error(`[API:${requestId}] Volcengine submit failed: ${submitResponse.status} - ${errorDetail}`);

    if (submitResponse.status === 429) {
      return {
        success: false,
        error: `${input.model.name || "Seedance"}: Rate limit exceeded. Try again in a moment.`,
      };
    }

    return {
      success: false,
      error: `${input.model.name || "Seedance"}: ${errorDetail}`,
    };
  }

  const submitResult: VolcengineCreateResponse = await submitResponse.json();
  console.log(`[API:${requestId}] Volcengine submit response: ${JSON.stringify(submitResult).substring(0, 300)}`);

  const taskId = submitResult.id;
  if (!taskId) {
    console.error(`[API:${requestId}] No task ID in Volcengine submit response`);
    return {
      success: false,
      error: "Volcengine: No task ID returned from API",
    };
  }

  console.log(`[API:${requestId}] Volcengine task submitted: ${taskId}`);

  // Poll for completion
  // Status flow: queued → running → succeeded/failed/expired
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 2000; // 2 seconds
  const startTime = Date.now();
  let lastStatus = "";

  while (true) {
    if (Date.now() - startTime > maxWaitTime) {
      console.error(`[API:${requestId}] Volcengine task timed out after 5 minutes`);
      return {
        success: false,
        error: `${input.model.name}: Generation timed out after 5 minutes`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const pollUrl = `${ARK_API_BASE}/contents/generations/tasks/${taskId}`;
      const pollResponse = await fetch(pollUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`[API:${requestId}] Volcengine poll (${elapsedSec}s): ${pollResponse.status}`);

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        let errorDetail = errorText || `HTTP ${pollResponse.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetail = errorJson.error?.message || errorJson.error || errorJson.message || errorJson.detail || errorDetail;
        } catch {
          // Keep original text
        }
        console.error(`[API:${requestId}] Volcengine poll failed: ${pollResponse.status} - ${errorDetail}`);
        return {
          success: false,
          error: `${input.model.name}: ${errorDetail}`,
        };
      }

      const pollData: VolcengineQueryResponse = await pollResponse.json();
      const currentStatus = pollData.status;

      // Log status changes
      if (currentStatus !== lastStatus) {
        console.log(`[API:${requestId}] Volcengine status changed: ${lastStatus} → ${currentStatus}`);
        lastStatus = currentStatus || "";
      }

      // Handle terminal states
      if (currentStatus === "succeeded") {
        console.log(`[API:${requestId}] Volcengine task succeeded`);
        // Extract video URL from content
        const videoContent = pollData.content?.find((c) => c.type === "video_url");
        const videoUrl = videoContent?.video_url?.url;

        if (!videoUrl) {
          console.error(`[API:${requestId}] No video URL in succeeded response. Response: ${JSON.stringify(pollData).substring(0, 500)}`);
          return {
            success: false,
            error: `${input.model.name}: No video URL in generation result`,
          };
        }

        // Validate URL before fetching
        const urlCheck = validateMediaUrl(videoUrl);
        if (!urlCheck.valid) {
          return { success: false, error: `Invalid output URL: ${urlCheck.error}` };
        }

        console.log(`[API:${requestId}] Fetching Volcengine output from: ${videoUrl.substring(0, 80)}...`);

        const outputResponse = await fetch(videoUrl);

        if (!outputResponse.ok) {
          return {
            success: false,
            error: `Failed to fetch output: ${outputResponse.status}`,
          };
        }

        // Check file size before downloading body
        const MAX_MEDIA_SIZE = 500 * 1024 * 1024; // 500MB
        const contentLength = parseInt(outputResponse.headers.get("content-length") || "0", 10);
        if (!isNaN(contentLength) && contentLength > MAX_MEDIA_SIZE) {
          return { success: false, error: `Media too large: ${(contentLength / (1024 * 1024)).toFixed(0)}MB > 500MB limit` };
        }

        const outputArrayBuffer = await outputResponse.arrayBuffer();
        if (outputArrayBuffer.byteLength > MAX_MEDIA_SIZE) {
          return { success: false, error: `Media too large: ${(outputArrayBuffer.byteLength / (1024 * 1024)).toFixed(0)}MB > 500MB limit` };
        }
        const outputSizeMB = outputArrayBuffer.byteLength / (1024 * 1024);

        const rawContentType = outputResponse.headers.get("content-type");
        const contentType =
          (rawContentType && rawContentType.startsWith("video/"))
            ? rawContentType
            : "video/mp4";

        console.log(`[API:${requestId}] Output: ${contentType}, ${outputSizeMB.toFixed(2)}MB`);

        // For very large videos (>20MB), return URL only
        if (outputSizeMB > 20) {
          console.log(`[API:${requestId}] SUCCESS - Returning URL for large video`);
          return {
            success: true,
            outputs: [
              {
                type: "video",
                data: "",
                url: videoUrl,
              },
            ],
          };
        }

        const outputBase64 = Buffer.from(outputArrayBuffer).toString("base64");

        console.log(`[API:${requestId}] SUCCESS - Returning video`);
        return {
          success: true,
          outputs: [
            {
              type: "video",
              data: `data:${contentType};base64,${outputBase64}`,
              url: videoUrl,
            },
          ],
        };
      }

      // Check for failure
      if (currentStatus === "failed" || currentStatus === "expired") {
        const reason = pollData.error?.message || `Generation ${currentStatus}`;
        console.error(`[API:${requestId}] Volcengine task ${currentStatus}: ${reason}`);
        return {
          success: false,
          error: `${input.model.name}: ${reason}`,
        };
      }

      // Continue polling for "queued" or "running"
    } catch (pollError) {
      const message = pollError instanceof Error ? pollError.message : String(pollError);
      console.error(`[API:${requestId}] Volcengine poll error: ${message}`);
      return {
        success: false,
        error: `${input.model.name}: ${message}`,
      };
    }
  }
}