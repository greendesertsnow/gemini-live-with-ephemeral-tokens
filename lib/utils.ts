import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Audio context creation with shared instances
const audioContexts = new Map<string, AudioContext>();

export async function audioContext(options?: { sampleRate?: number; id?: string }): Promise<AudioContext> {
  const map = audioContexts;
  
  if (typeof window === 'undefined') {
    throw new Error('AudioContext is only available in browser environment');
  }
  
  // Wait for user interaction before creating audio context
  const didInteract = new Promise((resolve) => {
    const events = ['click', 'keydown', 'touchstart'];
    const handler = () => {
      events.forEach(event => document.removeEventListener(event, handler));
      resolve(void 0);
    };
    events.forEach(event => document.addEventListener(event, handler));
  });

  if (options?.id && map.has(options.id)) {
    const ctx = map.get(options.id);
    if (ctx && ctx.state !== 'closed') {
      return ctx;
    }
  }

  try {
    const ctx = new AudioContext({
      sampleRate: options?.sampleRate || 44100,
    });
    
    if (options?.id) {
      map.set(options.id, ctx);
    }
    return ctx;
  } catch {
    await didInteract;
    if (options?.id && map.has(options.id)) {
      const ctx = map.get(options.id);
      if (ctx) {
        return ctx;
      }
    }
    
    const ctx = new AudioContext({
      sampleRate: options?.sampleRate || 44100,
    });
    
    if (options?.id) {
      map.set(options.id, ctx);
    }
    return ctx;
  }
}

// Base64 to ArrayBuffer conversion utility
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
