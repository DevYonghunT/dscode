"use client";

import { SessionProvider } from "next-auth/react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

/**
 * Tells next-auth/react where the NextAuth REST endpoints live.
 * Without this, `signIn()` and friends would call `/api/auth/...` and miss
 * our `/dscode` Next.js basePath, producing 404 + "ClientFetchError".
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider basePath={`${BASE}/api/auth`}>{children}</SessionProvider>
  );
}
