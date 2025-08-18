"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import { useScreenCapture } from "@/hooks/use-screen-capture";
import { useWebcam } from "@/hooks/use-webcam";
import { AudioRecorder } from "@/lib/audio-recorder";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Video, VideoOff, Monitor, MonitorOff, Settings } from "lucide-react";
import AudioPulse from "./audio-pulse";
// import { cn } from "@/lib/utils";

export type ControlTrayProps = {
  videoRef: RefObject<HTMLVideoElement>;
  children?: React.ReactNode;
  supportsVideo?: boolean;
  onVideoStreamChange?: (stream: MediaStream | null) => void;
  enableEditingSettings?: boolean;
  onSettingsClick?: () => void;
};

export function ControlTray({
  videoRef,
  children,
  onVideoStreamChange = () => {},
  supportsVideo = true,
  enableEditingSettings,
  onSettingsClick,
}: ControlTrayProps) {
  const webcam = useWebcam();
  const screenCapture = useScreenCapture();
  const [activeVideoStream, setActiveVideoStream] = useState<MediaStream | null>(null);
  const [inVolume, setInVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [muted, setMuted] = useState(false);
  const renderCanvasRef = useRef<HTMLCanvasElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);

  const { client, connected, connect, disconnect, volume } = useLiveAPIContext();

  useEffect(() => {
    if (!connected && connectButtonRef.current) {
      connectButtonRef.current.focus();
    }
  }, [connected]);

  useEffect(() => {
    if (!client) return;

    const onData = (base64: string) => {
      client.sendRealtimeInput([
        {
          mimeType: "audio/pcm;rate=16000",
          data: base64,
        },
      ]);
    };

    const onVolume = (volume: number) => {
      setInVolume(volume);
    };

    if (connected && !muted) {
      audioRecorder.on("data", onData).on("volume", onVolume);
      audioRecorder.start();
    } else {
      audioRecorder.stop();
      audioRecorder.off("data", onData).off("volume", onVolume);
    }

    return () => {
      audioRecorder.off("data", onData).off("volume", onVolume);
    };
  }, [connected, client, muted, audioRecorder]);

  // Update video stream display
  useEffect(() => {
    const newStream = webcam.stream || screenCapture.stream;
    setActiveVideoStream(newStream);
    onVideoStreamChange(newStream);
    
    if (videoRef.current && newStream) {
      videoRef.current.srcObject = newStream;
    }
  }, [webcam.stream, screenCapture.stream, videoRef, onVideoStreamChange]);

  // Send video frames to API
  useEffect(() => {
    if (!client || !connected || !supportsVideo || !activeVideoStream) return;

    const canvas = renderCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const videoTrack = activeVideoStream.getVideoTracks()[0];
    const videoEl = document.createElement("video");
    videoEl.srcObject = new MediaStream([videoTrack]);
    videoEl.play();

    const sendFrame = () => {
      if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result?.toString().split(",")[1];
              if (base64) {
                client.sendRealtimeInput([
                  {
                    mimeType: "image/jpeg",
                    data: base64,
                  },
                ]);
              }
            };
            reader.readAsDataURL(blob);
          }
        }, "image/jpeg", 0.3);
      }
    };

    const interval = setInterval(sendFrame, 1000);

    return () => {
      clearInterval(interval);
      videoEl.pause();
      videoEl.srcObject = null;
    };
  }, [connected, activeVideoStream, supportsVideo, client]);

  const handleToggleMute = () => {
    setMuted(!muted);
  };

  const handleToggleWebcam = async () => {
    if (webcam.isStreaming) {
      webcam.stop();
    } else {
      if (screenCapture.isStreaming) {
        screenCapture.stop();
      }
      await webcam.start();
    }
  };

  const handleToggleScreenCapture = async () => {
    if (screenCapture.isStreaming) {
      screenCapture.stop();
    } else {
      if (webcam.isStreaming) {
        webcam.stop();
      }
      await screenCapture.start();
    }
  };

  const handleConnect = async () => {
    if (connected) {
      await disconnect();
    } else {
      await connect();
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t">
      <div className="container mx-auto p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              ref={connectButtonRef}
              onClick={handleConnect}
              variant={connected ? "destructive" : "default"}
              size="lg"
            >
              {connected ? "Disconnect" : "Connect"}
            </Button>
            
            {connected && (
              <AudioPulse volume={connected ? (muted ? 0 : inVolume) : 0} />
            )}
          </div>

          <div className="flex items-center gap-2">
            {children}
            
            <Button
              onClick={handleToggleMute}
              variant={muted ? "outline" : "default"}
              size="icon"
              disabled={!connected}
            >
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>

            {supportsVideo && (
              <>
                <Button
                  onClick={handleToggleWebcam}
                  variant={webcam.isStreaming ? "default" : "outline"}
                  size="icon"
                  disabled={!connected}
                >
                  {webcam.isStreaming ? (
                    <Video className="h-4 w-4" />
                  ) : (
                    <VideoOff className="h-4 w-4" />
                  )}
                </Button>

                <Button
                  onClick={handleToggleScreenCapture}
                  variant={screenCapture.isStreaming ? "default" : "outline"}
                  size="icon"
                  disabled={!connected}
                >
                  {screenCapture.isStreaming ? (
                    <Monitor className="h-4 w-4" />
                  ) : (
                    <MonitorOff className="h-4 w-4" />
                  )}
                </Button>
              </>
            )}

            {enableEditingSettings && (
              <Button
                onClick={onSettingsClick}
                variant="outline"
                size="icon"
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <AudioPulse volume={volume} />
          </div>
        </div>
      </div>
      
      <canvas ref={renderCanvasRef} className="hidden" />
    </div>
  );
}