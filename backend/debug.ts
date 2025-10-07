/**
 * Debug endpoints for verifying cryptographic operations
 *
 * These endpoints expose internal handshake details for verification.
 * DO NOT expose these in production!
 */

import { Hono } from "hono";

const TD_REPORT_DATA_SIZE = 64;

/**
 * Compute report_data using TEE-Kit's binding format
 * report_data = SHA-512(nonce || iat || x25519_pubkey)
 */
export async function computeReportData(
  nonce: Uint8Array,
  iat: Uint8Array,
  x25519PublicKey: Uint8Array
): Promise<Uint8Array> {
  // Concatenate: nonce (32 bytes) || iat (8 bytes) || pubkey (32 bytes) = 72 bytes
  const combined = new Uint8Array(nonce.length + iat.length + x25519PublicKey.length);
  combined.set(nonce, 0);
  combined.set(iat, nonce.length);
  combined.set(x25519PublicKey, nonce.length + iat.length);

  // SHA-512 produces 64 bytes - perfect for report_data
  const hash = await crypto.subtle.digest("SHA-512", combined);
  return new Uint8Array(hash);
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Parse hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export function createDebugRoutes() {
  const app = new Hono();

  /**
   * Debug endpoint: Show handshake byte details
   *
   * POST /debug/handshake-bytes
   * Body: {
   *   "pubkey": "hex string of 32-byte x25519 public key",
   *   "nonce": "hex string of 32-byte nonce (optional, will generate if missing)",
   *   "iat": "hex string of 8-byte timestamp (optional, will generate if missing)"
   * }
   *
   * Returns:
   * - nonce: The verifier nonce (32 bytes, hex)
   * - iat: The issued-at timestamp (8 bytes, hex)
   * - server_pubkey: The input public key (32 bytes, hex)
   * - combined_input: nonce || iat || pubkey (72 bytes, hex)
   * - sha512_digest: SHA-512 hash of combined input (64 bytes, hex)
   * - report_data: Same as sha512_digest (64 bytes, hex)
   */
  app.post('/handshake-bytes', async (c) => {
    try {
      const body = await c.req.json();
      const pubkeyHex = body.pubkey;

      if (!pubkeyHex) {
        return c.json({ error: 'Missing pubkey in request body' }, 400);
      }

      // Parse pubkey from hex
      const pubkey = hexToBytes(pubkeyHex);

      if (pubkey.length !== 32) {
        return c.json({ error: `Invalid pubkey length: ${pubkey.length}, expected 32 bytes` }, 400);
      }

      // Generate or parse nonce
      let nonce: Uint8Array;
      if (body.nonce) {
        nonce = hexToBytes(body.nonce);
        if (nonce.length !== 32) {
          return c.json({ error: `Invalid nonce length: ${nonce.length}, expected 32 bytes` }, 400);
        }
      } else {
        // Generate random nonce for demo
        nonce = crypto.getRandomValues(new Uint8Array(32));
      }

      // Generate or parse iat (issued-at timestamp)
      let iat: Uint8Array;
      if (body.iat) {
        iat = hexToBytes(body.iat);
        if (iat.length !== 8) {
          return c.json({ error: `Invalid iat length: ${iat.length}, expected 8 bytes` }, 400);
        }
      } else {
        // Generate current timestamp for demo
        iat = new Uint8Array(8);
        const now = BigInt(Date.now());
        new DataView(iat.buffer).setBigUint64(0, now, false); // Big-endian
      }

      // Compute report_data = SHA-512(nonce || iat || pubkey)
      const reportData = await computeReportData(nonce, iat, pubkey);

      // Create combined input for display
      const combined = new Uint8Array(nonce.length + iat.length + pubkey.length);
      combined.set(nonce, 0);
      combined.set(iat, nonce.length);
      combined.set(pubkey, nonce.length + iat.length);

      // Return all the intermediate values
      return c.json({
        nonce: bytesToHex(nonce),
        iat: bytesToHex(iat),
        server_pubkey: bytesToHex(pubkey),
        combined_input: bytesToHex(combined),
        sha512_digest: bytesToHex(reportData),
        report_data: bytesToHex(reportData),
        sizes: {
          nonce_bytes: nonce.length,
          iat_bytes: iat.length,
          pubkey_bytes: pubkey.length,
          combined_bytes: combined.length,
          sha512_bytes: reportData.length,
          report_data_bytes: reportData.length
        }
      });
    } catch (err) {
      console.error('[Debug] Error processing handshake-bytes:', err);
      return c.json({ error: String(err) }, 500);
    }
  });

  /**
   * Simple test endpoint to verify debug routes are working
   */
  app.get('/ping', (c) => {
    return c.json({
      message: 'Debug routes active',
      warning: 'DO NOT expose these endpoints in production!'
    });
  });

  /**
   * IMA measurement log endpoint
   *
   * Returns the IMA runtime measurement log which contains hashes of all
   * files that were executed or accessed during runtime.
   *
   * GET /debug/ima-log
   *
   * Returns:
   * - available: boolean indicating if IMA is available
   * - entries: number of log entries
   * - log: full IMA ascii runtime measurements (if available)
   */
  app.get('/ima-log', async (c) => {
    try {
      const imaPath = '/sys/kernel/security/ima/ascii_runtime_measurements';
      const imaLog = await Deno.readTextFile(imaPath);
      const entries = imaLog.split('\n').filter(line => line.length > 0);

      return c.json({
        available: true,
        entries: entries.length,
        log: imaLog,
        path: imaPath
      });
    } catch (err) {
      return c.json({
        available: false,
        error: 'IMA not available or not accessible',
        details: String(err),
        hint: 'Check kernel cmdline has ima_policy=tcb ima_hash=sha256'
      }, 500);
    }
  });

  /**
   * IMA log summary - just counts and sample entries
   *
   * GET /debug/ima-summary
   */
  app.get('/ima-summary', async (c) => {
    try {
      const imaPath = '/sys/kernel/security/ima/ascii_runtime_measurements';
      const imaLog = await Deno.readTextFile(imaPath);
      const entries = imaLog.split('\n').filter(line => line.length > 0);

      // Parse a few sample entries
      const samples = entries.slice(0, 10).map(line => {
        const parts = line.split(' ');
        return {
          pcr: parts[0],
          template_hash: parts[1],
          template: parts[2],
          file_hash: parts[3],
          filename: parts[4]
        };
      });

      // Find ratsnest binary
      const ratsnestEntry = entries.find(line => line.includes('/usr/bin/ratsnest'));
      let ratsnestHash = null;
      if (ratsnestEntry) {
        const parts = ratsnestEntry.split(' ');
        ratsnestHash = parts[3]; // file_hash field
      }

      return c.json({
        available: true,
        total_entries: entries.length,
        sample_entries: samples,
        ratsnest_binary: {
          found: !!ratsnestEntry,
          hash: ratsnestHash,
          full_entry: ratsnestEntry
        }
      });
    } catch (err) {
      return c.json({
        available: false,
        error: 'IMA not available',
        details: String(err)
      }, 500);
    }
  });

  return app;
}
