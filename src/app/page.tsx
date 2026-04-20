"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";

// Load the entire app client-side only to avoid SSR crashes from
// Three.js, Konva and other browser-only libraries in the dependency tree.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Home() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
