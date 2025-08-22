import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(request: NextRequest): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'unknown';
    return ip;
}

function checkRateLimit(key: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 10;

    const record = rateLimitStore.get(key);
    
    if (!record || now > record.resetTime) {
        rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
        return true;
    }

    if (record.count >= maxRequests) {
        return false;
    }

    record.count++;
    return true;
}

export async function POST(request: NextRequest) {
    try {
        // Rate limiting
        const rateLimitKey = getRateLimitKey(request);
        if (!checkRateLimit(rateLimitKey)) {
            return NextResponse.json(
                { error: 'Too many requests. Please try again later.' }, 
                { status: 429 }
            );
        }

        const body = await request.json();
        const { token, source } = body;

        if (!token || typeof token !== 'string') {
            return NextResponse.json({ 
                error: 'Valid token required',
                details: 'Token must be a non-empty string'
            }, { status: 400 });
        }

        // Validate token format (basic validation)
        if (token.length < 10 || token.length > 500) {
            return NextResponse.json({ 
                error: 'Invalid token format',
                details: 'Token length is outside expected range'
            }, { status: 400 });
        }

        // Verify token with PocketBase
        const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);
        
        // Set the token and attempt to refresh
        pb.authStore.save(token, null);

        try {
            const authData = await pb.collection('users').authRefresh();

            console.log('WebView authentication successful:', {
                userId: authData.record.id,
                email: authData.record.email,
                source: source || 'api',
                timestamp: new Date().toISOString()
            });

            // Create response with authentication cookie
            const response = NextResponse.json({
                success: true,
                user: {
                    id: authData.record.id,
                    email: authData.record.email,
                    name: authData.record.name || null,
                    verified: authData.record.verified || false
                },
                authenticated_at: new Date().toISOString(),
                source: source || 'api'
            });

            // Set the pb_auth cookie for middleware
            response.cookies.set('pb_auth', 'true', {
                httpOnly: false, // Allow client-side access for WebView
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 * 30, // 30 days
                path: '/'
            });

            return response;
        } catch (authError: unknown) {
            const errorMessage = authError instanceof Error ? authError.message : 'Unknown error';
            console.error('Token validation failed:', {
                error: errorMessage,
                source: source || 'api',
                timestamp: new Date().toISOString()
            });

            // Clear the auth store on failure
            pb.authStore.clear();

            return NextResponse.json({ 
                error: 'Invalid or expired token',
                details: errorMessage
            }, { status: 401 });
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        console.error('WebView login error:', {
            error: errorMessage,
            stack: errorStack,
            timestamp: new Date().toISOString()
        });

        return NextResponse.json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? errorMessage : 'Please try again later'
        }, { status: 500 });
    }
}

// GET method for health check
export async function GET() {
    return NextResponse.json({
        status: 'healthy',
        service: 'webview-auth',
        timestamp: new Date().toISOString()
    });
}