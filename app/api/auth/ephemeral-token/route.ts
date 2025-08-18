import { NextRequest } from "next/server";
import { getSecureTokenService } from "@/lib/auth/secure-token-service";

export interface EphemeralTokenRequest {
  uses?: number;
  expirationMinutes?: number;
  sessionId?: string;
  scope?: string[];
}

export interface EphemeralTokenResponse {
  token: string;
  expiresAt: string;
  usesRemaining: number;
  sessionId: string;
  scope: string[];
}

export async function POST(request: NextRequest) {
  try {
    const tokenService = getSecureTokenService();
    return await tokenService.createTokenSecure(request);
  } catch (error) {
    console.error("[TokenAPI] Error in ephemeral-token endpoint:", error);
    
    return new Response(JSON.stringify({
      error: "Failed to create ephemeral token",
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : error) : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}