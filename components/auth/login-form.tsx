'use client';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { usePocketBaseAuth } from "@/lib/auth/pocketbase-context";

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  
  const { login, isLoading, isAuthenticated } = usePocketBaseAuth();

  useEffect(() => {
    // Check if we're in a WebView environment
    const isWebView = /WebView|wv/i.test(navigator.userAgent) || 
                     window.navigator.userAgent.includes('ReactNative');
    
    if (isWebView) {
      setAuthStatus("WebView detected - authentication via token expected");
    }

    // Check for URL token on mount
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
      setAuthStatus("Processing authentication token...");
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      setAuthStatus("Authentication successful! Redirecting...");
    }
  }, [isAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    try {
      await login(email, password);
      // Login function now handles the redirect automatically
    } catch (error: unknown) {
      console.error('Login failed:', error);
      setError(error instanceof Error ? error.message : 'Login failed. Please check your credentials.');
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Login to Gemini Live</CardTitle>
          <CardDescription>
            Enter your email and password to access the Gemini Live console
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
              
              {authStatus && (
                <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-md">
                  {authStatus}
                </div>
              )}
              
              <div className="grid gap-3">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="m@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              
              <div className="grid gap-3">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                />
              </div>
              
              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Login"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}