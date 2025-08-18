/**
 * Comprehensive configuration system for ephemeral token management
 * Handles environment variables, defaults, and validation
 */

export interface EphemeralTokenSystemConfig {
  // API Configuration
  api: {
    endpoint: string;
    timeout: number;
    retries: number;
  };
  
  // Gemini Model Configuration
  gemini: {
    model: string;
  };
  
  // Token Settings
  token: {
    defaultExpirationMinutes: number;
    defaultUses: number;
    maxExpirationMinutes: number;
    maxUses: number;
    refreshThresholdMinutes: number;
  };
  
  // Security Settings
  security: {
    enableRateLimit: boolean;
    rateLimitWindow: number; // minutes
    rateLimitMax: number;
    requireHttps: boolean;
    allowedOrigins: string[];
    maxRequestSizeBytes: number;
    enableAuditLog: boolean;
  };
  
  // Connection Settings
  connection: {
    maxRetries: number;
    retryDelayMs: number;
    autoReconnect: boolean;
    connectionTimeoutMs: number;
  };
  
  // Storage Settings
  storage: {
    enablePersistence: boolean;
    maxCacheSize: number;
    cacheEvictionMinutes: number;
    storagePrefix: string;
  };
  
  // Session Settings
  session: {
    maxTokensPerSession: number;
    sessionTimeoutMinutes: number;
    cleanupIntervalMinutes: number;
    enableSessionResumption: boolean;
  };
  
  // Development Settings
  development: {
    enableDebugLogging: boolean;
    enableDevTools: boolean;
    mockTokens: boolean;
    skipValidation: boolean;
  };
}

/**
 * Load configuration from environment variables with validation
 */
export function loadEphemeralTokenConfig(): EphemeralTokenSystemConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';

  return {
    api: {
      endpoint: process.env.NEXT_PUBLIC_TOKEN_API_ENDPOINT || '/api/auth',
      timeout: parseInt(process.env.TOKEN_API_TIMEOUT || '30000'),
      retries: parseInt(process.env.TOKEN_API_RETRIES || '3'),
    },
    
    gemini: {
      model: process.env.NEXT_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || 'models/gemini-2.0-flash-exp',
    },
    
    token: {
      defaultExpirationMinutes: parseInt(process.env.TOKEN_DEFAULT_EXPIRATION_MINUTES || '30'),
      defaultUses: parseInt(process.env.TOKEN_DEFAULT_USES || '1'),
      maxExpirationMinutes: parseInt(process.env.TOKEN_MAX_EXPIRATION_MINUTES || '30'),
      maxUses: parseInt(process.env.TOKEN_MAX_USES || '5'),
      refreshThresholdMinutes: parseInt(process.env.TOKEN_REFRESH_THRESHOLD_MINUTES || '5'),
    },
    
    security: {
      enableRateLimit: process.env.TOKEN_ENABLE_RATE_LIMIT !== 'false',
      rateLimitWindow: parseInt(process.env.TOKEN_RATE_LIMIT_WINDOW || '60'),
      rateLimitMax: parseInt(process.env.TOKEN_RATE_LIMIT_MAX || '10'),
      requireHttps: process.env.TOKEN_REQUIRE_HTTPS === 'true' || isProduction,
      allowedOrigins: process.env.TOKEN_ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'https://localhost:3000',
      ],
      maxRequestSizeBytes: parseInt(process.env.TOKEN_MAX_REQUEST_SIZE || '10240'), // 10KB
      enableAuditLog: process.env.TOKEN_ENABLE_AUDIT_LOG !== 'false',
    },
    
    connection: {
      maxRetries: parseInt(process.env.TOKEN_CONNECTION_MAX_RETRIES || '3'),
      retryDelayMs: parseInt(process.env.TOKEN_CONNECTION_RETRY_DELAY || '1000'),
      autoReconnect: process.env.TOKEN_AUTO_RECONNECT !== 'false',
      connectionTimeoutMs: parseInt(process.env.TOKEN_CONNECTION_TIMEOUT || '30000'),
    },
    
    storage: {
      enablePersistence: process.env.TOKEN_ENABLE_PERSISTENCE !== 'false' && typeof window !== 'undefined',
      maxCacheSize: parseInt(process.env.TOKEN_MAX_CACHE_SIZE || '50'),
      cacheEvictionMinutes: parseInt(process.env.TOKEN_CACHE_EVICTION_MINUTES || '60'),
      storagePrefix: process.env.TOKEN_STORAGE_PREFIX || 'gemini_tokens_',
    },
    
    session: {
      maxTokensPerSession: parseInt(process.env.TOKEN_MAX_TOKENS_PER_SESSION || '3'),
      sessionTimeoutMinutes: parseInt(process.env.TOKEN_SESSION_TIMEOUT_MINUTES || '60'),
      cleanupIntervalMinutes: parseInt(process.env.TOKEN_CLEANUP_INTERVAL_MINUTES || '5'),
      enableSessionResumption: process.env.TOKEN_ENABLE_SESSION_RESUMPTION !== 'false',
    },
    
    development: {
      enableDebugLogging: process.env.TOKEN_ENABLE_DEBUG_LOGGING === 'true' || isDevelopment,
      enableDevTools: process.env.TOKEN_ENABLE_DEV_TOOLS === 'true' || isDevelopment,
      mockTokens: process.env.TOKEN_MOCK_TOKENS === 'true',
      skipValidation: process.env.TOKEN_SKIP_VALIDATION === 'true',
    },
  };
}

/**
 * Validate configuration values
 */
export function validateEphemeralTokenConfig(config: EphemeralTokenSystemConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate token settings
  if (config.token.defaultExpirationMinutes < 1 || config.token.defaultExpirationMinutes > config.token.maxExpirationMinutes) {
    errors.push('Invalid default expiration minutes');
  }
  
  if (config.token.defaultUses < 1 || config.token.defaultUses > config.token.maxUses) {
    errors.push('Invalid default uses');
  }
  
  if (config.token.refreshThresholdMinutes >= config.token.defaultExpirationMinutes) {
    errors.push('Refresh threshold must be less than expiration time');
  }

  // Validate security settings
  if (config.security.rateLimitWindow < 1) {
    errors.push('Rate limit window must be at least 1 minute');
  }
  
  if (config.security.rateLimitMax < 1) {
    errors.push('Rate limit max must be at least 1');
  }
  
  if (config.security.maxRequestSizeBytes < 1024) {
    errors.push('Max request size must be at least 1KB');
  }

  // Validate connection settings
  if (config.connection.maxRetries < 0) {
    errors.push('Max retries cannot be negative');
  }
  
  if (config.connection.retryDelayMs < 100) {
    errors.push('Retry delay must be at least 100ms');
  }

  // Validate storage settings
  if (config.storage.maxCacheSize < 1) {
    errors.push('Max cache size must be at least 1');
  }
  
  if (config.storage.cacheEvictionMinutes < 1) {
    errors.push('Cache eviction time must be at least 1 minute');
  }

  // Validate session settings
  if (config.session.maxTokensPerSession < 1) {
    errors.push('Max tokens per session must be at least 1');
  }
  
  if (config.session.sessionTimeoutMinutes < config.token.defaultExpirationMinutes) {
    errors.push('Session timeout should be at least as long as token expiration');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get configuration with validation
 */
export function getValidatedEphemeralTokenConfig(): EphemeralTokenSystemConfig {
  const config = loadEphemeralTokenConfig();
  const validation = validateEphemeralTokenConfig(config);
  
  if (!validation.isValid) {
    console.warn('Ephemeral token configuration validation failed:');
    validation.errors.forEach(error => console.warn(`- ${error}`));
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid ephemeral token configuration in production');
    }
  }
  
  return config;
}

/**
 * Environment variable documentation and defaults
 */
export const CONFIG_DOCUMENTATION = {
  // Gemini Configuration
  'NEXT_PUBLIC_GEMINI_MODEL': {
    description: 'Gemini model to use for Live API (client-side accessible)',
    default: 'models/gemini-2.0-flash-exp',
    example: 'models/gemini-2.0-flash-exp',
  },
  
  // API Configuration
  'NEXT_PUBLIC_TOKEN_API_ENDPOINT': {
    description: 'Base endpoint for token API calls',
    default: '/api/auth',
    example: '/api/auth',
  },
  'TOKEN_API_TIMEOUT': {
    description: 'Timeout for API calls in milliseconds',
    default: '30000',
    example: '30000',
  },
  'TOKEN_API_RETRIES': {
    description: 'Number of retry attempts for failed API calls',
    default: '3',
    example: '3',
  },

  // Token Settings
  'TOKEN_DEFAULT_EXPIRATION_MINUTES': {
    description: 'Default token expiration time in minutes',
    default: '30',
    example: '30',
  },
  'TOKEN_DEFAULT_USES': {
    description: 'Default number of uses per token',
    default: '1',
    example: '1',
  },
  'TOKEN_MAX_EXPIRATION_MINUTES': {
    description: 'Maximum allowed token expiration time in minutes',
    default: '30',
    example: '30',
  },
  'TOKEN_MAX_USES': {
    description: 'Maximum allowed uses per token',
    default: '5',
    example: '5',
  },
  'TOKEN_REFRESH_THRESHOLD_MINUTES': {
    description: 'Minutes before expiration to automatically refresh token',
    default: '5',
    example: '5',
  },

  // Security Settings
  'TOKEN_ENABLE_RATE_LIMIT': {
    description: 'Enable rate limiting for token requests',
    default: 'true',
    example: 'true',
  },
  'TOKEN_RATE_LIMIT_WINDOW': {
    description: 'Rate limit window in minutes',
    default: '60',
    example: '60',
  },
  'TOKEN_RATE_LIMIT_MAX': {
    description: 'Maximum requests per rate limit window',
    default: '10',
    example: '10',
  },
  'TOKEN_REQUIRE_HTTPS': {
    description: 'Require HTTPS for all token requests (auto-enabled in production)',
    default: 'false',
    example: 'true',
  },
  'TOKEN_ALLOWED_ORIGINS': {
    description: 'Comma-separated list of allowed origins',
    default: 'http://localhost:3000,https://localhost:3000',
    example: 'https://myapp.com,https://staging.myapp.com',
  },

  // Connection Settings
  'TOKEN_CONNECTION_MAX_RETRIES': {
    description: 'Maximum connection retry attempts',
    default: '3',
    example: '3',
  },
  'TOKEN_CONNECTION_RETRY_DELAY': {
    description: 'Base delay between connection retries in milliseconds',
    default: '1000',
    example: '1000',
  },
  'TOKEN_AUTO_RECONNECT': {
    description: 'Enable automatic reconnection on connection loss',
    default: 'true',
    example: 'true',
  },

  // Storage Settings
  'TOKEN_ENABLE_PERSISTENCE': {
    description: 'Enable token persistence in localStorage',
    default: 'true',
    example: 'true',
  },
  'TOKEN_MAX_CACHE_SIZE': {
    description: 'Maximum number of tokens to cache',
    default: '50',
    example: '50',
  },
  'TOKEN_STORAGE_PREFIX': {
    description: 'Prefix for stored tokens in localStorage',
    default: 'gemini_tokens_',
    example: 'myapp_tokens_',
  },

  // Session Settings
  'TOKEN_MAX_TOKENS_PER_SESSION': {
    description: 'Maximum active tokens per session',
    default: '3',
    example: '3',
  },
  'TOKEN_ENABLE_SESSION_RESUMPTION': {
    description: 'Enable session resumption across page reloads',
    default: 'true',
    example: 'true',
  },

  // Development Settings
  'TOKEN_ENABLE_DEBUG_LOGGING': {
    description: 'Enable detailed debug logging (auto-enabled in development)',
    default: 'false',
    example: 'true',
  },
  'TOKEN_MOCK_TOKENS': {
    description: 'Use mock tokens for testing (development only)',
    default: 'false',
    example: 'true',
  },
};

// Global configuration instance
let globalConfig: EphemeralTokenSystemConfig | null = null;

export function getGlobalEphemeralTokenConfig(): EphemeralTokenSystemConfig {
  if (!globalConfig) {
    globalConfig = getValidatedEphemeralTokenConfig();
  }
  return globalConfig;
}

// Reset global config (useful for testing)
export function resetGlobalEphemeralTokenConfig(): void {
  globalConfig = null;
}