#!/usr/bin/env python3
"""
Generate the full El Kiosk Starter workflow JSON.

Run from repo root:
    python3 scripts/gen-starter-workflow.py

Output: public/workflows/elkiosk-starter.json

Architecture (44 nodes total, 102 edges):
  - 1 Brand Context prompt
  - 1 Platform & Format prompt
  - 1 Content Planner (Claude, generates 10 post ideas)
  - 10 × post column, each with:
      - Mood/Vibe Image (imageInput — upload or drag image)
      - Image Prompt LLM (Claude, writes the visual prompt)
      - Nano Banana (Gemini, generates the image)
      - Copy Writer LLM (Claude, writes caption + hashtags + CTA)
  - 1 Output Gallery

Layout: 10 posts arranged in 2 rows of 5 columns.
"""
import json
from pathlib import Path

# Output location relative to repo root
OUT_PATH = Path("public/workflows/elkiosk-starter.json")

# ============ LAYOUT CONSTANTS ============
COL_WIDTH = 400
ROW_GAP = 120
MOOD_HEIGHT = 260
PROMPT_HEIGHT = 200
NANO_HEIGHT = 320
COPY_HEIGHT = 220

ROW1_Y = 380
ROW2_Y = 1500
GALLERY_X = 2160
GALLERY_Y = 900

# ============ STATIC NODES ============
nodes = [
    {
        "id": "prompt-brand",
        "type": "prompt",
        "position": {"x": 20, "y": 40},
        "groupId": "group-brand",
        "data": {
            "label": "Brand Context",
            "variableName": "brand_context",
            "prompt": (
                "⚠️ Load a client above to populate this automatically.\n\n"
                "Brand: [Client Name]\n"
                "Website: [website]\n"
                "Logo: [logo url]\n\n"
                "Colors:\n"
                "  Primary: [#primary]\n"
                "  Secondary: [#secondary]\n"
                "  Accent: [#accent]\n\n"
                "Typography:\n"
                "  Display: [display font]\n"
                "  Body: [body font]\n\n"
                "Tagline: [tagline]\n"
                "Tone: [tone tags]\n"
                "Aesthetic: [aesthetic tags]\n"
                "Target Audience: [audience]\n\n"
                "Do's: [dos]\n"
                "Don'ts: [donts]"
            ),
            "status": "idle",
            "error": None
        },
        "width": 360, "height": 300
    },
    {
        "id": "prompt-platform",
        "type": "prompt",
        "position": {"x": 400, "y": 40},
        "groupId": "group-brand",
        "data": {
            "label": "Platform & Format",
            "variableName": "platform",
            "prompt": (
                "Platforms: Instagram, Facebook\n"
                "Format: Square 1:1\n"
                "Tier: Starter (10 posts / month)\n"
                "Style: Feed post, high quality, on-brand\n"
                "Language: match brand native language (DE/EN)"
            ),
            "status": "idle",
            "error": None
        },
        "width": 300, "height": 200
    },
    {
        "id": "llm-content-planner",
        "type": "llmGenerate",
        "position": {"x": 720, "y": 40},
        "groupId": "group-brand",
        "data": {
            "label": "📋 Content Planner (10 ideas)",
            "inputPrompt": (
                "You are the content planner for a social media agency called El Kiosk. "
                "Using the Brand Context above, generate exactly 10 distinct post ideas "
                "for the next monthly delivery.\n\n"
                "Requirements:\n"
                "- Posts must be varied in angle: product highlight, behind-the-scenes, "
                "value/mission, user testimonial, educational tip, seasonal hook, community "
                "shout-out, brand story, offer/promo, aspirational/lifestyle.\n"
                "- Each idea must align with the brand's tone, aesthetic, target audience, "
                "and Do's/Don'ts.\n"
                "- Write in the brand's native language (German for DACH brands, English "
                "otherwise).\n\n"
                "Output format — return ONLY this, nothing else:\n\n"
                "POST 1: [one-sentence idea] | HOOK: [2-5 word visual hook] | CTA: [call to action]\n"
                "POST 2: ...\n"
                "...\n"
                "POST 10: ..."
            ),
            "inputImages": [],
            "outputText": None,
            "provider": "anthropic",
            "model": "claude-opus-4-5",
            "temperature": 0.85,
            "maxTokens": 1200,
            "status": "idle",
            "error": None
        },
        "width": 360, "height": 280
    }
]

edges = [
    {"id": "e-brand-planner", "source": "prompt-brand", "target": "llm-content-planner",
     "sourceHandle": "text", "targetHandle": "text"},
    {"id": "e-platform-planner", "source": "prompt-platform", "target": "llm-content-planner",
     "sourceHandle": "text", "targetHandle": "text"}
]


def image_prompt_instruction(n):
    return (
        f"You are the visual prompt engineer for Post #{n} of the monthly Starter delivery.\n\n"
        f"Inputs available in context:\n"
        f"- Brand Context (colors, fonts, tone, aesthetic, do's, don'ts, target audience)\n"
        f"- Platform & Format (square 1:1, Instagram/Facebook feed)\n"
        f"- Content Planner output (10 ideas — use idea #{n})\n"
        f"- Optional mood/vibe reference image attached as input\n\n"
        f"Write a single, highly-detailed image-generation prompt for Nano Banana Pro "
        f"that visualizes post #{n}. The prompt MUST:\n"
        f"- Describe the subject, composition, lighting, color palette, mood, and style.\n"
        f"- Reference the brand colors by hex when relevant.\n"
        f"- Honor the brand's aesthetic tags.\n"
        f"- If a mood reference image is attached, describe the style/vibe to emulate.\n"
        f"- Never include text overlays (we add those separately).\n"
        f"- Be ready to paste directly into an image model — no preamble, no explanations.\n\n"
        f"Output: just the prompt, 2-5 sentences, no markdown."
    )


def copy_instruction(n):
    return (
        f"You are the copywriter for Post #{n} of the monthly Starter delivery.\n\n"
        f"Inputs available in context:\n"
        f"- Brand Context (tone, do's/don'ts, tagline, target audience)\n"
        f"- Content Planner output (10 ideas — use idea #{n})\n"
        f"- Generated image (from Nano Banana)\n\n"
        f"Write the final social copy for Post #{n}. Output EXACTLY this structure "
        f"in the brand's native language (German for DACH brands, English otherwise):\n\n"
        f"CAPTION: [3-5 sentences, engaging, on-brand, emoji-friendly]\n"
        f"HASHTAGS: [8-12 hashtags, mix of branded + discoverability]\n"
        f"CTA: [1 clear call-to-action matching the post's goal]\n\n"
        f"Rules:\n"
        f"- Match the brand tone exactly.\n"
        f"- Respect Do's and Don'ts.\n"
        f"- No placeholders or ellipses. Final, ready-to-publish copy."
    )


# ============ GENERATE 10 POSTS ============
for i in range(1, 11):
    post_idx = i - 1
    row_idx = 0 if i <= 5 else 1
    col_idx = post_idx % 5
    base_x = 20 + col_idx * COL_WIDTH
    base_y = ROW1_Y if row_idx == 0 else ROW2_Y
    group_id = "group-row1" if row_idx == 0 else "group-row2"

    mood_id = f"mood-post-{i}"
    prompt_id = f"prompt-post-{i}"
    nano_id = f"nano-post-{i}"
    copy_id = f"copy-post-{i}"

    mood_y = base_y
    prompt_y = mood_y + MOOD_HEIGHT + ROW_GAP
    nano_y = prompt_y + PROMPT_HEIGHT + ROW_GAP
    copy_y = nano_y + NANO_HEIGHT + ROW_GAP

    nodes.append({
        "id": mood_id, "type": "imageInput",
        "position": {"x": base_x, "y": mood_y}, "groupId": group_id,
        "data": {
            "label": f"🎨 Post {i} — Mood/Vibe",
            "image": None, "filename": None, "dimensions": None,
            "isOptional": True, "status": "idle", "error": None
        },
        "width": 320, "height": MOOD_HEIGHT
    })

    nodes.append({
        "id": prompt_id, "type": "llmGenerate",
        "position": {"x": base_x, "y": prompt_y}, "groupId": group_id,
        "data": {
            "label": f"✍️ Post {i} — Image Prompt",
            "inputPrompt": image_prompt_instruction(i),
            "inputImages": [], "outputText": None,
            "provider": "anthropic", "model": "claude-opus-4-5",
            "temperature": 0.8, "maxTokens": 300,
            "status": "idle", "error": None
        },
        "width": 320, "height": PROMPT_HEIGHT
    })

    nodes.append({
        "id": nano_id, "type": "nanoBanana",
        "position": {"x": base_x, "y": nano_y}, "groupId": group_id,
        "data": {
            "label": f"🍌 Post {i} — Image",
            "inputImages": [], "inputPrompt": None, "outputImage": None,
            "aspectRatio": "1:1", "resolution": "1K",
            "model": "nano-banana-pro",
            "selectedModel": {
                "provider": "gemini", "modelId": "nano-banana-pro",
                "displayName": "Nano Banana Pro"
            },
            "useGoogleSearch": False, "useImageSearch": False,
            "status": "idle", "error": None,
            "imageHistory": [], "selectedHistoryIndex": 0
        },
        "width": 320, "height": NANO_HEIGHT
    })

    nodes.append({
        "id": copy_id, "type": "llmGenerate",
        "position": {"x": base_x, "y": copy_y}, "groupId": group_id,
        "data": {
            "label": f"📝 Post {i} — Copy",
            "inputPrompt": copy_instruction(i),
            "inputImages": [], "outputText": None,
            "provider": "anthropic", "model": "claude-opus-4-5",
            "temperature": 0.75, "maxTokens": 400,
            "status": "idle", "error": None
        },
        "width": 320, "height": COPY_HEIGHT
    })

    # Edges for this post
    for src, sh, tgt, th, suffix in [
        ("prompt-brand", "text", prompt_id, "text", "brand-prompt"),
        ("prompt-platform", "text", prompt_id, "text", "platform-prompt"),
        ("llm-content-planner", "text", prompt_id, "text", "planner-prompt"),
        (mood_id, "image", prompt_id, "image", "mood-prompt"),
        (prompt_id, "text", nano_id, "text", "prompt-nano"),
        (mood_id, "image", nano_id, "reference", "mood-nano"),
        ("prompt-brand", "text", copy_id, "text", "brand-copy"),
        ("llm-content-planner", "text", copy_id, "text", "planner-copy"),
        (nano_id, "image", copy_id, "image", "nano-copy"),
    ]:
        edges.append({
            "id": f"e-{suffix}-{i}",
            "source": src, "target": tgt,
            "sourceHandle": sh, "targetHandle": th
        })

# ============ OUTPUT GALLERY ============
nodes.append({
    "id": "gallery-output",
    "type": "outputGallery",
    "position": {"x": GALLERY_X, "y": GALLERY_Y},
    "data": {
        "label": "📤 Output Gallery",
        "images": [],
        "status": "idle",
        "error": None
    },
    "width": 400, "height": 500
})

for i in range(1, 11):
    edges.append({
        "id": f"e-nano{i}-gallery",
        "source": f"nano-post-{i}",
        "target": "gallery-output",
        "sourceHandle": "image",
        "targetHandle": "image"
    })

# ============ GROUPS ============
row_total_height = MOOD_HEIGHT + ROW_GAP + PROMPT_HEIGHT + ROW_GAP + NANO_HEIGHT + ROW_GAP + COPY_HEIGHT
row_group_width = 5 * COL_WIDTH + 40

groups = {
    "group-brand": {
        "id": "group-brand", "name": "🎨 Brand DNA & Planner", "color": "purple",
        "position": {"x": -20, "y": -20},
        "size": {"width": 1120, "height": 340},
        "locked": False
    },
    "group-row1": {
        "id": "group-row1", "name": "📸 Posts 1–5", "color": "blue",
        "position": {"x": -40, "y": ROW1_Y - 60},
        "size": {"width": row_group_width, "height": row_total_height + 120},
        "locked": False
    },
    "group-row2": {
        "id": "group-row2", "name": "📸 Posts 6–10", "color": "green",
        "position": {"x": -40, "y": ROW2_Y - 60},
        "size": {"width": row_group_width, "height": row_total_height + 120},
        "locked": False
    }
}

# ============ ASSEMBLE + WRITE ============
workflow = {
    "version": 1,
    "id": "elkiosk-starter-template",
    "name": "🌱 Starter — 10 Posts (IG + FB)",
    "_elkiosk": {"tier": "starter", "platforms": ["Instagram", "Facebook"]},
    "edgeStyle": "default",
    "groups": groups,
    "nodes": nodes,
    "edges": edges
}

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(json.dumps(workflow, indent=2, ensure_ascii=False), encoding="utf-8")

print(f"✓ Wrote {OUT_PATH}")
print(f"  Nodes: {len(nodes)}  (3 header + 40 per-post + 1 gallery)")
print(f"  Edges: {len(edges)}")
print(f"  Groups: {len(groups)}")
print(f"  Size: {OUT_PATH.stat().st_size:,} bytes")
