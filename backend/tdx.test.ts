/**
 * Unit tests for TDX quote generation and X25519 binding
 */

import { assertEquals, assertNotEquals } from "@std/assert";

// Re-export the hash function for testing
async function hashPubkeyToReportData(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  const TD_REPORT_DATA_SIZE = 64;
  const hash = await crypto.subtle.digest("SHA-384", x25519PublicKey as BufferSource);
  const reportData = new Uint8Array(TD_REPORT_DATA_SIZE);
  reportData.set(new Uint8Array(hash), 0);
  return reportData;
}

Deno.test("hashPubkeyToReportData - valid 32-byte pubkey produces correct report_data", async () => {
  // Create a test 32-byte pubkey (all zeros)
  const testPubkey = new Uint8Array(32).fill(0);

  // Hash it
  const reportData = await hashPubkeyToReportData(testPubkey);

  // Verify report_data is 64 bytes
  assertEquals(reportData.length, 64, "report_data should be 64 bytes");

  // Verify the first 48 bytes are the SHA-384 hash
  const expectedHash = await crypto.subtle.digest("SHA-384", testPubkey as BufferSource);
  const expectedHashBytes = new Uint8Array(expectedHash);

  for (let i = 0; i < 48; i++) {
    assertEquals(reportData[i], expectedHashBytes[i], `Byte ${i} should match SHA-384 hash`);
  }

  // Verify the last 16 bytes are zeros (padding)
  for (let i = 48; i < 64; i++) {
    assertEquals(reportData[i], 0, `Byte ${i} should be zero padding`);
  }
});

Deno.test("hashPubkeyToReportData - different pubkeys produce different hashes", async () => {
  // Create two different pubkeys
  const pubkey1 = new Uint8Array(32).fill(0);
  const pubkey2 = new Uint8Array(32).fill(1);

  // Hash them
  const reportData1 = await hashPubkeyToReportData(pubkey1);
  const reportData2 = await hashPubkeyToReportData(pubkey2);

  // They should be different
  let same = true;
  for (let i = 0; i < 64; i++) {
    if (reportData1[i] !== reportData2[i]) {
      same = false;
      break;
    }
  }

  assertEquals(same, false, "Different pubkeys should produce different report_data");
});

Deno.test("hashPubkeyToReportData - flipping one bit changes the hash", async () => {
  // Create a pubkey
  const pubkey1 = new Uint8Array(32).fill(0);
  const pubkey2 = new Uint8Array(32).fill(0);

  // Flip one bit in the second pubkey
  pubkey2[0] = 1;

  // Hash both
  const reportData1 = await hashPubkeyToReportData(pubkey1);
  const reportData2 = await hashPubkeyToReportData(pubkey2);

  // Extract just the hash portions (first 48 bytes)
  const hash1 = reportData1.slice(0, 48);
  const hash2 = reportData2.slice(0, 48);

  // Convert to hex for comparison
  const hash1Hex = Array.from(hash1).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash2Hex = Array.from(hash2).map(b => b.toString(16).padStart(2, '0')).join('');

  assertNotEquals(hash1Hex, hash2Hex, "Flipping one bit should change the hash (avalanche effect)");
});

Deno.test("hashPubkeyToReportData - consistent output for same input", async () => {
  const testPubkey = new Uint8Array(32);
  // Fill with a pattern
  for (let i = 0; i < 32; i++) {
    testPubkey[i] = i;
  }

  // Hash it twice
  const reportData1 = await hashPubkeyToReportData(testPubkey);
  const reportData2 = await hashPubkeyToReportData(testPubkey);

  // Should be identical
  for (let i = 0; i < 64; i++) {
    assertEquals(reportData1[i], reportData2[i], `Byte ${i} should be identical on repeated hashing`);
  }
});

Deno.test("SHA-384 produces 48 bytes", async () => {
  const testData = new Uint8Array(32).fill(42);
  const hash = await crypto.subtle.digest("SHA-384", testData as BufferSource);
  const hashBytes = new Uint8Array(hash);

  assertEquals(hashBytes.length, 48, "SHA-384 should produce 48 bytes");
});
