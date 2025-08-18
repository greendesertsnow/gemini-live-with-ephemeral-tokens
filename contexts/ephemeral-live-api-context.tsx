"use client";

import { createContext, FC, ReactNode, useContext } from "react";
import { useEphemeralAuth, UseEphemeralAuthResult } from "@/hooks/use-ephemeral-auth";
import { LiveConnectConfig } from "@google/genai";
import { getGlobalEphemeralTokenConfig } from "@/lib/config/ephemeral-token-config";

const EphemeralLiveAPIContext = createContext<UseEphemeralAuthResult | undefined>(undefined);

export type EphemeralLiveAPIProviderProps = {
  children: ReactNode;
  config?: {
    model?: string;
    connectConfig?: LiveConnectConfig;
    autoConnect?: boolean;
  };
};

export const EphemeralLiveAPIProvider: FC<EphemeralLiveAPIProviderProps> = ({
  children,
  config,
}) => {
  const tokenConfig = getGlobalEphemeralTokenConfig();
  
  const ephemeralAuth = useEphemeralAuth({
    autoConnect: config?.autoConnect ?? true,
    autoRefresh: true,
    model: config?.model || "models/gemini-live-2.5-flash-preview",
    connectConfig: config?.connectConfig || {},
    onTokenRefresh: (token, expiresAt) => {
      if (tokenConfig.development.enableDebugLogging) {
        console.log(`[EphemeralLiveAPI] Token refreshed (expires: ${expiresAt.toISOString()})`);
      }
    },
    onTokenExpired: (sessionId) => {
      if (tokenConfig.development.enableDebugLogging) {
        console.warn(`[EphemeralLiveAPI] Token expired for session ${sessionId}`);
      }
    },
    onConnectionChange: (status) => {
      if (tokenConfig.development.enableDebugLogging) {
        console.log(`[EphemeralLiveAPI] Connection status changed: ${status}`);
      }
    },
    onError: (error) => {
      console.error(`[EphemeralLiveAPI] Error:`, error);
    },
  });

  return (
    <EphemeralLiveAPIContext.Provider value={ephemeralAuth}>
      {children}
    </EphemeralLiveAPIContext.Provider>
  );
};

export const useEphemeralLiveAPIContext = () => {
  const context = useContext(EphemeralLiveAPIContext);
  if (!context) {
    throw new Error("useEphemeralLiveAPIContext must be used within a EphemeralLiveAPIProvider");
  }
  return context;
};

// Compatibility hook that provides the same interface as the old useLiveAPIContext
export const useLiveAPIContext = () => {
  const ephemeralAuth = useEphemeralLiveAPIContext();
  
  // Map the enhanced auth interface to match the old interface
  return {
    client: ephemeralAuth.client,
    config: ephemeralAuth.client?.getConfig() || {},
    setConfig: () => {
      console.warn("setConfig is deprecated with ephemeral tokens. Configuration is managed automatically.");
    },
    model: ephemeralAuth.client?.model || "models/gemini-live-2.5-flash-preview",
    setModel: () => {
      console.warn("setModel is deprecated with ephemeral tokens. Use EphemeralLiveAPIProvider config instead.");
    },
    connected: ephemeralAuth.state.isConnected,
    connect: async () => {
      const success = await ephemeralAuth.actions.connect();
      if (!success) {
        throw new Error("Failed to connect");
      }
    },
    disconnect: async () => {
      ephemeralAuth.actions.disconnect();
    },
    volume: 0, // Would need to be implemented in the enhanced client if needed
    // Extended interface for enhanced features
    tokenState: ephemeralAuth.state,
    tokenActions: ephemeralAuth.actions,
  };
};