import express, { type Request, type Response } from "express";
import { TunnelServer, type QuoteData, type VerifierData } from "@teekit/tunnel";
import { getQuote as getTdxQuote } from "./tdx.ts";
import { getIMALogBytes, getIMACount, displayKeyMeasurements } from "./ima.ts";
import { createHonoApp } from "./main.ts";

// @ts-ignore - Import from Deno namespace
const crypto = globalThis.crypto;

const HONO_PORT = 4000;
const TUNNEL_PORT = 3000;
const USE_REAL_TDX = Deno.env.get("USE_REAL_TDX") === "true";

// Print startup banner
console.log('');
console.log('========================================');
console.log('   RATSNEST TDX ATTESTATION SERVER');
console.log('========================================');
console.log(`TDX Mode: ${USE_REAL_TDX ? 'ENABLED (Real quotes only)' : 'DISABLED - SERVER WILL FAIL'}`);
if (!USE_REAL_TDX) {
  console.error('⚠️  WARNING: USE_REAL_TDX is not enabled. Quote generation will fail.');
  console.error('⚠️  Set USE_REAL_TDX=true to enable TDX attestation.');
}
console.log('========================================');
console.log('');

// Helper to preview quote bytes
function previewQuote(quote: Uint8Array, label: string) {
  const preview = Array.from(quote.slice(0, 100))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  console.log(`[Quote Preview] ${label}:`);
  console.log(`  ${preview}...`);
}

// Get quote function - only uses real TDX (no fallback)
async function getQuote(x25519PublicKey: Uint8Array): Promise<QuoteData> {
  console.log(`[TunnelServer] getQuote called with pubkey length: ${x25519PublicKey.length}`);

  // Debug: Log handshake details for verification
  const pubkeyHex = Array.from(x25519PublicKey).map(b => b.toString(16).padStart(2, '0')).join('');
  console.log(`[Handshake Debug] Server X25519 pubkey: ${pubkeyHex}`);

  if (!USE_REAL_TDX) {
    const error = new Error('USE_REAL_TDX is not enabled. This server requires TDX attestation.');
    console.error(`[TunnelServer] ✗ ${error.message}`);
    throw error;
  }

  // Generate verifier data (nonce + iat) for binding
  // TEE-Kit expects: report_data = SHA-512(nonce || iat || x25519_pubkey)
  const nonce = crypto.getRandomValues(new Uint8Array(32)); // 32-byte random nonce
  const iat = new Uint8Array(8); // 8-byte timestamp
  const now = BigInt(Date.now());
  new DataView(iat.buffer).setBigUint64(0, now, false); // Big-endian timestamp

  const verifierData: VerifierData = {
    val: nonce,
    iat: iat
  };

  console.log(`[TunnelServer] Generated verifier data:`);
  console.log(`  nonce: ${Array.from(nonce.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')}... (32 bytes)`);
  console.log(`  iat: ${now.toString()} (${iat.length} bytes)`);

  // Compute report_data = SHA-512(nonce || iat || x25519_pubkey)
  const combined = new Uint8Array(nonce.length + iat.length + x25519PublicKey.length);
  combined.set(nonce, 0);
  combined.set(iat, nonce.length);
  combined.set(x25519PublicKey, nonce.length + iat.length);

  const reportDataHash = await crypto.subtle.digest("SHA-512", combined);
  const reportData = new Uint8Array(reportDataHash);

  console.log(`[Handshake Debug] SHA-512(nonce || iat || pubkey):`);
  console.log(`  ${Array.from(reportData).map(b => b.toString(16).padStart(2, '0')).join('')}`);

  // Real TDX quote generation with computed report_data
  console.log(`[TunnelServer] Generating real TDX quote...`);
  const quote = await getTdxQuote(reportData);
  console.log(`[TunnelServer] ✓ Successfully generated real TDX quote (${quote.length} bytes)`);
  previewQuote(quote, "Real TDX Quote");

  // Include IMA runtime measurements in attestation
  console.log(`[TunnelServer] Reading IMA measurements...`);
  try {
    const imaLogBytes = await getIMALogBytes();
    const imaCount = await getIMACount();
    console.log(`[TunnelServer] ✓ IMA log included: ${imaCount} measurements (${imaLogBytes.length} bytes)`);

    return {
      quote,
      verifier_data: verifierData,
      runtime_data: imaLogBytes
    };
  } catch (error) {
    console.warn(`[TunnelServer] ⚠ IMA log not available: ${error}`);
    console.warn(`[TunnelServer] Continuing without IMA measurements`);
    return {
      quote,
      verifier_data: verifierData
    };
  }
}

async function main() {
  // Start Hono API server
  const honoApp = createHonoApp();
  console.log(`[Hono] Starting on http://localhost:${HONO_PORT}`);
  Deno.serve({ port: HONO_PORT }, honoApp.fetch);

  // Wait a moment for Hono to be ready
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log(`[Hono] Server ready on http://localhost:${HONO_PORT}`);

  // Create Express app for TunnelServer
  const app = express();

  // Parse JSON request bodies
  app.use(express.json());

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
  tunnelServer.server.listen(TUNNEL_PORT, async () => {
    console.log(`[TunnelServer] Running on http://localhost:${TUNNEL_PORT}`);
    console.log(`[TunnelServer] Proxying to Hono backend at http://localhost:${HONO_PORT}`);

    // Display IMA measurements for easy policy configuration
    // Wait a moment for the first quote to be generated and IMA log to be ready
    setTimeout(async () => {
      try {
        await displayKeyMeasurements();
      } catch (error) {
        console.error('[TunnelServer] Failed to display IMA measurements:', error);
      }
    }, 2000); // Wait 2 seconds for system to stabilize
  });
}

main().catch((error) => {
  console.error("[TunnelServer] Fatal error:", error);
  Deno.exit(1);
});
