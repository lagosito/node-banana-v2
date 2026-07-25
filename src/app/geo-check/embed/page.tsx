// GEO Check — Embed Widget
// /geo-check/embed — renders input + loader for iframe embedding
// On completion: window.parent.postMessage({ type, reportId, resultUrl, score })

"use client";

import { useState } from "react";

export default function GeoCheckEmbed() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/geo-check/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website_url: domain.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Fehler bei der Analyse");
        setLoading(false);
        return;
      }

      // Send result to parent window
      window.parent.postMessage(
        {
          type: "elkiosk:geocheck:complete",
          reportId: data.reportId,
          resultUrl: `/geo-check/report/${data.reportId}`,
          score: data.overallScore,
        },
        "*",
      );

      // Show result briefly then reset
      setTimeout(() => {
        setLoading(false);
        setDomain("");
      }, 2000);
    } catch {
      setError("Netzwerkfehler. Bitte versuchen Sie es erneut.");
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "20px",
        background: "transparent",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          gap: "8px",
          width: "100%",
          maxWidth: "500px",
        }}
      >
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="ihre-website.de"
          disabled={loading}
          style={{
            flex: 1,
            padding: "12px 16px",
            fontSize: "16px",
            border: "2px solid #e5e7eb",
            borderRadius: "8px",
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = "#6366f1";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "#e5e7eb";
          }}
        />
        <button
          type="submit"
          disabled={loading || !domain.trim()}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            fontWeight: "600",
            color: "#fff",
            background: loading ? "#9ca3af" : "#6366f1",
            border: "none",
            borderRadius: "8px",
            cursor: loading ? "not-allowed" : "pointer",
            transition: "background 0.2s",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? "Analysiere..." : "Pruefen"}
        </button>
      </form>

      {error && (
        <p
          style={{
            marginTop: "12px",
            color: "#ef4444",
            fontSize: "14px",
          }}
        >
          {error}
        </p>
      )}

      <p
        style={{
          marginTop: "16px",
          color: "#9ca3af",
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        KI-Sichtbarkeits-Check powered by el Kiosk
      </p>
    </div>
  );
}
