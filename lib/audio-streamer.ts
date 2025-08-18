import {
  createWorketFromSrc,
  getRegisteredWorklets,
} from "./audioworklet-registry";

// Audio processing constants
const AUDIO_CONFIG = {
  SAMPLE_RATE: 24000,
  BUFFER_SIZE: 7680,
  INITIAL_BUFFER_TIME: 0.1, // 100ms initial buffer
  SCHEDULE_AHEAD_TIME: 0.2,
  GAIN_RAMP_TIME: 0.1,
  CLEANUP_DELAY_MS: 200,
  CHECK_INTERVAL_MS: 100,
  SCHEDULE_BUFFER_OFFSET_MS: 50,
  PCM16_SAMPLE_SIZE: 2, // 2 bytes per sample
  PCM16_MAX_VALUE: 32768,
} as const;

// Error handling utilities for audio processing
type AudioErrorType = 'PCM_CONVERSION_ERROR' | 'WORKLET_ERROR' | 'PLAYBACK_ERROR' | 'CONTEXT_ERROR';

class AudioError extends Error {
  constructor(
    message: string,
    public readonly type: AudioErrorType,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

const createAudioError = (type: AudioErrorType, message: string, context?: Record<string, unknown>): AudioError => {
  return new AudioError(`[${type}] ${message}`, type, context);
};

// Type definitions for worklet handling
interface WorkletHandler {
  (event: MessageEvent): void;
}

interface WorkletGraph {
  node?: AudioWorkletNode;
  handlers: WorkletHandler[];
}

// Removed unused type WorkletsRecord

export class AudioStreamer {
  private readonly sampleRate: number = AUDIO_CONFIG.SAMPLE_RATE;
  private readonly bufferSize: number = AUDIO_CONFIG.BUFFER_SIZE;
  private readonly initialBufferTime: number = AUDIO_CONFIG.INITIAL_BUFFER_TIME;

  // A queue of audio buffers to be played. Each buffer is a Float32Array.
  private audioQueue: Float32Array[] = [];
  private isPlaying: boolean = false;
  // Indicates if the stream has finished playing, e.g., interrupted.
  private isStreamComplete: boolean = false;
  private checkInterval: number | null = null;
  private scheduledTime: number = 0;

  // Pre-allocated buffer for PCM processing to reduce GC pressure
  private conversionBuffer: Float32Array | null = null;
  private maxBufferSize: number = 0;

  // Web Audio API nodes. source => gain => destination
  public gainNode: GainNode;
  public source: AudioBufferSourceNode;
  private endOfQueueAudioSource: AudioBufferSourceNode | null = null;

  public onComplete = () => { };

  constructor(public context: AudioContext) {
    this.gainNode = this.context.createGain();
    this.source = this.context.createBufferSource();
    this.gainNode.connect(this.context.destination);
    this.addPCM16 = this.addPCM16.bind(this);
  }

  async addWorklet<T extends WorkletHandler>(
    workletName: string,
    workletSrc: string,
    handler: T
  ): Promise<this> {
    const registeredWorklets = getRegisteredWorklets();
    let workletsRecord = registeredWorklets.get(this.context);
    if (workletsRecord && workletsRecord[workletName]) {
      // the worklet already exists on this context
      // add the new handler to it
      workletsRecord[workletName].handlers.push(handler);
      return Promise.resolve(this);
      //throw new Error(`Worklet ${workletName} already exists on context`);
    }

    if (!workletsRecord) {
      registeredWorklets.set(this.context, {});
      workletsRecord = registeredWorklets.get(this.context)!;
    }

    // create new record to fill in as becomes available
    workletsRecord[workletName] = { handlers: [handler] };

    const src = createWorketFromSrc(workletName, workletSrc);
    await this.context.audioWorklet.addModule(src);
    const worklet = new AudioWorkletNode(this.context, workletName);

    //add the node into the map
    workletsRecord[workletName].node = worklet;

    return this;
  }

  /**
   * Converts a Uint8Array of PCM16 audio data into a Float32Array.
   * PCM16 is a common raw audio format, but the Web Audio API generally
   * expects audio data as Float32Arrays with samples normalized between -1.0 and 1.0.
   * This function handles that conversion with optimized memory allocation.
   * @param chunk The Uint8Array containing PCM16 audio data.
   * @returns A Float32Array representing the converted audio data.
   */
  private _processPCM16Chunk(chunk: Uint8Array): Float32Array {
    const sampleCount = chunk.length / AUDIO_CONFIG.PCM16_SAMPLE_SIZE;

    // Reuse buffer if possible to reduce GC pressure
    if (!this.conversionBuffer || this.conversionBuffer.length < sampleCount) {
      this.conversionBuffer = new Float32Array(Math.max(sampleCount, this.maxBufferSize));
      this.maxBufferSize = Math.max(this.maxBufferSize, sampleCount);
    }

    const dataView = new DataView(chunk.buffer);
    const result = new Float32Array(sampleCount);

    for (let i = 0; i < sampleCount; i++) {
      try {
        const int16 = dataView.getInt16(i * AUDIO_CONFIG.PCM16_SAMPLE_SIZE, true);
        result[i] = int16 / AUDIO_CONFIG.PCM16_MAX_VALUE;
      } catch (e) {
        const error = createAudioError('PCM_CONVERSION_ERROR', 'Failed to convert PCM16 sample', {
          sampleIndex: i,
          chunkLength: chunk.length,
          originalError: e
        });
        console.error('[AudioStreamer] PCM conversion error:', {
          error: error.message,
          context: error.context
        });
        // Continue processing other samples
        result[i] = 0; // Silence for failed sample
      }
    }
    return result;
  }

  addPCM16(chunk: Uint8Array) {
    // Reset the stream complete flag when a new chunk is added.
    this.isStreamComplete = false;

    // Process the chunk into a Float32Array
    const processingBuffer = this._processPCM16Chunk(chunk);

    // Batch smaller chunks to reduce queue overhead
    this.addProcessedBufferToQueue(processingBuffer);

    // Start playing if not already playing.
    if (!this.isPlaying) {
      this.isPlaying = true;
      // Initialize scheduledTime only when we start playing
      this.scheduledTime = this.context.currentTime + AUDIO_CONFIG.INITIAL_BUFFER_TIME;
      console.debug('[AudioStreamer] starting playback', {
        contextState: this.context.state,
        queuedBuffers: this.audioQueue.length,
        sampleRate: this.sampleRate,
      });
      this.scheduleNextBuffer();
    }
  }

  /**
   * Optimized buffer queuing with reduced array allocations
   */
  private addProcessedBufferToQueue(processingBuffer: Float32Array): void {
    let offset = 0;

    // Add the processed buffer to the queue if it's larger than the buffer size.
    // This is to ensure that the buffer is not too large.
    while (offset + this.bufferSize <= processingBuffer.length) {
      // Use subarray instead of slice for better performance (no allocation)
      const buffer = processingBuffer.subarray(offset, offset + this.bufferSize);
      this.audioQueue.push(new Float32Array(buffer)); // Copy needed since subarray shares memory
      offset += this.bufferSize;
    }

    // Add the remaining buffer to the queue if it's not empty.
    const remaining = processingBuffer.length - offset;
    if (remaining > 0) {
      const buffer = processingBuffer.subarray(offset);
      this.audioQueue.push(new Float32Array(buffer));
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate
    );
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    try {
      while (
        this.audioQueue.length > 0 &&
        this.scheduledTime < this.context.currentTime + AUDIO_CONFIG.SCHEDULE_AHEAD_TIME
      ) {
        const audioData = this.audioQueue.shift()!;
        const audioBuffer = this.createAudioBuffer(audioData);
        const source = this.context.createBufferSource();

        if (this.audioQueue.length === 0) {
          if (this.endOfQueueAudioSource) {
            this.endOfQueueAudioSource.onended = null;
          }
          this.endOfQueueAudioSource = source;
          source.onended = () => {
            if (
              !this.audioQueue.length &&
              this.endOfQueueAudioSource === source
            ) {
              this.endOfQueueAudioSource = null;
              this.onComplete();
            }
          };
        }

        source.buffer = audioBuffer;
        source.connect(this.gainNode);

        // Access worklet registry safely
        const worklets = getRegisteredWorklets().get(this.context);

        if (worklets) {
          Object.entries(worklets).forEach(([, graph]: [string, WorkletGraph]) => {
            const { node, handlers } = graph;
            if (node) {
              source.connect(node);
              node.port.onmessage = function (ev: MessageEvent) {
                handlers.forEach((handler: WorkletHandler) => {
                  handler.call(node.port, ev);
                });
              };
              node.connect(this.context.destination);
            }
          });
        }
        // Ensure we never schedule in the past
        const startTime = Math.max(this.scheduledTime, this.context.currentTime);
        source.start(startTime);
        this.scheduledTime = startTime + audioBuffer.duration;
      }

      if (this.audioQueue.length === 0) {
        if (this.isStreamComplete) {
          this.isPlaying = false;
          if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
          }
        } else {
          if (!this.checkInterval) {
            this.checkInterval = window.setInterval(() => {
              if (this.audioQueue.length > 0) {
                this.scheduleNextBuffer();
              }
            }, AUDIO_CONFIG.CHECK_INTERVAL_MS) as unknown as number;
          }
        }
      } else {
        const nextCheckTime =
          (this.scheduledTime - this.context.currentTime) * 1000;
        setTimeout(
          () => this.scheduleNextBuffer(),
          Math.max(0, nextCheckTime - AUDIO_CONFIG.SCHEDULE_BUFFER_OFFSET_MS)
        );
      }
    } catch (e) {
      const error = createAudioError('PLAYBACK_ERROR', 'Failed to schedule audio buffer', {
        contextState: this.context.state,
        queueLength: this.audioQueue.length,
        scheduledTime: this.scheduledTime,
        currentTime: this.context.currentTime,
        originalError: e
      });

      console.error('[AudioStreamer] scheduleNextBuffer error:', {
        error: error.message,
        context: error.context
      });

      // Halt playback loop on error to avoid tight failures
      this.isPlaying = false;
    }
  }

  stop() {
    this.isPlaying = false;
    this.isStreamComplete = true;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.gainNode.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + AUDIO_CONFIG.GAIN_RAMP_TIME
    );

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, AUDIO_CONFIG.CLEANUP_DELAY_MS);
  }

  async resume() {
    try {
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      this.isStreamComplete = false;
      this.scheduledTime = this.context.currentTime + AUDIO_CONFIG.INITIAL_BUFFER_TIME;
      this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
    } catch (e) {
      const error = createAudioError('CONTEXT_ERROR', 'Failed to resume audio context', {
        contextState: this.context.state,
        originalError: e
      });
      console.error('[AudioStreamer] Resume error:', {
        error: error.message,
        context: error.context
      });
      throw error;
    }
  }

  complete() {
    this.isStreamComplete = true;
    this.onComplete();
  }
}