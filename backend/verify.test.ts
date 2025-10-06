/**
 * Positive path tests for quote verification
 */

import { assertEquals } from "@std/assert";
import { tappdV4Hex } from "./samples.ts";
import { normalizeMRTD, isMRTDAllowed, policy } from "../shared/policy.ts";

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
 * MRTD is 48 bytes located at offset 160 (48 header + 112 in body)
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

Deno.test("extractMRTD - valid TDX v4 quote returns MRTD", () => {
  const quote = hexToBytes(tappdV4Hex);

  assertEquals(quote.length, 8000, "Sample quote should be 8000 bytes");

  const mrtd = extractMRTD(quote);

  // MRTD should be 48 bytes = 96 hex chars + 0x prefix
  assertEquals(mrtd.length, 98, "MRTD hex string should be 98 chars (0x + 96 hex)");
  assertEquals(mrtd.startsWith('0x'), true, "MRTD should start with 0x");
});

Deno.test("normalizeMRTD - removes 0x prefix and lowercases", () => {
  const mrtd1 = "0xAABBCC";
  const mrtd2 = "0xaabbcc";
  const mrtd3 = "aabbcc";
  const mrtd4 = "AABBCC";

  const normalized1 = normalizeMRTD(mrtd1);
  const normalized2 = normalizeMRTD(mrtd2);
  const normalized3 = normalizeMRTD(mrtd3);
  const normalized4 = normalizeMRTD(mrtd4);

  assertEquals(normalized1, "aabbcc");
  assertEquals(normalized2, "aabbcc");
  assertEquals(normalized3, "aabbcc");
  assertEquals(normalized4, "aabbcc");
});

Deno.test("isMRTDAllowed - matches allowed MRTD regardless of casing/prefix", () => {
  // Get real MRTD from sample quote
  const quote = hexToBytes(tappdV4Hex);
  const mrtd = extractMRTD(quote);

  // The sample quote's MRTD (from policy.ts)
  const sampleMrtd = "0x00000000000000000000001000000000e702060000000000c68518a0ebb42136c12b2275164f8c72f25fa9a343922286";

  // Test with different formats
  assertEquals(isMRTDAllowed(sampleMrtd), true, "Should match with 0x prefix");
  assertEquals(isMRTDAllowed(sampleMrtd.replace('0x', '')), true, "Should match without 0x prefix");
  assertEquals(isMRTDAllowed(sampleMrtd.toUpperCase()), true, "Should match uppercase");
  assertEquals(isMRTDAllowed(sampleMrtd.toLowerCase()), true, "Should match lowercase");
});

Deno.test("isMRTDAllowed - rejects MRTD not in policy", () => {
  const fakeMrtd = "0x" + "ff".repeat(48); // 48 bytes of 0xFF

  assertEquals(isMRTDAllowed(fakeMrtd), false, "Should reject MRTD not in policy");
});

Deno.test("quote verification - valid quote structure", () => {
  const quote = hexToBytes(tappdV4Hex);

  // Check quote header (version should be 0x04 for v4)
  const version = quote.slice(0, 2);
  assertEquals(version[0], 0x04, "Quote version should be 4");
  assertEquals(version[1], 0x00, "Quote version byte 2 should be 0");

  // Check attestation key type (0x02 for ECDSA-256-with-P-256)
  const attestKeyType = quote.slice(2, 4);
  assertEquals(attestKeyType[0], 0x00, "Attestation key type byte 1");
  assertEquals(attestKeyType[1], 0x02, "Attestation key type should be 2 (ECDSA)");
});

Deno.test("quote verification - MRTD extraction is consistent", () => {
  const quote = hexToBytes(tappdV4Hex);

  const mrtd1 = extractMRTD(quote);
  const mrtd2 = extractMRTD(quote);

  assertEquals(mrtd1, mrtd2, "MRTD extraction should be deterministic");
});
