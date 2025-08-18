/**
 * A registry to map attached worklets by their audio-context
 * any module using `audioContext.audioWorklet.addModule(` should register the worklet here
 */
export type WorkletGraph = {
  node?: AudioWorkletNode;
  handlers: Array<(this: MessagePort, ev: MessageEvent) => unknown>;
};

// Create a factory function to avoid module-level state
export function createRegisteredWorklets(): Map<AudioContext, Record<string, WorkletGraph>> {
  return new Map();
}

export function getRegisteredWorklets(): Map<AudioContext, Record<string, WorkletGraph>> {
  if (typeof window === 'undefined') {
    return new Map();
  }

  // Store on window to avoid module-level state
  const globalWindow = window as unknown as Record<string, unknown>;
  if (!globalWindow.__registeredWorklets) {
    globalWindow.__registeredWorklets = createRegisteredWorklets();
  }
  return globalWindow.__registeredWorklets as Map<AudioContext, Record<string, WorkletGraph>>;
}

export const createWorketFromSrc = (
  workletName: string,
  workletSrc: string,
) => {
  const script = new Blob(
    [`registerProcessor("${workletName}", ${workletSrc})`],
    {
      type: "application/javascript",
    },
  );

  return URL.createObjectURL(script);
};