import { GoogleGenAI } from "@google/genai";
import { makeSerializable } from "@/lib/serialization-utils";

export interface EphemeralToken {
  token: string;
  expiresAt: Date;
  usesRemaining: number;
  sessionId: string;
  scope: string[];
  createdAt: Date;
  lastUsed?: Date;
}

export interface TokenStorageEntry {
  token: EphemeralToken;
  refreshCount: number;
  issuedFor: string; // client identifier
}

export interface CreateTokenOptions {
  uses?: number;
  expirationMinutes?: number;
  sessionId?: string;
  scope?: string[];
}

export interface TokenManagerConfig {
  maxTokensPerSession?: number;
  defaultExpirationMinutes?: number;
  defaultUses?: number;
  cleanupIntervalMinutes?: number;
  enableAuditLog?: boolean;
}

/**
 * Comprehensive ephemeral token lifecycle management system
 * Handles creation, refresh, storage, and cleanup of tokens
 */
export class EphemeralTokenManager {
  private genai: GoogleGenAI;
  private tokenStorage = new Map<string, TokenStorageEntry>();
  private sessionTokens = new Map<string, Set<string>>(); // sessionId -> Set of token IDs
  private cleanupInterval?: NodeJS.Timeout;
  private config: Required<TokenManagerConfig>;

  constructor(apiKey: string, config?: TokenManagerConfig) {
    this.genai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    this.config = {
      maxTokensPerSession: 3,
      defaultExpirationMinutes: 30,
      defaultUses: 1,
      cleanupIntervalMinutes: 5,
      enableAuditLog: true,
      ...config,
    };

    // Start automatic cleanup
    this.startCleanupInterval();
  }

  /**
   * Create a new ephemeral token
   */
  async createToken(
    options: CreateTokenOptions = {},
    clientId: string = 'unknown'
  ): Promise<EphemeralToken> {
    const {
      uses = this.config.defaultUses,
      expirationMinutes = this.config.defaultExpirationMinutes,
      sessionId = this.generateSessionId(),
      scope = ['gemini-live-api'],
    } = options;

    // Validate parameters
    this.validateTokenParams(uses, expirationMinutes);

    // Check session token limit
    this.enforceSessionTokenLimit(sessionId);

    try {
      // Create ephemeral token using Google's SDK
      const expiration = new Date(Date.now() + expirationMinutes * 60 * 1000);
      const googleToken = await this.genai.authTokens.create({
        config: {
          uses,
          expireTime: expiration.toISOString(),
        },
      });

      const token: EphemeralToken = {
        token: googleToken.name!,
        expiresAt: expiration,
        usesRemaining: uses,
        sessionId,
        scope,
        createdAt: new Date(),
      };

      // Store token
      const tokenId = this.generateTokenId(token.token);
      const storageEntry: TokenStorageEntry = {
        token,
        refreshCount: 0,
        issuedFor: clientId,
      };

      this.tokenStorage.set(tokenId, storageEntry);
      this.addTokenToSession(sessionId, tokenId);

      // Audit log
      if (this.config.enableAuditLog) {
        this.auditLog('TOKEN_CREATED', {
          tokenId,
          sessionId,
          expiresAt: token.expiresAt.toISOString(),
          uses,
          clientId,
        });
      }

      return token;
    } catch (error) {
      this.auditLog('TOKEN_CREATION_ERROR', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        clientId,
      });
      throw new Error(`Failed to create ephemeral token: ${error}`);
    }
  }

  /**
   * Refresh an existing token or create a new one for the session
   */
  async refreshToken(
    sessionId: string,
    options: Partial<CreateTokenOptions> = {},
    clientId: string = 'unknown'
  ): Promise<EphemeralToken> {
    // Get existing session tokens
    const sessionTokenIds = this.sessionTokens.get(sessionId) || new Set();

    // Mark old tokens as used (but don't delete immediately for audit trail)
    for (const tokenId of sessionTokenIds) {
      const entry = this.tokenStorage.get(tokenId);
      if (entry) {
        entry.token.usesRemaining = 0;
        entry.token.lastUsed = new Date();
      }
    }

    // Create new token
    const newToken = await this.createToken(
      { ...options, sessionId },
      clientId
    );

    // Update refresh count for audit
    const tokenId = this.generateTokenId(newToken.token);
    const entry = this.tokenStorage.get(tokenId);
    if (entry) {
      entry.refreshCount = 1; // First refresh for this token
    }

    if (this.config.enableAuditLog) {
      this.auditLog('TOKEN_REFRESHED', {
        sessionId,
        newTokenId: tokenId,
        previousTokenCount: sessionTokenIds.size,
        clientId,
      });
    }

    return newToken;
  }

  /**
   * Validate a token and decrement usage
   */
  async validateAndUseToken(tokenString: string): Promise<{
    valid: boolean;
    token?: EphemeralToken;
    reason?: string;
  }> {
    const tokenId = this.generateTokenId(tokenString);
    const entry = this.tokenStorage.get(tokenId);

    if (!entry) {
      return { valid: false, reason: 'Token not found' };
    }

    const { token } = entry;

    // Check expiration
    if (token.expiresAt < new Date()) {
      return { valid: false, reason: 'Token expired' };
    }

    // Check uses remaining
    if (token.usesRemaining <= 0) {
      return { valid: false, reason: 'Token usage exhausted' };
    }

    // Decrement usage and update last used
    token.usesRemaining--;
    token.lastUsed = new Date();

    if (this.config.enableAuditLog) {
      this.auditLog('TOKEN_USED', {
        tokenId,
        sessionId: token.sessionId,
        usesRemaining: token.usesRemaining,
      });
    }

    return { valid: true, token };
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): {
    sessionId: string;
    activeTokens: number;
    totalTokens: number;
    lastActivity?: Date;
  } {
    const sessionTokenIds = this.sessionTokens.get(sessionId) || new Set();
    let activeTokens = 0;
    let lastActivity: Date | undefined;

    for (const tokenId of sessionTokenIds) {
      const entry = this.tokenStorage.get(tokenId);
      if (entry) {
        const { token } = entry;
        if (token.expiresAt > new Date() && token.usesRemaining > 0) {
          activeTokens++;
        }
        if (token.lastUsed && (!lastActivity || token.lastUsed > lastActivity)) {
          lastActivity = token.lastUsed;
        }
      }
    }

    return {
      sessionId,
      activeTokens,
      totalTokens: sessionTokenIds.size,
      lastActivity,
    };
  }

  /**
   * Revoke all tokens for a session
   */
  revokeSession(sessionId: string): number {
    const sessionTokenIds = this.sessionTokens.get(sessionId) || new Set();
    let revokedCount = 0;

    for (const tokenId of sessionTokenIds) {
      const entry = this.tokenStorage.get(tokenId);
      if (entry) {
        entry.token.usesRemaining = 0;
        entry.token.lastUsed = new Date();
        revokedCount++;
      }
    }

    if (this.config.enableAuditLog) {
      this.auditLog('SESSION_REVOKED', {
        sessionId,
        revokedTokenCount: revokedCount,
      });
    }

    return revokedCount;
  }

  /**
   * Cleanup expired tokens
   */
  cleanup(): { cleaned: number; remaining: number } {
    const now = new Date();
    let cleaned = 0;

    for (const [tokenId, entry] of this.tokenStorage.entries()) {
      const { token } = entry;
      const expired = token.expiresAt < now;
      const exhausted = token.usesRemaining <= 0;

      // Remove tokens that are expired or exhausted and haven't been used recently
      const timeSinceLastUse = token.lastUsed
        ? now.getTime() - token.lastUsed.getTime()
        : now.getTime() - token.createdAt.getTime();

      const shouldCleanup = (expired || exhausted) && timeSinceLastUse > 5 * 60 * 1000; // 5 minutes

      if (shouldCleanup) {
        this.tokenStorage.delete(tokenId);
        this.removeTokenFromSession(token.sessionId, tokenId);
        cleaned++;
      }
    }

    if (this.config.enableAuditLog && cleaned > 0) {
      this.auditLog('CLEANUP_COMPLETED', {
        cleanedTokens: cleaned,
        remainingTokens: this.tokenStorage.size,
      });
    }

    return { cleaned, remaining: this.tokenStorage.size };
  }

  /**
   * Get statistics about token usage
   */
  getStatistics(): {
    totalTokens: number;
    activeTokens: number;
    expiredTokens: number;
    exhaustedTokens: number;
    sessions: number;
  } {
    const now = new Date();
    let activeTokens = 0;
    let expiredTokens = 0;
    let exhaustedTokens = 0;

    for (const entry of this.tokenStorage.values()) {
      const { token } = entry;

      if (token.expiresAt < now) {
        expiredTokens++;
      } else if (token.usesRemaining <= 0) {
        exhaustedTokens++;
      } else {
        activeTokens++;
      }
    }

    return {
      totalTokens: this.tokenStorage.size,
      activeTokens,
      expiredTokens,
      exhaustedTokens,
      sessions: this.sessionTokens.size,
    };
  }

  /**
   * Shutdown the token manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.config.enableAuditLog) {
      this.auditLog('MANAGER_SHUTDOWN', {
        finalTokenCount: this.tokenStorage.size,
        finalSessionCount: this.sessionTokens.size,
      });
    }
  }

  private validateTokenParams(uses: number, expirationMinutes: number): void {
    if (uses < 1 || uses > 5) {
      throw new Error('Uses must be between 1 and 5');
    }
    if (expirationMinutes < 1 || expirationMinutes > 30) {
      throw new Error('Expiration must be between 1 and 30 minutes');
    }
  }

  private enforceSessionTokenLimit(sessionId: string): void {
    const sessionTokenIds = this.sessionTokens.get(sessionId) || new Set();
    const activeTokens = Array.from(sessionTokenIds)
      .map(id => this.tokenStorage.get(id))
      .filter(entry => {
        if (!entry) return false;
        const { token } = entry;
        return token.expiresAt > new Date() && token.usesRemaining > 0;
      });

    if (activeTokens.length >= this.config.maxTokensPerSession) {
      throw new Error(`Session has reached maximum token limit (${this.config.maxTokensPerSession})`);
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateTokenId(tokenString: string): string {
    // Create a short hash of the token for storage key
    let hash = 0;
    for (let i = 0; i < tokenString.length; i++) {
      const char = tokenString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `token_${Math.abs(hash).toString(36)}`;
  }

  private addTokenToSession(sessionId: string, tokenId: string): void {
    if (!this.sessionTokens.has(sessionId)) {
      this.sessionTokens.set(sessionId, new Set());
    }
    this.sessionTokens.get(sessionId)!.add(tokenId);
  }

  private removeTokenFromSession(sessionId: string, tokenId: string): void {
    const sessionTokenIds = this.sessionTokens.get(sessionId);
    if (sessionTokenIds) {
      sessionTokenIds.delete(tokenId);
      if (sessionTokenIds.size === 0) {
        this.sessionTokens.delete(sessionId);
      }
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMinutes * 60 * 1000);
  }

  private auditLog(event: string, data: Record<string, unknown>): void {
    if (this.config.enableAuditLog) {
      const payload = makeSerializable({
        timestamp: new Date().toISOString(),
        event,
        ...data,
      });
      console.log(`[EphemeralTokenManager] ${event}`, payload);
    }
  }
}