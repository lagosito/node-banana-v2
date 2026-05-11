'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface ScoreData {
  brand_name: string;
  period: string;
  visibility_pct: number;
  position_avg: number | null;
  sentiment_avg: number;
  share_of_voice: Record<string, number>;
  by_model: Record<string, { visibility_pct: number }>;
  by_category: Record<string, { visibility_pct: number }>;
  sentiment_distribution: { positive: number; neutral: number; negative: number };
  total_answers: number;
  successful_answers: number;
  mentions: number;
}

const MODEL_LABELS: Record<string, string> = { chatgpt: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini' };
const MODEL_COLORS: Record<string, string> = { chatgpt: '#22d3ee', perplexity: '#a78bfa', gemini: '#fbbf24' };
const CAT_LABELS: Record<string, string> = { positioning: 'Positionierung', comparison: 'Vergleich', use_case: 'Use Case', branded: 'Branded' };
const COLORS = ['#22d3ee', '#a78bfa', '#fbbf24', '#fb923c', '#34d399', '#fb7185'];

export default function VisibilityPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [data, setData] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) { setError(true); setLoading(false); return; }
    fetch(`/api/visibility/score?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState />;

  return <Dashboard data={data} />;
}

function LoadingState() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-[3px] border-[#1e293b] border-t-[#22d3ee] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#94a3b8] text-sm">Lade Visibility Score...</p>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-[#fb7185] text-2xl font-bold mb-2">Score nicht gefunden</h2>
        <p className="text-[#94a3b8]">Bitte überprüfe den Link oder kontaktiere uns.</p>
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: ScoreData }) {
  const pct = data.visibility_pct || 0;
  const dist = data.sentiment_distribution || { positive: 0, neutral: 0, negative: 0 };
  const total = dist.positive + dist.neutral + dist.negative;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
      <div className="max-w-[960px] mx-auto px-6 py-10">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-[32px] font-bold text-white mb-2">AI Visibility Score</h1>
          <p className="text-[15px] text-[#94a3b8]">
            Analyse für <span className="text-[#22d3ee] font-semibold">{data.brand_name}</span> — {data.period}
          </p>
        </div>

        {/* Gauge */}
        <div className="flex justify-center mb-10">
          <Gauge value={pct} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <KpiCard value={`${pct.toFixed(1)}%`} label="Visibility" color="text-[#22d3ee]" />
          <KpiCard value={data.position_avg ? data.position_avg.toFixed(1) : '–'} label="Ø Position" color="text-[#34d399]" />
          <KpiCard value={`${data.sentiment_avg > 0 ? '+' : ''}${data.sentiment_avg.toFixed(2)}`} label="Sentiment" color="text-[#a78bfa]" />
          <KpiCard value={String(data.successful_answers || 0)} label="Antworten" color="text-[#fbbf24]" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <ChartCard title="Share of Voice">
            <BarChart data={data.share_of_voice || {}} colors={COLORS} />
          </ChartCard>
          <ChartCard title="Stimmungsverteilung">
            <SentimentChart dist={dist} avg={data.sentiment_avg} total={total} />
          </ChartCard>
          <ChartCard title="Nach KI-Modell">
            <BarChart
              data={Object.fromEntries(Object.entries(data.by_model || {}).map(([k, v]) => [MODEL_LABELS[k] || k, v.visibility_pct]))}
              colors={Object.values(MODEL_COLORS)}
            />
          </ChartCard>
          <ChartCard title="Nach Kategorie">
            <BarChart
              data={Object.fromEntries(Object.entries(data.by_category || {}).map(([k, v]) => [CAT_LABELS[k] || k, v.visibility_pct]))}
              colors={COLORS}
            />
          </ChartCard>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-br from-[#0f172a] to-[#1e1b4b] border border-[#312e81] rounded-2xl p-10 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">🚀 Deine Sichtbarkeit verbessern</h2>
          <p className="text-[#94a3b8] text-[15px] max-w-[500px] mx-auto mb-6 leading-relaxed">
            Deine Marke erscheint in <strong className="text-white">{pct.toFixed(0)}%</strong> der KI-Antworten.
            Mit El Kiosk verbessern wir deine Positionierung und Content-Strategie.
          </p>
          <a
            href="https://elkiosk.ai"
            className="inline-block bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-semibold text-[15px] px-8 py-3.5 rounded-[10px] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(99,102,241,0.3)] transition-all"
          >
            Jetzt mit El Kiosk starten →
          </a>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 pt-6 border-t border-[#1e293b]">
          <p className="text-xs text-[#475569]">Powered by <strong>El Kiosk</strong> — AI Visibility Score</p>
        </div>
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const radius = 90;
  const circumference = Math.PI * radius; // half circle
  const offset = circumference - (value / 100) * circumference;
  const strokeColor = value >= 70 ? '#34d399' : value >= 40 ? '#fbbf24' : '#fb7185';

  return (
    <div className="relative w-[220px] h-[130px]">
      <svg viewBox="0 0 220 130" className="w-full h-full">
        <path d="M 20 120 A 90 90 0 0 1 200 120" fill="none" stroke="#1e293b" strokeWidth="16" strokeLinecap="round" />
        <path
          d="M 20 120 A 90 90 0 0 1 200 120" fill="none" stroke={strokeColor} strokeWidth="16" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s ease' }}
        />
      </svg>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
        <div className="text-[48px] font-extrabold text-white leading-none">{value.toFixed(0)}</div>
        <div className="text-[#64748b] text-lg">%</div>
      </div>
    </div>
  );
}

function KpiCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 text-center">
      <div className={`text-[36px] font-extrabold leading-none mb-2 ${color}`}>{value}</div>
      <div className="text-xs font-medium text-[#64748b] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
      <h3 className="text-sm font-semibold text-[#94a3b8] uppercase tracking-wide mb-5">{title}</h3>
      {children}
    </div>
  );
}

function BarChart({ data, colors }: { data: Record<string, number>; colors: string[] }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      {entries.map(([label, value], i) => (
        <div key={label}>
          <div className="flex justify-between text-[13px] mb-1.5">
            <span className="text-[#e2e8f0] font-medium">{label}</span>
            <span className="text-[#94a3b8]">{typeof value === 'number' ? value.toFixed(1) : value}%</span>
          </div>
          <div className="h-2 bg-[#1e293b] rounded overflow-hidden">
            <div className="h-full rounded transition-all duration-1000" style={{ width: `${Math.min(100, value)}%`, background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SentimentChart({ dist, avg, total }: { dist: { positive: number; neutral: number; negative: number }; avg: number; total: number }) {
  const pctPositive = total > 0 ? (dist.positive / total * 100) : 0;
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (pctPositive / 100) * circumference;

  const items = [
    { label: 'Positiv', count: dist.positive, color: '#34d399' },
    { label: 'Neutral', count: dist.neutral, color: '#94a3b8' },
    { label: 'Negativ', count: dist.negative, color: '#fb7185' },
  ];

  return (
    <div className="flex items-center justify-center gap-8">
      <div className="relative w-[140px] h-[140px]">
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="70" cy="70" r="54" fill="none" stroke="#1e293b" strokeWidth="18" />
          <circle cx="70" cy="70" r="54" fill="none" stroke="#34d399" strokeWidth="18"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.5s ease' }} />
        </svg>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div className="text-[28px] font-bold text-white">{(avg > 0 ? '+' : '') + avg.toFixed(2)}</div>
          <div className="text-[11px] text-[#64748b]">Score</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {items.map(it => (
          <div key={it.label} className="flex items-center gap-2 text-[13px]">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: it.color }} />
            <span>{it.label}: {it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
