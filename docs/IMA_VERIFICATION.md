# IMA Verification Guide

This document explains how to verify IMA (Integrity Measurement Architecture) logs in the ratsnest attestation flow.

## Overview

Ratsnest now includes IMA runtime measurements alongside TDX quotes in the attestation response. This provides:

- **TDX Quote (MRTD + RTMRs)**: Verifies the boot-time measurements (firmware, kernel, initrd)
- **IMA Log**: Verifies runtime measurements (systemd, ratsnest binary, loaded libraries)

## Attestation Flow

### 1. Client Initiates Handshake

The TEE-Kit tunnel client sends an X25519 public key to establish an encrypted channel.

### 2. Server Responds with Quote + IMA Log

The server returns a `QuoteData` object containing:

```typescript
{
  quote: Uint8Array,           // TDX quote (8000 bytes)
  runtime_data: Uint8Array     // IMA log (ASCII format)
}
```

The `runtime_data` field contains the complete IMA measurement log from `/sys/kernel/security/ima/ascii_runtime_measurements`.

### 3. Client Verification Process

The verifier must check BOTH the TDX quote AND the IMA log:

#### Step 1: Verify TDX Quote

```typescript
// Standard TDX quote verification
const quote = response.quote;

// Extract and verify MRTD (infrastructure measurement)
const mrtd = extractMRTD(quote);
if (!policy.allowed_mrtd.includes(mrtd)) {
  throw new Error(`MRTD mismatch: got ${mrtd}`);
}

// Extract and verify RTMRs (boot measurements)
const rtmrs = extractRTMRs(quote);
if (!policy.allowed_rtmr1.includes(rtmrs.rtmr1)) {
  throw new Error(`RTMR1 mismatch: got ${rtmrs.rtmr1}`);
}
```

#### Step 2: Parse IMA Log

```typescript
const imaLog = new TextDecoder().decode(response.runtime_data);
const entries = parseIMALog(imaLog);

// IMA log format (one entry per line):
// <PCR> <template-hash> <template-name> <file-hash> <file-path>
// Example:
// 10 bb24b135e1c911c97aad8f1c1863efc08cd44c11 ima-ng sha256:d41dd4adacf5a35df426461dd8a92d7bdd5ba29bb61a1c3531bec0ada386f8dd /usr/lib/x86_64-linux-gnu/libresolv.so.2
```

#### Step 3: Verify Critical Executables

```typescript
const EXPECTED_MEASUREMENTS = {
  "/usr/bin/ratsnest": "ba3a9333351d4b03929523c88515d8057b216f582fe87c903de30def892de953",
  "/usr/lib/systemd/systemd-executor": "a0e08eb8f3e086b6d28b66369db05b45915e9bb8584859a282168b1cc44ef78d",
  // Add more critical binaries as needed
};

for (const [filePath, expectedHash] of Object.entries(EXPECTED_MEASUREMENTS)) {
  const entry = entries.find(e => e.filePath === filePath);

  if (!entry) {
    throw new Error(`Missing IMA measurement for ${filePath}`);
  }

  // Extract hash from "sha256:HASH" format
  const actualHash = entry.fileHash.split(':')[1];

  if (actualHash !== expectedHash) {
    throw new Error(`Hash mismatch for ${filePath}: expected ${expectedHash}, got ${actualHash}`);
  }
}
```

#### Step 4: Verify Log Integrity (Optional)

For stronger security, verify the IMA log integrity chain:

```typescript
// Each entry extends PCR 10 with: hash(PCR10 || template-hash)
// This creates a hash chain proving log integrity
let pcr10 = new Uint8Array(48); // SHA-384, starts at zero

for (const entry of entries) {
  // Extend PCR 10
  const newValue = sha384(concat(pcr10, hexToBytes(entry.templateHash)));
  pcr10 = newValue;
}

// Final PCR 10 value proves the log hasn't been tampered with
// (In TDX, IMA doesn't extend RTMRs yet, so this is informational only)
```

## API Endpoints

Ratsnest provides HTTP endpoints for IMA verification:

### `GET /api/ima/log`

Returns the complete IMA log (plain text).

```bash
curl http://35.227.182.70:3000/api/ima/log
```

### `GET /api/ima/count`

Returns the number of IMA measurements.

```bash
curl http://35.227.182.70:3000/api/ima/count
# {"count": 3210}
```

### `GET /api/ima/metadata`

Returns IMA metadata with sample entries.

```bash
curl http://35.227.182.70:3000/api/ima/metadata
```

### `GET /api/ima/search?path=<filepath>`

Search for specific file measurements.

```bash
curl "http://35.227.182.70:3000/api/ima/search?path=ratsnest"
```

## Example: Custom Verifier Implementation

```typescript
import { TunnelClient } from "@teekit/tunnel";

interface IMAEntry {
  pcr: number;
  templateHash: string;
  templateName: string;
  fileHash: string;
  filePath: string;
}

function parseIMALog(log: string): IMAEntry[] {
  return log.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split(/\s+/);
      return {
        pcr: parseInt(parts[0]),
        templateHash: parts[1],
        templateName: parts[2],
        fileHash: parts[3],
        filePath: parts.slice(4).join(' ')
      };
    });
}

// Custom verifier for ratsnest
const customVerifier = {
  async verify(response: { quote: Uint8Array, runtime_data?: Uint8Array }) {
    // 1. Verify TDX quote
    const mrtd = extractMRTD(response.quote);
    const rtmrs = extractRTMRs(response.quote);

    if (mrtd !== EXPECTED_MRTD) {
      throw new Error(`MRTD verification failed`);
    }

    // 2. Verify IMA log
    if (!response.runtime_data) {
      throw new Error(`No IMA log provided`);
    }

    const imaLog = new TextDecoder().decode(response.runtime_data);
    const entries = parseIMALog(imaLog);

    // 3. Check for ratsnest binary
    const ratsnestEntry = entries.find(e => e.filePath === '/usr/bin/ratsnest');
    if (!ratsnestEntry) {
      throw new Error(`Ratsnest binary not measured by IMA`);
    }

    const ratsnestHash = ratsnestEntry.fileHash.split(':')[1];
    console.log(`✓ Ratsnest measured: ${ratsnestHash}`);

    // 4. Verify hash matches expected value
    if (ratsnestHash !== EXPECTED_RATSNEST_HASH) {
      throw new Error(`Ratsnest hash mismatch`);
    }

    console.log(`✓ IMA verification successful: ${entries.length} measurements`);
  }
};

// Use with TunnelClient
const client = new TunnelClient("https://35.227.182.70:3000", {
  verifier: customVerifier
});
```

## Security Considerations

### What IMA Provides

✅ **Runtime integrity**: Proves which executables were loaded
✅ **Tamper detection**: Any modification to executables changes the hash
✅ **Audit trail**: Complete log of what was executed

### What IMA Does NOT Provide (in current TDX setup)

❌ **RTMR extension**: IMA measurements are NOT extended into TDX RTMRs (kernel limitation)
❌ **Cryptographic binding**: IMA log is not cryptographically bound to the TDX quote
❌ **Freshness guarantee**: Log could be replayed from an earlier boot

### Mitigation

The TDX quote's report_data contains `SHA-384(client_pubkey)`, which provides:
- **Freshness**: Quote is bound to this specific handshake session
- **Binding**: Client can verify the quote was generated for this connection

The IMA log verifies what's running, while the quote proves freshness and binding.

## Future Improvements

When Linux kernel supports IMA→RTMR extension:
1. IMA will extend measurements into RTMR2
2. RTMR2 will be included in the TDX quote
3. No need for separate `runtime_data` field
4. Cryptographic binding between IMA and TDX quote

Until then, the current approach provides defense-in-depth:
- TDX quote verifies the base system (MRTD, RTMR0, RTMR1)
- IMA log verifies the runtime state (ratsnest, systemd, libraries)

## Testing Your Verifier

1. Test with correct measurements (should pass)
2. Modify ratsnest binary on the VM (should fail)
3. Test with different MRTD (should fail)
4. Test without IMA log in response (should fail)

## References

- [Intel TDX Runtime Integrity Measurement](https://www.intel.com/content/www/us/en/developer/articles/community/runtime-integrity-measure-and-attest-trust-domain.html)
- [Linux IMA Documentation](https://sourceforge.net/p/linux-ima/wiki/Home/)
- [TEE-Kit Tunnel Protocol](https://github.com/teekit/tunnel)
