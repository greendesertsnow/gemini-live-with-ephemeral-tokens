"use client";

import React, { Component, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { detectNonSerializable } from '@/lib/serialization-utils';

interface SerializationIssue {
  type: string;
  path: string;
  suggestion: string;
}

interface SerializationErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  serializationIssues?: SerializationIssue[];
  retryCount: number;
}

interface SerializationErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, issues: SerializationIssue[], retry: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  maxRetries?: number;
  autoFix?: boolean;
}

export class SerializationErrorBoundary extends Component<
  SerializationErrorBoundaryProps,
  SerializationErrorBoundaryState
> {
  private retryTimeout?: NodeJS.Timeout;

  constructor(props: SerializationErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<SerializationErrorBoundaryState> {
    // Check if this is a serialization-related error
    const isSerializationError = 
      error.message.includes('Converting circular structure to JSON') ||
      error.message.includes('Set objects are not supported') ||
      error.message.includes('Map objects are not supported') ||
      error.message.includes('Only plain objects can be passed to Client Components');

    return {
      hasError: true,
      error,
      serializationIssues: isSerializationError ? [] : undefined,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SerializationErrorBoundary caught an error:', error, errorInfo);
    
    // Try to detect serialization issues in the component props or state
    try {
      const issues = detectNonSerializable(this.props);
      this.setState({
        errorInfo,
        serializationIssues: issues,
      });
    } catch (e) {
      console.warn('Could not analyze serialization issues:', e);
    }

    this.props.onError?.(error, errorInfo);

    // Auto-retry logic for serialization errors
    if (this.props.autoFix && this.state.retryCount < (this.props.maxRetries || 3)) {
      this.retryTimeout = setTimeout(() => {
        this.handleRetry();
      }, 1000 + this.state.retryCount * 1000);
    }
  }

  componentWillUnmount() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }

  handleRetry = () => {
    this.setState(prevState => ({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      serializationIssues: undefined,
      retryCount: prevState.retryCount + 1,
    }));
  };

  handleReset = () => {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      serializationIssues: undefined,
      retryCount: 0,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          const error = this.state.error || new Error('Unknown error');
          const issues = this.state.serializationIssues || [];
          return (this.props.fallback as (error: Error, issues: SerializationIssue[], retry: () => void) => React.ReactNode)(
            error,
            issues,
            this.handleRetry
          );
        }
        return this.props.fallback;
      }

      return (
        <Card className="m-4">
          <CardHeader>
            <CardTitle className="text-destructive">
              Component Error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertDescription>
                A component error occurred. This might be related to non-serializable data
                being passed between components.
              </AlertDescription>
            </Alert>

            {this.state.error && (
              <div className="space-y-2">
                <Badge variant="destructive">
                  {this.state.error.name}
                </Badge>
                <pre className="text-sm bg-muted p-3 rounded overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </div>
            )}

            {this.state.serializationIssues && this.state.serializationIssues.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold">Serialization Issues Detected:</h4>
                <div className="space-y-1">
                  {this.state.serializationIssues.map((issue, index) => (
                    <div key={index} className="text-sm bg-muted p-2 rounded">
                      <Badge variant="outline" className="mr-2">
                        {issue.type}
                      </Badge>
                      <span className="font-mono text-xs">{issue.path}</span>
                      <p className="text-muted-foreground mt-1">
                        💡 {issue.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={this.handleRetry} variant="default">
                Try Again
              </Button>
              <Button onClick={this.handleReset} variant="outline">
                Reset Component
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold">
                  Development Error Details
                </summary>
                <pre className="text-xs bg-muted p-3 rounded mt-2 overflow-auto max-h-64">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * HOC wrapper for SerializationErrorBoundary
 */
export function withSerializationErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options?: {
    fallback?: ReactNode | ((error: Error, issues: SerializationIssue[], retry: () => void) => ReactNode);
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    maxRetries?: number;
    autoFix?: boolean;
  }
) {
  const WithSerializationErrorBoundaryComponent = (props: P) => (
    <SerializationErrorBoundary {...options}>
      <WrappedComponent {...props} />
    </SerializationErrorBoundary>
  );

  WithSerializationErrorBoundaryComponent.displayName = 
    `withSerializationErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name})`;

  return WithSerializationErrorBoundaryComponent;
}

/**
 * Hook for handling serialization errors in functional components
 */
export function useSerializationErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const handleSerializationError = React.useCallback((error: Error) => {
    console.error('Serialization error caught:', error);
    
    // Check if this is a known serialization error
    const isSerializationError = 
      error.message.includes('Converting circular structure to JSON') ||
      error.message.includes('Set objects are not supported') ||
      error.message.includes('Map objects are not supported') ||
      error.message.includes('Only plain objects can be passed to Client Components');

    if (isSerializationError) {
      setError(error);
      
      // Auto-clear error after a delay
      setTimeout(() => {
        setError(null);
      }, 5000);
    } else {
      throw error; // Re-throw non-serialization errors
    }
  }, []);

  const clearError = React.useCallback(() => {
    setError(null);
  }, []);

  return {
    error,
    handleSerializationError,
    clearError,
    hasSerializationError: error !== null,
  };
}