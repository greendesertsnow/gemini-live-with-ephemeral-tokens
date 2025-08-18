import { EphemeralToken } from './ephemeral-token-manager';

export interface StoredToken {
  token: EphemeralToken;
  cacheKey: string;
  retrievedAt: Date;
  refreshScheduled?: Date;
}

export interface TokenCacheEntry {
  token: StoredToken;
  hitCount: number;
  lastAccessed: Date;
}

export interface RateLimitEntry {
  count: number;
  windowStart: Date;
  blocked: boolean;
}

export interface TokenStorageConfig {
  maxCacheSize?: number;
  cacheEvictionMinutes?: number;
  rateLimitWindow?: number; // minutes
  rateLimitMax?: number;
  enablePersistence?: boolean;
  storagePrefix?: string;
}

/**
 * Client-side token storage system with caching and rate limiting
 * Provides efficient token management for the frontend application
 */
export class TokenStorage {
  private cache = new Map<string, TokenCacheEntry>();
  private rateLimits = new Map<string, RateLimitEntry>();
  private config: Required<TokenStorageConfig>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: TokenStorageConfig) {
    this.config = {
      maxCacheSize: 50,
      cacheEvictionMinutes: 60,
      rateLimitWindow: 60, // 1 hour
      rateLimitMax: 10, // 10 requests per hour per client
      enablePersistence: typeof localStorage !== 'undefined',
      storagePrefix: 'gemini_tokens_',
      ...config,
    };

    this.startCleanupInterval();
    this.loadFromPersistence();
  }

  /**
   * Store a token in cache and optionally persist
   */
  async storeToken(sessionId: string, token: EphemeralToken): Promise<void> {
    const cacheKey = this.generateCacheKey(sessionId);
    const storedToken: StoredToken = {
      token,
      cacheKey,
      retrievedAt: new Date(),
    };

    const cacheEntry: TokenCacheEntry = {
      token: storedToken,
      hitCount: 0,
      lastAccessed: new Date(),
    };

    // Evict old entries if cache is full
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictOldestEntry();
    }

    this.cache.set(cacheKey, cacheEntry);

    // Persist to localStorage if enabled
    if (this.config.enablePersistence) {
      await this.persistToken(cacheKey, storedToken);
    }

    console.log(`[TokenStorage] Stored token for session ${sessionId}`);
  }

  /**
   * Retrieve a token from cache or persistence
   */
  async getToken(sessionId: string): Promise<StoredToken | null> {
    const cacheKey = this.generateCacheKey(sessionId);
    
    // Check cache first
    const cacheEntry = this.cache.get(cacheKey);
    if (cacheEntry) {
      cacheEntry.hitCount++;
      cacheEntry.lastAccessed = new Date();
      
      // Validate token is still valid
      if (this.isTokenValid(cacheEntry.token.token)) {
        return cacheEntry.token;
      } else {
        // Remove invalid token
        this.cache.delete(cacheKey);
        if (this.config.enablePersistence) {
          this.removePersistentToken(cacheKey);
        }
      }
    }

    // Try to load from persistence
    if (this.config.enablePersistence) {
      const persistedToken = await this.loadPersistedToken(cacheKey);
      if (persistedToken && this.isTokenValid(persistedToken.token)) {
        // Add back to cache
        const cacheEntry: TokenCacheEntry = {
          token: persistedToken,
          hitCount: 1,
          lastAccessed: new Date(),
        };
        this.cache.set(cacheKey, cacheEntry);
        return persistedToken;
      }
    }

    return null;
  }

  /**
   * Remove a token from cache and persistence
   */
  async removeToken(sessionId: string): Promise<boolean> {
    const cacheKey = this.generateCacheKey(sessionId);
    const hadToken = this.cache.has(cacheKey);

    this.cache.delete(cacheKey);

    if (this.config.enablePersistence) {
      this.removePersistentToken(cacheKey);
    }

    console.log(`[TokenStorage] Removed token for session ${sessionId}`);
    return hadToken;
  }

  /**
   * Check rate limiting for a client
   */
  checkRateLimit(clientId: string = 'default'): {
    allowed: boolean;
    remaining: number;
    resetTime: Date;
  } {
    const now = new Date();
    const entry = this.rateLimits.get(clientId);

    if (!entry) {
      // First request
      this.rateLimits.set(clientId, {
        count: 1,
        windowStart: now,
        blocked: false,
      });
      
      return {
        allowed: true,
        remaining: this.config.rateLimitMax - 1,
        resetTime: new Date(now.getTime() + this.config.rateLimitWindow * 60 * 1000),
      };
    }

    const windowElapsed = now.getTime() - entry.windowStart.getTime();
    const windowSize = this.config.rateLimitWindow * 60 * 1000;

    // Reset window if expired
    if (windowElapsed >= windowSize) {
      entry.count = 1;
      entry.windowStart = now;
      entry.blocked = false;
      
      return {
        allowed: true,
        remaining: this.config.rateLimitMax - 1,
        resetTime: new Date(now.getTime() + windowSize),
      };
    }

    // Check if over limit
    if (entry.count >= this.config.rateLimitMax) {
      entry.blocked = true;
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: new Date(entry.windowStart.getTime() + windowSize),
      };
    }

    // Increment count
    entry.count++;

    return {
      allowed: true,
      remaining: this.config.rateLimitMax - entry.count,
      resetTime: new Date(entry.windowStart.getTime() + windowSize),
    };
  }

  /**
   * Get storage statistics
   */
  getStatistics(): {
    cacheSize: number;
    hitRate: number;
    rateLimitedClients: number;
    oldestEntry?: Date;
    newestEntry?: Date;
  } {
    let totalHits = 0;
    let totalRequests = 0;
    let oldestEntry: Date | undefined;
    let newestEntry: Date | undefined;

    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
      totalRequests += entry.hitCount + 1; // +1 for initial storage

      if (!oldestEntry || entry.lastAccessed < oldestEntry) {
        oldestEntry = entry.lastAccessed;
      }
      if (!newestEntry || entry.lastAccessed > newestEntry) {
        newestEntry = entry.lastAccessed;
      }
    }

    const rateLimitedClients = Array.from(this.rateLimits.values())
      .filter(entry => entry.blocked).length;

    return {
      cacheSize: this.cache.size,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      rateLimitedClients,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Clear all cached tokens
   */
  async clearAll(): Promise<void> {
    this.cache.clear();
    this.rateLimits.clear();

    if (this.config.enablePersistence) {
      await this.clearPersistence();
    }

    console.log('[TokenStorage] Cleared all cached tokens');
  }

  /**
   * Shutdown storage system
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  private isTokenValid(token: EphemeralToken): boolean {
    const now = new Date();
    return token.expiresAt > now && token.usesRemaining > 0;
  }

  private generateCacheKey(sessionId: string): string {
    return `${this.config.storagePrefix}${sessionId}`;
  }

  private evictOldestEntry(): void {
    let oldestKey: string | undefined;
    let oldestTime: Date | undefined;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldestTime || entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.config.enablePersistence) {
        this.removePersistentToken(oldestKey);
      }
    }
  }

  private async persistToken(key: string, token: StoredToken): Promise<void> {
    try {
      const data = JSON.stringify({
        ...token,
        token: {
          ...token.token,
          expiresAt: token.token.expiresAt.toISOString(),
          createdAt: token.token.createdAt.toISOString(),
          lastUsed: token.token.lastUsed?.toISOString(),
        },
        retrievedAt: token.retrievedAt.toISOString(),
      });
      
      localStorage.setItem(key, data);
    } catch (error) {
      console.warn('[TokenStorage] Failed to persist token:', error);
    }
  }

  private async loadPersistedToken(key: string): Promise<StoredToken | null> {
    try {
      const data = localStorage.getItem(key);
      if (!data) return null;

      const parsed = JSON.parse(data);
      
      return {
        ...parsed,
        token: {
          ...parsed.token,
          expiresAt: new Date(parsed.token.expiresAt),
          createdAt: new Date(parsed.token.createdAt),
          lastUsed: parsed.token.lastUsed ? new Date(parsed.token.lastUsed) : undefined,
        },
        retrievedAt: new Date(parsed.retrievedAt),
      };
    } catch (error) {
      console.warn('[TokenStorage] Failed to load persisted token:', error);
      return null;
    }
  }

  private removePersistentToken(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[TokenStorage] Failed to remove persistent token:', error);
    }
  }

  private async loadFromPersistence(): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.config.storagePrefix)) {
          const token = await this.loadPersistedToken(key);
          if (token && this.isTokenValid(token.token)) {
            const cacheEntry: TokenCacheEntry = {
              token,
              hitCount: 0,
              lastAccessed: new Date(),
            };
            this.cache.set(key, cacheEntry);
          } else if (token) {
            // Remove invalid persisted token
            this.removePersistentToken(key);
          }
        }
      }
    } catch (error) {
      console.warn('[TokenStorage] Failed to load from persistence:', error);
    }
  }

  private async clearPersistence(): Promise<void> {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.config.storagePrefix)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('[TokenStorage] Failed to clear persistence:', error);
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cacheEvictionMinutes * 60 * 1000);
  }

  private cleanup(): void {
    const now = new Date();
    const evictionTime = this.config.cacheEvictionMinutes * 60 * 1000;
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now.getTime() - entry.lastAccessed.getTime();
      const tokenExpired = !this.isTokenValid(entry.token.token);

      if (tokenExpired || age > evictionTime) {
        this.cache.delete(key);
        if (this.config.enablePersistence) {
          this.removePersistentToken(key);
        }
        cleaned++;
      }
    }

    // Clean up rate limit entries
    const rateLimitWindow = this.config.rateLimitWindow * 60 * 1000;
    for (const [clientId, entry] of this.rateLimits.entries()) {
      const age = now.getTime() - entry.windowStart.getTime();
      if (age > rateLimitWindow * 2) { // Keep for 2x window for statistics
        this.rateLimits.delete(clientId);
      }
    }

    if (cleaned > 0) {
      console.log(`[TokenStorage] Cleaned up ${cleaned} expired tokens`);
    }
  }
}

// Singleton instance for global usage
let globalTokenStorage: TokenStorage | null = null;

export function getTokenStorage(config?: TokenStorageConfig): TokenStorage {
  if (!globalTokenStorage) {
    globalTokenStorage = new TokenStorage(config);
  }
  return globalTokenStorage;
}