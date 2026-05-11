import { Suspense } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI Visibility Score — El Kiosk',
  description: 'Wie sichtbar ist deine Marke in KI-Antworten? Analyse für ChatGPT, Perplexity und Gemini.',
};

export default function VisibilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-10 h-10 border-[3px] border-[#1e293b] border-t-[#22d3ee] rounded-full animate-spin" />
      </div>
    }>
      {children}
    </Suspense>
  );
}
