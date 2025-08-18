"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { getTokenMonitor } from '@/lib/monitoring/token-monitor';
import { getTokenErrorHandler } from '@/lib/monitoring/error-handler';
import { useEphemeralAuth } from '@/hooks/use-ephemeral-auth';
import { useSafeTokenContext } from '@/hooks/use-safe-context';

interface DashboardStats {
  uptime: string;
  totalEvents: number;
  errorRate: number;
  successRate: number;
  activeSessions: number;
  totalSessions: number;
  recentErrors: number;
  criticalErrors: number;
}

function TokenDashboardContent() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  const monitor = getTokenMonitor();
  const errorHandler = getTokenErrorHandler();
  
  // Use safe context hooks that won't throw if providers aren't available
  // const tokenContext = useSafeTokenContext();

  // Toggle visibility with keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        setIsVisible(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Refresh stats
  const refreshStats = useCallback(() => {
    const metrics = monitor.getMetrics();
    const performance = monitor.generatePerformanceReport();
    const errorSummary = errorHandler.generateErrorSummary();
    
    setStats({
      uptime: formatUptime(performance.uptime),
      totalEvents: performance.totalEvents,
      errorRate: Math.round(performance.errorRate * 100),
      successRate: Math.round(performance.successRate * 100),
      activeSessions: metrics.activeSessions,
      totalSessions: metrics.totalSessions,
      recentErrors: errorSummary.totalErrors,
      criticalErrors: errorSummary.criticalErrorsLast24h,
    });
  }, [monitor, errorHandler]);

  // Auto-refresh
  useEffect(() => {
    if (!isVisible) return;
    
    refreshStats();
    
    if (autoRefresh) {
      const interval = setInterval(refreshStats, 2000);
      return () => clearInterval(interval);
    }
  }, [isVisible, autoRefresh, refreshStats]);

  if (!isVisible || process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm">
      <div className="absolute inset-4 bg-background rounded-lg shadow-2xl overflow-auto">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Token System Dashboard</h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={autoRefresh ? "default" : "outline"}
                onClick={() => setAutoRefresh(!autoRefresh)}
              >
                {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
              </Button>
              <Button size="sm" onClick={refreshStats}>
                Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsVisible(false)}>
                Close (Ctrl+Shift+D)
              </Button>
            </div>
          </div>

          {stats && (
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="metrics">Metrics</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
                <TabsTrigger value="sessions">Sessions</TabsTrigger>
                <TabsTrigger value="debug">Debug</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Uptime</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.uptime}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Success Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-600">{stats.successRate}%</div>
                      <Progress value={stats.successRate} className="mt-2" />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Active Sessions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stats.activeSessions}</div>
                      <div className="text-sm text-muted-foreground">/ {stats.totalSessions} total</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Errors</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-red-600">{stats.recentErrors}</div>
                      {stats.criticalErrors > 0 && (
                        <Badge variant="destructive" className="mt-1">
                          {stats.criticalErrors} Critical
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TokenStateCard />
                  <ConnectionStateCard />
                </div>
              </TabsContent>

              <TabsContent value="metrics" className="space-y-4">
                <MetricsView />
              </TabsContent>

              <TabsContent value="errors" className="space-y-4">
                <ErrorsView />
              </TabsContent>

              <TabsContent value="sessions" className="space-y-4">
                <SessionsView />
              </TabsContent>

              <TabsContent value="debug" className="space-y-4">
                <DebugView />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

function TokenStateCard() {
  const context = useSafeTokenContext();
  if (!context) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token State</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Context not available</div>
        </CardContent>
      </Card>
    );
  }
  
  const { state } = context;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Token State</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span>Session ID:</span>
          <code className="text-xs bg-muted px-1 rounded">{state.sessionId}</code>
        </div>
        
        <div className="flex items-center justify-between">
          <span>Is Valid:</span>
          <Badge variant={state.isValid ? "default" : "secondary"}>
            {state.isValid ? "Valid" : "Invalid"}
          </Badge>
        </div>

        {state.tokenExpiresAt && (
          <div className="flex items-center justify-between">
            <span>Expires:</span>
            <span className="text-sm">{formatRelativeTime(state.tokenExpiresAt)}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span>Uses Remaining:</span>
          <span>{state.usesRemaining}</span>
        </div>

        <div className="flex items-center justify-between">
          <span>Refresh Count:</span>
          <span>{state.refreshCount}</span>
        </div>

        {state.isRefreshing && (
          <Alert>
            <AlertDescription>Token refresh in progress...</AlertDescription>
          </Alert>
        )}

        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionStateCard() {
  let ephemeralAuthState = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const ephemeralAuth = useEphemeralAuth();
    ephemeralAuthState = ephemeralAuth.state;
  } catch (error) {
    console.warn('[ConnectionStateCard] EphemeralAuth context not available:', error);
  }
  
  if (!ephemeralAuthState) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connection State</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Context not available</div>
        </CardContent>
      </Card>
    );
  }
  
  const state = ephemeralAuthState;
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection State</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span>Status:</span>
          <Badge variant={
            state.connectionStatus === 'connected' ? "default" :
            state.connectionStatus === 'connecting' ? "secondary" :
            state.connectionStatus === 'error' ? "destructive" : "outline"
          }>
            {state.connectionStatus}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <span>Authenticated:</span>
          <Badge variant={state.isAuthenticated ? "default" : "outline"}>
            {state.isAuthenticated ? "Yes" : "No"}
          </Badge>
        </div>

        {state.isLoading && (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            <span className="text-sm">Loading...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface TokenMetrics {
  tokensCreated: number;
  tokensRefreshed: number;
  tokensExpired: number;
  averageTokenCreationTime: number;
  maxTokenCreationTime: number;
  connectionsAttempted: number;
  connectionsSuccessful: number;
  connectionsFailed: number;
  reconnectionAttempts: number;
  averageConnectionTime: number;
}

function MetricsView() {
  const [metrics, setMetrics] = useState<TokenMetrics | null>(null);

  useEffect(() => {
    const monitor = getTokenMonitor();
    const data = monitor.getMetrics();
    setMetrics(data);
  }, []);

  if (!metrics) return <div>Loading metrics...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Token Operations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Created:</span>
              <span>{metrics.tokensCreated}</span>
            </div>
            <div className="flex justify-between">
              <span>Refreshed:</span>
              <span>{metrics.tokensRefreshed}</span>
            </div>
            <div className="flex justify-between">
              <span>Expired:</span>
              <span>{metrics.tokensExpired}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span>Avg Creation Time:</span>
              <span>{Math.round(metrics.averageTokenCreationTime)}ms</span>
            </div>
            <div className="flex justify-between">
              <span>Max Creation Time:</span>
              <span>{Math.round(metrics.maxTokenCreationTime)}ms</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Attempted:</span>
              <span>{metrics.connectionsAttempted}</span>
            </div>
            <div className="flex justify-between">
              <span>Successful:</span>
              <span className="text-green-600">{metrics.connectionsSuccessful}</span>
            </div>
            <div className="flex justify-between">
              <span>Failed:</span>
              <span className="text-red-600">{metrics.connectionsFailed}</span>
            </div>
            <div className="flex justify-between">
              <span>Reconnects:</span>
              <span>{metrics.reconnectionAttempts}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span>Avg Connect Time:</span>
              <span>{Math.round(metrics.averageConnectionTime)}ms</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface ErrorSummary {
  errorsBySeverity: Record<string, number>;
  totalErrors: number;
  criticalErrorsLast24h: number;
}

interface ErrorEntry {
  id: string;
  category: string;
  message: string;
  context: {
    timestamp: Date;
  };
  suggestions: string[];
}

function ErrorsView() {
  const [errorSummary, setErrorSummary] = useState<ErrorSummary | null>(null);
  const [recentErrors, setRecentErrors] = useState<ErrorEntry[]>([]);

  useEffect(() => {
    const errorHandler = getTokenErrorHandler();
    const summary = errorHandler.generateErrorSummary();
    const recent = errorHandler.getCriticalErrors(10);
    
    setErrorSummary(summary);
    setRecentErrors(recent);
  }, []);

  if (!errorSummary) return <div>Loading errors...</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(errorSummary.errorsBySeverity).map(([severity, count]) => (
          <Card key={severity}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm capitalize">{severity}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                severity === 'critical' ? 'text-red-600' :
                severity === 'high' ? 'text-orange-600' :
                severity === 'medium' ? 'text-yellow-600' : 'text-blue-600'
              }`}>
                {count as number}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Critical Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentErrors.map((error) => (
                <div key={error.id} className="border rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="destructive">{error.category}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {error.context.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-sm">{error.message}</div>
                  {error.suggestions.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      💡 {error.suggestions[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface SessionEntry {
  sessionId: string;
  startTime: Date;
  tokensUsed: number;
  connectionAttempts: number;
  errors: Array<unknown>;
}

function SessionsView() {
  const monitor = getTokenMonitor();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  useEffect(() => {
    const activeSessions = monitor.getActiveSessions();
    setSessions(activeSessions);
  }, [monitor]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions ({sessions.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <div className="text-muted-foreground text-center py-4">
            No active sessions
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.sessionId} className="border rounded p-2">
                <div className="flex items-center justify-between">
                  <code className="text-xs">{session.sessionId}</code>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(session.startTime)}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                  <span>Tokens: {session.tokensUsed}</span>
                  <span>Connections: {session.connectionAttempts}</span>
                  <span>Errors: {session.errors.length}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DebugView() {
  const [debugInfo, setDebugInfo] = useState<string>('');

  const exportData = () => {
    const monitor = getTokenMonitor();
    const errorHandler = getTokenErrorHandler();
    
    const data = {
      timestamp: new Date().toISOString(),
      metrics: monitor.exportMetrics(),
      errors: errorHandler.exportErrors('json'),
      environment: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        nodeEnv: process.env.NODE_ENV,
      },
    };
    
    setDebugInfo(JSON.stringify(data, null, 2));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={exportData}>Export Debug Data</Button>
        <Button 
          onClick={() => navigator.clipboard.writeText(debugInfo)}
          disabled={!debugInfo}
        >
          Copy to Clipboard
        </Button>
        <Button 
          variant="destructive"
          onClick={() => {
            getTokenMonitor().clearMetrics();
            getTokenErrorHandler().clearErrors();
          }}
        >
          Clear All Data
        </Button>
      </div>

      {debugInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Debug Export</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded max-h-96 overflow-auto">
              {debugInfo}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Utility functions
function formatUptime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return `${seconds}s ago`;
  }
}

/**
 * Safe wrapper for TokenDashboard that only renders when contexts are available
 */
export function TokenDashboard() {
  const [contextReady, setContextReady] = useState(false);

  // Check if we're in development and contexts should be available
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Small delay to ensure providers are mounted
      const timer = setTimeout(() => {
        setContextReady(true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // Only render in development when contexts are ready
  if (process.env.NODE_ENV !== 'development' || !contextReady) {
    return null;
  }

  // Try to render with error boundary
  try {
    return <TokenDashboardContent />;
  } catch (error) {
    console.warn('[TokenDashboard] Context not available:', error);
    return null;
  }
}