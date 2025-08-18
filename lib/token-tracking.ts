import * as React from 'react';

/**
 * Token usage tracking utilities for Gemini Live API
 */

export interface TokenUsageEvent {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  duration?: number;
  status: 'success' | 'error';
  sessionId?: string;
}

export interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  averageTokensPerRequest: number;
  costPerToken: number;
  sessionStart: Date;
  lastActivity: Date;
}

// Token pricing per 1M tokens (Live API audio pricing as of January 2025)
export const TOKEN_PRICING = {
  'models/gemini-2.0-flash-exp': { input: 2.10, output: 8.50 }, // Live API audio pricing
  'models/gemini-live-2.5-flash-preview': { input: 3.00, output: 12.00 }, // Live API audio pricing
  'models/gemini-2.0-flash-live-001': { input: 2.10, output: 8.50 }, // Live API audio pricing  
  'models/gemini-2.5-flash-preview-native-audio-dialog': { input: 3.00, output: 12.00 }, // Native audio pricing
  'models/gemini-2.5-flash-exp-native-audio-thinking-dialog': { input: 3.00, output: 12.00 }, // Native audio pricing
} as const;

class TokenTracker {
  private events: TokenUsageEvent[] = [];
  private sessionStart: Date = new Date();
  private storageKey = 'gemini-token-usage';

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Track a token usage event
   */
  track(event: Omit<TokenUsageEvent, 'timestamp' | 'totalTokens' | 'cost'>): void {
    const fullEvent: TokenUsageEvent = {
      ...event,
      timestamp: new Date(),
      totalTokens: event.inputTokens + event.outputTokens,
      cost: this.calculateCost(event.model, event.inputTokens, event.outputTokens)
    };

    this.events.push(fullEvent);
    
    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }

    this.saveToStorage();
    
    // Emit event for real-time updates
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tokenUsageUpdate', { 
        detail: fullEvent 
      }));
    }
  }

  /**
   * Calculate cost for token usage
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = TOKEN_PRICING[model as keyof typeof TOKEN_PRICING] || TOKEN_PRICING['models/gemini-2.0-flash-exp'];
    const inputCost = (inputTokens / 1000000) * pricing.input;
    const outputCost = (outputTokens / 1000000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Get usage summary for current session
   */
  getSummary(): TokenUsageSummary {
    if (this.events.length === 0) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        totalRequests: 0,
        averageTokensPerRequest: 0,
        costPerToken: 0,
        sessionStart: this.sessionStart,
        lastActivity: this.sessionStart
      };
    }

    const totalInputTokens = this.events.reduce((sum, event) => sum + event.inputTokens, 0);
    const totalOutputTokens = this.events.reduce((sum, event) => sum + event.outputTokens, 0);
    const totalTokens = totalInputTokens + totalOutputTokens;
    const totalCost = this.events.reduce((sum, event) => sum + event.cost, 0);
    const successfulRequests = this.events.filter(e => e.status === 'success').length;

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCost,
      totalRequests: this.events.length,
      averageTokensPerRequest: successfulRequests > 0 ? totalTokens / successfulRequests : 0,
      costPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
      sessionStart: this.sessionStart,
      lastActivity: this.events[this.events.length - 1]?.timestamp || this.sessionStart
    };
  }

  /**
   * Get recent activity events
   */
  getRecentActivity(limit: number = 10): TokenUsageEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.events = [];
    this.sessionStart = new Date();
    this.saveToStorage();
  }


  /**
   * Export usage data as CSV
   */
  exportCSV(): string {
    const headers = [
      'Timestamp',
      'Model',
      'Input Tokens',
      'Output Tokens',
      'Total Tokens',
      'Cost',
      'Duration (ms)',
      'Status'
    ];

    const rows = this.events.map(event => [
      event.timestamp.toISOString(),
      event.model,
      event.inputTokens.toString(),
      event.outputTokens.toString(),
      event.totalTokens.toString(),
      event.cost.toFixed(6),
      event.duration?.toString() || '',
      event.status
    ]);

    return [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
  }

  /**
   * Save to localStorage
   */
  private saveToStorage(): void {
    if (typeof window !== 'undefined') {
      try {
        const data = {
          events: this.events.slice(-100), // Keep only last 100 events in storage
          sessionStart: this.sessionStart.toISOString()
        };
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      } catch (error) {
        console.warn('Failed to save token usage data:', error);
      }
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
          const data = JSON.parse(stored);
          this.events = data.events?.map((e: TokenUsageEvent) => ({
            ...e,
            timestamp: new Date(e.timestamp)
          })) || [];
          this.sessionStart = data.sessionStart ? new Date(data.sessionStart) : new Date();
        }
      } catch (error) {
        console.warn('Failed to load token usage data:', error);
        this.events = [];
      }
    }
  }
}

// Global token tracker instance
export const tokenTracker = new TokenTracker();

/**
 * React hook for token usage tracking
 */
export function useTokenTracking() {
  const [summary, setSummary] = React.useState<TokenUsageSummary>(tokenTracker.getSummary());
  const [recentActivity, setRecentActivity] = React.useState<TokenUsageEvent[]>(tokenTracker.getRecentActivity());

  React.useEffect(() => {
    const updateData = () => {
      setSummary(tokenTracker.getSummary());
      setRecentActivity(tokenTracker.getRecentActivity());
    };

    // Update immediately
    updateData();

    // Listen for updates
    const handleUpdate = () => updateData();
    if (typeof window !== 'undefined') {
      window.addEventListener('tokenUsageUpdate', handleUpdate);
      return () => window.removeEventListener('tokenUsageUpdate', handleUpdate);
    }
  }, []);

  return {
    summary,
    recentActivity,
    track: tokenTracker.track.bind(tokenTracker),
    clear: tokenTracker.clear.bind(tokenTracker),
    exportCSV: tokenTracker.exportCSV.bind(tokenTracker)
  };
}