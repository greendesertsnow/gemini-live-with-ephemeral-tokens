"use client";

import { useEffect, useState } from "react";
import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import { StreamingLog } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import TokenUsageDisplay from "@/components/token-usage-display";

export default function SidePanel() {
  const { client } = useLiveAPIContext();
  const [logs, setLogs] = useState<StreamingLog[]>([]);

  useEffect(() => {
    if (!client) return;
    const handleLog = (log: StreamingLog) => {
      setLogs((prev) => [...prev.slice(-99), log]);
    };

    client.on("log", handleLog);
    return () => {
      client.off("log", handleLog);
    };
  }, [client]);

  const getLogColor = (type: string) => {
    if (type.startsWith("client")) return "text-blue-500";
    if (type.startsWith("server")) return "text-green-500";
    return "text-gray-500";
  };

  const formatLogMessage = (log: StreamingLog) => {
    if (typeof log.message === "string") {
      return log.message;
    }
    
    if (typeof log.message === "object") {
      return JSON.stringify(log.message, null, 2);
    }
    
    return String(log.message);
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Token Usage Display */}
      <TokenUsageDisplay />
      
      {/* Activity Log */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(50vh-8rem)]">
            <div className="p-4 space-y-2">
              {logs.length === 0 ? (
                <p className="text-muted-foreground text-sm">No activity yet...</p>
              ) : (
                logs.map((log, index) => (
                  <div
                    key={index}
                    className="text-xs font-mono space-y-1 border-b pb-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {log.date.toLocaleTimeString()}
                      </span>
                      <Badge variant="outline" className={cn("text-xs", getLogColor(log.type))}>
                        {log.type}
                      </Badge>
                      {log.count && (
                        <Badge variant="secondary" className="text-xs">
                          {log.count}
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground whitespace-pre-wrap break-all">
                      {formatLogMessage(log)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}