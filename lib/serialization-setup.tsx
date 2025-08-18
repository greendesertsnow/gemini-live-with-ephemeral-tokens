/**
 * Quick Setup for Serialization Safety
 * Drop-in integration for existing Next.js apps
 */

'use client';

import { useEffect } from 'react';
import { SerializationErrorBoundary } from '@/components/serialization-error-boundary';
import { configureDevWarnings, installSerializationDevTools } from '@/lib/dev-warnings';

// Global configuration - call this once in your app
export function setupSerializationSafety(config?: {
  enableDevTools?: boolean;
  logLevel?: 'warn' | 'error';
  excludePaths?: string[];
  autoFix?: boolean;
}) {
  const {
    enableDevTools = true,
    logLevel = 'warn',
    excludePaths = ['onClick', 'onAction', 'onSubmit', 'onChange', 'onFocus', 'onBlur'],
    autoFix = true
  } = config || {};

  // Configure development warnings
  configureDevWarnings({
    enabled: process.env.NODE_ENV === 'development',
    logLevel,
    checkProps: true,
    checkState: true,
    checkContext: true,
    excludePaths,
    includeStackTrace: true
  });

  // Install dev tools
  if (enableDevTools && typeof window !== 'undefined') {
    installSerializationDevTools();
  }

  return {
    ErrorBoundary: SerializationErrorBoundary,
    defaultProps: {
      autoFix,
      logErrors: process.env.NODE_ENV === 'development',
      showDetails: process.env.NODE_ENV === 'development',
      maxRetries: 2
    }
  };
}

// App-level wrapper component
interface SerializationSafeAppProps {
  children: React.ReactNode;
  config?: Parameters<typeof setupSerializationSafety>[0];
}

export function SerializationSafeApp({ children, config }: SerializationSafeAppProps) {
  const { ErrorBoundary, defaultProps } = setupSerializationSafety(config);

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 Serialization safety system enabled');
      console.log('   Use __checkSerialization(data) in console to test any data');
    }
  }, []);

  return (
    <ErrorBoundary
      {...defaultProps}
      fallback={(error, issues, retry) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
            <div className="flex items-center mb-4">
              <span className="text-2xl mr-3">🚨</span>
              <h2 className="text-xl font-semibold text-gray-900">
                App Error
              </h2>
            </div>
            
            <p className="text-gray-600 mb-4">
              A serialization error occurred. This usually means non-serializable data 
              (like Set, Map, or functions) was passed where only plain objects are allowed.
            </p>
            
            {process.env.NODE_ENV === 'development' && issues.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 rounded">
                <h3 className="font-medium text-red-800 mb-2">Issues found:</h3>
                <ul className="text-sm text-red-700 space-y-1">
                  {issues.slice(0, 3).map((issue, i) => (
                    <li key={i}>• {(issue as unknown as Record<string, unknown>).reason as string || 'serialization issue'}</li>
                  ))}
                </ul>
                {issues.length > 3 && (
                  <p className="text-xs text-red-600 mt-1">
                    ...and {issues.length - 3} more issues
                  </p>
                )}
              </div>
            )}
            
            <div className="flex gap-3">
              <button
                onClick={retry}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-gray-600 text-white py-2 px-4 rounded hover:bg-gray-700 transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

// Hook for quick component-level protection
export function useQuickSerializationCheck(data: unknown, componentName: string) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      import('@/lib/serialization-utils').then(({ detectNonSerializable }) => {
        const issues = detectNonSerializable(data);
        if (issues.length > 0) {
          console.warn(`⚠️ Serialization issues in ${componentName}:`, issues);
        }
      });
    }
  }, [data, componentName]);
}