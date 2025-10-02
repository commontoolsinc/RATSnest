import express from "express";
import { TunnelServer, type QuoteData } from "@teekit/tunnel";
import type { Request, Response } from "@types/express";
import { tappdV4Hex } from "./samples.ts";

const HONO_PORT = 4000;
const TUNNEL_PORT = 3000;

// Helper to convert hex to bytes
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

// Stub getQuote function - returns sample quote for now
async function getQuote(x25519PublicKey: Uint8Array): Promise<QuoteData> {
  console.log(`[TunnelServer] getQuote called with pubkey length: ${x25519PublicKey.length}`);

  // Sample TDX v4 quote - in Phase 4 this will be replaced with real quote from /dev/tdx_guest
  // The real implementation will:
  // 1. Hash the x25519PublicKey with SHA-384
  // 2. Bind it to report_data
  // 3. Call /dev/tdx_guest to generate quote
  const sampleQuote = hexToBytes(tappdV4Hex);

  console.log(`[TunnelServer] Returning sample TDX v4 quote of length: ${sampleQuote.length}`);

  return {
    quote: sampleQuote,
  };
}

async function main() {
  const app = express();

  // Proxy all requests to the Hono backend
  app.use(async (req: Request, res: Response, next) => {
    console.log(`[Proxy] ${req.method} ${req.url}`);
    try {
      // Extract just the path from req.url (might be full URL from tunnel)
      const urlPath = req.url.startsWith('http') ? new URL(req.url).pathname + new URL(req.url).search : req.url;
      const url = `http://localhost:${HONO_PORT}${urlPath}`;
      const method = req.method;

      console.log(`[Proxy] Forwarding to: ${url}`);

      // Forward the request to Hono
      const response = await fetch(url, {
        method,
        headers: req.headers as HeadersInit,
        body: method !== "GET" && method !== "HEAD" ? JSON.stringify(req.body) : undefined,
      });

      console.log(`[Proxy] Got response: ${response.status}`);

      // Copy response headers
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Set status and send body
      res.status(response.status);

      const contentType = response.headers.get("content-type");
      console.log(`[Proxy] Content-Type: ${contentType}`);

      if (contentType?.includes("application/json")) {
        const json = await response.json();
        console.log(`[Proxy] Sending JSON:`, json);
        res.json(json);
      } else {
        const text = await response.text();
        console.log(`[Proxy] Sending text: ${text.substring(0, 100)}`);
        res.send(text);
      }

      console.log(`[Proxy] Response sent`);
    } catch (error) {
      console.error(`[TunnelServer] Proxy error:`, error);
      next(error);
    }
  });

  // Initialize TunnelServer with Express app and getQuote function
  console.log(`[TunnelServer] Initializing with getQuote function...`);
  const tunnelServer = await TunnelServer.initialize(app, getQuote);

  // Start listening
  tunnelServer.server.listen(TUNNEL_PORT, () => {
    console.log(`[TunnelServer] Running on http://localhost:${TUNNEL_PORT}`);
    console.log(`[TunnelServer] Proxying to Hono backend at http://localhost:${HONO_PORT}`);
  });
}

main().catch((error) => {
  console.error("[TunnelServer] Fatal error:", error);
  Deno.exit(1);
});
