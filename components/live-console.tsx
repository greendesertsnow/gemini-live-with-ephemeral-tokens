"use client";

import { useRef, useState, RefObject } from "react";
import { EphemeralLiveAPIProvider } from "@/contexts/ephemeral-live-api-context";
import { TokenProvider } from "@/contexts/token-context";
import SidePanel from "@/components/side-panel";
import { Altair } from "@/components/altair";
import { ControlTray } from "@/components/control-tray";
import SettingsDialog from "@/components/settings-dialog";
import { SerializationErrorBoundary } from "@/components/serialization-error-boundary";
import { useEphemeralAuth } from "@/hooks/use-ephemeral-auth";
import { cn } from "@/lib/utils";
// import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TokenDashboard } from "@/components/dev/token-dashboard";
import { createTokenMonitorDevTools } from "@/lib/monitoring/token-monitor";
import { getGlobalEphemeralTokenConfig } from "@/lib/config/ephemeral-token-config";
import ToolStatusIndicator from "@/components/tool-status-indicator";
import { useEffect } from "react";

function ConnectionStatus() {
  const { state, actions } = useEphemeralAuth();
  
  if (state.error) {
    return (
      <Alert className="m-4">
        <AlertDescription className="flex items-center justify-between">
          <span>Connection Error: {state.error}</span>
          <Button size="sm" onClick={actions.retry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">
            {state.isConnecting ? 'Connecting...' : 'Getting secure token...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-2 border-b">
      <div className="flex items-center gap-2">
        <Badge variant={state.isConnected ? "default" : "secondary"}>
          {state.connectionStatus}
        </Badge>
        {state.isAuthenticated && (
          <Badge variant="outline">
            {state.usesRemaining} uses remaining
          </Badge>
        )}
        {state.needsRefresh && (
          <Badge variant="secondary">
            Token refresh needed
          </Badge>
        )}
      </div>
      
      {state.isConnected && (
        <ToolStatusIndicator />
      )}
    </div>
  );
}

function LiveConsoleContent() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <SerializationErrorBoundary autoFix={true} maxRetries={3}>
      <EphemeralLiveAPIProvider>
        <div className="min-h-screen bg-background">
          {/* Connection Status Bar */}
          <ConnectionStatus />
          
          <div className="flex h-screen">
            {/* Side Panel */}
            <div className="w-80 border-r">
              <SerializationErrorBoundary>
                <SidePanel />
              </SerializationErrorBoundary>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 relative">
                <SerializationErrorBoundary>
                  <Altair />
                </SerializationErrorBoundary>
                
                {/* Video Stream Display */}
                <video
                  className={cn(
                    "absolute top-4 right-4 w-64 h-48 rounded-lg shadow-lg bg-black",
                    !videoStream && "hidden"
                  )}
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                />
              </div>

              {/* Control Tray */}
              <SerializationErrorBoundary>
                <ControlTray
                  videoRef={videoRef as RefObject<HTMLVideoElement>}
                  supportsVideo={true}
                  onVideoStreamChange={setVideoStream}
                  enableEditingSettings={true}
                  onSettingsClick={() => setSettingsOpen(true)}
                />
              </SerializationErrorBoundary>
            </div>
          </div>

          {/* Settings Dialog */}
          <SerializationErrorBoundary>
            <SettingsDialog 
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
            />
          </SerializationErrorBoundary>
        </div>
      </EphemeralLiveAPIProvider>
    </SerializationErrorBoundary>
  );
}

export default function LiveConsole() {
  // Initialize development tools
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      createTokenMonitorDevTools();
    }
  }, []);

  // Load configuration on client side
  const tokenConfig = getGlobalEphemeralTokenConfig();

  return (
    <TokenProvider
      config={{
        apiEndpoint: tokenConfig.api.endpoint,
        autoRefresh: true,
        refreshThresholdMinutes: tokenConfig.token.refreshThresholdMinutes,
        maxRetries: tokenConfig.connection.maxRetries,
        onTokenExpired: (sessionId) => {
          console.warn(`Token expired for session ${sessionId}`);
        },
        onTokenRefreshed: (_token, expiresAt) => {
          console.log(`Token refreshed (expires: ${expiresAt.toISOString()})`);
        },
        onError: (error) => {
          console.error('Token error:', error);
        },
      }}
    >
      <TokenDashboard />
      <LiveConsoleContent />
    </TokenProvider>
  );
}