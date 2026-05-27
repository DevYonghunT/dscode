// Client-side helper to build URLs that respect Next.js basePath.
// next/link and next/image prepend basePath automatically, but raw fetch() does not.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${BASE}${path}`;
}
