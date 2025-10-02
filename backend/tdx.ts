// TDX quote generation using Deno FFI
// Based on go-tdx-guest: https://github.com/google/go-tdx-guest

const TDX_GUEST_DEVICE = "/dev/tdx_guest";
const TD_REPORT_DATA_SIZE = 64;
const TD_REPORT_SIZE = 1024;
const REQ_BUF_SIZE = 4 * 4 * 1024; // 16KB

// Calculate ioctl command numbers (from linux_abi.go)
const IOC_NRBITS = 8;
const IOC_TYPEBITS = 8;
const IOC_SIZEBITS = 14;
const IOC_DIRBITS = 2;
const IOC_NRSHIFT = 0;
const IOC_TYPESHIFT = IOC_NRSHIFT + IOC_NRBITS;
const IOC_SIZESHIFT = IOC_TYPESHIFT + IOC_TYPEBITS;
const IOC_DIRSHIFT = IOC_SIZESHIFT + IOC_SIZEBITS;
const IOC_WRITE = 1;
const IOC_READ = 2;
const IOC_TYPE_TDX_GUEST = 'T'.charCodeAt(0);

const IOC_TDX_WITHOUT_NR_WITHOUT_SIZE =
  ((IOC_WRITE | IOC_READ) << IOC_DIRSHIFT) |
  (IOC_TYPE_TDX_GUEST << IOC_TYPESHIFT);

// TdxReportReq size: 64 + 1024 = 1088 bytes
const TDX_REPORT_REQ_SIZE = TD_REPORT_DATA_SIZE + TD_REPORT_SIZE;
const IOC_TDX_GET_REPORT =
  IOC_TDX_WITHOUT_NR_WITHOUT_SIZE |
  (TDX_REPORT_REQ_SIZE << IOC_SIZESHIFT) |
  (0x1 << IOC_NRSHIFT);

// TdxQuoteReqABI size: 8 + 8 = 16 bytes (pointer + uint64)
const TDX_QUOTE_REQ_ABI_SIZE = 16;
const IOC_TDX_GET_QUOTE =
  IOC_TDX_WITHOUT_NR_WITHOUT_SIZE |
  (TDX_QUOTE_REQ_ABI_SIZE << IOC_SIZESHIFT) |
  (0x2 << IOC_NRSHIFT);

// Load libc for ioctl
const libc = Deno.dlopen("libc.so.6", {
  open: {
    parameters: ["buffer", "i32"],
    result: "i32",
  },
  close: {
    parameters: ["i32"],
    result: "i32",
  },
  ioctl: {
    parameters: ["i32", "u32", "pointer"],
    result: "i32",
  },
});

/**
 * Hash x25519 public key with SHA-384 and pad to 64 bytes for report_data
 */
async function hashPubkeyToReportData(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  // SHA-384 produces 48 bytes, we pad with zeros to 64 bytes
  const hash = await crypto.subtle.digest("SHA-384", x25519PublicKey);
  const reportData = new Uint8Array(TD_REPORT_DATA_SIZE);
  reportData.set(new Uint8Array(hash), 0);
  return reportData;
}

/**
 * Get TD Report from /dev/tdx_guest using ioctl TDX_CMD_GET_REPORT0
 */
function getTdReport(reportData: Uint8Array): Uint8Array {
  if (reportData.length !== TD_REPORT_DATA_SIZE) {
    throw new Error(`reportData must be ${TD_REPORT_DATA_SIZE} bytes`);
  }

  // Open /dev/tdx_guest
  const pathBuf = new TextEncoder().encode(TDX_GUEST_DEVICE + "\0");
  const O_RDWR = 0x0002;
  const fd = libc.symbols.open(pathBuf, O_RDWR);

  if (fd < 0) {
    throw new Error(`Failed to open ${TDX_GUEST_DEVICE}: ${fd}`);
  }

  try {
    // Create TdxReportReq struct: [reportData(64), tdReport(1024)]
    const reportReq = new Uint8Array(TDX_REPORT_REQ_SIZE);
    reportReq.set(reportData, 0);

    // Call ioctl
    const result = libc.symbols.ioctl(fd, IOC_TDX_GET_REPORT, reportReq);

    if (result !== 0) {
      throw new Error(`ioctl TDX_CMD_GET_REPORT0 failed: ${result}`);
    }

    // Extract TD Report from response (skip first 64 bytes of reportData)
    return reportReq.slice(TD_REPORT_DATA_SIZE, TDX_REPORT_REQ_SIZE);
  } finally {
    libc.symbols.close(fd);
  }
}

/**
 * Convert TD Report to TDX Quote using ioctl TDX_CMD_GET_QUOTE
 */
function getTdxQuote(tdReport: Uint8Array): Uint8Array {
  if (tdReport.length !== TD_REPORT_SIZE) {
    throw new Error(`tdReport must be ${TD_REPORT_SIZE} bytes`);
  }

  // Open /dev/tdx_guest
  const pathBuf = new TextEncoder().encode(TDX_GUEST_DEVICE + "\0");
  const O_RDWR = 0x0002;
  const fd = libc.symbols.open(pathBuf, O_RDWR);

  if (fd < 0) {
    throw new Error(`Failed to open ${TDX_GUEST_DEVICE}: ${fd}`);
  }

  try {
    // Create TdxQuoteHdr struct (24 bytes header + 16KB data buffer)
    const quoteHdr = new ArrayBuffer(24 + REQ_BUF_SIZE);
    const view = new DataView(quoteHdr);
    const dataArray = new Uint8Array(quoteHdr);

    // Set header fields (all little-endian):
    // - Version (uint64): 1
    view.setBigUint64(0, 1n, true);
    // - Status (uint64): 0
    view.setBigUint64(8, 0n, true);
    // - InLen (uint32): 1024
    view.setUint32(16, TD_REPORT_SIZE, true);
    // - OutLen (uint32): 0
    view.setUint32(20, 0, true);

    // Copy TD Report into Data field (starts at offset 24)
    dataArray.set(tdReport, 24);

    // Create TdxQuoteReqABI struct (pointer + length)
    const quoteReq = new ArrayBuffer(16);
    const reqView = new DataView(quoteReq);

    // This is tricky - we need to pass a pointer to quoteHdr
    // In Deno FFI, we can use Deno.UnsafePointer.of()
    const quoteHdrPtr = Deno.UnsafePointer.of(dataArray);
    reqView.setBigUint64(0, BigInt(quoteHdrPtr!), true); // Buffer pointer
    reqView.setBigUint64(8, BigInt(quoteHdr.byteLength), true); // Length

    // Call ioctl
    const result = libc.symbols.ioctl(fd, IOC_TDX_GET_QUOTE, Deno.UnsafePointer.of(new Uint8Array(quoteReq)));

    if (result !== 0) {
      throw new Error(`ioctl TDX_CMD_GET_QUOTE failed: ${result}`);
    }

    // Read OutLen to get actual quote size
    const outLen = view.getUint32(20, true);

    if (outLen === 0) {
      throw new Error("Quote generation returned 0 bytes");
    }

    // Extract quote from Data field
    return dataArray.slice(24, 24 + outLen);
  } finally {
    libc.symbols.close(fd);
  }
}

/**
 * Generate a TDX quote bound to an x25519 public key
 */
export async function getQuote(x25519PublicKey: Uint8Array): Promise<Uint8Array> {
  console.log(`[TDX] Generating quote for pubkey length: ${x25519PublicKey.length}`);

  // Step 1: Hash the public key to create report_data
  const reportData = await hashPubkeyToReportData(x25519PublicKey);
  console.log(`[TDX] Report data (SHA-384): ${reportData.length} bytes`);

  // Step 2: Get TD Report from /dev/tdx_guest
  const tdReport = getTdReport(reportData);
  console.log(`[TDX] Got TD Report: ${tdReport.length} bytes`);

  // Step 3: Convert TD Report to Quote
  const quote = getTdxQuote(tdReport);
  console.log(`[TDX] Got TDX Quote: ${quote.length} bytes`);

  return quote;
}
