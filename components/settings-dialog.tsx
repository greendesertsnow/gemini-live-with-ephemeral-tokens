"use client";

import { useState } from "react";
import { useLiveAPIContext } from "@/contexts/ephemeral-live-api-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Search, Code, Zap, Globe, AudioWaveform, Brain, Settings } from "lucide-react";
import { LiveConnectConfig } from "@google/genai";
import { buildToolsConfig, ToolsConfig } from "@/lib/tools-config";
import { useSearchParams } from "next/navigation";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ModelCapability {
  search: boolean;
  functionCalling: boolean;
  codeExecution: boolean;
  urlContext: boolean;
}

interface ModelInfo {
  value: string;
  label: string;
  description: string;
  capabilities: ModelCapability;
  audioType: "cascaded" | "native";
}

const MODELS: ModelInfo[] = [
  {
    value: "models/gemini-2.0-flash-exp",
    label: "Gemini 2.0 Flash (Experimental)",
    description: "Latest experimental model with all capabilities",
    capabilities: { search: true, functionCalling: true, codeExecution: true, urlContext: true },
    audioType: "cascaded"
  },
  {
    value: "models/gemini-live-2.5-flash-preview",
    label: "Gemini Live 2.5 Flash Preview",
    description: "Optimized for real-time conversations with tool support",
    capabilities: { search: true, functionCalling: true, codeExecution: true, urlContext: true },
    audioType: "cascaded"
  },
  {
    value: "models/gemini-2.0-flash-live-001",
    label: "Gemini 2.0 Flash Live",
    description: "Stable live conversation model",
    capabilities: { search: true, functionCalling: true, codeExecution: false, urlContext: false },
    audioType: "cascaded"
  },
  {
    value: "models/gemini-2.5-flash-preview-native-audio-dialog",
    label: "Gemini 2.5 Native Audio Dialog",
    description: "Native audio generation with natural dialog flow",
    capabilities: { search: true, functionCalling: true, codeExecution: false, urlContext: false },
    audioType: "native"
  },
  {
    value: "models/gemini-2.5-flash-exp-native-audio-thinking-dialog",
    label: "Gemini 2.5 Native Audio + Thinking",
    description: "Native audio with enhanced reasoning capabilities",
    capabilities: { search: true, functionCalling: false, codeExecution: false, urlContext: false },
    audioType: "native"
  },
];

const VOICES = [
  { value: "Puck", label: "Puck", description: "Friendly and conversational" },
  { value: "Charon", label: "Charon", description: "Deep and authoritative" },
  { value: "Kore", label: "Kore", description: "Warm and professional" },
  { value: "Fenrir", label: "Fenrir", description: "Bold and confident" },
  { value: "Aoede", label: "Aoede", description: "Melodic and expressive" },
];

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "sv", name: "Swedish", flag: "🇸🇪" },
  { code: "no", name: "Norwegian", flag: "🇳🇴" },
];

function CapabilityBadges({ capabilities, audioType }: { capabilities: ModelCapability; audioType: "cascaded" | "native" }) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Badge variant="secondary" className="text-xs h-5 px-2 flex-shrink-0">
        {audioType === "native" ? (
          <><AudioWaveform className="w-3 h-3 mr-1" />Native Audio</>
        ) : (
          <><Brain className="w-3 h-3 mr-1" />Cascaded</>
        )}
      </Badge>
      {capabilities.search && (
        <Badge variant="outline" className="text-xs h-5 px-2 flex-shrink-0">
          <Search className="w-3 h-3 mr-1" />Search
        </Badge>
      )}
      {capabilities.functionCalling && (
        <Badge variant="outline" className="text-xs h-5 px-2 flex-shrink-0">
          <Zap className="w-3 h-3 mr-1" />Functions
        </Badge>
      )}
      {capabilities.codeExecution && (
        <Badge variant="outline" className="text-xs h-5 px-2 flex-shrink-0">
          <Code className="w-3 h-3 mr-1" />Code
        </Badge>
      )}
      {capabilities.urlContext && (
        <Badge variant="outline" className="text-xs h-5 px-2 flex-shrink-0">
          <Globe className="w-3 h-3 mr-1" />URLs
        </Badge>
      )}
    </div>
  );
}

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { model, client, tokenActions, tokenState } = useLiveAPIContext();
  const searchParams = useSearchParams();
  
  // Initialize state from URL parameters or defaults
  const [localModel, setLocalModel] = useState(() => {
    return searchParams?.get('model') || model || 'models/gemini-live-2.5-flash-preview';
  });
  const [localConfig, setLocalConfig] = useState<LiveConnectConfig>((client?.getConfig?.() as LiveConnectConfig) || {});
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    return searchParams?.get('lang') || 'en';
  });
  // Tools are now auto-enabled based on model capabilities
  // const [enabledTools, setEnabledTools] = useState<ToolsConfig>({
  //   search: true,
  //   codeExecution: true,
  //   functionCalling: true,
  //   weather: true,
  // });

  const handleSave = async () => {
    try {
      // Always enable all tools for the selected model (auto-detect capabilities)
      const selectedModel = MODELS.find(m => m.value === localModel);
      const autoEnabledTools: ToolsConfig = {
        search: selectedModel?.capabilities.search ?? false,
        codeExecution: selectedModel?.capabilities.codeExecution ?? false, 
        functionCalling: selectedModel?.capabilities.functionCalling ?? false,
        weather: selectedModel?.capabilities.functionCalling ?? false, // Weather requires function calling
      };

      // Build tools configuration with auto-enabled tools
      const tools = buildToolsConfig(autoEnabledTools);
      
      // Create enhanced config with tools
      const configWithTools: LiveConnectConfig = {
        ...localConfig,
        tools: tools.length > 0 ? tools : undefined,
      };
      
      // Debug logging
      console.log('🔧 Auto-enabled tools for model:', autoEnabledTools);
      console.log('🔧 Built tools array:', tools);
      console.log('🔧 Tools count:', tools.length);

      // Add language preference to system instruction
      const languageInstruction = selectedLanguage !== 'en' 
        ? `Please respond in ${LANGUAGES.find(l => l.code === selectedLanguage)?.name || 'English'}.` 
        : '';
      
      if (languageInstruction) {
        const existingInstruction = currentSystemInstruction;
        const combinedInstruction = [existingInstruction, languageInstruction]
          .filter(Boolean)
          .join(' ');
        
        configWithTools.systemInstruction = combinedInstruction ? 
          { parts: [{ text: combinedInstruction }] } : 
          undefined;
      }

      if (tokenState.isConnected) {
        await tokenActions.disconnect();
      }
      
      // Update URL parameters to persist settings
      const urlParams = new URLSearchParams();
      urlParams.set('model', localModel);
      urlParams.set('lang', selectedLanguage);
      
      // Update URL without triggering navigation
      const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
      window.history.pushState({}, '', newUrl);

      // Enhanced debugging
      console.log('🚀 Model Change:', { from: model, to: localModel });
      console.log('🔧 Connecting with tools:', tools);
      console.log('📋 Full config:', configWithTools);
      console.log('🔗 URL updated:', newUrl);
      
      await tokenActions.connect(localModel, configWithTools);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      onOpenChange(false);
    }
  };

  const handleVoiceChange = (voice: string) => {
    setLocalConfig({
      ...localConfig,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice,
          },
        },
      },
    });
  };

  const handleSystemInstructionChange = (instruction: string) => {
    setLocalConfig({
      ...localConfig,
      systemInstruction: instruction ? { parts: [{ text: instruction }] } : undefined,
    });
  };

  interface ExtendedConfig extends LiveConnectConfig {
    speechConfig?: {
      voiceConfig?: {
        prebuiltVoiceConfig?: {
          voiceName?: string;
        };
      };
    };
    systemInstruction?: string | {
      parts?: Array<{ text: string }>;
    };
  }
  
  const cfgAny = localConfig as ExtendedConfig;
  const currentVoice =
    cfgAny?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName ||
    "Puck";

  const currentSystemInstruction =
    typeof cfgAny?.systemInstruction === "string"
      ? cfgAny.systemInstruction
      : cfgAny?.systemInstruction?.parts?.[0]?.text || "";

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your Gemini Live API settings
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Accordion type="multiple" defaultValue={["model", "voice", "advanced"]} className="w-full">
            <AccordionItem value="model">
              <AccordionTrigger className="text-base">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  Model & Capabilities
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid gap-3">
                  <Label htmlFor="model">Model</Label>
                  <Select value={localModel} onValueChange={setLocalModel}>
                    <SelectTrigger id="model" className="h-auto min-h-[90px] py-3">
                      <SelectValue>
                        {(() => {
                          const selectedModel = MODELS.find(m => m.value === localModel);
                          return selectedModel && (
                            <div className="flex flex-col items-start w-full pr-2">
                              <div className="font-medium text-left">{selectedModel.label}</div>
                              <div className="text-xs text-muted-foreground mt-1 text-left">{selectedModel.description}</div>
                              <div className="mt-2 w-full">
                                <CapabilityBadges capabilities={selectedModel.capabilities} audioType={selectedModel.audioType} />
                              </div>
                            </div>
                          );
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="max-w-xl">
                      {MODELS.map((model) => {
                        return (
                          <SelectItem key={model.value} value={model.value} className="py-4 min-h-[90px]">
                            <div className="w-full flex flex-col gap-2 pr-2">
                              <div className="font-medium">{model.label}</div>
                              <div className="text-xs text-muted-foreground">{model.description}</div>
                              <div className="w-full">
                                <CapabilityBadges capabilities={model.capabilities} audioType={model.audioType} />
                              </div>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="voice">
              <AccordionTrigger className="text-base">
                <div className="flex items-center gap-2">
                  <AudioWaveform className="w-4 h-4" />
                  Voice & Language
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid gap-3">
                  <Label htmlFor="voice">Voice</Label>
                  <Select value={currentVoice} onValueChange={handleVoiceChange}>
                    <SelectTrigger id="voice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICES.map((voice) => (
                        <SelectItem key={voice.value} value={voice.value} className="py-2">
                          <div>
                            <div className="font-medium">{voice.label}</div>
                            <div className="text-xs text-muted-foreground">{voice.description}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currentVoice && (() => {
                    const selectedVoice = VOICES.find(v => v.value === currentVoice);
                    return selectedVoice && (
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          {selectedVoice.description}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                // TODO: Implement voice preview
                                console.log(`Playing preview for ${selectedVoice.label}`);
                              }}
                            >
                              <AudioWaveform className="w-4 h-4 mr-1" />
                              Preview
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Play a sample of this voice</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })()}
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="language">Language</Label>
                  <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                    <SelectTrigger id="language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code} className="py-2">
                          <div className="flex items-center gap-2">
                            <span>{lang.flag}</span>
                            <span>{lang.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="advanced">
              <AccordionTrigger className="text-base">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Advanced Settings
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="grid gap-3">
                  <Label htmlFor="system-instruction">System Instruction</Label>
                  <Input
                    id="system-instruction"
                    placeholder="Enter system instructions..."
                    value={currentSystemInstruction}
                    onChange={(e) => handleSystemInstructionChange(e.target.value)}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Changes
          </Button>
        </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}