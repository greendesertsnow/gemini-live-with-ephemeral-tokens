/**
 * Comprehensive monitoring and observability system for ephemeral tokens
 * Provides metrics, logging, and error tracking for production systems
 */

export interface TokenMetrics {
  // Token lifecycle metrics
  tokensCreated: number;
  tokensRefreshed: number;
  tokensExpired: number;
  tokensRevoked: number;
  
  // Connection metrics
  connectionsAttempted: number;
  connectionsSuccessful: number;
  connectionsFailed: number;
  reconnectionAttempts: number;
  
  // Error metrics
  authErrors: number;
  networkErrors: number;
  apiErrors: number;
  timeoutErrors: number;
  
  // Performance metrics
  averageTokenCreationTime: number;
  averageConnectionTime: number;
  maxTokenCreationTime: number;
  maxConnectionTime: number;
  
  // Rate limiting metrics
  rateLimitHits: number;
  rateLimitBlocks: number;
  
  // Session metrics
  activeSessions: number;
  totalSessions: number;
  averageSessionDuration: number;
}

export interface TokenEvent {
  timestamp: Date;
  eventType: 'token_created' | 'token_refreshed' | 'token_expired' | 'connection_success' | 
            'connection_failed' | 'auth_error' | 'network_error' | 'rate_limit_hit';
  sessionId: string;
  details: Record<string, unknown>;
  duration?: number; // milliseconds
  error?: string;
}

export interface SessionMetadata {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  tokensUsed: number;
  connectionAttempts: number;
  errors: string[];
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Token monitoring and metrics collection system
 */
export class TokenMonitor {
  private metrics: TokenMetrics;
  private events: TokenEvent[] = [];
  private sessions = new Map<string, SessionMetadata>();
  private startTime = new Date();
  
  // Performance tracking
  private operationStartTimes = new Map<string, number>();
  
  // Configuration
  private config = {
    maxEventHistory: 1000,
    maxSessionHistory: 100,
    enableDetailedLogging: process.env.NODE_ENV === 'development',
    enableMetricsCollection: true,
    metricsFlushInterval: 60000, // 1 minute
  };

  constructor() {
    this.metrics = this.createEmptyMetrics();
    this.startMetricsFlushTimer();
  }

  /**
   * Start tracking an operation
   */
  startOperation(operationId: string): void {
    this.operationStartTimes.set(operationId, Date.now());
  }

  /**
   * End tracking an operation and return duration
   */
  endOperation(operationId: string): number {
    const startTime = this.operationStartTimes.get(operationId);
    this.operationStartTimes.delete(operationId);
    
    if (startTime) {
      return Date.now() - startTime;
    }
    return 0;
  }

  /**
   * Record token creation event
   */
  recordTokenCreation(sessionId: string, duration?: number): void {
    this.metrics.tokensCreated++;
    
    if (duration) {
      this.updateAverageMetric('averageTokenCreationTime', duration);
      this.metrics.maxTokenCreationTime = Math.max(this.metrics.maxTokenCreationTime, duration);
    }
    
    this.addEvent({
      eventType: 'token_created',
      sessionId,
      details: { duration },
      duration,
    });
    
    this.updateSession(sessionId, session => {
      session.tokensUsed++;
    });
    
    if (this.config.enableDetailedLogging) {
      console.log(`[TokenMonitor] Token created for session ${sessionId} in ${duration}ms`);
    }
  }

  /**
   * Record token refresh event
   */
  recordTokenRefresh(sessionId: string, duration?: number): void {
    this.metrics.tokensRefreshed++;
    
    if (duration) {
      this.updateAverageMetric('averageTokenCreationTime', duration);
    }
    
    this.addEvent({
      eventType: 'token_refreshed',
      sessionId,
      details: { duration },
      duration,
    });
    
    this.updateSession(sessionId, session => {
      session.tokensUsed++;
    });
    
    if (this.config.enableDetailedLogging) {
      console.log(`[TokenMonitor] Token refreshed for session ${sessionId} in ${duration}ms`);
    }
  }

  /**
   * Record token expiration
   */
  recordTokenExpiration(sessionId: string): void {
    this.metrics.tokensExpired++;
    
    this.addEvent({
      eventType: 'token_expired',
      sessionId,
      details: {},
    });
    
    if (this.config.enableDetailedLogging) {
      console.warn(`[TokenMonitor] Token expired for session ${sessionId}`);
    }
  }

  /**
   * Record successful connection
   */
  recordConnectionSuccess(sessionId: string, duration?: number): void {
    this.metrics.connectionsAttempted++;
    this.metrics.connectionsSuccessful++;
    
    if (duration) {
      this.updateAverageMetric('averageConnectionTime', duration);
      this.metrics.maxConnectionTime = Math.max(this.metrics.maxConnectionTime, duration);
    }
    
    this.addEvent({
      eventType: 'connection_success',
      sessionId,
      details: { duration },
      duration,
    });
    
    this.updateSession(sessionId, session => {
      session.connectionAttempts++;
    });
    
    if (this.config.enableDetailedLogging) {
      console.log(`[TokenMonitor] Connection successful for session ${sessionId} in ${duration}ms`);
    }
  }

  /**
   * Record failed connection
   */
  recordConnectionFailure(sessionId: string, error: string, duration?: number): void {
    this.metrics.connectionsAttempted++;
    this.metrics.connectionsFailed++;
    
    // Categorize error
    if (error.includes('auth') || error.includes('token')) {
      this.metrics.authErrors++;
    } else if (error.includes('network') || error.includes('fetch')) {
      this.metrics.networkErrors++;
    } else if (error.includes('timeout')) {
      this.metrics.timeoutErrors++;
    } else {
      this.metrics.apiErrors++;
    }
    
    this.addEvent({
      eventType: 'connection_failed',
      sessionId,
      details: { duration },
      duration,
      error,
    });
    
    this.updateSession(sessionId, session => {
      session.connectionAttempts++;
      session.errors.push(error);
    });
    
    if (this.config.enableDetailedLogging) {
      console.error(`[TokenMonitor] Connection failed for session ${sessionId}:`, error);
    }
  }

  /**
   * Record reconnection attempt
   */
  recordReconnectionAttempt(sessionId: string, attempt: number, maxAttempts: number): void {
    this.metrics.reconnectionAttempts++;
    
    this.addEvent({
      eventType: 'connection_failed', // Using connection_failed for reconnection attempts
      sessionId,
      details: { attempt, maxAttempts, type: 'reconnection' },
    });
    
    if (this.config.enableDetailedLogging) {
      console.log(`[TokenMonitor] Reconnection attempt ${attempt}/${maxAttempts} for session ${sessionId}`);
    }
  }

  /**
   * Record rate limit hit
   */
  recordRateLimitHit(sessionId: string, blocked: boolean = false): void {
    this.metrics.rateLimitHits++;
    if (blocked) {
      this.metrics.rateLimitBlocks++;
    }
    
    this.addEvent({
      eventType: 'rate_limit_hit',
      sessionId,
      details: { blocked },
    });
    
    if (this.config.enableDetailedLogging) {
      console.warn(`[TokenMonitor] Rate limit ${blocked ? 'blocked' : 'hit'} for session ${sessionId}`);
    }
  }

  /**
   * Start tracking a session
   */
  startSession(sessionId: string, metadata?: Partial<SessionMetadata>): void {
    const session: SessionMetadata = {
      sessionId,
      startTime: new Date(),
      tokensUsed: 0,
      connectionAttempts: 0,
      errors: [],
      ...metadata,
    };
    
    this.sessions.set(sessionId, session);
    this.metrics.totalSessions++;
    this.updateActiveSessionsCount();
    
    if (this.config.enableDetailedLogging) {
      console.log(`[TokenMonitor] Started tracking session ${sessionId}`);
    }
  }

  /**
   * End tracking a session
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.endTime = new Date();
      const duration = session.endTime.getTime() - session.startTime.getTime();
      
      // Update average session duration
      this.updateAverageSessionDuration(duration);
      
      // Keep session for history but mark as ended
      this.updateActiveSessionsCount();
      
      if (this.config.enableDetailedLogging) {
        console.log(`[TokenMonitor] Ended session ${sessionId} (duration: ${duration}ms)`);
      }
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): TokenMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50): TokenEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get session information
   */
  getSession(sessionId: string): SessionMetadata | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values()).filter(session => !session.endTime);
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(): {
    uptime: number;
    totalEvents: number;
    errorRate: number;
    successRate: number;
    averageResponseTime: number;
    topErrors: Array<{ error: string; count: number }>;
  } {
    const now = Date.now();
    const uptime = now - this.startTime.getTime();
    
    // Calculate error rate
    const totalConnections = this.metrics.connectionsAttempted;
    const errorRate = totalConnections > 0 ? this.metrics.connectionsFailed / totalConnections : 0;
    const successRate = 1 - errorRate;
    
    // Calculate average response time
    const averageResponseTime = (this.metrics.averageTokenCreationTime + this.metrics.averageConnectionTime) / 2;
    
    // Get top errors
    const errorCounts = new Map<string, number>();
    this.events.forEach(event => {
      if (event.error) {
        const count = errorCounts.get(event.error) || 0;
        errorCounts.set(event.error, count + 1);
      }
    });
    
    const topErrors = Array.from(errorCounts.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      uptime,
      totalEvents: this.events.length,
      errorRate,
      successRate,
      averageResponseTime,
      topErrors,
    };
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportMetrics(): {
    metrics: TokenMetrics;
    performance: ReturnType<TokenMonitor['generatePerformanceReport']>;
    sessions: { active: number; total: number };
    timestamp: string;
  } {
    return {
      metrics: this.getMetrics(),
      performance: this.generatePerformanceReport(),
      sessions: {
        active: this.metrics.activeSessions,
        total: this.metrics.totalSessions,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Clear all metrics (for testing or reset)
   */
  clearMetrics(): void {
    this.metrics = this.createEmptyMetrics();
    this.events = [];
    this.sessions.clear();
    this.operationStartTimes.clear();
    
    if (this.config.enableDetailedLogging) {
      console.log('[TokenMonitor] Metrics cleared');
    }
  }

  private createEmptyMetrics(): TokenMetrics {
    return {
      tokensCreated: 0,
      tokensRefreshed: 0,
      tokensExpired: 0,
      tokensRevoked: 0,
      connectionsAttempted: 0,
      connectionsSuccessful: 0,
      connectionsFailed: 0,
      reconnectionAttempts: 0,
      authErrors: 0,
      networkErrors: 0,
      apiErrors: 0,
      timeoutErrors: 0,
      averageTokenCreationTime: 0,
      averageConnectionTime: 0,
      maxTokenCreationTime: 0,
      maxConnectionTime: 0,
      rateLimitHits: 0,
      rateLimitBlocks: 0,
      activeSessions: 0,
      totalSessions: 0,
      averageSessionDuration: 0,
    };
  }

  private addEvent(event: Omit<TokenEvent, 'timestamp'>): void {
    const fullEvent: TokenEvent = {
      timestamp: new Date(),
      ...event,
    };
    
    this.events.push(fullEvent);
    
    // Trim events if over limit
    if (this.events.length > this.config.maxEventHistory) {
      this.events.splice(0, this.events.length - this.config.maxEventHistory);
    }
  }

  private updateSession(sessionId: string, updateFn: (session: SessionMetadata) => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      updateFn(session);
    }
  }

  private updateAverageMetric(metricKey: keyof TokenMetrics, newValue: number): void {
    const current = this.metrics[metricKey] as number;
    const count = this.getMetricSampleCount(metricKey);
    this.metrics[metricKey] = (current * count + newValue) / (count + 1) as never;
  }

  private getMetricSampleCount(metricKey: keyof TokenMetrics): number {
    switch (metricKey) {
      case 'averageTokenCreationTime':
        return this.metrics.tokensCreated + this.metrics.tokensRefreshed;
      case 'averageConnectionTime':
        return this.metrics.connectionsAttempted;
      default:
        return 1;
    }
  }

  private updateActiveSessionsCount(): void {
    this.metrics.activeSessions = this.getActiveSessions().length;
  }

  private updateAverageSessionDuration(duration: number): void {
    const endedSessions = Array.from(this.sessions.values()).filter(s => s.endTime).length;
    const current = this.metrics.averageSessionDuration;
    this.metrics.averageSessionDuration = (current * (endedSessions - 1) + duration) / endedSessions;
  }

  private startMetricsFlushTimer(): void {
    if (!this.config.enableMetricsCollection) return;
    
    setInterval(() => {
      if (this.config.enableDetailedLogging) {
        const report = this.generatePerformanceReport();
        console.log('[TokenMonitor] Performance Report:', {
          uptime: `${Math.round(report.uptime / 1000)}s`,
          totalEvents: report.totalEvents,
          errorRate: `${Math.round(report.errorRate * 100)}%`,
          successRate: `${Math.round(report.successRate * 100)}%`,
          avgResponseTime: `${Math.round(report.averageResponseTime)}ms`,
        });
      }
    }, this.config.metricsFlushInterval);
  }
}

// Global monitor instance
let globalTokenMonitor: TokenMonitor | null = null;

export function getTokenMonitor(): TokenMonitor {
  if (!globalTokenMonitor) {
    globalTokenMonitor = new TokenMonitor();
  }
  return globalTokenMonitor;
}

// Development utilities
export function createTokenMonitorDevTools() {
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const monitor = getTokenMonitor();
    
    (window as unknown as Record<string, unknown>).__tokenMonitor = {
      getMetrics: () => monitor.getMetrics(),
      getEvents: (limit?: number) => monitor.getRecentEvents(limit),
      getSessions: () => monitor.getActiveSessions(),
      getReport: () => monitor.generatePerformanceReport(),
      export: () => monitor.exportMetrics(),
      clear: () => monitor.clearMetrics(),
    };
    
    console.log('🔍 Token Monitor dev tools available at window.__tokenMonitor');
  }
}