'use client';

import { useEffect, useRef } from 'react';
import { pb } from '@/lib/auth/pocketbase-client';

interface WebViewMessage {
  type: 'AUTH_TOKEN';
  token: string;
  source?: 'react-native' | 'url' | 'cookie';
}

export function WebViewAuthHandler() {
  const hasAttemptedAuth = useRef(false);

  useEffect(() => {
    // Skip if not in browser environment
    if (typeof window === 'undefined') {
      return;
    }

    // Use optional auth context to avoid build errors
    let isAuthenticated = false;
    try {
      // This will be undefined during SSR/build
      if (typeof window !== 'undefined' && window.localStorage) {
        // Check if we have a valid PocketBase token
        const pbData = localStorage.getItem('pocketbase_auth');
        if (pbData) {
          const authData = JSON.parse(pbData);
          isAuthenticated = !!(authData.token && authData.model);
        }
      }
    } catch {
      isAuthenticated = false;
    }

    // Prevent multiple authentication attempts
    if (hasAttemptedAuth.current || isAuthenticated) {
      return;
    }

    const authenticateWithToken = async (token: string, source: string = 'unknown') => {
      try {
        console.log(`WebView token detected from ${source}, authenticating...`);
        
        // Set the token in PocketBase auth store
        pb.authStore.save(token, null);
        
        // Verify the token and get user data
        const authData = await pb.collection('users').authRefresh();
        console.log('WebView authentication successful:', {
          user: authData.record.email,
          source
        });

        // Set auth cookie for middleware
        if (typeof document !== 'undefined') {
          document.cookie = `pb_auth=true; path=/; max-age=${60 * 60 * 24 * 30}; samesite=strict`;
        }

        // Redirect from login page after successful auth
        if (window.location.pathname === '/login') {
          console.log('Redirecting from login page to home...');
          setTimeout(() => {
            window.location.href = '/';
          }, 500);
        }

        return true;
      } catch (error) {
        console.error(`WebView authentication failed (${source}):`, error);
        pb.authStore.clear();
        
        // Clear auth cookie on failure
        if (typeof document !== 'undefined') {
          document.cookie = 'pb_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        }
        return false;
      }
    };

    const initializeAuth = async () => {
      hasAttemptedAuth.current = true;

      // 1. Check for token in URL parameters (primary method for WebView)
      const urlParams = new URLSearchParams(window.location.search);
      const urlToken = urlParams.get('token');
      
      if (urlToken) {
        const success = await authenticateWithToken(urlToken, 'url');
        if (success) {
          // Remove token from URL for security
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('token');
          window.history.replaceState({}, '', newUrl.toString());
          return;
        }
      }

      // 2. Check for existing PocketBase cookie/session
      if (pb.authStore.isValid) {
        try {
          await pb.collection('users').authRefresh();
          console.log('Existing PocketBase session validated');
          
          // Set auth cookie for middleware if not already set
          if (typeof document !== 'undefined') {
            const authCookie = document.cookie
              .split('; ')
              .find(row => row.startsWith('pb_auth='));
            
            if (!authCookie || authCookie.split('=')[1] !== 'true') {
              document.cookie = `pb_auth=true; path=/; max-age=${60 * 60 * 24 * 30}; samesite=strict`;
            }
          }

          // Redirect from login if already authenticated
          if (window.location.pathname === '/login') {
            setTimeout(() => {
              window.location.href = '/';
            }, 100);
          }
          return;
        } catch {
          console.log('Existing session invalid, clearing auth store');
          pb.authStore.clear();
        }
      }

      // 3. Set up postMessage listener for React Native WebView
      const handleMessage = async (event: MessageEvent) => {
        // Validate origin for security (in production, you should check specific origins)
        if (process.env.NODE_ENV === 'production') {
          // Add your React Native app's origin validation here
          // const allowedOrigins = ['your-react-native-scheme://'];
          // if (!allowedOrigins.includes(event.origin)) return;
        }

        const message: WebViewMessage = event.data;
        
        if (message.type === 'AUTH_TOKEN' && message.token) {
          await authenticateWithToken(message.token, 'react-native-postMessage');
        }
      };

      window.addEventListener('message', handleMessage);
      
      // Also listen for React Native WebView postMessage (alternative method)
      const handleWebViewMessage = (event: MessageEvent) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data.type === 'AUTH_TOKEN' && data.token) {
            authenticateWithToken(data.token, 'react-native-webview');
          }
        } catch (error) {
          // Ignore malformed messages
          console.debug('Ignored malformed message:', error);
        }
      };

      document.addEventListener('message', handleWebViewMessage as EventListener);

      // Cleanup function
      return () => {
        window.removeEventListener('message', handleMessage);
        document.removeEventListener('message', handleWebViewMessage as EventListener);
      };
    };

    initializeAuth().then(cleanup => {
      return () => {
        if (cleanup) {
          cleanup();
        }
      };
    });

    // Return empty cleanup for the useEffect
    return () => {};
  }, []); // Remove isAuthenticated dependency to avoid context issues

  // Expose authentication method to window for direct calls from React Native
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { webViewAuth?: { authenticate: (token: string) => Promise<{ success: boolean; error?: string }> } }).webViewAuth = {
        authenticate: async (token: string) => {
          try {
            pb.authStore.save(token, null);
            await pb.collection('users').authRefresh();
            
            // Set auth cookie
            document.cookie = `pb_auth=true; path=/; max-age=${60 * 60 * 24 * 30}; samesite=strict`;
            
            // Trigger auth context update
            window.dispatchEvent(new Event('pocketbase-auth-change'));
            
            if (window.location.pathname === '/login') {
              window.location.href = '/';
            }
            
            return { success: true };
          } catch (error) {
            pb.authStore.clear();
            document.cookie = 'pb_auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
            return { success: false, error: error instanceof Error ? error.message : 'Authentication failed' };
          }
        }
      };
    }
  }, []);

  return null;
}