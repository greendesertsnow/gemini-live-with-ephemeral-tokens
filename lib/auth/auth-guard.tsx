'use client';

import { useEffect, useState } from 'react';
import { usePocketBaseAuth } from './pocketbase-context';

interface AuthGuardProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { isAuthenticated, isLoading } = usePocketBaseAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render anything until mounted (avoid hydration issues)
  if (!mounted) {
    return fallback || (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Loading...</h1>
          <p className="text-muted-foreground">
            Initializing application...
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return fallback || (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Authenticating...</h1>
          <p className="text-muted-foreground">
            Verifying your credentials...
          </p>
        </div>
      </div>
    );
  }

  // If not authenticated, the middleware will handle the redirect
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Redirecting...</h1>
          <p className="text-muted-foreground">
            Taking you to the login page...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}