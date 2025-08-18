import { NextRequest } from "next/server";
import { getSecureTokenService } from "@/lib/auth/secure-token-service";

export interface SessionStatusResponse {
  sessionId: string;
  isActive: boolean;
  tokenValid: boolean;
  expiresAt: string | null;
  usesRemaining: number | null;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  lastActivity: string;
  totalTokens?: number;
  activeTokens?: number;
}

export async function GET(request: NextRequest) {
  try {
    const tokenService = getSecureTokenService();
    return await tokenService.getSessionStatusSecure(request);
  } catch (error) {
    console.error("[TokenAPI] Error in session-status endpoint:", error);
    
    return new Response(JSON.stringify({
      error: "Failed to check session status",
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : error) : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}