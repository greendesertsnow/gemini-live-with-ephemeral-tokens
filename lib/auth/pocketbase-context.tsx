'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { pb, authHelpers, AuthUser } from './pocketbase-client';

interface PocketBaseAuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const PocketBaseAuthContext = createContext<PocketBaseAuthContextType | undefined>(undefined);

export function PocketBaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Initialize auth state from stored token
    setUser(authHelpers.getCurrentUser());
    setIsLoading(false);

    // Listen for auth changes
    const unsubscribe = pb.authStore.onChange(() => {
      setUser(authHelpers.getCurrentUser());
    });

    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const userData = await authHelpers.login(email, password);
      setUser(userData);
      
      // Force a reload to trigger middleware redirect
      setTimeout(() => {
        window.location.href = '/';
      }, 100);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    authHelpers.logout();
    setUser(null);
    
    // Force a reload to trigger middleware redirect
    setTimeout(() => {
      window.location.href = '/login';
    }, 100);
  };

  const value = {
    user,
    login,
    logout,
    isLoading,
    isAuthenticated: !!user && authHelpers.isAuthenticated()
  };

  return (
    <PocketBaseAuthContext.Provider value={value}>
      {children}
    </PocketBaseAuthContext.Provider>
  );
}

export function usePocketBaseAuth() {
  const context = useContext(PocketBaseAuthContext);
  if (context === undefined) {
    throw new Error('usePocketBaseAuth must be used within a PocketBaseAuthProvider');
  }
  return context;
}