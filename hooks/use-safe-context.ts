"use client";

import { useContext } from 'react';
import { TokenContext } from '@/contexts/token-context';

/**
 * Safe version of useTokenContext that doesn't throw if provider is missing
 */
export function useSafeTokenContext() {
  try {
    const context = useContext(TokenContext);
    return context || null;
  } catch (error) {
    console.warn('[useSafeTokenContext] Context not available:', error);
    return null;
  }
}

/**
 * Hook to check if token context is available
 */
export function useTokenContextAvailable(): boolean {
  const context = useSafeTokenContext();
  return context !== null;
}