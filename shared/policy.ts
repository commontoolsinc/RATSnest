/**
 * MRTD Policy for Ratsnest TDX Remote Attestation
 *
 * This policy defines which TDX VM measurements are trusted by the client.
 *
 * MRTD (Measurement of Trust Domain):
 * - Measures TDX infrastructure (TDVF firmware + machine config)
 * - Fixed per GCP machine type, does NOT vary with application code
 * - Use to verify running on correct GCP TDX infrastructure
 *
 * RTMRs (Runtime Measurement Registers):
 * - Extended during boot by systemd-stub
 * - Contain measurements of kernel, initrd, command line
 * - VARY with application code changes
 * - Use to verify specific code version
 *
 * To update this policy:
 * 1. Build and deploy: `make deploy`
 * 2. Check backend logs for MRTD and RTMR values
 * 3. Update allowed_mrtd and allowed_rtmr* arrays below
 * 4. Rebuild: `make build`
 */

export interface MRTDPolicy {
  /**
   * List of allowed MRTD values (hex strings with or without 0x prefix)
   * Validates TDX infrastructure (GCP machine type, firmware)
   */
  allowed_mrtd: string[]

  /**
   * List of allowed RTMR1 values (optional)
   * RTMRs contain boot measurements and vary with code changes
   */
  allowed_rtmr1?: string[]

  /**
   * List of allowed RTMR2 values (optional)
   */
  allowed_rtmr2?: string[]

  /**
   * List of allowed RTMR3 values (optional)
   */
  allowed_rtmr3?: string[]

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
    "0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c"
  ],
  min_tcb_version: "1.0"
}

/**
 * Normalize measurement hex string (remove 0x prefix, lowercase)
 */
export function normalizeMeasurement(measurement: string): string {
  return measurement.replace(/^0x/i, '').toLowerCase()
}

/**
 * Check if an MRTD value is allowed by the policy
 */
export function isMRTDAllowed(mrtd: string): boolean {
  const normalized = normalizeMeasurement(mrtd)
  return policy.allowed_mrtd.some(
    allowed => normalizeMeasurement(allowed) === normalized
  )
}

/**
 * Check if an RTMR value is allowed by the policy
 * Returns true if no policy is set (optional RTMR) or if value matches
 */
export function isRTMRAllowed(rtmr: string, rtmrNumber: 1 | 2 | 3): boolean {
  const policyKey = `allowed_rtmr${rtmrNumber}` as keyof MRTDPolicy
  const allowedValues = policy[policyKey] as string[] | undefined

  // If no policy set for this RTMR, it's optional (allow any value)
  if (!allowedValues || allowedValues.length === 0) {
    return true
  }

  const normalized = normalizeMeasurement(rtmr)
  return allowedValues.some(
    allowed => normalizeMeasurement(allowed) === normalized
  )
}

/**
 * Verify all measurements (MRTD + RTMRs) against policy
 */
export function verifyMeasurements(measurements: {
  mrtd: string
  rtmr1?: string
  rtmr2?: string
  rtmr3?: string
}): { allowed: boolean; details: string[] } {
  const details: string[] = []

  // Check MRTD (required)
  const mrtdAllowed = isMRTDAllowed(measurements.mrtd)
  details.push(`MRTD: ${mrtdAllowed ? '✓ allowed' : '✗ NOT allowed'}`)

  // Check RTMRs (optional based on policy)
  if (measurements.rtmr1) {
    const rtmr1Allowed = isRTMRAllowed(measurements.rtmr1, 1)
    if (policy.allowed_rtmr1 && policy.allowed_rtmr1.length > 0) {
      details.push(`RTMR1: ${rtmr1Allowed ? '✓ allowed' : '✗ NOT allowed'}`)
    } else {
      details.push(`RTMR1: ○ no policy set (any value allowed)`)
    }
  }

  if (measurements.rtmr2) {
    const rtmr2Allowed = isRTMRAllowed(measurements.rtmr2, 2)
    if (policy.allowed_rtmr2 && policy.allowed_rtmr2.length > 0) {
      details.push(`RTMR2: ${rtmr2Allowed ? '✓ allowed' : '✗ NOT allowed'}`)
    } else {
      details.push(`RTMR2: ○ no policy set (any value allowed)`)
    }
  }

  if (measurements.rtmr3) {
    const rtmr3Allowed = isRTMRAllowed(measurements.rtmr3, 3)
    if (policy.allowed_rtmr3 && policy.allowed_rtmr3.length > 0) {
      details.push(`RTMR3: ${rtmr3Allowed ? '✓ allowed' : '✗ NOT allowed'}`)
    } else {
      details.push(`RTMR3: ○ no policy set (any value allowed)`)
    }
  }

  // Overall: require MRTD + all configured RTMRs to pass
  const allowed = mrtdAllowed &&
    (!measurements.rtmr1 || isRTMRAllowed(measurements.rtmr1, 1)) &&
    (!measurements.rtmr2 || isRTMRAllowed(measurements.rtmr2, 2)) &&
    (!measurements.rtmr3 || isRTMRAllowed(measurements.rtmr3, 3))

  return { allowed, details }
}
