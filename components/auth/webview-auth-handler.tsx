'use client';

import { useEffect } from 'react';
import { pb } from '@/lib/auth/pocketbase-client';

export function WebViewAuthHandler() {
  useEffect(() => {
    // Check for token in URL parameters (for WebView authentication)
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (token) {
      console.log('WebView token detected, authenticating...');
      
      // Set the token in PocketBase auth store
      pb.authStore.save(token, null);
      
      // Verify the token and get user data
      pb.collection('users').authRefresh()
        .then(() => {
          console.log('WebView authentication successful');
          // Remove token from URL for security
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete('token');
          window.history.replaceState({}, '', newUrl.toString());
        })
        .catch((error) => {
          console.error('WebView authentication failed:', error);
          pb.authStore.clear();
        });
    }
  }, []);

  return null;
}