"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Part, ExecutableCode } from "@google/genai";
import embed from "vega-embed";

export function Altair() {
  const { client } = useLiveAPIContext();
  const [messages, setMessages] = useState<Part[]>([]);
  const vegaRefs = useRef<Record<string, HTMLDivElement>>({});

  useEffect(() => {
    if (!client) return;
    const handleContent = (data: { modelTurn?: { parts?: Part[] } }) => {
      const parts = data.modelTurn?.parts;
      if (parts) {
        setMessages((prev) => [...prev, ...parts]);
      }
    };

    client.on("content", handleContent);
    return () => {
      client.off("content", handleContent);
    };
  }, [client]);

  useEffect(() => {
    // Render Vega visualizations (best-effort parsing)
    messages.forEach((part, index) => {
      const exec: ExecutableCode | undefined = part.executableCode;
      const code: string | undefined = exec?.code;
      if (!code) return;

      try {
        const spec = JSON.parse(code);
        if (spec && typeof spec === "object" && String(spec.$schema || "").includes("vega-lite")) {
          const refKey = `vega-${index}`;
          const element = vegaRefs.current[refKey];
          if (element && !element.hasChildNodes()) {
            embed(element, spec, {
              actions: false,
              renderer: "svg",
            });
          }
        }
      } catch {
        // Not valid JSON or not Vega spec - ignore
      }
    });
  }, [messages]);

  const renderPart = (part: Part, index: number) => {
    if (part.text) {
      return (
        <div key={index} className="prose dark:prose-invert max-w-none">
          <p className="whitespace-pre-wrap">{part.text}</p>
        </div>
      );
    }

    if (part.executableCode) {
      const exec: ExecutableCode = part.executableCode;
      const language = String(exec?.language ?? "");
      const code = String(exec?.code ?? "");

      // Try Vega-Lite render path
      try {
        const spec = JSON.parse(code);
        if (spec && typeof spec === "object" && String(spec.$schema || "").includes("vega-lite")) {
          const refKey = `vega-${index}`;
          return (
            <div key={index} className="my-4">
              <div
                ref={(el) => {
                  if (el) vegaRefs.current[refKey] = el;
                }}
                className="vega-embed"
              />
            </div>
          );
        }
      } catch {
        // Not JSON or not Vega - fall back to code rendering
      }

      return (
        <div key={index} className="my-4">
          <Badge variant="secondary" className="mb-2">
            {language}
          </Badge>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    if (part.codeExecutionResult) {
      const { outcome, output } = part.codeExecutionResult;
      return (
        <div key={index} className="my-4">
          <Badge variant={String(outcome) === "OK" ? "default" : "destructive"}>
            Execution: {String(outcome)}
          </Badge>
          {output && (
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">
              <code>{output}</code>
            </pre>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-12rem)]">
          <div className="p-4 space-y-4">
            {messages.length === 0 ? (
              <p className="text-muted-foreground">
                Start a conversation by connecting and speaking...
              </p>
            ) : (
              messages.map((part, index) => renderPart(part, index))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}