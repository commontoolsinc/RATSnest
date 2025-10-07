// IMA (Integrity Measurement Architecture) log reading and parsing

const IMA_LOG_PATH = "/sys/kernel/security/ima/ascii_runtime_measurements";
const IMA_COUNT_PATH = "/sys/kernel/security/ima/runtime_measurements_count";

/**
 * IMA measurement entry
 * Format: <PCR> <template-hash> <template-name> <file-hash> <file-path>
 * Example: 10 <hash> ima-ng sha256:<hash> /usr/bin/ratsnest
 */
export interface IMAEntry {
  pcr: number;
  templateHash: string;
  templateName: string;
  fileHash: string;
  filePath: string;
}

/**
 * Read the IMA ASCII runtime measurements log
 * Returns the raw log as a string
 */
export async function readIMALog(): Promise<string> {
  try {
    return await Deno.readTextFile(IMA_LOG_PATH);
  } catch (error) {
    console.error(`[IMA] Failed to read IMA log from ${IMA_LOG_PATH}:`, error);
    throw new Error(`IMA log not available: ${error}`);
  }
}

/**
 * Get the count of IMA measurements
 */
export async function getIMACount(): Promise<number> {
  try {
    const countStr = await Deno.readTextFile(IMA_COUNT_PATH);
    return parseInt(countStr.trim(), 10);
  } catch (error) {
    console.warn(`[IMA] Failed to read IMA count from ${IMA_COUNT_PATH}:`, error);
    return -1;
  }
}

/**
 * Parse a single IMA log line
 * Format: <PCR> <template-hash> <template-name> <file-hash> <file-path>
 */
function parseIMALine(line: string): IMAEntry | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }

  return {
    pcr: parseInt(parts[0], 10),
    templateHash: parts[1],
    templateName: parts[2],
    fileHash: parts[3],
    filePath: parts.slice(4).join(' '), // File path may contain spaces
  };
}

/**
 * Parse the IMA log into structured entries
 */
export function parseIMALog(log: string): IMAEntry[] {
  return log
    .split('\n')
    .map(line => parseIMALine(line))
    .filter((entry): entry is IMAEntry => entry !== null);
}

/**
 * Search for specific file measurements in the IMA log
 * Returns all entries matching the given file paths
 */
export function findFileMeasurements(entries: IMAEntry[], filePaths: string[]): IMAEntry[] {
  const pathSet = new Set(filePaths);
  return entries.filter(entry => pathSet.has(entry.filePath));
}

/**
 * Get IMA log as bytes for inclusion in attestation quote
 * This can be included in QuoteData.runtime_data
 */
export async function getIMALogBytes(): Promise<Uint8Array> {
  const log = await readIMALog();
  return new TextEncoder().encode(log);
}

/**
 * Get IMA log metadata for logging/debugging
 */
export async function getIMAMetadata(): Promise<{
  count: number;
  sampleEntries: IMAEntry[];
}> {
  const count = await getIMACount();
  const log = await readIMALog();
  const entries = parseIMALog(log);

  // Get first 10 entries as samples
  const sampleEntries = entries.slice(0, 10);

  return { count, sampleEntries };
}

/**
 * Get key executable measurements for policy configuration
 * Returns measurements for critical binaries that should be verified
 */
export async function getKeyMeasurements(): Promise<Map<string, string>> {
  const log = await readIMALog();
  const entries = parseIMALog(log);

  // Critical executables to track
  const keyPaths = [
    "/usr/bin/ratsnest",
    "/usr/lib/systemd/systemd-executor",
    "/usr/lib/x86_64-linux-gnu/libsystemd.so.0.40.0",
    "/usr/lib/x86_64-linux-gnu/systemd/libsystemd-core-257.so",
    "/usr/lib/x86_64-linux-gnu/libc.so.6",
    "/bin/bash",
  ];

  const measurements = new Map<string, string>();

  for (const path of keyPaths) {
    const entry = entries.find(e => e.filePath === path);
    if (entry) {
      // Extract hash from "sha256:HASH" format
      const hash = entry.fileHash.includes(':')
        ? entry.fileHash.split(':')[1]
        : entry.fileHash;
      measurements.set(path, hash);
    }
  }

  return measurements;
}

/**
 * Display key IMA measurements in a formatted, copy-pasteable way
 * For use in startup logs to easily extract hashes for policy configuration
 */
export async function displayKeyMeasurements(): Promise<void> {
  console.log('========================================');
  console.log('   IMA KEY MEASUREMENTS');
  console.log('========================================');

  try {
    const measurements = await getKeyMeasurements();
    const count = await getIMACount();

    console.log(`Total IMA Measurements: ${count}`);
    console.log('');
    console.log('Critical Executables (for policy.ts):');
    console.log('');

    if (measurements.size === 0) {
      console.log('  ⚠️  No key measurements found');
    } else {
      for (const [path, hash] of measurements.entries()) {
        console.log(`  ${path}:`);
        console.log(`    ${hash}`);
      }
    }

    console.log('');
    console.log('Copy to verifier EXPECTED_MEASUREMENTS:');
    console.log('{');
    for (const [path, hash] of measurements.entries()) {
      console.log(`  "${path}": "${hash}",`);
    }
    console.log('}');
    console.log('========================================');
  } catch (error) {
    console.error('Failed to read IMA measurements:', error);
    console.log('========================================');
  }
}
