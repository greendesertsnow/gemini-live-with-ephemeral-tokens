/**
 * Comprehensive error handling and reporting system for ephemeral tokens
 * Provides structured error categorization, reporting, and recovery strategies
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  TOKEN_CREATION = 'token_creation',
  TOKEN_REFRESH = 'token_refresh',
  TOKEN_VALIDATION = 'token_validation',
  CONNECTION = 'connection',
  AUTHENTICATION = 'authentication',
  RATE_LIMIT = 'rate_limit',
  NETWORK = 'network',
  API = 'api',
  CONFIGURATION = 'configuration',
  SECURITY = 'security',
  UNKNOWN = 'unknown'
}

export interface ErrorContext {
  sessionId?: string;
  userId?: string;
  clientId?: string;
  userAgent?: string;
  ipAddress?: string;
  timestamp: Date;
  requestId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface TokenError {
  id: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError?: Error;
  context: ErrorContext;
  stackTrace?: string;
  suggestions: string[];
  recoverable: boolean;
  retryable: boolean;
  metadata: Record<string, unknown>;
}

export interface ErrorReport {
  errorId: string;
  summary: {
    category: ErrorCategory;
    severity: ErrorSeverity;
    count: number;
    firstOccurrence: Date;
    lastOccurrence: Date;
  };
  patterns: {
    commonCauses: string[];
    affectedSessions: number;
    timeDistribution: Record<string, number>;
  };
  impact: {
    sessionsAffected: number;
    connectionFailures: number;
    tokenFailures: number;
    userImpact: 'low' | 'medium' | 'high';
  };
  recommendations: string[];
}

/**
 * Comprehensive error handling system for token operations
 */
export class TokenErrorHandler {
  private errors: TokenError[] = [];
  private errorReports = new Map<string, ErrorReport>();
  private config = {
    maxErrorHistory: 500,
    enableStackTrace: process.env.NODE_ENV === 'development',
    enableReporting: true,
    reportingInterval: 5 * 60 * 1000, // 5 minutes
    enableAutoRecovery: true,
  };

  constructor() {
    this.startErrorReporting();
  }

  /**
   * Handle and categorize an error
   */
  handleError(
    error: Error | string,
    context: Partial<ErrorContext> = {},
    metadata: Record<string, unknown> = {}
  ): TokenError {
    const errorMessage = typeof error === 'string' ? error : error.message;
    const category = this.categorizeError(errorMessage, metadata);
    const severity = this.determineSeverity(category, errorMessage, context);

    const tokenError: TokenError = {
      id: this.generateErrorId(),
      category,
      severity,
      message: errorMessage,
      originalError: typeof error === 'object' ? error : undefined,
      context: {
        timestamp: new Date(),
        ...context,
      },
      stackTrace: this.config.enableStackTrace && typeof error === 'object' ? error.stack : undefined,
      suggestions: this.generateSuggestions(category, errorMessage, context),
      recoverable: this.isRecoverable(category, errorMessage),
      retryable: this.isRetryable(category, errorMessage),
      metadata,
    };

    this.recordError(tokenError);
    this.updateErrorReports(tokenError);

    // Log error based on severity
    this.logError(tokenError);

    // Attempt auto-recovery if enabled and applicable
    if (this.config.enableAutoRecovery && tokenError.recoverable) {
      this.attemptRecovery(tokenError);
    }

    return tokenError;
  }

  /**
   * Get error by ID
   */
  getError(errorId: string): TokenError | undefined {
    return this.errors.find(error => error.id === errorId);
  }

  /**
   * Get errors by category
   */
  getErrorsByCategory(category: ErrorCategory, limit: number = 50): TokenError[] {
    return this.errors
      .filter(error => error.category === category)
      .slice(-limit);
  }

  /**
   * Get errors by session
   */
  getErrorsBySession(sessionId: string, limit: number = 50): TokenError[] {
    return this.errors
      .filter(error => error.context.sessionId === sessionId)
      .slice(-limit);
  }

  /**
   * Get critical errors requiring immediate attention
   */
  getCriticalErrors(limit: number = 20): TokenError[] {
    return this.errors
      .filter(error => error.severity === ErrorSeverity.CRITICAL)
      .slice(-limit);
  }

  /**
   * Generate error report for a category
   */
  generateErrorReport(category: ErrorCategory): ErrorReport | undefined {
    return this.errorReports.get(category);
  }

  /**
   * Generate comprehensive error summary
   */
  generateErrorSummary(): {
    totalErrors: number;
    errorsByCategory: Record<ErrorCategory, number>;
    errorsBySeverity: Record<ErrorSeverity, number>;
    criticalErrorsLast24h: number;
    mostCommonErrors: Array<{ message: string; count: number; category: ErrorCategory }>;
    recoverableErrorsPercent: number;
  } {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const errorsByCategory = {} as Record<ErrorCategory, number>;
    const errorsBySeverity = {} as Record<ErrorSeverity, number>;
    const errorCounts = new Map<string, { count: number; category: ErrorCategory }>();

    let recoverableErrors = 0;
    let criticalErrorsLast24h = 0;

    this.errors.forEach(error => {
      // Count by category
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;

      // Count by severity
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;

      // Count critical errors in last 24h
      if (error.severity === ErrorSeverity.CRITICAL && error.context.timestamp >= yesterday) {
        criticalErrorsLast24h++;
      }

      // Count recoverable errors
      if (error.recoverable) {
        recoverableErrors++;
      }

      // Count error messages
      const existing = errorCounts.get(error.message);
      if (existing) {
        existing.count++;
      } else {
        errorCounts.set(error.message, { count: 1, category: error.category });
      }
    });

    const mostCommonErrors = Array.from(errorCounts.entries())
      .map(([message, data]) => ({ message, count: data.count, category: data.category }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalErrors: this.errors.length,
      errorsByCategory,
      errorsBySeverity,
      criticalErrorsLast24h,
      mostCommonErrors,
      recoverableErrorsPercent: this.errors.length > 0 ? (recoverableErrors / this.errors.length) * 100 : 0,
    };
  }

  /**
   * Clear error history
   */
  clearErrors(): void {
    this.errors = [];
    this.errorReports.clear();
  }

  /**
   * Export errors for external analysis
   */
  exportErrors(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = ['id', 'category', 'severity', 'message', 'timestamp', 'sessionId', 'recoverable'];
      const rows = this.errors.map(error => [
        error.id,
        error.category,
        error.severity,
        error.message.replace(/"/g, '""'), // Escape quotes
        error.context.timestamp.toISOString(),
        error.context.sessionId || '',
        error.recoverable.toString(),
      ]);

      return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    }

    return JSON.stringify(this.errors, null, 2);
  }

  private categorizeError(message: string, metadata: Record<string, unknown>): ErrorCategory {
    const lowerMessage = message.toLowerCase();

    // Token-related errors
    if (lowerMessage.includes('token') && (lowerMessage.includes('create') || lowerMessage.includes('generate'))) {
      return ErrorCategory.TOKEN_CREATION;
    }
    if (lowerMessage.includes('token') && lowerMessage.includes('refresh')) {
      return ErrorCategory.TOKEN_REFRESH;
    }
    if (lowerMessage.includes('token') && (lowerMessage.includes('invalid') || lowerMessage.includes('expired'))) {
      return ErrorCategory.TOKEN_VALIDATION;
    }

    // Authentication errors
    if (lowerMessage.includes('auth') || lowerMessage.includes('unauthorized') || lowerMessage.includes('forbidden')) {
      return ErrorCategory.AUTHENTICATION;
    }

    // Rate limiting
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests')) {
      return ErrorCategory.RATE_LIMIT;
    }

    // Network errors
    if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('connection refused')) {
      return ErrorCategory.NETWORK;
    }

    // Connection errors
    if (lowerMessage.includes('connect') || lowerMessage.includes('websocket') || lowerMessage.includes('disconnect')) {
      return ErrorCategory.CONNECTION;
    }

    // API errors
    if (lowerMessage.includes('api') || lowerMessage.includes('server') || metadata.statusCode) {
      return ErrorCategory.API;
    }

    // Configuration errors
    if (lowerMessage.includes('config') || lowerMessage.includes('environment') || lowerMessage.includes('missing')) {
      return ErrorCategory.CONFIGURATION;
    }

    // Security errors
    if (lowerMessage.includes('security') || lowerMessage.includes('cors') || lowerMessage.includes('origin')) {
      return ErrorCategory.SECURITY;
    }

    return ErrorCategory.UNKNOWN;
  }

  private determineSeverity(category: ErrorCategory, message: string, context: Partial<ErrorContext>): ErrorSeverity {
    const lowerMessage = message.toLowerCase();

    // Critical errors that block all functionality
    if (category === ErrorCategory.CONFIGURATION || lowerMessage.includes('critical')) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity errors that significantly impact functionality
    if (category === ErrorCategory.AUTHENTICATION ||
      category === ErrorCategory.TOKEN_CREATION ||
      (context.retryAttempt && context.maxRetries && context.retryAttempt >= context.maxRetries)) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity errors that may be recoverable
    if (category === ErrorCategory.CONNECTION ||
      category === ErrorCategory.TOKEN_REFRESH ||
      category === ErrorCategory.API) {
      return ErrorSeverity.MEDIUM;
    }

    // Low severity errors
    return ErrorSeverity.LOW;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private generateSuggestions(category: ErrorCategory, _message: string, _context: Partial<ErrorContext>): string[] {
    const suggestions: string[] = [];

    switch (category) {
      case ErrorCategory.TOKEN_CREATION:
        suggestions.push('Check that GEMINI_API_KEY is set correctly in environment variables');
        suggestions.push('Verify API key has necessary permissions for ephemeral token creation');
        suggestions.push('Ensure rate limits are not exceeded');
        break;

      case ErrorCategory.TOKEN_REFRESH:
        suggestions.push('Check if the session is still valid');
        suggestions.push('Try creating a new token instead of refreshing');
        suggestions.push('Verify network connectivity');
        break;

      case ErrorCategory.TOKEN_VALIDATION:
        suggestions.push('Check token expiration time');
        suggestions.push('Verify token format and integrity');
        suggestions.push('Try creating a fresh token');
        break;

      case ErrorCategory.CONNECTION:
        suggestions.push('Check network connectivity');
        suggestions.push('Verify WebSocket endpoint is accessible');
        suggestions.push('Try reconnecting after a brief delay');
        break;

      case ErrorCategory.AUTHENTICATION:
        suggestions.push('Verify API credentials are valid');
        suggestions.push('Check token permissions and scope');
        suggestions.push('Ensure proper authentication headers');
        break;

      case ErrorCategory.RATE_LIMIT:
        suggestions.push('Implement exponential backoff for retries');
        suggestions.push('Reduce request frequency');
        suggestions.push('Consider implementing request queuing');
        break;

      case ErrorCategory.NETWORK:
        suggestions.push('Check internet connectivity');
        suggestions.push('Verify firewall and proxy settings');
        suggestions.push('Try again after network conditions improve');
        break;

      case ErrorCategory.CONFIGURATION:
        suggestions.push('Check all required environment variables are set');
        suggestions.push('Verify configuration values are correct');
        suggestions.push('Review application setup documentation');
        break;

      case ErrorCategory.SECURITY:
        suggestions.push('Check CORS configuration');
        suggestions.push('Verify allowed origins are properly configured');
        suggestions.push('Ensure HTTPS is used in production');
        break;

      default:
        suggestions.push('Check application logs for more details');
        suggestions.push('Try refreshing the page');
        suggestions.push('Contact support if the issue persists');
    }

    return suggestions;
  }

  private isRecoverable(category: ErrorCategory, message: string): boolean {
    // Non-recoverable errors
    if (category === ErrorCategory.CONFIGURATION ||
      message.includes('invalid api key') ||
      message.includes('permissions')) {
      return false;
    }

    // Most other errors are potentially recoverable
    return true;
  }

  private isRetryable(category: ErrorCategory, message: string): boolean {
    // Non-retryable errors
    if (category === ErrorCategory.AUTHENTICATION ||
      category === ErrorCategory.CONFIGURATION ||
      message.includes('invalid') ||
      message.includes('forbidden')) {
      return false;
    }

    // Retryable errors
    return [
      ErrorCategory.NETWORK,
      ErrorCategory.CONNECTION,
      ErrorCategory.TOKEN_CREATION,
      ErrorCategory.TOKEN_REFRESH,
      ErrorCategory.API,
    ].includes(category);
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private recordError(error: TokenError): void {
    this.errors.push(error);

    // Trim errors if over limit
    if (this.errors.length > this.config.maxErrorHistory) {
      this.errors.splice(0, this.errors.length - this.config.maxErrorHistory);
    }
  }

  private updateErrorReports(error: TokenError): void {
    if (!this.config.enableReporting) return;

    const categoryKey = error.category;
    const existing = this.errorReports.get(categoryKey);

    if (existing) {
      existing.summary.count++;
      existing.summary.lastOccurrence = error.context.timestamp;
      if (error.context.sessionId) {
        existing.impact.sessionsAffected++;
      }
    } else {
      const newReport: ErrorReport = {
        errorId: error.id,
        summary: {
          category: error.category,
          severity: error.severity,
          count: 1,
          firstOccurrence: error.context.timestamp,
          lastOccurrence: error.context.timestamp,
        },
        patterns: {
          commonCauses: [error.message],
          affectedSessions: error.context.sessionId ? 1 : 0,
          timeDistribution: {},
        },
        impact: {
          sessionsAffected: error.context.sessionId ? 1 : 0,
          connectionFailures: error.category === ErrorCategory.CONNECTION ? 1 : 0,
          tokenFailures: [ErrorCategory.TOKEN_CREATION, ErrorCategory.TOKEN_REFRESH].includes(error.category) ? 1 : 0,
          userImpact: error.severity === ErrorSeverity.CRITICAL ? 'high' :
            error.severity === ErrorSeverity.HIGH ? 'medium' : 'low',
        },
        recommendations: error.suggestions,
      };

      this.errorReports.set(categoryKey, newReport);
    }
  }

  private logError(error: TokenError): void {
    const logData = {
      id: error.id,
      category: error.category,
      severity: error.severity,
      message: error.message,
      session: error.context.sessionId,
      recoverable: error.recoverable,
      suggestions: error.suggestions,
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        console.error('🚨 CRITICAL TOKEN ERROR:', logData);
        break;
      case ErrorSeverity.HIGH:
        console.error('❌ HIGH SEVERITY TOKEN ERROR:', logData);
        break;
      case ErrorSeverity.MEDIUM:
        console.warn('⚠️ TOKEN ERROR:', logData);
        break;
      case ErrorSeverity.LOW:
        console.log('ℹ️ TOKEN WARNING:', logData);
        break;
    }
  }

  private attemptRecovery(error: TokenError): void {
    // Basic recovery strategies based on error type
    console.log(`🔧 Attempting auto-recovery for error ${error.id}`);

    // Recovery logic would be implemented here
    // This is a placeholder for actual recovery mechanisms
  }

  private startErrorReporting(): void {
    if (!this.config.enableReporting) return;

    setInterval(() => {
      const summary = this.generateErrorSummary();
      if (summary.criticalErrorsLast24h > 0) {
        console.warn('📊 Token Error Report - Critical errors in last 24h:', summary.criticalErrorsLast24h);
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('📊 Token Error Summary:', {
          totalErrors: summary.totalErrors,
          criticalLast24h: summary.criticalErrorsLast24h,
          recoverablePercent: `${Math.round(summary.recoverableErrorsPercent)}%`,
        });
      }
    }, this.config.reportingInterval);
  }
}

// Global error handler instance
let globalTokenErrorHandler: TokenErrorHandler | null = null;

export function getTokenErrorHandler(): TokenErrorHandler {
  if (!globalTokenErrorHandler) {
    globalTokenErrorHandler = new TokenErrorHandler();
  }
  return globalTokenErrorHandler;
}

// Convenience function for handling errors
export function handleTokenError(
  error: Error | string,
  context?: Partial<ErrorContext>,
  metadata?: Record<string, unknown>
): TokenError {
  return getTokenErrorHandler().handleError(error, context, metadata);
}