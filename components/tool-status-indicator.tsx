"use client";

import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Code, Zap, CloudRain, Cpu } from "lucide-react";
import { useEffect, useState } from "react";

interface ActiveTool {
  name: string;
  icon: React.ReactNode;
  description: string;
  active: boolean;
}

export function ToolStatusIndicator() {
  const { client } = useLiveAPIContext();
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);

  useEffect(() => {
    if (!client) {
      setActiveTools([]);
      return;
    }

    // Get the current config from the client
    const config = client.getConfig?.() as { tools?: unknown[] } | undefined;
    const tools = config?.tools || [];

    // Parse active tools from config
    const parsedTools: ActiveTool[] = [];

    tools.forEach((tool: unknown) => {
      const toolObj = tool as Record<string, unknown>;
      if (toolObj.google_search) {
        parsedTools.push({
          name: 'Search',
          icon: <Search className="w-3 h-3" />,
          description: 'Google Search integration active',
          active: true
        });
      }

      if (toolObj.code_execution) {
        parsedTools.push({
          name: 'Code',
          icon: <Code className="w-3 h-3" />,
          description: 'Code execution available',
          active: true
        });
      }

      if (toolObj.function_declarations) {
        const hasWeather = Array.isArray(toolObj.function_declarations) &&
          toolObj.function_declarations.some(
            (fn: Record<string, unknown>) => fn.name === 'get_weather'
          );

        parsedTools.push({
          name: 'Functions',
          icon: <Zap className="w-3 h-3" />,
          description: 'Custom function calling enabled',
          active: true
        });

        if (hasWeather) {
          parsedTools.push({
            name: 'Weather',
            icon: <CloudRain className="w-3 h-3" />,
            description: 'Weather API available',
            active: true
          });
        }
      }
    });

    setActiveTools(parsedTools);
  }, [client]);

  if (activeTools.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 px-2 py-1">
        <Cpu className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground mr-1">Tools:</span>
        {activeTools.map((tool) => (
          <Tooltip key={tool.name}>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs h-5 px-1.5">
                {tool.icon}
                <span className="ml-1">{tool.name}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>{tool.description}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export default ToolStatusIndicator;