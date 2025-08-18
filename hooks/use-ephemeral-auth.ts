"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTokenContext, useTokenStatus, useTokenConnection } from '@/contexts/token-context';
import { EnhancedGenAILiveClient } from '@/lib/enhanced-genai-live-client';
import { LiveConnectConfig } from '@google/genai';
import { AudioStreamer } from '@/lib/audio-streamer';
import { audioContext } from '@/lib/utils';
import VolMeterWorket from '@/lib/worklets/vol-meter';

export interface EphemeralAuthConfig {
  autoConnect?: boolean;
  autoRefresh?: boolean;
  model?: string;
  connectConfig?: LiveConnectConfig;
  onTokenRefresh?: (token: string, expiresAt: Date) => void;
  onTokenExpired?: (sessionId: string) => void;
  onConnectionChange?: (status: 'connected' | 'disconnected' | 'connecting' | 'error') => void;
  onError?: (error: string) => void;
}

export interface EphemeralAuthState {
  // Token state
  isAuthenticated: boolean;
  token: string | null;
  tokenExpiresAt: Date | null;
  usesRemaining: number;
  needsRefresh: boolean;

  // Connection state
  isConnected: boolean;
  isConnecting: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';

  // Status flags
  isLoading: boolean;
  error: string | null;

  // Session info
  sessionId: string;
  refreshCount: number;
}

export interface EphemeralAuthActions {
  // Authentication
  authenticate: () => Promise<boolean>;
  refreshAuth: () => Promise<boolean>;
  clearAuth: () => Promise<void>;

  // Connection
  connect: (model?: string, config?: LiveConnectConfig) => Promise<boolean>;
  disconnect: () => void;

  // Client access
  getClient: () => EnhancedGenAILiveClient | null;

  // Error handling
  clearError: () => void;
  retry: () => Promise<boolean>;
}

export interface UseEphemeralAuthResult {
  state: EphemeralAuthState;
  actions: EphemeralAuthActions;
  client: EnhancedGenAILiveClient | null;
}

export function useEphemeralAuth(config: EphemeralAuthConfig = {}): UseEphemeralAuthResult {
  const tokenContext = useTokenContext();
  const tokenStatus = useTokenStatus();
  const tokenConnection = useTokenConnection();

  const [client, setClient] = useState<EnhancedGenAILiveClient | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<EnhancedGenAILiveClient | null>(null);
  const configRef = useRef(config);
  const authStartedRef = useRef(false);

  // Update config ref
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Initialize audio streamer for TTS playback (server -> speakers)
  useEffect(() => {
    let cancelled = false;
    if (!audioStreamerRef.current) {
      audioContext({ id: 'audio-out' })
        .then((ctx: AudioContext) => {
          if (cancelled) return;
          const streamer = new AudioStreamer(ctx);
          audioStreamerRef.current = streamer;
          // best-effort VU meter hookup (optional)
          streamer.addWorklet<any>('vumeter-out', VolMeterWorket, () => { }).catch(() => { });
        })
        .catch(() => { });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Initialize client
  useEffect(() => {
    if (!clientRef.current) {
      const newClient = new EnhancedGenAILiveClient({
        tokenConfig: {
          endpoint: '/api/auth',
          sessionId: tokenConnection.sessionId,
          autoRefresh: configRef.current.autoRefresh ?? true,
          refreshThresholdMinutes: 5,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
      });

      // Setup event listeners
      newClient.on('open', async () => {
        try {
          await audioStreamerRef.current?.resume();
        } catch { }
        tokenContext.actions.updateConnectionStatus('connected');
        configRef.current.onConnectionChange?.(tokenConnection.connectionStatus);
      });

      newClient.on('close', () => {
        tokenContext.actions.updateConnectionStatus('disconnected');
        setIsConnecting(false);
        configRef.current.onConnectionChange?.(tokenConnection.connectionStatus);
      });

      newClient.on('error', (error) => {
        const errorMessage = error.message || 'Connection error';
        setError(errorMessage);
        tokenContext.actions.updateConnectionStatus('error');
        configRef.current.onError?.(errorMessage);
        configRef.current.onConnectionChange?.(tokenConnection.connectionStatus);
      });

      newClient.on('tokenrefresh', (token, expiresAt) => {
        configRef.current.onTokenRefresh?.(token, expiresAt);
      });

      newClient.on('tokenexpired', (sessionId) => {
        configRef.current.onTokenExpired?.(sessionId);
      });

      newClient.on('reconnecting', (attempt, maxAttempts) => {
        console.log(`Reconnecting... (${attempt}/${maxAttempts})`);
        setIsConnecting(true);
        tokenContext.actions.updateConnectionStatus('connecting');
      });

      newClient.on('reconnected', () => {
        console.log('Reconnected successfully');
        setIsConnecting(false);
        setError(null);
        tokenContext.actions.updateConnectionStatus('connected');
      });

      newClient.on('reconnectfailed', (error) => {
        console.error('Reconnection failed:', error);
        setIsConnecting(false);
        setError(error.message);
        tokenContext.actions.updateConnectionStatus('error');
      });

      // Pipe server PCM -> WebAudio
      newClient.on('audio', (data: ArrayBuffer) => {
        try {
          audioStreamerRef.current?.addPCM16(new Uint8Array(data));
        } catch (e) {
          console.error('[EphemeralAuth] addPCM16 error', e);
        }
      });
      newClient.on('interrupted', () => {
        audioStreamerRef.current?.stop();
      });

      clientRef.current = newClient;
      setClient(newClient);
    }

    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
        setClient(null);
      }
    };
  }, [tokenConnection.sessionId]);

  // Auto-authentication with StrictMode guard
  useEffect(() => {
    if (
      configRef.current.autoConnect &&
      !tokenStatus.hasToken &&
      !tokenStatus.isRefreshing &&
      !authStartedRef.current
    ) {
      authStartedRef.current = true;
      authenticate().finally(() => {
        authStartedRef.current = false;
      });
    }
  }, [tokenStatus.hasToken, tokenStatus.isRefreshing]);

  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const success = await tokenContext.actions.createToken();

      if (!success && tokenContext.state.error) {
        setError(tokenContext.state.error);
      }

      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      configRef.current.onError?.(errorMessage);
      return false;
    }
  }, [tokenContext.actions]);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const success = await tokenContext.actions.refreshToken();

      if (!success && tokenContext.state.error) {
        setError(tokenContext.state.error);
      }

      return success;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      configRef.current.onError?.(errorMessage);
      return false;
    }
  }, [tokenContext.actions]);

  const clearAuth = useCallback(async (): Promise<void> => {
    try {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
      await tokenContext.actions.clearToken();
      setError(null);
    } catch (error) {
      console.warn('Error clearing auth:', error);
    }
  }, [tokenContext.actions]);

  const connect = useCallback(async (
    model?: string,
    connectConfig?: LiveConnectConfig
  ): Promise<boolean> => {
    if (!clientRef.current) {
      setError('Client not initialized');
      return false;
    }

    if (!tokenStatus.hasToken) {
      const authSuccess = await authenticate();
      if (!authSuccess) {
        return false;
      }
    }

    try {
      setIsConnecting(true);
      setError(null);
      tokenContext.actions.updateConnectionStatus('connecting');

      const targetModel = model || configRef.current.model || process.env.NEXT_PUBLIC_GEMINI_MODEL || 'models/gemini-2.0-flash-exp';
      const baseConfig = connectConfig || configRef.current.connectConfig || {};
      
      // Debug model selection
      console.log('🎯 Connection Details:', {
        requestedModel: model,
        fallbackModel: configRef.current.model,
        finalModel: targetModel,
        hasConfig: !!connectConfig,
        configTools: connectConfig?.tools?.length || 0
      });
      const ensureSpeech = (cfg: LiveConnectConfig): LiveConnectConfig => {
        const anyCfg: any = cfg || {};
        const hasSpeech = !!(anyCfg?.speechConfig);
        if (hasSpeech) return cfg;
        return {
          ...cfg,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Puck' },
            },
          },
        };
      };
      const targetConfig = ensureSpeech(baseConfig);

      const success = await clientRef.current.connect(targetModel, targetConfig);

      if (!success) {
        setError('Failed to connect to Gemini Live API');
        tokenContext.actions.updateConnectionStatus('error');
      }

      setIsConnecting(false);
      return success;
    } catch (error) {
      setIsConnecting(false);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(errorMessage);
      tokenContext.actions.updateConnectionStatus('error');
      configRef.current.onError?.(errorMessage);
      return false;
    }
  }, [tokenStatus.hasToken, authenticate, tokenContext.actions]);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
    setIsConnecting(false);
    setError(null);
  }, []);

  const getClient = useCallback((): EnhancedGenAILiveClient | null => {
    return clientRef.current;
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    tokenContext.actions.clearError();
  }, [tokenContext.actions]);

  const retry = useCallback(async (): Promise<boolean> => {
    clearError();

    if (tokenStatus.hasToken) {
      // Try to reconnect with existing token
      return await connect();
    } else {
      // Try to authenticate and connect
      const authSuccess = await authenticate();
      if (authSuccess) {
        return await connect();
      }
      return false;
    }
  }, [tokenStatus.hasToken, connect, authenticate, clearError]);

  // Build state object
  const state: EphemeralAuthState = {
    // Token state
    isAuthenticated: tokenStatus.hasToken && tokenStatus.isValid,
    token: tokenContext.state.currentToken,
    tokenExpiresAt: tokenContext.state.tokenExpiresAt,
    usesRemaining: tokenStatus.usesRemaining,
    needsRefresh: tokenStatus.needsRefresh,

    // Connection state
    isConnected: tokenConnection.connectionStatus === 'connected',
    isConnecting: isConnecting || tokenContext.state.isRefreshing,
    connectionStatus: tokenConnection.connectionStatus,

    // Status flags
    isLoading: tokenContext.state.isRefreshing || isConnecting,
    error: error || tokenContext.state.error,

    // Session info
    sessionId: tokenConnection.sessionId,
    refreshCount: tokenConnection.refreshCount,
  };

  // Build actions object
  const actions: EphemeralAuthActions = {
    authenticate,
    refreshAuth,
    clearAuth,
    connect,
    disconnect,
    getClient,
    clearError,
    retry,
  };

  return {
    state,
    actions,
    client: clientRef.current,
  };
}

// Utility hook for simple token-only authentication
export function useTokenAuth() {
  const { state, actions } = useEphemeralAuth({ autoConnect: true });

  return {
    isAuthenticated: state.isAuthenticated,
    token: state.token,
    isLoading: state.isLoading,
    error: state.error,
    authenticate: actions.authenticate,
    refresh: actions.refreshAuth,
    clear: actions.clearAuth,
  };
}

// Utility hook for connection status monitoring
export function useConnectionMonitor() {
  const { state } = useEphemeralAuth();

  return {
    status: state.connectionStatus,
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    sessionId: state.sessionId,
    refreshCount: state.refreshCount,
  };
}

// Utility hook for error handling
export function useAuthErrors() {
  const { state, actions } = useEphemeralAuth();

  return {
    error: state.error,
    hasError: !!state.error,
    clearError: actions.clearError,
    retry: actions.retry,
  };
}