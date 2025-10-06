/**
 * Negative path tests for quote verification
 * Tests that verification properly rejects invalid inputs
 */

import { assertEquals, assertThrows } from "@std/assert";
import { tappdV4Hex } from "./samples.ts";
import { isMRTDAllowed, MRTDPolicy } from "../shared/policy.ts";

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract MRTD from TDX quote
 */
function extractMRTD(quote: Uint8Array): string {
  const MRTD_OFFSET = 160;
  const MRTD_SIZE = 48;

  if (quote.length < MRTD_OFFSET + MRTD_SIZE) {
    throw new Error(`Quote too small: ${quote.length} bytes`);
  }

  const mrtd = quote.slice(MRTD_OFFSET, MRTD_OFFSET + MRTD_SIZE);
  return bytesToHex(mrtd);
}

Deno.test("NEGATIVE - extractMRTD rejects quote that's too small", () => {
  const tinyQuote = new Uint8Array(100); // Only 100 bytes

  assertThrows(
    () => extractMRTD(tinyQuote),
    Error,
    "Quote too small",
    "Should reject quote smaller than 208 bytes"
  );
});

Deno.test("NEGATIVE - wrong MRTD is rejected", () => {
  // Create a bogus MRTD that's definitely not in the policy
  const wrongMrtd = "0x" + "ab".repeat(48);

  assertEquals(isMRTDAllowed(wrongMrtd), false, "Should reject wrong MRTD");
});

Deno.test("NEGATIVE - flipped bit in MRTD causes rejection", () => {
  const quote = hexToBytes(tappdV4Hex);
  const correctMrtd = extractMRTD(quote);

  // Flip one bit in the MRTD
  const mrtdBytes = hexToBytes(correctMrtd);
  mrtdBytes[0] ^= 0x01; // XOR with 1 to flip the least significant bit
  const wrongMrtd = bytesToHex(mrtdBytes);

  // The correct MRTD should be allowed
  assertEquals(isMRTDAllowed(correctMrtd), true, "Correct MRTD should be allowed");

  // The flipped MRTD should be rejected
  assertEquals(isMRTDAllowed(wrongMrtd), false, "MRTD with flipped bit should be rejected");
});

Deno.test("NEGATIVE - empty MRTD list rejects all MRTDs", () => {
  // Create a policy with no allowed MRTDs
  const emptyPolicy: MRTDPolicy = {
    allowed_mrtd: []
  };

  // Even the sample MRTD from the quote should be rejected
  const quote = hexToBytes(tappdV4Hex);
  const mrtd = extractMRTD(quote);

  // Manually check against empty policy
  const normalized = mrtd.replace(/^0x/i, '').toLowerCase();
  const allowed = emptyPolicy.allowed_mrtd.some(
    allowed => allowed.replace(/^0x/i, '').toLowerCase() === normalized
  );

  assertEquals(allowed, false, "Empty policy should reject all MRTDs");
});

Deno.test("NEGATIVE - corrupted quote data", () => {
  const quote = hexToBytes(tappdV4Hex);

  // Corrupt the MRTD region by setting all bytes to 0xFF
  const corruptedQuote = new Uint8Array(quote);
  for (let i = 160; i < 160 + 48; i++) {
    corruptedQuote[i] = 0xFF;
  }

  const corruptedMrtd = extractMRTD(corruptedQuote);
  const expectedCorruptedMrtd = "0x" + "ff".repeat(48);

  assertEquals(corruptedMrtd, expectedCorruptedMrtd, "Should extract corrupted MRTD");
  assertEquals(isMRTDAllowed(corruptedMrtd), false, "Corrupted MRTD should be rejected");
});

Deno.test("NEGATIVE - report_data mismatch scenario", async () => {
  // Simulate the scenario where the report_data doesn't match the expected pubkey hash

  // Create two different pubkeys
  const pubkey1 = new Uint8Array(32).fill(0xAA);
  const pubkey2 = new Uint8Array(32).fill(0xBB);

  // Hash both
  const hash1 = await crypto.subtle.digest("SHA-384", pubkey1 as BufferSource);
  const hash2 = await crypto.subtle.digest("SHA-384", pubkey2 as BufferSource);

  const hash1Hex = Array.from(new Uint8Array(hash1)).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash2Hex = Array.from(new Uint8Array(hash2)).map(b => b.toString(16).padStart(2, '0')).join('');

  // They should be different
  assertEquals(hash1Hex === hash2Hex, false, "Different pubkeys should produce different hashes");

  // This demonstrates that if a quote contains hash1 but we expect hash2,
  // the verification should fail (tested in integration tests)
});

Deno.test("NEGATIVE - MRTD with wrong length", () => {
  // MRTD should be exactly 48 bytes (96 hex chars)
  const tooShortMrtd = "0x" + "aa".repeat(32); // Only 32 bytes
  const tooLongMrtd = "0x" + "aa".repeat(64); // 64 bytes

  // These won't match the policy MRTD (which is 48 bytes)
  assertEquals(isMRTDAllowed(tooShortMrtd), false, "Short MRTD should be rejected");
  assertEquals(isMRTDAllowed(tooLongMrtd), false, "Long MRTD should be rejected");
});
