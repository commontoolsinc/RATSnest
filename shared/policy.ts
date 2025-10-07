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
   * Expected IMA measurements for critical executables
   * Maps file paths to their expected SHA256 hashes
   */
  expected_ima_measurements?: Record<string, string>

  /**
   * Minimum TCB version (optional, for future use)
   */
  min_tcb_version?: string
}

/**
 * Current MRTD policy
 *
 * Values extracted from VM console logs at deployment time.
 * Update these after each image rebuild.
 */
export const policy: MRTDPolicy = {
  // TDX Infrastructure Measurement (fixed per GCP machine type)
  allowed_mrtd: [
    "0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c"
  ],

  // Boot Measurements (varies with kernel/image changes)
  allowed_rtmr1: [
    "0x4484eea1a5ad776567a76d381d0e4233b28adab4d94e0f4c426f8761d98a6463b9dadb8ad4db878611a09ab5e0a999d2"
  ],

  // IMA Runtime Measurements (varies with code changes)
  // These verify the integrity of executed binaries at runtime
  expected_ima_measurements: {
    "/usr/bin/ratsnest": "12c7226a0a41dfd2456b4fc8eb7e547f87c6ced1a9cc18c7657d4bce550997a4",
    "/usr/lib/systemd/systemd-executor": "a0e08eb8f3e086b6d28b66369db05b45915e9bb8584859a282168b1cc44ef78d",
    "/usr/lib/x86_64-linux-gnu/libsystemd.so.0.40.0": "7ba2cab942f4aaa188d6e5409705d448eacc4ae6914ff7cd2e1302e33bb7897f",
    "/usr/lib/x86_64-linux-gnu/systemd/libsystemd-core-257.so": "f62482f05efbf5551c2a42c753978071facd336936af0b81389b7bc3a99d5bc7",
    "/usr/lib/x86_64-linux-gnu/libc.so.6": "56e42210fbaee005355b622121fec8b0c16ca80837eddce3e3557075103dda78",
  },

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
 * IMA log entry structure
 */
export interface IMAEntry {
  pcr: number
  templateHash: string
  templateName: string
  fileHash: string
  filePath: string
}

/**
 * Parse IMA ASCII log format
 * Format: <PCR> <template-hash> <template-name> <file-hash> <file-path>
 * Example: 10 bb24b135... ima-ng sha256:d41dd4ad... /usr/bin/ratsnest
 */
export function parseIMALog(log: string): IMAEntry[] {
  return log
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5) return null

      return {
        pcr: parseInt(parts[0], 10),
        templateHash: parts[1],
        templateName: parts[2],
        fileHash: parts[3],
        filePath: parts.slice(4).join(' ') // File path may contain spaces
      }
    })
    .filter((entry): entry is IMAEntry => entry !== null)
}

/**
 * Verify IMA measurements against expected values
 */
export function verifyIMAMeasurements(imaLog: string): {
  allowed: boolean
  details: string[]
  checkedFiles: number
  missingFiles: string[]
  mismatchedFiles: string[]
} {
  const details: string[] = []
  const missingFiles: string[] = []
  const mismatchedFiles: string[] = []

  // If no IMA policy configured, skip verification
  if (!policy.expected_ima_measurements || Object.keys(policy.expected_ima_measurements).length === 0) {
    details.push('IMA: ○ no policy set (any measurements allowed)')
    return { allowed: true, details, checkedFiles: 0, missingFiles, mismatchedFiles }
  }

  // Parse IMA log
  const entries = parseIMALog(imaLog)
  details.push(`IMA: Found ${entries.length} measurements in log`)

  // Check each expected measurement
  let checkedFiles = 0
  for (const [filePath, expectedHash] of Object.entries(policy.expected_ima_measurements)) {
    const entry = entries.find(e => e.filePath === filePath)

    if (!entry) {
      details.push(`  ✗ ${filePath}: NOT FOUND in IMA log`)
      missingFiles.push(filePath)
      continue
    }

    // Extract hash from "sha256:HASH" format
    const actualHash = entry.fileHash.includes(':')
      ? entry.fileHash.split(':')[1]
      : entry.fileHash

    const hashMatch = actualHash.toLowerCase() === expectedHash.toLowerCase()
    checkedFiles++

    if (hashMatch) {
      details.push(`  ✓ ${filePath}: hash matches`)
    } else {
      details.push(`  ✗ ${filePath}: HASH MISMATCH`)
      details.push(`    Expected: ${expectedHash}`)
      details.push(`    Got:      ${actualHash}`)
      mismatchedFiles.push(filePath)
    }
  }

  const allowed = missingFiles.length === 0 && mismatchedFiles.length === 0

  return { allowed, details, checkedFiles, missingFiles, mismatchedFiles }
}

/**
 * Verify all measurements (MRTD + RTMRs + IMA) against policy
 */
export function verifyMeasurements(measurements: {
  mrtd: string
  rtmr1?: string
  rtmr2?: string
  rtmr3?: string
  imaLog?: string
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

  // Check IMA measurements if provided
  let imaAllowed = true
  if (measurements.imaLog) {
    const imaResult = verifyIMAMeasurements(measurements.imaLog)
    details.push(...imaResult.details)
    imaAllowed = imaResult.allowed

    if (!imaResult.allowed) {
      details.push(`IMA: ✗ Verification FAILED (${imaResult.missingFiles.length} missing, ${imaResult.mismatchedFiles.length} mismatched)`)
    } else if (imaResult.checkedFiles > 0) {
      details.push(`IMA: ✓ All ${imaResult.checkedFiles} critical files verified`)
    }
  }

  // Overall: require MRTD + all configured RTMRs + IMA to pass
  const allowed = mrtdAllowed &&
    (!measurements.rtmr1 || isRTMRAllowed(measurements.rtmr1, 1)) &&
    (!measurements.rtmr2 || isRTMRAllowed(measurements.rtmr2, 2)) &&
    (!measurements.rtmr3 || isRTMRAllowed(measurements.rtmr3, 3)) &&
    imaAllowed

  return { allowed, details }
}
