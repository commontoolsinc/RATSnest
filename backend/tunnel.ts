import express from "express";
import { TunnelServer, type QuoteData } from "@teekit/tunnel";
import type { Request, Response } from "@types/express";
import { getQuote as getTdxQuote } from "./tdx.ts";
import { tappdV4Hex } from "./samples.ts";
import { createHonoApp } from "./main.ts";

const HONO_PORT = 4000;
const TUNNEL_PORT = 3000;
const USE_REAL_TDX = Deno.env.get("USE_REAL_TDX") === "true";

// Helper to convert hex to bytes
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper to preview quote bytes
function previewQuote(quote: Uint8Array, label: string) {
  const preview = Array.from(quote.slice(0, 100))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  console.log(`[Quote Preview] ${label}:`);
  console.log(`  ${preview}...`);
}

// Get quote function - uses real TDX if enabled, otherwise sample quote
async function getQuote(x25519PublicKey: Uint8Array): Promise<QuoteData> {
  console.log(`[TunnelServer] getQuote called with pubkey length: ${x25519PublicKey.length}`);

  if (USE_REAL_TDX) {
    // Phase 4: Real TDX quote generation
    try {
      const quote = await getTdxQuote(x25519PublicKey);
      console.log(`[TunnelServer] Returning real TDX quote of length: ${quote.length}`);
      previewQuote(quote, "Real TDX Quote");
      return { quote };
    } catch (err) {
      console.error(`[TunnelServer] Failed to get real TDX quote:`, err);
      console.log(`[TunnelServer] Falling back to sample quote`);
    }
  }

  // Fallback: Sample TDX v4 quote
  const sampleQuote = hexToBytes(tappdV4Hex);
  console.log(`[TunnelServer] Returning sample TDX v4 quote of length: ${sampleQuote.length}`);
  previewQuote(sampleQuote, "Sample TDX Quote");

  return {
    quote: sampleQuote,
  };
}

async function main() {
  // Start Hono API server
  const honoApp = createHonoApp();
  console.log(`[Hono] Starting on http://localhost:${HONO_PORT}`);
  Deno.serve({ port: HONO_PORT }, honoApp.fetch);

  // Create Express app for TunnelServer
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
