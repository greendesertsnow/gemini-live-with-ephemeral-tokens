import { NextRequest } from "next/server";
import { getSecureTokenService } from "@/lib/auth/secure-token-service";

export interface RefreshTokenRequest {
  currentToken?: string;
  sessionId: string;
  uses?: number;
  expirationMinutes?: number;
}

export interface RefreshTokenResponse {
  token: string;
  expiresAt: string;
  usesRemaining: number;
  sessionId: string;
  scope: string[];
}

export async function POST(request: NextRequest) {
  try {
    const tokenService = getSecureTokenService();
    return await tokenService.refreshTokenSecure(request);
  } catch (error) {
    console.error("[TokenAPI] Error in refresh-token endpoint:", error);
    
    return new Response(JSON.stringify({
      error: "Failed to refresh ephemeral token",
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : error) : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}