// TDX quote generation using ConfigFS-TSM
// Based on go-configfs-tsm: https://github.com/google/go-configfs-tsm

const TSM_REPORT_PATH = "/sys/kernel/config/tsm/report";
const TD_REPORT_DATA_SIZE = 64;

/**
 * Hash x25519 public key with SHA-384 and pad to 64 bytes for report_data
 */
async function hashPubkeyToReportData(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  // SHA-384 produces 48 bytes, we pad with zeros to 64 bytes
  const hash = await crypto.subtle.digest("SHA-384", x25519PublicKey as BufferSource);
  const reportData = new Uint8Array(TD_REPORT_DATA_SIZE);
  reportData.set(new Uint8Array(hash), 0);
  return reportData;
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
 * MRTD is 48 bytes located at offset 160 (48 header + 112 in body)
 */
function extractMRTD(quote: Uint8Array): string {
  const MRTD_OFFSET = 160;
  const MRTD_SIZE = 48;

  if (quote.length < MRTD_OFFSET + MRTD_SIZE) {
    throw new Error(`Quote too small: ${quote.length} bytes`);
  }

  const mrtd = quote.slice(MRTD_OFFSET, MRTD_OFFSET + MRTD_SIZE);
  return '0x' + Array.from(mrtd).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function getQuote(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  console.log(`[TDX] Generating quote for pubkey length: ${x25519PublicKey.length}`);

  // Step 1: Hash the public key to create report_data
  const reportData = await hashPubkeyToReportData(x25519PublicKey);
  console.log(`[TDX] Report data (SHA-384): ${reportData.length} bytes`);

  // Debug: Log handshake binding details
  const sha384 = await crypto.subtle.digest("SHA-384", x25519PublicKey as BufferSource);
  const sha384Hex = Array.from(new Uint8Array(sha384)).map(b => b.toString(16).padStart(2, '0')).join('');
  const reportDataHex = Array.from(reportData).map(b => b.toString(16).padStart(2, '0')).join('');
  console.log(`[Handshake Debug] SHA-384(pubkey): ${sha384Hex}`);
  console.log(`[Handshake Debug] Report data: ${reportDataHex}`);

  // Step 2: Generate TDX quote via ConfigFS-TSM
  const quote = await getQuoteViaConfigFS(reportData);
  console.log(`[TDX] Got TDX Quote: ${quote.length} bytes`);

  // Step 3: Extract and log MRTD for policy configuration
  try {
    const mrtd = extractMRTD(quote);
    console.log(`[TDX] MRTD (for policy.ts): ${mrtd}`);
  } catch (err) {
    console.warn(`[TDX] Failed to extract MRTD:`, err);
  }

  return quote;
}
