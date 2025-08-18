/**
 * Tools configuration utility for Gemini Live API
 * Handles construction of tools array based on enabled capabilities
 */

export interface ToolsConfig {
  search: boolean;
  codeExecution: boolean;
  functionCalling: boolean;
  weather: boolean;
}

export interface WeatherAPIConfig {
  apiKey?: string;
  provider?: 'openweather' | 'weatherapi';
}

/**
 * Builds the tools array for Gemini Live API based on enabled tools
 */
export function buildToolsConfig(
  enabledTools: ToolsConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _weatherConfig?: WeatherAPIConfig
): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];

  // Google Search Tool
  if (enabledTools.search) {
    tools.push({
      google_search: {}
    });
  }

  // Code Execution Tool
  if (enabledTools.codeExecution) {
    tools.push({
      code_execution: {}
    });
  }

  // Weather API Function Declaration
  if (enabledTools.weather) {
    tools.push({
      function_declarations: [{
        name: "get_weather",
        description: "Get current weather information for a specific location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city and country (e.g., 'London, UK' or 'New York, NY')"
            },
            units: {
              type: "string",
              description: "Temperature units",
              enum: ["celsius", "fahrenheit"],
              default: "celsius"
            }
          },
          required: ["location"]
        }
      }]
    });
  }

  return tools;
}

/**
 * Validates if tools are supported by the given model
 */
export function validateToolsForModel(
  enabledTools: ToolsConfig,
  modelCapabilities: {
    search: boolean;
    functionCalling: boolean;
    codeExecution: boolean;
  }
): { isValid: boolean; unsupportedTools: string[] } {
  const unsupportedTools: string[] = [];

  if (enabledTools.search && !modelCapabilities.search) {
    unsupportedTools.push('Google Search');
  }

  if (enabledTools.codeExecution && !modelCapabilities.codeExecution) {
    unsupportedTools.push('Code Execution');
  }

  if ((enabledTools.functionCalling || enabledTools.weather) && !modelCapabilities.functionCalling) {
    unsupportedTools.push('Function Calling');
  }

  return {
    isValid: unsupportedTools.length === 0,
    unsupportedTools
  };
}

/**
 * Creates a default tools configuration
 */
export function createDefaultToolsConfig(): ToolsConfig {
  return {
    search: true,
    codeExecution: true,
    functionCalling: true,
    weather: false
  };
}

/**
 * Weather API function handler
 * This handles weather function calls from the Gemini Live API
 */
export async function handleWeatherFunction(
  location: string,
  units: 'celsius' | 'fahrenheit' = 'celsius',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config?: WeatherAPIConfig
): Promise<{
  location: string;
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
  units: string;
}> {
  try {
    const response = await fetch('/api/weather', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ location, units }),
    });

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Weather function error:', error);
    // Return fallback data on error
    return {
      location,
      temperature: units === 'celsius' ? 22 : 72,
      description: 'Weather data unavailable',
      humidity: 65,
      windSpeed: 10,
      units: units === 'celsius' ? '°C' : '°F'
    };
  }
}