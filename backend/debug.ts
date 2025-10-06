/**
 * Debug endpoints for verifying cryptographic operations
 *
 * These endpoints expose internal handshake details for verification.
 * DO NOT expose these in production!
 */

import { Hono } from "hono";

const TD_REPORT_DATA_SIZE = 64;

/**
 * Hash x25519 public key with SHA-384 and pad to 64 bytes for report_data
 * (Exported version of internal function for debugging)
 */
export async function hashPubkeyToReportData(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  // SHA-384 produces 48 bytes, we pad with zeros to 64 bytes
  const hash = await crypto.subtle.digest("SHA-384", x25519PublicKey as BufferSource);
  const reportData = new Uint8Array(TD_REPORT_DATA_SIZE);
  reportData.set(new Uint8Array(hash), 0);
  return reportData;
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
   * Body: { "pubkey": "hex string of 32-byte x25519 public key" }
   *
   * Returns:
   * - server_pubkey: The input public key (32 bytes, hex)
   * - hash_input: Same as server_pubkey, the bytes being hashed (32 bytes, hex)
   * - sha384_digest: SHA-384 hash of the pubkey (48 bytes, hex)
   * - report_data: Final report_data value (64 bytes: 48 hash + 16 zeros, hex)
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

      // Compute SHA-384 hash
      const sha384 = await crypto.subtle.digest("SHA-384", pubkey as BufferSource);
      const sha384Bytes = new Uint8Array(sha384);

      // Create report_data (48 bytes hash + 16 bytes padding)
      const reportData = await hashPubkeyToReportData(pubkey);

      // Return all the intermediate values
      return c.json({
        server_pubkey: bytesToHex(pubkey),
        hash_input: bytesToHex(pubkey),
        sha384_digest: bytesToHex(sha384Bytes),
        report_data: bytesToHex(reportData),
        sizes: {
          pubkey_bytes: pubkey.length,
          sha384_bytes: sha384Bytes.length,
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

  return app;
}
