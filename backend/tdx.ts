// TDX quote generation using ConfigFS-TSM
// Based on go-configfs-tsm: https://github.com/google/go-configfs-tsm

const TSM_REPORT_PATH = "/sys/kernel/config/tsm/report";
const TD_REPORT_DATA_SIZE = 64;

/**
 * Pad report_data to 64 bytes if needed
 * TEE-Kit uses SHA-512 (64 bytes) which fits perfectly
 * Legacy code used SHA-384 (48 bytes) + padding
 */
function padReportData(reportData: Uint8Array): Uint8Array {
  if (reportData.length === TD_REPORT_DATA_SIZE) {
    return reportData; // Already 64 bytes
  }

  if (reportData.length > TD_REPORT_DATA_SIZE) {
    throw new Error(`reportData too large: ${reportData.length} bytes (max ${TD_REPORT_DATA_SIZE})`);
  }

  // Pad with zeros to 64 bytes
  const padded = new Uint8Array(TD_REPORT_DATA_SIZE);
  padded.set(reportData, 0);
  return padded;
}

/**
 * Generate TDX quote using ConfigFS-TSM interface
 *
 * Modern Linux kernels provide attestation via /sys/kernel/config/tsm/report:
 * 1. Create temporary directory under /sys/kernel/config/tsm/report/
 * 2. Write 64-byte reportdata to inblob file
 * 3. Read TDX quote (with certificates) from outblob file
 * 4. Clean up temporary directory
 */
async function getQuoteViaConfigFS(reportData: Uint8Array): Promise<Uint8Array> {
  if (reportData.length !== TD_REPORT_DATA_SIZE) {
    throw new Error(`reportData must be ${TD_REPORT_DATA_SIZE} bytes`);
  }

  // Create temporary directory for this request
  const tempDir = await Deno.makeTempDir({ dir: TSM_REPORT_PATH, prefix: "request_" });

  try {
    // Write report data to inblob
    const inblobPath = `${tempDir}/inblob`;
    await Deno.writeFile(inblobPath, reportData);

    // Read TDX quote from outblob
    const outblobPath = `${tempDir}/outblob`;
    const quote = await Deno.readFile(outblobPath);

    // Verify provider is tdx_guest
    const providerPath = `${tempDir}/provider`;
    const provider = await Deno.readTextFile(providerPath);
    if (!provider.trim().startsWith("tdx_guest")) {
      throw new Error(`Unexpected provider: ${provider.trim()}, expected tdx_guest`);
    }

    return quote;
  } finally {
    // Clean up temporary directory
    try {
      await Deno.remove(tempDir);
    } catch (err) {
      console.warn(`[TDX] Failed to cleanup temp directory ${tempDir}:`, err);
    }
  }
}

/**
 * Generate a TDX quote bound to an x25519 public key
 *
 * Process:
 * 1. Hash the x25519 public key with SHA-384 (48 bytes) → pad to 64 bytes
 * 2. Use ConfigFS-TSM to generate TDX quote with reportdata
 * 3. Return the quote containing the bound public key hash
 */
/**
 * Extract MRTD from TDX quote for policy validation
 * MRTD (mr_td) is 48 bytes located at offset 184:
 *   48 (header) + 16 (tee_tcb_svn) + 48 (mr_seam) + 48 (mr_seam_signer) +
 *   4 (seam_svn) + 4 (reserved0) + 8 (td_attributes) + 8 (xfam) = 184
 */
function extractMRTD(quote: Uint8Array): string {
  const MRTD_OFFSET = 184;
  const MRTD_SIZE = 48;

  if (quote.length < MRTD_OFFSET + MRTD_SIZE) {
    throw new Error(`Quote too small: ${quote.length} bytes`);
  }

  const mrtd = quote.slice(MRTD_OFFSET, MRTD_OFFSET + MRTD_SIZE);
  return '0x' + Array.from(mrtd).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Extract RTMRs (Runtime Measurement Registers) from TDX quote
 * RTMRs contain boot measurements (kernel, initrd, etc.) and vary with code changes
 *
 * TDX Quote v4 Structure:
 *   Offset 376: rtmr0 (48 bytes)
 *   Offset 424: rtmr1 (48 bytes)
 *   Offset 472: rtmr2 (48 bytes)
 *   Offset 520: rtmr3 (48 bytes)
 */
interface RTMRs {
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
}

function extractRTMRs(quote: Uint8Array): RTMRs {
  const RTMR_SIZE = 48;
  const RTMR0_OFFSET = 376;
  const RTMR1_OFFSET = 424;
  const RTMR2_OFFSET = 472;
  const RTMR3_OFFSET = 520;

  if (quote.length < RTMR3_OFFSET + RTMR_SIZE) {
    throw new Error(`Quote too small for RTMR extraction: ${quote.length} bytes`);
  }

  const bytesToHex = (bytes: Uint8Array) =>
    '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    rtmr0: bytesToHex(quote.slice(RTMR0_OFFSET, RTMR0_OFFSET + RTMR_SIZE)),
    rtmr1: bytesToHex(quote.slice(RTMR1_OFFSET, RTMR1_OFFSET + RTMR_SIZE)),
    rtmr2: bytesToHex(quote.slice(RTMR2_OFFSET, RTMR2_OFFSET + RTMR_SIZE)),
    rtmr3: bytesToHex(quote.slice(RTMR3_OFFSET, RTMR3_OFFSET + RTMR_SIZE)),
  };
}

export async function getQuote(reportData: Uint8Array): Promise<Uint8Array> {
  console.log(`[TDX] Generating quote for report_data length: ${reportData.length} bytes`);

  // Step 1: Pad report_data to 64 bytes if needed
  const paddedReportData = padReportData(reportData);
  console.log(`[TDX] Padded report_data: ${paddedReportData.length} bytes`);

  // Step 2: Generate TDX quote via ConfigFS-TSM
  const quote = await getQuoteViaConfigFS(paddedReportData);
  console.log(`[TDX] Got TDX Quote: ${quote.length} bytes`);

  // Step 3: Extract and log MRTD + RTMRs for policy configuration
  try {
    const mrtd = extractMRTD(quote);
    const rtmrs = extractRTMRs(quote);

    // Print MRTD and RTMRs prominently for easy extraction from console logs
    console.log('');
    console.log('========================================');
    console.log('   TDX ATTESTATION - MEASUREMENTS');
    console.log('========================================');
    console.log('');
    console.log('MRTD (Infrastructure):');
    console.log(`  ${mrtd}`);
    console.log('');
    console.log('RTMRs (Boot Measurements):');
    console.log(`  RTMR0: ${rtmrs.rtmr0}`);
    console.log(`  RTMR1: ${rtmrs.rtmr1}`);
    console.log(`  RTMR2: ${rtmrs.rtmr2}`);
    console.log(`  RTMR3: ${rtmrs.rtmr3}`);
    console.log('');
    console.log('Update shared/policy.ts:');
    console.log(`  allowed_mrtd: ["${mrtd}"]`);
    console.log('');
    console.log('If RTMRs vary with code changes, add:');
    console.log(`  allowed_rtmr1: ["${rtmrs.rtmr1}"]  // or whichever RTMR varies`);
    console.log('');
    console.log('========================================');
    console.log('');
  } catch (err) {
    console.warn(`[TDX] Failed to extract measurements:`, err);
  }

  return quote;
}
