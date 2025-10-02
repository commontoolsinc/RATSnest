import express from "express";
import { TunnelServer } from "@teekit/tunnel";
import type { Request, Response } from "@types/express";
import type { QuoteData } from "@teekit/tunnel";

const HONO_PORT = 4000;
const TUNNEL_PORT = 3000;

// Stub getQuote function - returns mock attestation data for now
async function getQuote(x25519PublicKey: Uint8Array): Promise<QuoteData> {
  console.log(`[TunnelServer] getQuote called with pubkey length: ${x25519PublicKey.length}`);

  // Mock quote - in Phase 4 this will be replaced with real TDX quote generation
  const mockQuote = new Uint8Array(64);
  mockQuote.fill(0x42); // Fill with placeholder bytes

  // In a real implementation, this would:
  // 1. Hash the x25519PublicKey with SHA-384
  // 2. Bind it to report_data
  // 3. Call TDX guest device to generate quote
  // 4. Return the actual quote bytes

  console.log(`[TunnelServer] Returning mock quote of length: ${mockQuote.length}`);

  return {
    quote: mockQuote,
  };
}

async function main() {
  const app = express();

  // Proxy all requests to the Hono backend
  app.use(async (req: Request, res: Response, next) => {
    console.log(`[Proxy] ${req.method} ${req.url}`);
    try {
      const url = `http://localhost:${HONO_PORT}${req.url}`;
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
