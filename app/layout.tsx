import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PocketBaseAuthProvider } from "@/lib/auth/pocketbase-context";
import { WebViewAuthHandler } from "@/components/auth/webview-auth-handler";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gemini Live API Console",
  description: "Interactive console for Google Gemini Live API with real-time audio/video streaming",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WebViewAuthHandler />
        <PocketBaseAuthProvider>
          {children}
        </PocketBaseAuthProvider>
      </body>
    </html>
  );
}
