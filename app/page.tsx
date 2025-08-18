"use client";

import ClientOnly from "@/components/client-only";
import LiveConsole from "@/components/live-console";

export default function Home() {
  return (
    <ClientOnly
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Loading Gemini Live...</h1>
            <p className="text-muted-foreground">
              Initializing secure connection...
            </p>
          </div>
        </div>
      }
    >
      <LiveConsole />
    </ClientOnly>
  );
}
