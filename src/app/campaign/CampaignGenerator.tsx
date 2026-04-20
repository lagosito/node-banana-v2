"use client";

import { useState, useCallback } from "react";
import { useTheme } from "@/hooks/useTheme";

interface CampaignResult {
  strategy: {
    imagePrompts: string[];
    videoPrompts: string[];
    captions: { text: string; hashtags: string[] }[];
  };
  images: { prompt: string; base64: string; error?: string }[];
  videos: { prompt: string; url?: string; error?: string }[];
}

interface GeneratedImage {
  prompt: string;
  base64: string;
}

export default function CampaignGenerator() {
  const { theme } = useTheme();
  const [clientName, setClientName] = useState("");
  const [objective, setObjective] = useState("");
  const [platform, setPlatform] = useState<string>("instagram");
  const [brandColors, setBrandColors] = useState("");
  const [tone, setTone] = useState<string>("professional");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedImageIdx, setSelectedImageIdx] = useState<number | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!clientName.trim() || !objective.trim()) {
      setError("Please fill in client name and campaign objective");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResult(null);
    setProgress("Generating campaign strategy...");

    try {
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          objective: objective.trim(),
          platform,
          brandColors: brandColors.trim() || undefined,
          tone,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Campaign generation failed");
      }

      const data = await res.json();
      setResult(data);
      setProgress("Done!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsGenerating(false);
    }
  }, [clientName, objective, platform, brandColors, tone]);

  return (
    <div className="min-h-screen bg-[var(--c-bg)] text-[var(--c-text)]">
      {/* Header */}
      <header className="h-11 bg-[var(--c-header-bg)] border-b border-[var(--c-header-border)] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <a href="/" className="text-2xl font-semibold text-[var(--c-text)] tracking-tight hover:opacity-80 transition-opacity">
            El Kiosk
          </a>
          <span className="text-[var(--c-text-muted)]">|</span>
          <span className="text-sm text-[var(--c-text-secondary)] font-medium">Campaign Generator</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold mb-3">
            🎯 Campaign Generator
          </h1>
          <p className="text-[var(--c-text-tertiary)] text-lg max-w-2xl mx-auto">
            Enter your client details and objective — AI generates a complete campaign with images, videos, captions, and hashtags.
          </p>
        </div>

        {/* Form */}
        <div className="bg-[var(--c-bg-surface)] border border-[var(--c-border-subtle)] rounded-xl p-6 mb-8 shadow-lg max-w-3xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Client Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-secondary)] mb-1.5">
                Client Name *
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Café Berlin"
                className="theme-input w-full px-3 py-2.5 rounded-lg border text-sm"
              />
            </div>

            {/* Platform */}
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-secondary)] mb-1.5">
                Platform
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="theme-input w-full px-3 py-2.5 rounded-lg border text-sm appearance-none"
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="tiktok">TikTok</option>
                <option value="linkedin">LinkedIn</option>
                <option value="all">All Platforms</option>
              </select>
            </div>

            {/* Tone */}
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-secondary)] mb-1.5">
                Tone
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="theme-input w-full px-3 py-2.5 rounded-lg border text-sm appearance-none"
              >
                <option value="professional">Professional</option>
                <option value="casual">Casual & Friendly</option>
                <option value="luxury">Luxury & Premium</option>
                <option value="playful">Playful & Fun</option>
                <option value="bold">Bold & Edgy</option>
              </select>
            </div>

            {/* Brand Colors */}
            <div>
              <label className="block text-sm font-medium text-[var(--c-text-secondary)] mb-1.5">
                Brand Colors <span className="text-[var(--c-text-muted)]">(optional)</span>
              </label>
              <input
                type="text"
                value={brandColors}
                onChange={(e) => setBrandColors(e.target.value)}
                placeholder="e.g. navy blue, gold, white"
                className="theme-input w-full px-3 py-2.5 rounded-lg border text-sm"
              />
            </div>

            {/* Objective - full width */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-[var(--c-text-secondary)] mb-1.5">
                Campaign Objective *
              </label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="e.g. Promote our new summer menu with fresh salads and cocktails, targeting young professionals in Hamburg"
                rows={3}
                className="theme-input w-full px-3 py-2.5 rounded-lg border text-sm resize-none"
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="mt-5 flex justify-center">
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !clientName.trim() || !objective.trim()}
              className="px-8 py-3 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--c-text)] text-[var(--c-bg)] hover:bg-[var(--c-text-secondary)]"
            >
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {progress || "Generating..."}
                </span>
              ) : (
                "🚀 Generate Campaign"
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm text-center">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-10">
            {/* ─── Images Section ─── */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                🖼️ Generated Images
                <span className="text-sm font-normal text-[var(--c-text-muted)]">
                  ({result.images.filter(i => !i.error).length}/{result.images.length})
                </span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {result.images.map((img, idx) => (
                  <div
                    key={idx}
                    className="group relative bg-[var(--c-bg-elevated)] border border-[var(--c-border-subtle)] rounded-lg overflow-hidden cursor-pointer hover:border-[var(--c-border)] transition-colors"
                    onClick={() => !img.error && setSelectedImageIdx(idx)}
                  >
                    {img.error ? (
                      <div className="aspect-square flex items-center justify-center p-3">
                        <div className="text-center">
                          <span className="text-2xl">❌</span>
                          <p className="text-xs text-[var(--c-text-muted)] mt-1">{img.error}</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <img
                          src={`data:image/png;base64,${img.base64}`}
                          alt={img.prompt}
                          className="w-full aspect-square object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                          <p className="text-white text-[10px] line-clamp-3">{img.prompt}</p>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* ─── Videos Section ─── */}
            {result.videos.length > 0 && (
              <section>
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  🎬 Video Concepts
                  <span className="text-sm font-normal text-[var(--c-text-muted)]">
                    ({result.videos.filter(v => !v.error).length}/{result.videos.length} ready)
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {result.videos.map((vid, idx) => (
                    <div
                      key={idx}
                      className="bg-[var(--c-bg-elevated)] border border-[var(--c-border-subtle)] rounded-lg overflow-hidden"
                    >
                      {vid.url ? (
                        <video
                          src={vid.url}
                          controls
                          className="w-full aspect-video object-cover"
                        />
                      ) : (
                        <div className="aspect-video flex items-center justify-center bg-[var(--c-bg-canvas)]">
                          <div className="text-center p-4">
                            <span className="text-2xl">{vid.error ? "❌" : "⏳"}</span>
                            <p className="text-xs text-[var(--c-text-muted)] mt-1">
                              {vid.error || "Video generation pending"}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="p-3">
                        <p className="text-xs text-[var(--c-text-secondary)] line-clamp-2">
                          {vid.prompt}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ─── Captions & Hashtags Section ─── */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                ✍️ Captions & Hashtags
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {result.strategy.captions.map((caption, idx) => (
                  <div
                    key={idx}
                    className="bg-[var(--c-bg-elevated)] border border-[var(--c-border-subtle)] rounded-lg p-4 group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-medium text-[var(--c-text-muted)] uppercase tracking-wide">
                        Post #{idx + 1}
                      </span>
                      <button
                        onClick={() => {
                          const text = `${caption.text}\n\n${caption.hashtags.join(" ")}`;
                          navigator.clipboard.writeText(text);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-[var(--c-text-tertiary)] hover:text-[var(--c-text)] px-2 py-1 rounded border border-[var(--c-border)] hover:bg-[var(--c-bg-hover)]"
                        title="Copy to clipboard"
                      >
                        📋 Copy
                      </button>
                    </div>
                    <p className="text-sm text-[var(--c-text-secondary)] mb-3 whitespace-pre-wrap">
                      {caption.text}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {caption.hashtags.map((tag, tagIdx) => (
                        <span
                          key={tagIdx}
                          className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-[var(--c-bg-canvas)] text-[var(--c-text-tertiary)] border border-[var(--c-border-subtle)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ─── Video Prompts (for manual generation) ─── */}
            <section>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                🎥 Video Prompts
                <span className="text-sm font-normal text-[var(--c-text-muted)]">
                  (ready to use in the canvas editor)
                </span>
              </h2>
              <div className="space-y-3">
                {result.strategy.videoPrompts.map((prompt, idx) => (
                  <div
                    key={idx}
                    className="bg-[var(--c-bg-elevated)] border border-[var(--c-border-subtle)] rounded-lg p-4 flex items-start gap-3 group"
                  >
                    <span className="text-xs font-bold text-[var(--c-text-muted)] bg-[var(--c-bg-canvas)] rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <p className="text-sm text-[var(--c-text-secondary)] flex-1">{prompt}</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(prompt)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-[var(--c-text-tertiary)] hover:text-[var(--c-text)] px-2 py-1 rounded border border-[var(--c-border)] hover:bg-[var(--c-bg-hover)] shrink-0"
                    >
                      📋
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {selectedImageIdx !== null && result?.images[selectedImageIdx] && !result.images[selectedImageIdx].error && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setSelectedImageIdx(null)}
        >
          <div className="max-w-4xl max-h-full relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:image/png;base64,${result.images[selectedImageIdx].base64}`}
              alt={result.images[selectedImageIdx].prompt}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <p className="text-white/70 text-sm mt-3 text-center max-w-xl mx-auto">
              {result.images[selectedImageIdx].prompt}
            </p>
            <div className="flex justify-center gap-3 mt-4">
              <button
                onClick={() => {
                  const img = result.images[selectedImageIdx];
                  const link = document.createElement("a");
                  link.href = `data:image/png;base64,${img.base64}`;
                  link.download = `campaign-image-${selectedImageIdx + 1}.png`;
                  link.click();
                }}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                ⬇️ Download
              </button>
              <button
                onClick={() => setSelectedImageIdx(null)}
                className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
              >
                ✕ Close
              </button>
            </div>
            {/* Navigation */}
            <button
              onClick={() => setSelectedImageIdx((prev) => prev !== null ? (prev - 1 + result.images.length) % result.images.length : 0)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            >
              ‹
            </button>
            <button
              onClick={() => setSelectedImageIdx((prev) => prev !== null ? (prev + 1) % result.images.length : 0)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
