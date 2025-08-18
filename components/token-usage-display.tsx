"use client";

import { useState } from "react";
import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart, Clock, RefreshCw, Download } from "lucide-react";
import { useTokenTracking } from "@/lib/token-tracking";

export function TokenUsageDisplay() {
  const { tokenState } = useLiveAPIContext();
  const { summary, recentActivity, clear, exportCSV } = useTokenTracking();
  const [isLoading, setIsLoading] = useState(false);

  const handleExportCSV = () => {
    const csvContent = exportCSV();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gemini-token-usage-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const handleClearData = () => {
    if (confirm('Are you sure you want to clear all token usage data?')) {
      clear();
    }
  };

  const handleRefresh = () => {
    // Since we're using real-time tracking, this is essentially a no-op
    // but we'll show loading state for UX feedback
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 500);
  };

  // Remove the useEffect since we're using real-time tracking

  if (!tokenState.isConnected) {
    return null;
  }

  return (
    <TooltipProvider>
      <Card className="w-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart className="w-5 h-5" />
              Token Usage
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-2">
          {/* Usage Summary */}
          <div className="py-4 overflow-x-auto">
            <div className="flex flex-col justify-between items-center min-w-fit px-4">
              <div className="text-center flex-shrink-0">
                <div className="text-2xl font-bold text-blue-600">{summary.totalInputTokens.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">Input Tokens</div>
              </div>
              <div className="text-center flex-shrink-0">
                <div className="text-2xl font-bold text-green-600">{summary.totalOutputTokens.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">Output Tokens</div>
              </div>
              <div className="text-center flex-shrink-0">
                <div className="text-2xl font-bold text-purple-600">{summary.totalTokens.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Tokens</div>
              </div>
              <div className="text-center flex-shrink-0">
                <div className="text-2xl font-bold text-orange-600">${summary.totalCost.toFixed(4)}</div>
                <div className="text-xs text-muted-foreground mt-1">Total Cost</div>
              </div>
            </div>
          </div>

          {/* Activity Logs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Recent Activity
              </h4>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={handleExportCSV}>
                  <Download className="w-4 h-4 mr-1" />
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={handleClearData}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {recentActivity.length === 0 ? (
                <p className="text-muted-foreground text-xs">No activity recorded yet</p>
              ) : (
                recentActivity.map((log, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={log.status === 'success' ? 'default' : 'destructive'} className="text-xs">
                        {log.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-blue-600">{log.inputTokens}</span>
                        </TooltipTrigger>
                        <TooltipContent>Input tokens</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger>
                          <span className="text-green-600">{log.outputTokens}</span>
                        </TooltipTrigger>
                        <TooltipContent>Output tokens</TooltipContent>
                      </Tooltip>
                      <span className="text-orange-600 font-mono">
                        ${log.cost.toFixed(4)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Usage Info */}
          <div className="text-xs text-muted-foreground">
            <p>Session started: {summary.sessionStart.toLocaleString()}</p>
            <p>Total requests: {summary.totalRequests}</p>
            <p>Average tokens/request: {Math.round(summary.averageTokensPerRequest)}</p>
            <p className="mt-1">
              💡 Costs are estimated based on current Gemini Live API audio pricing
            </p>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

export default TokenUsageDisplay;