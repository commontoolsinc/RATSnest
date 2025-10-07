# TDX MRTD Troubleshooting Guide

## Executive Summary

**Status**: TDX attestation is **working correctly**, but MRTD does **NOT vary** with code changes.

**Key Finding**: The MRTD value `0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c` appears to be determined by GCP's TDX VM configuration (machine type, memory, TD attributes) rather than the UKI/initrd contents.

## Current Situation (2025-10-06)

### ✅ What's Working

1. **TDX Quote Generation** - Real 8000-byte TDX v4 quotes generated via ConfigFS-TSM
2. **SSH Access** - Successfully added to image for debugging
3. **MRTD Extraction** - Correct offset (184) deployed and working
4. **No Silent Fallbacks** - Removed sample quote fallback; server fails if TDX unavailable
5. **Binary Deployment** - Binary changes reflected in deployed VMs
6. **PCR Measurements** - UKI/initrd changes correctly reflected in PCR 4, 9, 11

### ❌ What's NOT Working

**MRTD does not change between builds despite:**
- Different binary SHA256
- Different PCR measurements (PCR 4, 9, 11)
- Different initrd contents
- VM replacement (not reusing old instances)

## Comprehensive Test Results

### Test 1: Initial Deployment (VM 34.82.154.183)

**Setup:**
- Clean build with SSH support added
- VM deployed with `REPLACE_VM=true`

**Results:**
```
Binary SHA256:  6e1a1c31ff5685353be6acfdd8d22b87cc3b260accc23bf2a545266a5fe688ab
MRTD:           0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c
TDX Quote:      8000 bytes (real TDX v4 format)
PCR 4:          a0bfb238b8308359c95bf32f9bb68e506f64769774a07da1e2ca7de265978c5b
PCR 9:          484a0a167a706920eff3860154f0ec814bcb59696614e9cac4973c75f973b8c9
PCR 11:         f394ea96a034e284aa076db32813951bb3f7ca2597666feefc8a0869d584514b
```

**Verification:**
- ✅ TDX available: `/sys/kernel/config/tsm/report` exists
- ✅ Service running: `systemctl status ratsnest` shows active
- ✅ Real quotes: Logs show `[TDX] Got TDX Quote: 8000 bytes`
- ✅ Binary integrity: SHA256 matches between build and VM

### Test 2: Modified Build (VM 35.185.234.52)

**Setup:**
- Modified `backend/main.ts` to add log message
- Rebuilt and deployed with `REPLACE_VM=true`

**Results:**
```
Binary SHA256:  e0c540bfcc470334bdec5bf68371309bfe8e97c594bc499ffdb3333888011484
MRTD:           0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c (SAME!)
TDX Quote:      8000 bytes (real TDX v4 format)
PCR 4:          f641a2928cf20eb2259e11108a9dd377459f308e5fc99c856ea1764a1caf3a42 (DIFFERENT!)
PCR 9:          7ea0842ba3f2025ce7c365a771d36121ac296dfdb0d063fd1a97aeb8113c072c (DIFFERENT!)
PCR 11:         c1d32dcfe47742daa2f50dc09fea5721d8816c727cfc510cb25eece7662c2f45 (DIFFERENT!)
```

**Verification:**
- ✅ Binary changed: SHA256 is different
- ✅ Code change deployed: Log message `[Build] Test modification v2` appears
- ✅ UKI changed: All PCRs are different
- ❌ **MRTD unchanged**: Still same value

### Summary of Changes vs MRTD

| Metric | Test 1 → Test 2 | MRTD Changed? |
|--------|------------------|---------------|
| Binary SHA256 | Changed ✓ | ❌ No |
| PCR 4 (UKI) | Changed ✓ | ❌ No |
| PCR 9 (initrd) | Changed ✓ | ❌ No |
| PCR 11 (sections) | Changed ✓ | ❌ No |
| VM Instance | Replaced ✓ | ❌ No |
| TDX Quote | Real (8000B) ✓ | ❌ No |

## What MRTD Actually Measures

### Intel TDX Specification

According to Intel TDX specs, MRTD (mr_td) is a runtime measurement that includes:

```
MRTD = Hash(TDVF + Initial_TD_Memory + TD_Configuration)
```

Components:
- **TDVF (TDX Virtual Firmware)**: Provided by cloud provider (GCP), not in your image
- **Initial_TD_Memory**: Initial TD memory pages loaded by VMM
- **TD_Configuration**: CPUID leaves, number of VCPUs, TD attributes

### GCP TDX Implementation

**Hypothesis**: GCP's TDX implementation may compute MRTD primarily from:
1. **Machine type** (c3-standard-4)
2. **TD configuration** (CPU count, memory, attributes)
3. **TDVF version** (GCP-controlled firmware)

The UKI/initrd contents may **not be included** in MRTD calculation on GCP's implementation, or they may be measured elsewhere (e.g., in RTMRs).

### Alternative Measurement Registers

TDX provides multiple measurement registers:
- **MRTD** (mr_td): Initial TD measurement - **not varying with code**
- **RTMR0-3**: Runtime Measurement Registers - may include boot measurements
- **mr_config_id, mr_owner**: Additional measurement fields

**Next Step**: Check if code changes are reflected in RTMRs instead of MRTD.

## Architectural Implications

### Current Understanding

The MRTD `0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c` represents:

1. ✅ **GCP's TDX infrastructure** - Validates you're running on real GCP TDX hardware
2. ✅ **c3-standard-4 machine type** - Ensures correct CPU/memory configuration
3. ❌ **NOT your code** - Does not uniquely identify your application binary

### Security Implications

**Good News:**
- TDX attestation is working
- Quotes prove VM is running in TDX enclave
- Quote binding to X25519 key is working

**Limitation:**
- Cannot use MRTD alone to verify specific application version
- Need to combine with other measurements (RTMRs, signatures, etc.)

### Recommended Approach

1. **Use MRTD for infrastructure validation**: Verify running on correct GCP TDX machine type
2. **Use RTMRs for application validation**: Check if RTMRs include UKI/initrd measurements
3. **Add application signatures**: Sign your binary and verify signature in addition to MRTD
4. **Accept current MRTD**: Use the fixed value as "GCP c3-standard-4 TDX VM" identifier

## Implementation Details

### Changes Made

1. **SSH Access Added** (`image/ratsnest/ratsnest.conf`, `mkosi.postinst`, `deploy-gcp.sh`)
   - Added `openssh-server` package
   - Configured SSH keys in image
   - Added firewall rule for port 22

2. **Removed Silent Fallback** (`backend/tunnel.ts`)
   - Deleted sample quote fallback logic
   - Server now fails loudly if TDX unavailable
   - Removed `tappdV4Hex` import and `hexToBytes` helper

3. **MRTD Extraction Fixed** (`backend/tdx.ts:77`)
   - Changed offset from 160 → 184
   - Now extracts correct MRTD from quote body

### TDX Quote v4 Structure (Verified)

```
Offset 0:   Header (48 bytes)
Offset 48:  tee_tcb_svn (16 bytes)
Offset 64:  mr_seam (48 bytes)
Offset 112: mr_seam_signer (48 bytes)
Offset 160: seam_svn (4 bytes)
Offset 164: reserved0 (4 bytes)
Offset 168: td_attributes (8 bytes)
Offset 176: xfam (8 bytes)
Offset 184: mr_td / MRTD (48 bytes) ← CORRECT OFFSET ✓
Offset 232: mr_config_id (48 bytes)
Offset 280: mr_owner (48 bytes)
Offset 328: mr_owner_config (48 bytes)
Offset 376: rtmr0 (48 bytes)
Offset 424: rtmr1 (48 bytes)
Offset 472: rtmr2 (48 bytes)
Offset 520: rtmr3 (48 bytes)
Offset 568: report_data (64 bytes)
```

## SSH Diagnostics Commands

Now that SSH is enabled, you can run these commands on the VM:

```bash
# SSH into VM (replace IP with current VM)
ssh root@<VM_IP>

# Check TDX availability
ls -la /sys/kernel/config/tsm/report

# View service status
systemctl status ratsnest

# View logs
journalctl -u ratsnest -n 100 --no-pager

# Check binary
sha256sum /usr/bin/ratsnest
ls -lh /usr/bin/ratsnest

# Manual TDX quote generation
cd /sys/kernel/config/tsm/report
mkdir test_report
printf '%064d' 0 | xxd -r -p > test_report/inblob
hexdump -C test_report/outblob | head -20
cat test_report/provider  # Should show "tdx_guest"
wc -c test_report/outblob  # Should be ~8000 bytes
rmdir test_report
```

## Console Access Commands

```bash
# View latest logs (last 100 lines)
make logs

# Auto-refresh logs every 2 seconds
make watch-logs

# Extract MRTD from console
make extract-mrtd

# Full console output
make console-output

# Manual extraction
gcloud compute instances get-serial-port-output ratsnest-vm \
  --zone=us-west1-a | grep -A 5 "TDX ATTESTATION - MRTD VALUE"
```

## Testing Matrix (Updated)

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| TDX available | `/sys/kernel/config/tsm/report` exists | ✓ Exists | ✅ |
| Quote generation | 8000 byte quote | ✓ 8000 bytes | ✅ |
| Quote format | TDX v4 (`04 00 02 00 81...`) | ✓ Correct | ✅ |
| MRTD extraction (server) | Offset 184 | ✓ Offset 184 | ✅ |
| MRTD extraction (client) | Correct from `@teekit/qvl` | ✓ Correct | ✅ |
| MRTD uniqueness | Different per image build | ✗ Always same | ❌ |
| PCR measurements change | Different per build | ✓ Different | ✅ |
| Binary embedded in image | SHA256 matches | ✓ Matches | ✅ |
| SSH access | Can SSH into VM | ✓ Working | ✅ |
| No silent fallback | Fails if TDX unavailable | ✓ Fails loudly | ✅ |
| Binary changes deployed | SHA256 different on VM | ✓ Different | ✅ |

## Solution: Use RTMRs for Code Verification

### Implementation (2025-10-06)

**The Fix**: RTMRs (Runtime Measurement Registers) contain boot measurements and DO vary with code changes.

**Architecture:**
```
TDX Boot Flow:
1. GCP VMM creates TDX VM
2. TDX Module measures TDVF + config → MRTD sealed (fixed per machine type)
3. TDVF loads UKI (your ratsnest image)
4. systemd-stub measures kernel → extends RTMR1/2
5. systemd-stub measures initrd → extends RTMR1/2
6. systemd-stub measures cmdline → extends RTMR1/2
7. Final RTMRs contain application-specific measurements
```

**Code Changes:**

1. **Backend (backend/tdx.ts)**: Added `extractRTMRs()` function
   - Extracts rtmr0-3 from quote at offsets 376, 424, 472, 520
   - Logs all RTMRs alongside MRTD for policy configuration

2. **Shared (shared/policy.ts)**: Extended `MRTDPolicy` interface
   - Added `allowed_rtmr1`, `allowed_rtmr2`, `allowed_rtmr3` fields
   - Added `verifyMeasurements()` for combined MRTD + RTMR verification

3. **Frontend (frontend/App.tsx)**: Updated quote verification
   - Extracts RTMRs from `quote.body.rtmr0` through `quote.body.rtmr3`
   - Calls `verifyMeasurements()` to check MRTD + RTMRs together

**Verification Strategy:**
- **MRTD**: Validates infrastructure (GCP c3-standard-4 TDX VM)
- **RTMRs**: Validates specific application code version
- **Combined**: Complete trust chain from hardware to application

## Next Steps

### Testing

1. **Deploy and Extract RTMRs** - Deploy current code and extract RTMR values from logs
2. **Compare Builds** - Deploy with code change and verify RTMRs change
3. **Identify Key RTMR** - Determine which RTMR (likely RTMR1 or RTMR2) contains UKI measurements
4. **Update Policy** - Add verified RTMR values to `shared/policy.ts`

### Investigation

1. ~~**Check RTMRs**~~ ✅ Implemented RTMR extraction and verification
2. **GCP Documentation** - Search for GCP-specific TDX MRTD behavior
3. **Compare with AWS/Azure** - See if other cloud providers have similar behavior
4. **Intel TDX Specs** - Deep dive into what VMM must measure in MRTD

### Alternative Approaches (Not Needed - RTMRs Work!)

1. ~~**Accept Fixed MRTD**~~ - ✅ Use MRTD for infrastructure + RTMRs for code
2. ~~**Use RTMRs**~~ - ✅ Implemented!
3. **Add Signatures** - Could supplement RTMR verification (defense in depth)
4. **Application-Level Attestation** - Could include version/hash in API response

### Example Policy Configuration

```typescript
// shared/policy.ts
export const policy: MRTDPolicy = {
  // GCP c3-standard-4 TDX VM MRTD (infrastructure validation)
  allowed_mrtd: [
    "0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c"
  ],

  // RTMRs for code verification (update after testing)
  // Deploy and check logs for actual values, then uncomment:
  // allowed_rtmr1: ["0x..."],  // UKI/kernel measurements
  // allowed_rtmr2: ["0x..."],  // initrd/cmdline measurements

  min_tcb_version: "1.0",
}
```

## Key Files

### Configuration
- `image/ratsnest/ratsnest.conf` - Mkosi config with SSH package
- `image/ratsnest/mkosi.postinst` - Image setup script (enables SSH, adds keys)
- `image/ratsnest/mkosi.extra/etc/systemd/system/ratsnest.service` - Systemd service (sets `USE_REAL_TDX=true`)
- `image/deploy-gcp.sh` - GCP deployment script (includes SSH firewall rule)
- `shared/policy.ts` - Client-side MRTD policy
- `backend/tdx.ts` - TDX quote generation and MRTD extraction
- `backend/tunnel.ts` - TunnelServer with no fallback

### Build Artifacts
- `backend/dist/ratsnest` - Compiled binary (100MB)
- `build/ratsnest-tdx.efi` - UKI image
- `build/ratsnest-tdx.tar.gz` - GCP disk image
- `build/measurements.json` - PCR measurements (reference only, not actual MRTD)

### Samples (Removed from Production)
- `backend/samples.ts` - Sample TDX quotes (no longer used in production code)

## Open Questions

1. **What does GCP measure in MRTD?**
   - Is it just TDVF + machine config?
   - Does GCP's VMM exclude UKI from MRTD?

2. **Where are boot measurements stored?**
   - Are they in RTMRs (rtmr0-3)?
   - Are they in mr_config_id or mr_owner?

3. **Can we influence MRTD?**
   - By changing machine type?
   - By changing TD attributes?
   - By configuring TDVF differently?

4. **Is this GCP-specific?**
   - Do AWS/Azure TDX VMs behave similarly?
   - Is there a "standard" TDX MRTD behavior?

## Reference Links

- TDX Quote Structure: `frontend/node_modules/@teekit/qvl/src/structs.ts`
- ConfigFS-TSM: Linux kernel TDX quote interface
- Intel TDX Documentation: https://www.intel.com/content/www/us/en/developer/articles/technical/intel-trust-domain-extensions.html
- GCP Confidential Computing: https://cloud.google.com/confidential-computing/confidential-vm/docs
- TDX Module Spec: https://cdrdv2.intel.com/v1/dl/getContent/733568

## Conclusion

The TDX attestation system is **fully functional** - real quotes are generated, measurements are extracted correctly, and the encrypted tunnel is established.

**Key Findings:**
- **MRTD does not vary with code** - This is by design in TDX architecture
- **RTMRs DO vary with code** - They contain boot measurements from systemd-stub
- **Combined verification works** - MRTD validates infrastructure, RTMRs validate code

**Architecture Insight:**
MRTD is measured by the TDX module during VM initialization (before your code loads), so it only measures the infrastructure (TDVF + machine config). Your application code is measured by systemd-stub during boot and extended into RTMRs. This is the correct and expected behavior.

**Solution Status**: ✅ Implemented and **VERIFIED** - RTMRs work perfectly!

## RTMR Verification Results (2025-10-06)

### Test Results: RTMR Determinism and Variability

We deployed three test VMs to verify RTMR behavior:

**Test 1: ratsnest-vm (v2)** - 34.82.154.183
```
Code: "Test modification v2"
MRTD:  0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c
RTMR0: 0xd02908d3a1f41d05fc9afb91b4bbc84a3cd4ba02fa7cc7b293bd56cb7e90b2fa813af8970d9a28a75d70b1871ba09ef2
RTMR1: 0x0241c722b7705106ce8cc277dfb7652e82b9b1a36662c55b548307594f3f2e6fbe4f426765e0d05b728cedef8d0c13e6
RTMR2: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
RTMR3: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

**Test 2: ratsnest-vm-v3 (v3)** - 35.185.234.52
```
Code: "Test modification v3" (one line changed in backend/main.ts)
MRTD:  0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c
RTMR0: 0xd02908d3a1f41d05fc9afb91b4bbc84a3cd4ba02fa7cc7b293bd56cb7e90b2fa813af8970d9a28a75d70b1871ba09ef2
RTMR1: 0xe4b03948871b824607c80ed3fea4f3ff9f2c48c28f4c5ccce682fa5e217985dc022ea514fa2f7c08ef6e5dfd56af36e0
RTMR2: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
RTMR3: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

**Test 3: ratsnest-vm-v3c (v3 duplicate)** - 136.117.0.76
```
Code: "Test modification v3" (same image as v3, different VM instance)
MRTD:  0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c
RTMR0: 0xd02908d3a1f41d05fc9afb91b4bbc84a3cd4ba02fa7cc7b293bd56cb7e90b2fa813af8970d9a28a75d70b1871ba09ef2
RTMR1: 0xe4b03948871b824607c80ed3fea4f3ff9f2c48c28f4c5ccce682fa5e217985dc022ea514fa2f7c08ef6e5dfd56af36e0
RTMR2: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
RTMR3: 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

### Key Findings

✅ **MRTD is infrastructure-only**: Identical across all VMs (same machine type)
✅ **RTMR0 is firmware/early boot**: Identical across all VMs
🎯 **RTMR1 contains code measurements**: Changes with code modifications (v2 vs v3)
✅ **RTMR1 is deterministic**: Same image produces identical RTMR1 (v3 vs v3c)
✅ **RTMR2/3 are unused**: All zeros

### Conclusions

**RTMR1 is the perfect solution for code verification:**
- ✅ Changes when code changes (v2 ≠ v3)
- ✅ Deterministic for same build (v3 = v3c)
- ✅ Independent of VM instance
- ✅ Measured by systemd-stub during boot
- ✅ Cannot be forged (part of TDX quote)

**Recommended Policy Configuration:**
```typescript
export const policy: MRTDPolicy = {
  // Infrastructure validation (GCP c3-standard-4 TDX)
  allowed_mrtd: [
    "0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c"
  ],

  // Code validation - RTMR1 from your specific build
  allowed_rtmr1: [
    "0xe4b03948871b824607c80ed3fea4f3ff9f2c48c28f4c5ccce682fa5e217985dc022ea514fa2f7c08ef6e5dfd56af36e0"
  ],

  min_tcb_version: "1.0"
}
```

This gives you:
- **Infrastructure trust**: Via MRTD (GCP TDX hardware)
- **Code trust**: Via RTMR1 (exact binary version)
- **Complete attestation**: Hardware → Firmware → OS → Application
