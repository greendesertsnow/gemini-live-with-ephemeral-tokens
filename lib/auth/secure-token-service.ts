import { EphemeralTokenManager } from './ephemeral-token-manager';
import { getSecurityMiddleware } from './security-middleware';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Secure token service that integrates the token manager with security middleware
 * Provides a high-level API for secure token operations
 */
export class SecureTokenService {
  private tokenManager: EphemeralTokenManager;
  private securityMiddleware = getSecurityMiddleware();

  constructor(apiKey: string) {
    this.tokenManager = new EphemeralTokenManager(apiKey, {
      maxTokensPerSession: 3,
      defaultExpirationMinutes: 30,
      defaultUses: 1,
      cleanupIntervalMinutes: 5,
      enableAuditLog: true,
    });
  }

  /**
   * Secure wrapper for token creation
   */
  async createTokenSecure(request: NextRequest) {
    return this.securityMiddleware.secureEndpoint(
      request,
      'ephemeral-token',
      async (req) => {
        const { searchParams } = new URL(req.url);
        let body: Record<string, unknown> = {};
        if (req.method === 'POST') {
          try {
            body = await req.json();
          } catch {
            body = {};
          }
        }

        const options = {
          uses: parseInt((body?.uses ?? searchParams.get('uses') ?? '1') as string),
          expirationMinutes: parseInt((body?.expirationMinutes ?? searchParams.get('expirationMinutes') ?? '30') as string),
          sessionId: (body?.sessionId ?? searchParams.get('sessionId')) as string | undefined,
          scope: (body?.scope as string[] | undefined) || ['gemini-live-api'],
        };

        const clientId = this.getClientId(req);
        const token = await this.tokenManager.createToken(options, clientId);

        return NextResponse.json({
          token: token.token,
          expiresAt: token.expiresAt.toISOString(),
          usesRemaining: token.usesRemaining,
          sessionId: token.sessionId,
          scope: token.scope,
        });
      }
    );
  }

  /**
   * Secure wrapper for token refresh
   */
  async refreshTokenSecure(request: NextRequest) {
    return this.securityMiddleware.secureEndpoint(
      request,
      'refresh-token',
      async (req) => {
        let body: Record<string, unknown> = {};
        try {
          body = await req.json();
        } catch {
          body = {};
        }
        const { sessionId } = body;

        if (!sessionId) {
          return NextResponse.json({
            error: 'sessionId is required'
          }, { status: 400 });
        }

        const options = {
          uses: (body.uses as number) || 1,
          expirationMinutes: (body.expirationMinutes as number) || 30,
        };

        const clientId = this.getClientId(req);
        const token = await this.tokenManager.refreshToken(sessionId as string, options, clientId);

        return NextResponse.json({
          token: token.token,
          expiresAt: token.expiresAt.toISOString(),
          usesRemaining: token.usesRemaining,
          sessionId: token.sessionId,
          scope: token.scope,
        });
      }
    );
  }

  /**
   * Secure wrapper for session status check
   */
  async getSessionStatusSecure(request: NextRequest) {
    return this.securityMiddleware.secureEndpoint(
      request,
      'session-status',
      async (req) => {
        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get('sessionId');

        if (!sessionId) {
          return NextResponse.json({
            error: 'sessionId parameter is required'
          }, { status: 400 });
        }

        const status = this.tokenManager.getSessionStatus(sessionId);

        return NextResponse.json({
          sessionId: status.sessionId,
          isActive: status.activeTokens > 0,
          tokenValid: status.activeTokens > 0,
          expiresAt: status.lastActivity?.toISOString() || null,
          usesRemaining: status.activeTokens,
          connectionStatus: status.activeTokens > 0 ? 'connected' : 'disconnected',
          lastActivity: status.lastActivity?.toISOString() || new Date().toISOString(),
          totalTokens: status.totalTokens,
          activeTokens: status.activeTokens,
        });
      }
    );
  }

  /**
   * Get service statistics (admin endpoint)
   */
  async getServiceStats(request: NextRequest) {
    return this.securityMiddleware.secureEndpoint(
      request,
      'service-stats',
      async () => {
        const tokenStats = this.tokenManager.getStatistics();
        const securityStats = this.securityMiddleware.getSecurityStats();

        return NextResponse.json({
          tokens: tokenStats,
          security: securityStats,
          timestamp: new Date().toISOString(),
        });
      }
    );
  }

  /**
   * Revoke session tokens (admin endpoint)
   */
  async revokeSessionSecure(request: NextRequest) {
    return this.securityMiddleware.secureEndpoint(
      request,
      'revoke-session',
      async (req) => {
        const body = await req.json();
        const { sessionId } = body;

        if (!sessionId) {
          return NextResponse.json({
            error: 'sessionId is required'
          }, { status: 400 });
        }

        const revokedCount = this.tokenManager.revokeSession(sessionId);

        return NextResponse.json({
          success: true,
          sessionId,
          revokedTokens: revokedCount,
        });
      }
    );
  }

  private getClientId(request: NextRequest): string {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      'unknown';

    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Simple hash for client identification
    let hash = 0;
    const combined = `${ip}_${userAgent}`;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return `client_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Shutdown the service
   */
  shutdown(): void {
    this.tokenManager.shutdown();
    this.securityMiddleware.shutdown();
  }
}

// Global service instance
let globalTokenService: SecureTokenService | null = null;

export function getSecureTokenService(): SecureTokenService {
  if (!globalTokenService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    globalTokenService = new SecureTokenService(apiKey);
  }
  return globalTokenService;
}