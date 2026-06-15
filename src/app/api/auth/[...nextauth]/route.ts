import { NextRequest } from "next/server";
import { handlers, BASE_PATH } from "@/auth";

/**
 * Next.js strips its configured basePath (/dscode) from `request.url` before
 * handing the request to the route handler. But NextAuth's `basePath`
 * (/dscode/api/auth) needs to see the full URL so its URL-derived redirect_uri
 * lands under /dscode.
 *
 * We rebuild the request with the /dscode prefix re-added before forwarding.
 *
 * NOTE on host: `next start` always fills the request URL host as `localhost`
 * (it ignores the Host header), and NextAuth derives the OAuth redirect_uri from
 * that origin. We do NOT try to rewrite it to 127.0.0.1 — NextRequest forces the
 * host back to `localhost` regardless. So the whole app is kept on `localhost`
 * (BrowserWindow + AUTH_URL) and the Google client is a "Desktop app" type, which
 * accepts http://localhost:<port> loopback redirects on any port.
 */
function rewrap(h: (req: NextRequest, ctx?: unknown) => Response | Promise<Response>) {
  return async (req: NextRequest, ctx?: unknown) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(BASE_PATH)) {
      url.pathname = `${BASE_PATH}${url.pathname}`;
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
        // `duplex: "half"` is required by undici when body is a stream but isn't
        // in the standard `RequestInit` typings.
        (init as RequestInit & { duplex?: "half" }).duplex = "half";
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patched = new NextRequest(url, init as any);
      return h(patched, ctx);
    }
    return h(req, ctx);
  };
}

export const GET = rewrap(handlers.GET);
export const POST = rewrap(handlers.POST);
