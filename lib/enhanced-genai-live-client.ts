import {
  Content,
  GoogleGenAI,
  LiveCallbacks,
  LiveClientToolResponse,
  LiveConnectConfig,
  LiveServerContent,
  LiveServerMessage,
  LiveServerToolCall,
  LiveServerToolCallCancellation,
  Part,
  Session,
} from "@google/genai";

import { EventEmitter } from "eventemitter3";
import { difference } from "lodash";
import { StreamingLog } from "./types";
import { base64ToArrayBuffer } from "./utils";
import { getTokenStorage, StoredToken } from "./auth/token-storage";
import { getTokenMonitor } from "./monitoring/token-monitor";
import { handleTokenError } from "./monitoring/error-handler";
import { tokenTracker } from "./token-tracking";
import { getGlobalEphemeralTokenConfig } from "./config/ephemeral-token-config";

// Configuration constants
const DEFAULT_EPHEMERAL_CONFIG = {
  ENDPOINT: '/api/auth',
  AUTO_REFRESH: true,
  REFRESH_THRESHOLD_MINUTES: 5,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  TOKEN_EXPIRATION_MINUTES: 30,
  TOKEN_USES: 1,
} as const;

const TIMEOUTS = {
  CLEANUP_GRACE_PERIOD_MS: 5 * 60 * 1000, // 5 minutes
  NORMAL_DISCONNECT_CODE: 1000,
} as const;

// Error handling types and utilities
type TokenErrorType = 'AUTH_FAILED' | 'TOKEN_EXPIRED' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'CONNECTION_FAILED';

class TokenError extends Error {
  constructor(
    message: string,
    public readonly type: TokenErrorType,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

const createTokenError = (type: TokenErrorType, message: string, context?: Record<string, unknown>): TokenError => {
  return new TokenError(`[${type}] ${message}`, type, context);
};

// Type definitions for token data
interface TokenData {
  token: string;
  expiresAt: string;
  usesRemaining: number;
  sessionId: string;
  scope: string[];
}

interface TokenInfo {
  token: string;
  expiresAt: Date;
  usesRemaining: number;
  sessionId: string;
  scope: string[];
  createdAt: Date;
}

/**
 * Extended event types for the enhanced client with ephemeral token support
 */
export interface EnhancedLiveClientEventTypes {
  // Original events from the base client
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  content: (data: LiveServerContent) => void;
  error: (error: ErrorEvent) => void;
  interrupted: () => void;
  log: (log: StreamingLog) => void;
  open: () => void;
  setupcomplete: () => void;
  toolcall: (toolCall: LiveServerToolCall) => void;
  toolcallcancellation: (
    toolcallCancellation: LiveServerToolCallCancellation
  ) => void;
  turncomplete: () => void;

  // New events for token management
  tokenrefresh: (newToken: string, expiresAt: Date) => void;
  tokenexpired: (sessionId: string) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  reconnected: () => void;
  reconnectfailed: (error: Error) => void;
}

export interface EphemeralTokenConfig {
  endpoint?: string;
  sessionId?: string;
  autoRefresh?: boolean;
  refreshThresholdMinutes?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Enhanced GenAI Live Client with ephemeral token support
 * Provides automatic token refresh, connection recovery, and session management
 */
export class EnhancedGenAILiveClient extends EventEmitter<EnhancedLiveClientEventTypes> {
  protected client: GoogleGenAI | null = null;

  private _status: "connected" | "disconnected" | "connecting" | "reconnecting" = "disconnected";
  public get status() {
    return this._status;
  }

  private _session: Session | null = null;
  public get session() {
    return this._session;
  }

  private _model: string | null = null;
  public get model() {
    return this._model;
  }

  private _currentToken: string | null = null;
  private _tokenExpiresAt: Date | null = null;
  private _sessionId: string;

  protected config: LiveConnectConfig | null = null;
  private tokenConfig: Required<EphemeralTokenConfig>;
  private tokenStorage = getTokenStorage();
  private monitor = getTokenMonitor();

  private refreshTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private connectionCallbacks: LiveCallbacks | null = null;
  private pendingTokenRequest: Promise<StoredToken | null> | null = null;

  public getConfig() {
    return { ...this.config };
  }

  constructor(options?: { tokenConfig?: EphemeralTokenConfig }) {
    super();

    this.tokenConfig = {
      endpoint: DEFAULT_EPHEMERAL_CONFIG.ENDPOINT,
      sessionId: this.generateSessionId(),
      autoRefresh: DEFAULT_EPHEMERAL_CONFIG.AUTO_REFRESH,
      refreshThresholdMinutes: DEFAULT_EPHEMERAL_CONFIG.REFRESH_THRESHOLD_MINUTES,
      maxRetries: DEFAULT_EPHEMERAL_CONFIG.MAX_RETRIES,
      retryDelayMs: DEFAULT_EPHEMERAL_CONFIG.RETRY_DELAY_MS,
      ...options?.tokenConfig,
    };

    this._sessionId = this.tokenConfig.sessionId;

    // Start monitoring this session
    this.monitor.startSession(this._sessionId, {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Node.js',
    });

    // Bind methods
    this.send = this.send.bind(this);
    this.onopen = this.onopen.bind(this);
    this.onerror = this.onerror.bind(this);
    this.onclose = this.onclose.bind(this);
    this.onmessage = this.onmessage.bind(this);
    this.refreshToken = this.refreshToken.bind(this);
  }

  protected log(type: string, message: StreamingLog["message"]) {
    const log: StreamingLog = {
      date: new Date(),
      type,
      message,
    };
    this.emit("log", log);
  }

  /**
   * Enhanced connect method with ephemeral token support
   */
  async connect(model: string, config: LiveConnectConfig): Promise<boolean> {
    if (this._status === "connected" || this._status === "connecting") {
      return false;
    }

    const connectStartTime = Date.now();
    this._status = "connecting";
    this.config = config;
    this._model = model;
    this.reconnectAttempts = 0;

    // Debug model connection
    console.log('🤖 Enhanced Client Connecting:', {
      model: model,
      configuredTools: config.tools?.length || 0,
      speechConfig: !!config.speechConfig,
      systemInstruction: !!config.systemInstruction
    });

    try {
      // Get or create ephemeral token
      const token = await this.getValidToken();
      if (!token) {
        const error = createTokenError('AUTH_FAILED', 'Failed to obtain ephemeral token', {
          sessionId: this._sessionId,
          endpoint: 'connect'
        });
        handleTokenError(error, error.context || {});
        throw error;
      }

      // Use ephemeral token directly as API key for GoogleGenAI client
      this.client = new GoogleGenAI({
        apiKey: token.token.token,
        httpOptions: { apiVersion: 'v1alpha' },
      });
      this._currentToken = token.token.token;
      this._tokenExpiresAt = token.token.expiresAt;

      // Setup connection callbacks
      this.connectionCallbacks = {
        onopen: this.onopen,
        onmessage: this.onmessage,
        onerror: this.onerror,
        onclose: this.onclose,
      };

      // Establish connection
      this._session = await this.client.live.connect({
        model,
        config,
        callbacks: this.connectionCallbacks,
      });

      this._status = "connected";
      const connectDuration = Date.now() - connectStartTime;

      // Record successful connection
      this.monitor.recordConnectionSuccess(this._sessionId, connectDuration);

      // Start automatic token refresh if enabled
      if (this.tokenConfig.autoRefresh) {
        this.scheduleTokenRefresh();
      }

      this.log("client.connect", `Connected with ephemeral token (expires: ${this._tokenExpiresAt?.toISOString()})`);
      return true;

    } catch (error) {
      const connectDuration = Date.now() - connectStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failed connection
      this.monitor.recordConnectionFailure(this._sessionId, errorMessage, connectDuration);

      // Handle error with categorization
      handleTokenError(error instanceof Error ? error : new Error(errorMessage), {
        sessionId: this._sessionId,
        endpoint: 'connect',
        responseTime: connectDuration
      });

      console.error("Error connecting to GenAI Live with ephemeral token:", error);
      this._status = "disconnected";

      // Try to recover with token refresh
      if (this.shouldRetryConnection(error)) {
        this.scheduleReconnection();
        return false;
      }

      throw error;
    }
  }

  /**
   * Disconnect and clean up resources
   */
  public disconnect() {
    if (!this.session) {
      return false;
    }

    // Clear timers
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.session?.close();
    this._session = null;
    this._status = "disconnected";
    this.client = null;
    this._currentToken = null;
    this._tokenExpiresAt = null;
    this.reconnectAttempts = 0;

    this.log("client.close", `Disconnected`);
    return true;
  }

  /**
   * Get a valid ephemeral token, refreshing if necessary
   * Implements request deduplication to prevent multiple concurrent token requests
   */
  private async getValidToken(): Promise<StoredToken | null> {
    // Prevent multiple concurrent token requests
    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest;
    }

    this.pendingTokenRequest = this.fetchValidToken();

    try {
      const result = await this.pendingTokenRequest;
      return result;
    } finally {
      this.pendingTokenRequest = null;
    }
  }

  /**
   * Internal method to fetch a valid token
   */
  private async fetchValidToken(): Promise<StoredToken | null> {
    try {
      // Check if we have a cached valid token
      const cachedToken = await this.tokenStorage.getToken(this._sessionId);

      if (cachedToken && this.isTokenStillValid(cachedToken.token)) {
        return cachedToken;
      }

      // Request new token from API
      const tokenRequestBody = {
        sessionId: this._sessionId,
        uses: DEFAULT_EPHEMERAL_CONFIG.TOKEN_USES,
        expirationMinutes: DEFAULT_EPHEMERAL_CONFIG.TOKEN_EXPIRATION_MINUTES,
      };

      const response = await fetch(`${this.tokenConfig.endpoint}/ephemeral-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenRequestBody),
      });

      if (!response.ok) {
        throw createTokenError('NETWORK_ERROR', `Token request failed: ${response.status} ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          endpoint: 'ephemeral-token'
        });
      }

      const tokenData = await response.json();
      const newToken = this.createTokenFromResponse(tokenData);
      const storedToken = await this.storeTokenData(newToken);

      this.log("token.created", `New ephemeral token created (expires: ${newToken.expiresAt.toISOString()})`);
      return storedToken;

    } catch (error) {
      const tokenError = error instanceof TokenError ? error :
        createTokenError('TOKEN_EXPIRED', 'Failed to get ephemeral token', { originalError: error });

      console.error("[EnhancedGenAILiveClient] Failed to get ephemeral token:", {
        error: tokenError.message,
        type: tokenError.type,
        context: tokenError.context
      });
      return null;
    }
  }

  /**
   * Create token object from API response
   */
  private createTokenFromResponse(tokenData: TokenData): TokenInfo {
    return {
      token: tokenData.token,
      expiresAt: new Date(tokenData.expiresAt),
      usesRemaining: tokenData.usesRemaining,
      sessionId: tokenData.sessionId,
      scope: tokenData.scope,
      createdAt: new Date(),
    };
  }

  /**
   * Store token data and create StoredToken
   */
  private async storeTokenData(newToken: TokenInfo): Promise<StoredToken> {
    const storedToken: StoredToken = {
      token: newToken,
      cacheKey: this._sessionId,
      retrievedAt: new Date(),
    };

    await this.tokenStorage.storeToken(this._sessionId, newToken);
    return storedToken;
  }

  /**
   * Refresh the current ephemeral token
   */
  private async refreshToken(): Promise<boolean> {
    const refreshStartTime = Date.now();

    try {
      this.log("token.refresh", "Refreshing ephemeral token");

      const tokenRequestBody = {
        sessionId: this._sessionId,
        uses: DEFAULT_EPHEMERAL_CONFIG.TOKEN_USES,
        expirationMinutes: DEFAULT_EPHEMERAL_CONFIG.TOKEN_EXPIRATION_MINUTES,
      };

      const response = await fetch(`${this.tokenConfig.endpoint}/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenRequestBody),
      });

      if (!response.ok) {
        throw createTokenError('NETWORK_ERROR', `Token refresh failed: ${response.status} ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          endpoint: 'refresh-token'
        });
      }

      const tokenData = await response.json() as TokenData;
      const newToken = this.createTokenFromResponse(tokenData);

      // Update stored token
      await this.storeTokenData(newToken);

      // Update client with new token
      this._currentToken = newToken.token;
      this._tokenExpiresAt = newToken.expiresAt;

      const refreshDuration = Date.now() - refreshStartTime;

      // Record successful token refresh
      this.monitor.recordTokenRefresh(this._sessionId, refreshDuration);

      // Emit token refresh event
      this.emit("tokenrefresh", newToken.token, newToken.expiresAt);

      // Schedule next refresh
      if (this.tokenConfig.autoRefresh) {
        this.scheduleTokenRefresh();
      }

      this.log("token.refreshed", `Token refreshed (expires: ${newToken.expiresAt.toISOString()})`);

      return true;

    } catch (error) {
      const refreshDuration = Date.now() - refreshStartTime;
      const tokenError = error instanceof TokenError ? error :
        createTokenError('TOKEN_EXPIRED', 'Token refresh failed', { originalError: error });

      // Handle token refresh error
      handleTokenError(tokenError, {
        sessionId: this._sessionId,
        endpoint: 'refresh-token',
        responseTime: refreshDuration,
        ...tokenError.context
      });

      console.error("[EnhancedGenAILiveClient] Failed to refresh ephemeral token:", {
        error: tokenError.message,
        type: tokenError.type,
        context: tokenError.context
      });
      this.emit("tokenexpired", this._sessionId);

      // Try to reconnect with new token
      this.scheduleReconnection();

      return false;
    }
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this._tokenExpiresAt) return;

    const now = new Date();
    const timeUntilExpiry = this._tokenExpiresAt.getTime() - now.getTime();
    const refreshThreshold = this.tokenConfig.refreshThresholdMinutes * 60 * 1000;
    const refreshIn = timeUntilExpiry - refreshThreshold;

    if (refreshIn > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshToken();
      }, refreshIn);

      this.log("token.scheduled", `Token refresh scheduled in ${Math.round(refreshIn / 1000)}s`);
    } else {
      // Token needs immediate refresh
      setTimeout(() => this.refreshToken(), 0);
    }
  }

  /**
   * Check if token is still valid
   */
  private isTokenStillValid(token: { expiresAt: string | Date; usesRemaining: number }): boolean {
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const refreshThreshold = this.tokenConfig.refreshThresholdMinutes * 60 * 1000;

    return timeUntilExpiry > refreshThreshold && token.usesRemaining > 0;
  }

  /**
   * Check if connection should be retried
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private shouldRetryConnection(_error: unknown): boolean {
    return this.reconnectAttempts < this.tokenConfig.maxRetries;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(): void {
    if (this.reconnectAttempts >= this.tokenConfig.maxRetries) {
      this.emit("reconnectfailed", new Error("Max reconnection attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.tokenConfig.retryDelayMs * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    this.emit("reconnecting", this.reconnectAttempts, this.tokenConfig.maxRetries);

    this.reconnectTimer = setTimeout(async () => {
      try {
        this._status = "reconnecting";
        const success = await this.connect(this._model!, this.config!);

        if (success) {
          this.reconnectAttempts = 0;
          this.emit("reconnected");
        } else {
          this.scheduleReconnection();
        }
      } catch (error) {
        console.error("Reconnection attempt failed:", error);
        this.scheduleReconnection();
      }
    }, delay);

    this.log("connection.reconnect", `Reconnection attempt ${this.reconnectAttempts}/${this.tokenConfig.maxRetries} in ${delay}ms`);
  }

  // Original callback methods with enhanced error handling
  protected onopen() {
    this.log("client.open", "Connected");
    this.emit("open");
  }

  protected onerror(e: ErrorEvent) {
    this.log("server.error", e.message);
    this.emit("error", e);

    // Check if error is token-related
    if (this.isTokenError(e)) {
      this.refreshToken();
    }
  }

  protected onclose(e: CloseEvent) {
    this.log(
      `server.close`,
      `disconnected ${e.reason ? `with reason: ${e.reason}` : ``}`
    );
    this.emit("close", e);

    // Auto-reconnect if not intentional disconnect
    if (e.code !== TIMEOUTS.NORMAL_DISCONNECT_CODE && this._status === "connected") {
      this.scheduleReconnection();
    }
  }

  protected async onmessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      this.handleSetupComplete();
      return;
    }

    if (message.toolCall) {
      this.handleToolCall(message.toolCall);
      return;
    }

    if (message.toolCallCancellation) {
      this.handleToolCallCancellation(message.toolCallCancellation);
      return;
    }

    if (message.serverContent) {
      this.handleServerContent(message.serverContent, message);
      return;
    }

    // Handle unmatched message
    console.log("[EnhancedGenAILiveClient] received unmatched message", message);
  }

  /**
   * Handle setup complete message
   */
  private handleSetupComplete(): void {
    this.log("server.send", "setupComplete");
    this.emit("setupcomplete");
  }

  /**
   * Handle tool call message
   */
  private handleToolCall(toolCall: LiveServerToolCall): void {
    this.log("server.toolCall", `Tool call: ${toolCall.functionCalls?.[0]?.name || 'unknown'}`);
    this.emit("toolcall", toolCall);
  }

  /**
   * Handle tool call cancellation message
   */
  private handleToolCallCancellation(toolCallCancellation: LiveServerToolCallCancellation): void {
    this.log("server.toolCallCancellation", `Tool call cancelled: ${toolCallCancellation.ids?.join(', ') || 'unknown'}`);
    this.emit("toolcallcancellation", toolCallCancellation);
  }

  /**
   * Handle server content message
   */
  private handleServerContent(serverContent: LiveServerContent, originalMessage: LiveServerMessage): void {
    if ("interrupted" in serverContent) {
      this.log("server.content", "interrupted");
      this.emit("interrupted");
      return;
    }

    if ("turnComplete" in serverContent) {
      this.log("server.content", "turnComplete");
      this.emit("turncomplete");

      // Extract token usage metadata when turn is complete
      this.handleTokenUsage(originalMessage);
    }

    if ("modelTurn" in serverContent) {
      this.handleModelTurn(serverContent, originalMessage);
    }
  }

  /**
   * Handle token usage metadata from server messages
   */
  private handleTokenUsage(message: LiveServerMessage): void {
    try {
      // Extract usage metadata from different possible locations
      const messageObj = message as unknown as Record<string, unknown>;
      const usageMetadata = messageObj?.usageMetadata ||
                           (messageObj?.serverContent as Record<string, unknown>)?.usageMetadata ||
                           (messageObj?.modelTurn as Record<string, unknown>)?.usageMetadata;

      if (usageMetadata) {
        console.log('🎯 Token Usage Detected:', usageMetadata);
        console.log('🔍 Available fields:', Object.keys(usageMetadata));
        
        const usageData = usageMetadata as Record<string, unknown>;
        
        // Extract token counts - try different field names based on API versions
        const inputTokens = (usageData.promptTokenCount as number) ||
                           (usageData.inputTokenCount as number) ||
                           (usageData.promptTokens as number) || 0;
        const outputTokens = (usageData.candidatesTokenCount as number) ||
                            (usageData.outputTokenCount as number) ||
                            (usageData.responseTokenCount as number) ||
                            (usageData.candidateTokens as number) || 0;
        
        const totalTokens = (usageData.totalTokenCount as number) || (inputTokens + outputTokens);

        // Track the usage
        if (totalTokens > 0) {
          tokenTracker.track({
            model: this._model || getGlobalEphemeralTokenConfig().gemini.model,
            inputTokens,
            outputTokens,
            status: 'success'
          });

          console.log(`📊 Tracked ${totalTokens} tokens (${inputTokens} input, ${outputTokens} output)`);
        }

        // Log response token breakdown if available
        if (usageData.responseTokensDetails) {
          console.debug('Response token breakdown:', usageData.responseTokensDetails);
        }
      } else {
        // Log the entire message structure for debugging
        console.debug('🔍 No usage metadata found in message:', Object.keys(message));
      }
    } catch (error) {
      console.warn('Failed to handle token usage:', error);
    }
  }

  /**
   * Handle failed requests for token tracking
   */
  private handleTokenUsageError(message: LiveServerMessage): void {
    try {
      const error = (message as unknown as Record<string, unknown>)?.error;
      if (error) {
        // Track failed request with estimated tokens (minimal)
        tokenTracker.track({
          model: this._model || getGlobalEphemeralTokenConfig().gemini.model,
          inputTokens: 10, // Minimal estimate for failed requests
          outputTokens: 0,
          status: 'error'
        });

        console.log('❌ Tracked failed request');
      }
    } catch (error) {
      console.warn('Failed to handle token usage error:', error);
    }
  }

  /**
   * Handle model turn content with audio and text parts
   */
  private handleModelTurn(serverContent: LiveServerContent, originalMessage: LiveServerMessage): void {
    const parts: Part[] = serverContent.modelTurn?.parts || [];

    // Also check for usage metadata in model turn
    this.handleTokenUsage(originalMessage);

    // Process audio parts
    const { audioParts, otherParts } = this.separateAudioParts(parts);
    this.processAudioParts(audioParts);

    // If only audio parts, we're done
    if (otherParts.length === 0) {
      return;
    }

    // Emit content for non-audio parts
    const content: { modelTurn: Content } = { modelTurn: { parts: otherParts } };
    this.emit("content", content);
    this.log(`server.content`, `Content with ${otherParts.length} parts`);
  }

  /**
   * Separate audio parts from other parts
   */
  private separateAudioParts(parts: Part[]): { audioParts: Part[], otherParts: Part[] } {
    const audioParts = parts.filter(
      (p) => p.inlineData && p.inlineData.mimeType?.startsWith("audio/pcm")
    );
    const otherParts = difference(parts, audioParts);

    return { audioParts, otherParts };
  }

  /**
   * Process audio parts and emit audio data
   */
  private processAudioParts(audioParts: Part[]): void {
    const base64s = audioParts.map((p) => p.inlineData?.data).filter(Boolean);

    base64s.forEach((b64) => {
      if (b64) {
        const data = base64ToArrayBuffer(b64);
        this.emit("audio", data);
        this.log(`server.audio`, `buffer (${data.byteLength})`);
      }
    });
  }

  private isTokenError(error: ErrorEvent): boolean {
    const message = error.message.toLowerCase();
    return message.includes('auth') ||
      message.includes('token') ||
      message.includes('unauthorized') ||
      message.includes('forbidden');
  }

  // Original methods preserved
  sendRealtimeInput(chunks: Array<{ mimeType: string; data: string }>) {
    let hasAudio = false;
    let hasVideo = false;
    for (const ch of chunks) {
      this.session?.sendRealtimeInput({ media: ch });
      if (ch.mimeType.includes("audio")) {
        hasAudio = true;
      }
      if (ch.mimeType.includes("image")) {
        hasVideo = true;
      }
      if (hasAudio && hasVideo) {
        break;
      }
    }
    const message =
      hasAudio && hasVideo
        ? "audio + video"
        : hasAudio
          ? "audio"
          : hasVideo
            ? "video"
            : "unknown";
    this.log(`client.realtimeInput`, message);
  }

  sendToolResponse(toolResponse: LiveClientToolResponse) {
    if (
      toolResponse.functionResponses &&
      toolResponse.functionResponses.length
    ) {
      this.session?.sendToolResponse({
        functionResponses: toolResponse.functionResponses,
      });
      this.log(`client.toolResponse`, toolResponse);
    }
  }

  send(parts: Part | Part[], turnComplete: boolean = true) {
    this.session?.sendClientContent({ turns: parts, turnComplete });
    this.log(`client.send`, {
      turns: Array.isArray(parts) ? parts : [parts],
      turnComplete,
    });
  }

  /**
   * Get session information
   */
  getSessionInfo() {
    return {
      sessionId: this._sessionId,
      tokenExpiresAt: this._tokenExpiresAt,
      status: this._status,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Manually trigger token refresh
   */
  async manualRefreshToken(): Promise<boolean> {
    return await this.refreshToken();
  }
}