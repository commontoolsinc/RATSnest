/**
 * MRTD Policy for Ratsnest TDX Remote Attestation
 *
 * This policy defines which TDX VM measurements are trusted by the client.
 * The MRTD (Measurement of Trust Domain) is a SHA-384 hash of:
 * - Linux kernel binary
 * - Initial ramdisk (initrd)
 * - Kernel command line parameters
 *
 * To update this policy:
 * 1. Build a new image: `cd image && ./build.sh`
 * 2. Copy the MRTD value from the build output
 * 3. Add it to the allowed_mrtd array below
 */

export interface MRTDPolicy {
  /**
   * List of allowed MRTD values (hex strings with or without 0x prefix)
   * At least one must match for verification to succeed
   */
  allowed_mrtd: string[]

  /**
   * Minimum TCB version (optional, for future use)
   */
  min_tcb_version?: string
}

/**
 * Current MRTD policy
 *
 * TODO: Run `image/build.sh` to generate the first MRTD value
 * and update this array with the output.
 *
 * For testing: Using sample MRTD from known TDX quote
 */
export const policy: MRTDPolicy = {
  allowed_mrtd: [
    // Sample MRTD for testing (from samples.ts TDX v4 quote)
    // Replace with real MRTD from image/build.sh output when building on TDX hardware
    "0x00000000000000000000001000000000e700060000000000c5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036f"
  ],
  min_tcb_version: "1.0"
}

/**
 * Normalize MRTD hex string (remove 0x prefix, lowercase)
 */
export function normalizeMRTD(mrtd: string): string {
  return mrtd.replace(/^0x/i, '').toLowerCase()
}

/**
 * Check if an MRTD value is allowed by the policy
 */
export function isMRTDAllowed(mrtd: string): boolean {
  const normalized = normalizeMRTD(mrtd)
  return policy.allowed_mrtd.some(
    allowed => normalizeMRTD(allowed) === normalized
  )
}
