"use client";

import { cn } from "@/lib/utils";

interface AudioPulseProps {
  volume: number;
  className?: string;
}

export default function AudioPulse({ volume, className }: AudioPulseProps) {
  // Calculate size based on volume (0-1 range)
  const size = Math.max(8, Math.min(volume * 200, 32));
  
  return (
    <div className={cn("relative flex items-center justify-center w-8 h-8", className)}>
      <div 
        className="absolute rounded-full bg-primary/20 animate-pulse"
        style={{
          width: `${size * 2}px`,
          height: `${size * 2}px`,
        }}
      />
      <div 
        className="absolute rounded-full bg-primary/40"
        style={{
          width: `${size * 1.5}px`,
          height: `${size * 1.5}px`,
        }}
      />
      <div 
        className="relative rounded-full bg-primary"
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      />
    </div>
  );
}