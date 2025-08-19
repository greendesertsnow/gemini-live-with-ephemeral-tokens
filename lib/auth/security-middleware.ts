import { NextRequest, NextResponse } from "next/server";
import { makeSerializable } from "@/lib/serialization-utils";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: NextRequest) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface SecurityConfig {
  enableRateLimit: boolean;
  rateLimitConfig: RateLimitConfig;
  enableRequestValidation: boolean;
  enableAuditLogging: boolean;
  allowedOrigins?: string[];
  requireHttps?: boolean;
  maxRequestSizeBytes?: number;
}

export interface RateLimitEntry {
  count: number;
  windowStart: number;
  blocked: boolean;
  lastReset: number;
}

export interface AuditLogEntry {
  timestamp: Date;
  event: string;
  clientId: string;
  ip: string;
  userAgent?: string;
  requestPath: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Comprehensive security middleware for token API endpoints
 * Provides rate limiting, validation, and audit logging
 */
export class SecurityMiddleware {
  private rateLimitStore = new Map<string, RateLimitEntry>();
  private auditLogEntries: AuditLogEntry[] = [];
  private config: SecurityConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = {
      enableRateLimit: true,
      rateLimitConfig: {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 10,
        keyGenerator: (req) => this.getClientIdentifier(req),
      },
      enableRequestValidation: true,
      enableAuditLogging: true,
      allowedOrigins: ['http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001', 'https://localhost:3001'],
      requireHttps: process.env.NODE_ENV === 'production',
      maxRequestSizeBytes: 1024 * 10, // 10KB
      ...config,
    };

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Main middleware function to secure API routes
   */
  async secureEndpoint(
    request: NextRequest,
    endpoint: string,
    handler: (request: NextRequest) => Promise<NextResponse>
  ): Promise<NextResponse> {
    const startTime = Date.now();
    const clientId = this.getClientIdentifier(request);

    try {
      // Security validations
      const validationResult = await this.validateRequest(request, endpoint);
      if (!validationResult.valid) {
        this.auditLog('SECURITY_VIOLATION', clientId, request, false, validationResult.reason);
        return NextResponse.json(
          { error: validationResult.reason },
          { status: validationResult.statusCode || 400 }
        );
      }

      // Rate limiting (skip in development to avoid noisy throttling)
      if (process.env.NODE_ENV !== 'development' && this.config.enableRateLimit) {
        const rateLimitResult = this.checkRateLimit(clientId);
        if (!rateLimitResult.allowed) {
          this.auditLog('RATE_LIMIT_EXCEEDED', clientId, request, false, 'Too many requests');

          return NextResponse.json(
            {
              error: 'Too many requests',
              retryAfter: rateLimitResult.retryAfter,
            },
            {
              status: 429,
              headers: {
                'Retry-After': rateLimitResult.retryAfter.toString(),
                'X-RateLimit-Limit': this.config.rateLimitConfig.maxRequests.toString(),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
              }
            }
          );
        }
      }

      // Execute the actual handler
      const response = await handler(request);
      const processingTime = Date.now() - startTime;

      // Audit successful requests
      this.auditLog('API_REQUEST_SUCCESS', clientId, request, true, undefined, {
        endpoint,
        processingTime,
        statusCode: response.status,
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      this.auditLog('API_REQUEST_ERROR', clientId, request, false,
        error instanceof Error ? error.message : String(error), {
        endpoint,
        processingTime,
      });

      console.error(`[SecurityMiddleware] Error in ${endpoint}:`, error);

      return NextResponse.json(
        {
          error: 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error : undefined
        },
        { status: 500 }
      );
    }
  }

  /**
   * Validate incoming requests for security compliance
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async validateRequest(request: NextRequest, _endpoint: string): Promise<{
    valid: boolean;
    reason?: string;
    statusCode?: number;
  }> {
    if (!this.config.enableRequestValidation) {
      return { valid: true };
    }

    // HTTPS validation (production only)
    if (this.config.requireHttps && !request.url.startsWith('https://') &&
      !request.url.includes('localhost')) {
      return {
        valid: false,
        reason: 'HTTPS required',
        statusCode: 403
      };
    }

    // Origin validation
    if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
      const origin = request.headers.get('origin');
      
      // Debug logging for origin validation
      console.log('[SecurityMiddleware] Origin validation:', {
        requestOrigin: origin,
        allowedOrigins: this.config.allowedOrigins,
        isAllowed: origin ? this.config.allowedOrigins.includes(origin) : 'no-origin-header'
      });
      
      if (origin && !this.config.allowedOrigins.includes(origin)) {
        return {
          valid: false,
          reason: 'Invalid origin',
          statusCode: 403
        };
      }
    }

    // Content-Length validation
    const contentLength = request.headers.get('content-length');
    if (contentLength && this.config.maxRequestSizeBytes) {
      const size = parseInt(contentLength);
      if (size > this.config.maxRequestSizeBytes) {
        return {
          valid: false,
          reason: 'Request too large',
          statusCode: 413
        };
      }
    }

    // Method validation
    const allowedMethods = ['GET', 'POST'];
    if (!allowedMethods.includes(request.method)) {
      return {
        valid: false,
        reason: 'Method not allowed',
        statusCode: 405
      };
    }

    // Content-Type validation for POST requests
    if (request.method === 'POST') {
      const contentType = request.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        return {
          valid: false,
          reason: 'Invalid content type',
          statusCode: 415
        };
      }
    }

    return { valid: true };
  }

  /**
   * Rate limiting implementation
   */
  private checkRateLimit(clientId: string): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter: number;
  } {
    const now = Date.now();
    const { windowMs, maxRequests } = this.config.rateLimitConfig;

    let entry = this.rateLimitStore.get(clientId);

    // Create new entry if doesn't exist
    if (!entry) {
      entry = {
        count: 1,
        windowStart: now,
        blocked: false,
        lastReset: now,
      };
      this.rateLimitStore.set(clientId, entry);

      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: Math.ceil((now + windowMs) / 1000),
        retryAfter: 0,
      };
    }

    // Check if window has expired
    if (now - entry.windowStart >= windowMs) {
      entry.count = 1;
      entry.windowStart = now;
      entry.blocked = false;
      entry.lastReset = now;

      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: Math.ceil((now + windowMs) / 1000),
        retryAfter: 0,
      };
    }

    // Check if over limit
    if (entry.count >= maxRequests) {
      entry.blocked = true;
      const resetTime = entry.windowStart + windowMs;

      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.ceil(resetTime / 1000),
        retryAfter: Math.ceil((resetTime - now) / 1000),
      };
    }

    // Increment count
    entry.count++;

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetTime: Math.ceil((entry.windowStart + windowMs) / 1000),
      retryAfter: 0,
    };
  }

  /**
   * Generate client identifier for rate limiting
   */
  private getClientIdentifier(request: NextRequest): string {
    // Try to get IP address from headers (NextRequest doesn't have .ip property)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      request.headers.get('x-forwarded-proto') ||
      'unknown';

    // Include User-Agent for better differentiation
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Create hash-like identifier
    return `${ip}_${this.simpleHash(userAgent)}`;
  }

  /**
   * Simple hash function for user agent
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Audit logging function
   */
  private auditLog(
    event: string,
    clientId: string,
    request: NextRequest,
    success: boolean,
    error?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.config.enableAuditLogging) return;

    const entry: AuditLogEntry = {
      timestamp: new Date(),
      event,
      clientId,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0] ||
        request.headers.get('x-real-ip') ||
        'unknown',
      userAgent: request.headers.get('user-agent') || undefined,
      requestPath: new URL(request.url).pathname,
      success,
      error,
      metadata,
    };

    this.auditLogEntries.push(entry);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[SecurityAudit] ${event}`, makeSerializable({
        clientId: entry.clientId,
        success: entry.success,
        error: entry.error,
        metadata: entry.metadata,
      }));
    }

    // Keep only last 1000 entries in memory
    if (this.auditLogEntries.length > 1000) {
      this.auditLogEntries.splice(0, this.auditLogEntries.length - 1000);
    }
  }

  /**
   * Get security statistics
   */
  getSecurityStats(): {
    activeRateLimits: number;
    blockedClients: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    topEvents: Array<{ event: string; count: number }>;
  } {
    const blockedClients = Array.from(this.rateLimitStore.values())
      .filter(entry => entry.blocked).length;

    const eventCounts = new Map<string, number>();
    let successfulRequests = 0;
    let failedRequests = 0;

    for (const entry of this.auditLogEntries) {
      const count = eventCounts.get(entry.event) || 0;
      eventCounts.set(entry.event, count + 1);

      if (entry.success) {
        successfulRequests++;
      } else {
        failedRequests++;
      }
    }

    const topEvents = Array.from(eventCounts.entries())
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      activeRateLimits: this.rateLimitStore.size,
      blockedClients,
      totalRequests: this.auditLogEntries.length,
      successfulRequests,
      failedRequests,
      topEvents,
    };
  }

  /**
   * Get recent audit log entries
   */
  getRecentAuditLog(limit: number = 100): AuditLogEntry[] {
    return this.auditLogEntries.slice(-limit);
  }

  /**
   * Clear rate limits for a client (admin function)
   */
  clearRateLimit(clientId: string): boolean {
    return this.rateLimitStore.delete(clientId);
  }

  /**
   * Start cleanup interval to remove old entries
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000); // Every 10 minutes
  }

  /**
   * Cleanup old rate limit entries
   */
  private cleanup(): void {
    const now = Date.now();
    const { windowMs } = this.config.rateLimitConfig;
    let cleaned = 0;

    for (const [clientId, entry] of this.rateLimitStore.entries()) {
      // Remove entries older than 2x window
      if (now - entry.windowStart > windowMs * 2) {
        this.rateLimitStore.delete(clientId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[SecurityMiddleware] Cleaned up ${cleaned} old rate limit entries`);
    }
  }

  /**
   * Shutdown the security middleware
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

// Singleton instance for global usage
let globalSecurityMiddleware: SecurityMiddleware | null = null;

export function getSecurityMiddleware(config?: Partial<SecurityConfig>): SecurityMiddleware {
  // If config is provided, always create a new instance (or recreate if config changed)
  if (config) {
    if (globalSecurityMiddleware) {
      globalSecurityMiddleware.shutdown();
    }
    globalSecurityMiddleware = new SecurityMiddleware(config);
  } else if (!globalSecurityMiddleware) {
    // Only create with defaults if no instance exists and no config provided
    globalSecurityMiddleware = new SecurityMiddleware();
  }
  return globalSecurityMiddleware;
}

// Reset global security middleware (useful for testing or configuration changes)
export function resetSecurityMiddleware(): void {
  if (globalSecurityMiddleware) {
    globalSecurityMiddleware.shutdown();
    globalSecurityMiddleware = null;
  }
}