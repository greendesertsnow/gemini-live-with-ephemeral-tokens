/**
 * Development-time Warning System for Serialization Issues
 * Provides React hooks and components to detect and warn about
 * serialization issues during development.
 */

'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { detectNonSerializable, logSerializationIssues, type SerializationIssue } from './serialization-utils';

/**
 * Configuration for development warnings
 */
interface DevWarningConfig {
  enabled?: boolean;
  logLevel?: 'warn' | 'error';
  checkProps?: boolean;
  checkState?: boolean;
  checkContext?: boolean;
  excludePaths?: string[];
  includeStackTrace?: boolean;
}

const DEFAULT_CONFIG: DevWarningConfig = {
  enabled: process.env.NODE_ENV === 'development',
  logLevel: 'warn',
  checkProps: true,
  checkState: true,
  checkContext: true,
  excludePaths: [],
  includeStackTrace: true
};

/**
 * Global configuration for dev warnings
 */
let globalConfig: DevWarningConfig = { ...DEFAULT_CONFIG };

export function configureDevWarnings(config: Partial<DevWarningConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Hook to check props for serialization issues in development
 */
export function useSerializationCheck(
  props: Record<string, unknown>,
  componentName: string,
  config?: Partial<DevWarningConfig>
): void {
  const finalConfig = useMemo(() => ({ ...globalConfig, ...config }), [config]);
  const propsRef = useRef(props);
  const hasLoggedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!finalConfig.enabled || !finalConfig.checkProps) return;

    // Only check if props have changed
    if (propsRef.current === props) return;
    propsRef.current = props;

    const checkProps = (propsToCheck: Record<string, unknown>) => {
      Object.entries(propsToCheck).forEach(([propName, propValue]) => {
        // Skip excluded paths
        if (finalConfig.excludePaths?.some(path => propName.startsWith(path))) {
          return;
        }

        const issues = detectNonSerializable(propValue);
        if (issues.length > 0) {
          const issueKey = `${componentName}-${propName}-${JSON.stringify(issues)}`;
          
          // Avoid logging the same issue repeatedly
          if (hasLoggedRef.current.has(issueKey)) return;
          hasLoggedRef.current.add(issueKey);

          const logger = console[finalConfig.logLevel || 'warn'];
          logger(`⚠️  Serialization issue in ${componentName} prop '${propName}':`);
          
          issues.forEach((issue, index) => {
            logger(`  ${index + 1}. ${issue.path || propName}: ${issue.type}`);
            if (issue.suggestion) {
              logger(`     💡 ${issue.suggestion}`);
            }
          });

          if (finalConfig.includeStackTrace) {
            logger('Stack trace:', new Error().stack);
          }
        }
      });
    };

    checkProps(props);
  }, [props, componentName, finalConfig]);
}

/**
 * Hook to check state for serialization issues
 */
export function useStateSerializationCheck<T>(
  state: T,
  stateName: string,
  config?: Partial<DevWarningConfig>
): void {
  const finalConfig = useMemo(() => ({ ...globalConfig, ...config }), [config]);
  const stateRef = useRef(state);
  const hasLoggedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!finalConfig.enabled || !finalConfig.checkState) return;

    // Only check if state has changed
    if (stateRef.current === state) return;
    stateRef.current = state;

    const issues = detectNonSerializable(state);
    if (issues.length > 0) {
      const issueKey = `${stateName}-${JSON.stringify(issues)}`;
      
      if (hasLoggedRef.current.has(issueKey)) return;
      hasLoggedRef.current.add(issueKey);

      const logger = console[finalConfig.logLevel || 'warn'];
      logger(`⚠️  Serialization issue in state '${stateName}':`);
      
      issues.forEach((issue, index) => {
        logger(`  ${index + 1}. ${issue.path || 'root'}: ${issue.type}`);
        if (issue.suggestion) {
          logger(`     💡 ${issue.suggestion}`);
        }
      });

      if (finalConfig.includeStackTrace) {
        logger('Stack trace:', new Error().stack);
      }
    }
  }, [state, stateName, finalConfig]);
}

/**
 * Higher-order component that wraps components to check their props
 */
export function withSerializationCheck<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  config?: Partial<DevWarningConfig>
) {
  const WrappedComponent = (props: P) => {
    const componentName = Component.displayName || Component.name || 'Anonymous';
    useSerializationCheck(props, componentName, config);
    return <Component {...props} />;
  };

  WrappedComponent.displayName = `withSerializationCheck(${Component.displayName || Component.name || 'Anonymous'})`;
  return WrappedComponent;
}

/**
 * Custom hook for comprehensive serialization checking
 */
export function useSerializationSafety(
  values: Record<string, unknown>,
  context: string,
  config?: Partial<DevWarningConfig>
) {
  const finalConfig = useMemo(() => ({ ...globalConfig, ...config }), [config]);
  const valuesRef = useRef(values);
  const issueCache = useRef(new Map<string, SerializationIssue[]>());

  const checkSerialization = useCallback((
    valuesToCheck: Record<string, unknown>,
    contextName: string
  ) => {
    if (!finalConfig.enabled) return { isSerializable: true, issues: [] as SerializationIssue[] };

    const allIssues: SerializationIssue[] = [];
    let isSerializable = true;

    Object.entries(valuesToCheck).forEach(([key, value]) => {
      const issues = detectNonSerializable(value);
      if (issues.length > 0) {
        isSerializable = false;
        allIssues.push(...issues.map(issue => ({
          ...issue,
          path: `${key}.${issue.path}`.replace(/\.$/, '')
        })));
      }
    });

    // Cache and log issues
    const cacheKey = `${contextName}-${JSON.stringify(allIssues)}`;
    if (!issueCache.current.has(cacheKey) && !isSerializable) {
      issueCache.current.set(cacheKey, allIssues);
      
      const logger = console[finalConfig.logLevel || 'warn'];
      logger(`⚠️  Serialization issues detected in ${contextName}:`);
      
      allIssues.forEach((issue, index) => {
        logger(`  ${index + 1}. ${issue.path}: ${issue.type}`);
        if (issue.suggestion) {
          logger(`     💡 ${issue.suggestion}`);
        }
      });
    }

    return { isSerializable, issues: allIssues };
  }, [finalConfig]);

  useEffect(() => {
    if (valuesRef.current === values) return;
    valuesRef.current = values;
    checkSerialization(values, context);
  }, [values, context, checkSerialization]);

  return { checkSerialization };
}

/**
 * Development component that shows serialization warnings in the UI
 */
interface SerializationWarningsProps {
  data: unknown;
  context?: string;
  showInProduction?: boolean;
  className?: string;
}

export function SerializationWarnings({
  data,
  context = 'Data',
  showInProduction = false,
  className = ''
}: SerializationWarningsProps) {
  const shouldShow = showInProduction || process.env.NODE_ENV === 'development';
  
  if (!shouldShow) return null;

  const issues = detectNonSerializable(data);
  
  if (issues.length === 0) return null;

  return (
    <div className={`bg-yellow-50 border border-yellow-200 rounded-md p-4 ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          <span className="text-yellow-400" aria-label="Warning">
            ⚠️
          </span>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-yellow-800">
            Serialization Issues in {context}
          </h3>
          <div className="mt-2 text-sm text-yellow-700">
            <ul className="list-disc list-inside space-y-1">
              {issues.map((issue, index) => (
                <li key={index}>
                  <strong>{issue.path || 'root'}:</strong> {issue.type}
                  {issue.suggestion && (
                    <>
                      <br />
                      <em className="text-yellow-600">💡 {issue.suggestion}</em>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Utility to create a serialization-safe version of props for development
 */
export function createSafeProps<T extends Record<string, unknown>>(
  props: T,
  options?: {
    logIssues?: boolean;
    context?: string;
  }
): T {
  const { logIssues = true, context = 'Props' } = options || {};
  
  if (process.env.NODE_ENV !== 'development') {
    return props;
  }

  const issues = detectNonSerializable(props);
  
  if (issues.length > 0 && logIssues) {
    logSerializationIssues(props, context);
  }

  return props;
}

/**
 * React DevTools integration for serialization checking
 */
export function installSerializationDevTools() {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') {
    return;
  }

  // Add global helper function for manual checking
  (window as unknown as Record<string, unknown>).__checkSerialization = (value: unknown, context = 'Manual Check') => {
    const issues = detectNonSerializable(value);
    const isSerializable = issues.length === 0;
    
    if (isSerializable) {
      console.log(`✅ ${context} is serializable`);
    } else {
      console.group(`❌ ${context} has serialization issues:`);
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue.path}: ${issue.type}`);
        if (issue.suggestion) {
          console.log(`   💡 ${issue.suggestion}`);
        }
      });
      console.groupEnd();
    }
    
    return { isSerializable, issues };
  };

  console.log('🔍 Serialization DevTools installed. Use __checkSerialization(value) in console.');
}