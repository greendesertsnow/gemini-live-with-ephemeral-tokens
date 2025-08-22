import { NextRequest, NextResponse } from 'next/server';
import PocketBase from 'pocketbase';

export async function POST(request: NextRequest) {
    try {
        const { token } = await request.json();

        if (!token) {
            return NextResponse.json({ error: 'Token required' }, { status: 400 });
        }

        // Verify token with PocketBase
        const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);
        pb.authStore.save(token, null);

        try {
            const authData = await pb.collection('users').authRefresh();

            // Create response with authentication cookie
            const response = NextResponse.json({
                success: true,
                user: {
                    id: authData.record.id,
                    email: authData.record.email,
                    name: authData.record.name
                }
            });

            // Set the pb_auth cookie for middleware
            response.cookies.set('pb_auth', 'true', {
                httpOnly: false, // Allow client-side access
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 60 * 60 * 24 * 30, // 30 days
                path: '/'
            });

            return response;
        } catch (authError) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }
    } catch (error) {
        console.error('WebView login error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}