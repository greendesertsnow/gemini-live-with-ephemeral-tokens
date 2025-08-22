import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
    // Check for PocketBase auth cookie
    const authCookie = request.cookies.get('pb_auth');
    const isLoginPage = request.nextUrl.pathname.startsWith('/login');
    const isApiRoute = request.nextUrl.pathname.startsWith('/api');
    const isStaticFile = request.nextUrl.pathname.startsWith('/_next') ||
        request.nextUrl.pathname.startsWith('/favicon') ||
        request.nextUrl.pathname.includes('.');

    // Allow API routes and static files
    if (isApiRoute || isStaticFile) {
        return NextResponse.next();
    }

    // Check if user is authenticated (cookie exists and has 'true' value)
    const isAuthenticated = authCookie && authCookie.value === 'true';

    console.log('Middleware check:', {
        pathname: request.nextUrl.pathname,
        authCookie: authCookie?.value,
        isAuthenticated,
        isLoginPage
    });

    // If not authenticated and not on login page, redirect to login
    if (!isAuthenticated && !isLoginPage) {
        console.log('Redirecting to login - not authenticated');
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // If authenticated and on login page, redirect to home
    if (isAuthenticated && isLoginPage) {
        console.log('Redirecting to home - already authenticated');
        return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};