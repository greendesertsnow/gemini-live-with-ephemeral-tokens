"use client";

import React, { createContext, useContext, useEffect, useReducer, useCallback, ReactNode } from 'react';
import { getTokenStorage, StoredToken } from '@/lib/auth/token-storage';

export interface TokenState {
  currentToken: string | null;
  tokenExpiresAt: Date | null;
  sessionId: string;
  isRefreshing: boolean;
  isValid: boolean;
  usesRemaining: number;
  error: string | null;
  lastRefresh: Date | null;
  refreshCount: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
}

export interface TokenActions {
  createToken: (options?: CreateTokenOptions) => Promise<boolean>;
  refreshToken: () => Promise<boolean>;
  clearToken: () => void;
  updateConnectionStatus: (status: TokenState['connectionStatus']) => void;
  clearError: () => void;
}

export interface CreateTokenOptions {
  uses?: number;
  expirationMinutes?: number;
  sessionId?: string;
}

export interface TokenContextValue {
  state: TokenState;
  actions: TokenActions;
}

export interface TokenProviderConfig {
  apiEndpoint?: string;
  autoRefresh?: boolean;
  refreshThresholdMinutes?: number;
  maxRetries?: number;
  onTokenExpired?: (sessionId: string) => void;
  onTokenRefreshed?: (token: string, expiresAt: Date) => void;
  onError?: (error: string) => void;
}

type TokenAction =
  | { type: 'CREATE_TOKEN_START' }
  | { type: 'CREATE_TOKEN_SUCCESS'; payload: { token: string; expiresAt: Date; usesRemaining: number } }
  | { type: 'CREATE_TOKEN_FAILURE'; payload: string }
  | { type: 'REFRESH_TOKEN_START' }
  | { type: 'REFRESH_TOKEN_SUCCESS'; payload: { token: string; expiresAt: Date; usesRemaining: number } }
  | { type: 'REFRESH_TOKEN_FAILURE'; payload: string }
  | { type: 'CLEAR_TOKEN' }
  | { type: 'UPDATE_CONNECTION_STATUS'; payload: TokenState['connectionStatus'] }
  | { type: 'CLEAR_ERROR' }
  | { type: 'UPDATE_USES'; payload: number }
  | { type: 'SET_SESSION_ID'; payload: string };

const initialState: TokenState = {
  currentToken: null,
  tokenExpiresAt: null,
  sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  isRefreshing: false,
  isValid: false,
  usesRemaining: 0,
  error: null,
  lastRefresh: null,
  refreshCount: 0,
  connectionStatus: 'disconnected',
};

function tokenReducer(state: TokenState, action: TokenAction): TokenState {
  switch (action.type) {
    case 'CREATE_TOKEN_START':
      return {
        ...state,
        isRefreshing: true,
        error: null,
      };

    case 'CREATE_TOKEN_SUCCESS':
      return {
        ...state,
        currentToken: action.payload.token,
        tokenExpiresAt: action.payload.expiresAt,
        usesRemaining: action.payload.usesRemaining,
        isRefreshing: false,
        isValid: true,
        error: null,
        lastRefresh: new Date(),
        refreshCount: state.refreshCount + 1,
      };

    case 'CREATE_TOKEN_FAILURE':
      return {
        ...state,
        isRefreshing: false,
        isValid: false,
        error: action.payload,
      };

    case 'REFRESH_TOKEN_START':
      return {
        ...state,
        isRefreshing: true,
        error: null,
      };

    case 'REFRESH_TOKEN_SUCCESS':
      return {
        ...state,
        currentToken: action.payload.token,
        tokenExpiresAt: action.payload.expiresAt,
        usesRemaining: action.payload.usesRemaining,
        isRefreshing: false,
        isValid: true,
        error: null,
        lastRefresh: new Date(),
        refreshCount: state.refreshCount + 1,
      };

    case 'REFRESH_TOKEN_FAILURE':
      return {
        ...state,
        isRefreshing: false,
        isValid: false,
        error: action.payload,
      };

    case 'CLEAR_TOKEN':
      return {
        ...initialState,
        sessionId: state.sessionId, // Preserve session ID
      };

    case 'UPDATE_CONNECTION_STATUS':
      return {
        ...state,
        connectionStatus: action.payload,
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
      };

    case 'UPDATE_USES':
      return {
        ...state,
        usesRemaining: action.payload,
        isValid: action.payload > 0 && state.tokenExpiresAt ? state.tokenExpiresAt > new Date() : false,
      };

    case 'SET_SESSION_ID':
      return {
        ...state,
        sessionId: action.payload,
      };

    default:
      return state;
  }
}

export const TokenContext = createContext<TokenContextValue | null>(null);

export interface TokenProviderProps {
  children: ReactNode;
  config?: TokenProviderConfig;
}

export function TokenProvider({ children, config }: TokenProviderProps) {
  const [state, dispatch] = useReducer(tokenReducer, initialState);
  const tokenStorage = getTokenStorage();

  const providerConfig: Required<TokenProviderConfig> = {
    apiEndpoint: '/api/auth',
    autoRefresh: true,
    refreshThresholdMinutes: 5,
    maxRetries: 3,
    onTokenExpired: () => {},
    onTokenRefreshed: () => {},
    onError: () => {},
    ...config,
  };

  // Load existing token on mount
  useEffect(() => {
    loadExistingToken();
  }, []);

  // Auto-refresh timer
  useEffect(() => {
    if (providerConfig.autoRefresh && state.tokenExpiresAt && state.isValid) {
      const now = new Date();
      const timeUntilExpiry = state.tokenExpiresAt.getTime() - now.getTime();
      const refreshThreshold = providerConfig.refreshThresholdMinutes * 60 * 1000;
      
      if (timeUntilExpiry > refreshThreshold) {
        const refreshIn = timeUntilExpiry - refreshThreshold;
        
        const timer = setTimeout(() => {
          if (state.isValid && !state.isRefreshing) {
            refreshToken();
          }
        }, refreshIn);

        return () => clearTimeout(timer);
      } else if (timeUntilExpiry > 0) {
        // Token needs immediate refresh
        const timer = setTimeout(() => refreshToken(), 1000);
        return () => clearTimeout(timer);
      } else {
        // Token is expired
        providerConfig.onTokenExpired(state.sessionId);
        dispatch({ type: 'CLEAR_TOKEN' });
      }
    }
  }, [state.tokenExpiresAt, state.isValid, state.isRefreshing, providerConfig.autoRefresh]);

  const loadExistingToken = useCallback(async () => {
    try {
      const storedToken = await tokenStorage.getToken(state.sessionId);
      if (storedToken && isTokenValid(storedToken.token)) {
        dispatch({
          type: 'CREATE_TOKEN_SUCCESS',
          payload: {
            token: storedToken.token.token,
            expiresAt: storedToken.token.expiresAt,
            usesRemaining: storedToken.token.usesRemaining,
          },
        });
      }
    } catch (error) {
      console.warn('Failed to load existing token:', error);
    }
  }, [state.sessionId]);

  const createToken = useCallback(async (options?: CreateTokenOptions): Promise<boolean> => {
    try {
      dispatch({ type: 'CREATE_TOKEN_START' });

      const requestBody = {
        sessionId: options?.sessionId || state.sessionId,
        uses: options?.uses || 1,
        expirationMinutes: options?.expirationMinutes || 30,
      };

      const response = await fetch(`${providerConfig.apiEndpoint}/ephemeral-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Token creation failed: ${response.status}`);
      }

      const tokenData = await response.json();
      const expiresAt = new Date(tokenData.expiresAt);

      // Store token
      await tokenStorage.storeToken(state.sessionId, {
        token: tokenData.token,
        expiresAt,
        usesRemaining: tokenData.usesRemaining,
        sessionId: tokenData.sessionId,
        scope: tokenData.scope,
        createdAt: new Date(),
      });

      // Update session ID if provided
      if (options?.sessionId && options.sessionId !== state.sessionId) {
        dispatch({ type: 'SET_SESSION_ID', payload: options.sessionId });
      }

      dispatch({
        type: 'CREATE_TOKEN_SUCCESS',
        payload: {
          token: tokenData.token,
          expiresAt,
          usesRemaining: tokenData.usesRemaining,
        },
      });

      providerConfig.onTokenRefreshed(tokenData.token, expiresAt);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'CREATE_TOKEN_FAILURE', payload: errorMessage });
      providerConfig.onError(errorMessage);
      return false;
    }
  }, [state.sessionId, providerConfig]);

  const refreshToken = useCallback(async (): Promise<boolean> => {
    try {
      dispatch({ type: 'REFRESH_TOKEN_START' });

      const response = await fetch(`${providerConfig.apiEndpoint}/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: state.sessionId,
          uses: 1,
          expirationMinutes: 30,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Token refresh failed: ${response.status}`);
      }

      const tokenData = await response.json();
      const expiresAt = new Date(tokenData.expiresAt);

      // Store refreshed token
      await tokenStorage.storeToken(state.sessionId, {
        token: tokenData.token,
        expiresAt,
        usesRemaining: tokenData.usesRemaining,
        sessionId: tokenData.sessionId,
        scope: tokenData.scope,
        createdAt: new Date(),
      });

      dispatch({
        type: 'REFRESH_TOKEN_SUCCESS',
        payload: {
          token: tokenData.token,
          expiresAt,
          usesRemaining: tokenData.usesRemaining,
        },
      });

      providerConfig.onTokenRefreshed(tokenData.token, expiresAt);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'REFRESH_TOKEN_FAILURE', payload: errorMessage });
      providerConfig.onError(errorMessage);
      
      // If refresh fails, try creating a new token
      if (!state.isRefreshing) {
        return await createToken();
      }
      
      return false;
    }
  }, [state.sessionId, state.isRefreshing, createToken, providerConfig]);

  const clearToken = useCallback(async () => {
    try {
      await tokenStorage.removeToken(state.sessionId);
    } catch (error) {
      console.warn('Failed to clear stored token:', error);
    }
    dispatch({ type: 'CLEAR_TOKEN' });
  }, [state.sessionId]);

  const updateConnectionStatus = useCallback((status: TokenState['connectionStatus']) => {
    dispatch({ type: 'UPDATE_CONNECTION_STATUS', payload: status });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const actions: TokenActions = {
    createToken,
    refreshToken,
    clearToken,
    updateConnectionStatus,
    clearError,
  };

  const contextValue: TokenContextValue = {
    state,
    actions,
  };

  return (
    <TokenContext.Provider value={contextValue}>
      {children}
    </TokenContext.Provider>
  );
}

export function useTokenContext(): TokenContextValue {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error('useTokenContext must be used within a TokenProvider');
  }
  return context;
}

// Utility functions
function isTokenValid(token: any): boolean {
  const now = new Date();
  const expiresAt = new Date(token.expiresAt);
  return expiresAt > now && token.usesRemaining > 0;
}

// Hook for getting token status
export function useTokenStatus() {
  const { state } = useTokenContext();
  
  const timeUntilExpiry = state.tokenExpiresAt 
    ? state.tokenExpiresAt.getTime() - new Date().getTime()
    : 0;
  
  const needsRefresh = timeUntilExpiry < (5 * 60 * 1000); // Less than 5 minutes
  
  return {
    hasToken: !!state.currentToken,
    isValid: state.isValid,
    isRefreshing: state.isRefreshing,
    needsRefresh,
    timeUntilExpiry,
    usesRemaining: state.usesRemaining,
    error: state.error,
  };
}

// Hook for connection management
export function useTokenConnection() {
  const { state, actions } = useTokenContext();
  
  return {
    connectionStatus: state.connectionStatus,
    updateConnectionStatus: actions.updateConnectionStatus,
    sessionId: state.sessionId,
    refreshCount: state.refreshCount,
  };
}