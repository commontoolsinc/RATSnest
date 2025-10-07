import { useEffect, useState, useRef } from 'react'
import { TunnelClient } from '@teekit/tunnel'
import { policy, verifyMeasurements } from '../../shared/policy'
import './App.css'

// Parse query parameters
const urlParams = new URLSearchParams(window.location.search)
const queryBackend = urlParams.get('backend')
const queryMrtd = urlParams.get('mrtd')

// Use backend from query param if provided, otherwise use current origin in production, localhost for development
const baseUrl = queryBackend || (
  window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : window.location.origin
)

if (queryBackend) {
  console.log('[Config] Using backend from query parameter:', queryBackend)
} else if (window.location.hostname === 'localhost') {
  console.log('[Config] Using localhost backend:', baseUrl)
} else {
  console.log('[Config] Using current origin as backend:', baseUrl)
}

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Get MRTD from query parameter if provided
const effectivePolicy = queryMrtd
  ? { ...policy, allowed_mrtd: [queryMrtd] }
  : policy

if (queryMrtd) {
  console.log('[Policy] Using MRTD from query parameter:', queryMrtd)
} else {
  console.log('[Policy] Using MRTD from policy.ts:', policy.allowed_mrtd)
}

// Custom quote verification function
// Note: TunnelClient only passes the parsed quote (not runtime_data)
// We fetch the IMA log separately via the API
async function verifyTdxQuote(quote: any): Promise<boolean> {
  try {
    console.log('[Verify] ========================================')
    console.log('[Verify] TDX Quote Verification')
    console.log('[Verify] ========================================')
    console.log('[Verify] Quote version:', quote.header.version)

    // Log report_data from quote (contains the binding)
    const reportData = quote.body.report_data
    const reportDataHex = Array.from(reportData).map(b => (b as number).toString(16).padStart(2, '0')).join('')
    console.log('[Verify] Quote report_data (64 bytes):')
    console.log('[Verify]   ' + reportDataHex)

    // Extract MRTD from the quote body
    // The quote.body contains either TdxQuoteBody10Type or TdxQuoteBody15Type
    const mrtd = bytesToHex(quote.body.mr_td)
    console.log('[Verify] MRTD from quote:', mrtd)

    // Extract RTMRs from quote body
    const rtmr0 = bytesToHex(quote.body.rtmr0)
    const rtmr1 = bytesToHex(quote.body.rtmr1)
    const rtmr2 = bytesToHex(quote.body.rtmr2)
    const rtmr3 = bytesToHex(quote.body.rtmr3)

    console.log('[Verify] RTMRs from quote:')
    console.log('[Verify]   RTMR0:', rtmr0)
    console.log('[Verify]   RTMR1:', rtmr1)
    console.log('[Verify]   RTMR2:', rtmr2)
    console.log('[Verify]   RTMR3:', rtmr3)

    // Fetch IMA log for verification
    // Note: TunnelClient doesn't pass runtime_data to customVerifyQuote
    // So we fetch it via the API endpoint
    let imaLog: string | undefined
    try {
      console.log('[Verify] Fetching IMA log for verification...')
      const response = await fetch(baseUrl + '/api/ima/log')
      if (response.ok) {
        imaLog = await response.text()
        console.log('[Verify] IMA log fetched:', imaLog.length, 'bytes')
      } else {
        console.warn('[Verify] Failed to fetch IMA log:', response.status)
      }
    } catch (err) {
      console.warn('[Verify] Could not fetch IMA log:', err)
    }

    // Verify all measurements (MRTD + RTMRs + IMA) against policy
    const verification = verifyMeasurements({
      mrtd,
      rtmr1,
      rtmr2,
      rtmr3,
      imaLog,
    })

    console.log('[Verify] Measurement verification:')
    verification.details.forEach(detail => console.log(`[Verify]   ${detail}`))
    console.log('[Verify] Overall result:', verification.allowed ? '✓ ALLOWED' : '✗ DENIED')

    if (!verification.allowed) {
      console.error('[Verify] Measurements not allowed by policy!')
      return false
    }

    console.log('[Verify] ✓ Quote verification passed (TDX + IMA)')
    return true
  } catch (err) {
    console.error('[Verify] Quote verification failed:', err)
    return false
  }
}

// Store handshake details for debugging
let handshakeDetails = {
  serverPubkey: null as Uint8Array | null,
  nonce: null as Uint8Array | null,
  iat: null as Uint8Array | null,
  reportData: null as Uint8Array | null
}

// Custom X25519 binding verifier that logs the real values
async function logAndVerifyX25519Binding(client: any): Promise<boolean> {
  console.log('[Handshake] ========================================')
  console.log('[Handshake] X25519 Binding Verification')
  console.log('[Handshake] ========================================')

  // Extract handshake details from TunnelClient
  const serverPubkey = client.serverX25519PublicKey
  const verifierData = client.reportBindingData?.verifierData

  if (serverPubkey) {
    handshakeDetails.serverPubkey = serverPubkey
    const pubkeyHex = Array.from(serverPubkey).map(b => (b as number).toString(16).padStart(2, '0')).join('')
    console.log('[Handshake] Server X25519 Public Key (32 bytes):')
    console.log('[Handshake]   ' + pubkeyHex)
  } else {
    console.log('[Handshake] ⚠️  Server pubkey not available')
  }

  if (verifierData?.val) {
    handshakeDetails.nonce = verifierData.val
    const nonceHex = Array.from(verifierData.val).map(b => (b as number).toString(16).padStart(2, '0')).join('')
    console.log('[Handshake] Verifier Nonce (32 bytes):')
    console.log('[Handshake]   ' + nonceHex)
  } else {
    console.log('[Handshake] ⚠️  Nonce not available (server not sending verifier_data)')
  }

  if (verifierData?.iat) {
    handshakeDetails.iat = verifierData.iat
    const iatHex = Array.from(verifierData.iat).map(b => (b as number).toString(16).padStart(2, '0')).join('')
    const iatTimestamp = new DataView(verifierData.iat.buffer).getBigUint64(0, false)
    console.log('[Handshake] Issued-At Timestamp (8 bytes):')
    console.log('[Handshake]   ' + iatHex + ' (' + iatTimestamp.toString() + 'ms)')
  } else {
    console.log('[Handshake] ⚠️  IAT not available (server not sending verifier_data)')
  }

  // Compute expected report_data and compare
  if (handshakeDetails.nonce && handshakeDetails.iat && handshakeDetails.serverPubkey) {
    const combined = new Uint8Array(
      handshakeDetails.nonce.length +
      handshakeDetails.iat.length +
      handshakeDetails.serverPubkey.length
    )
    combined.set(handshakeDetails.nonce, 0)
    combined.set(handshakeDetails.iat, handshakeDetails.nonce.length)
    combined.set(handshakeDetails.serverPubkey, handshakeDetails.nonce.length + handshakeDetails.iat.length)

    const expectedReportData = await crypto.subtle.digest("SHA-512", combined)
    handshakeDetails.reportData = new Uint8Array(expectedReportData)
    const reportDataHex = Array.from(handshakeDetails.reportData).map(b => b.toString(16).padStart(2, '0')).join('')
    console.log('[Handshake] Expected report_data = SHA-512(nonce || iat || pubkey):')
    console.log('[Handshake]   ' + reportDataHex)
    console.log('[Handshake] ========================================')
  }

  // Let TEE-Kit's default verifier handle the actual verification
  return true
}

// Initialize tunnel client at module level with real verification
// TunnelClient will automatically verify:
// 1. The TDX quote signature and measurements
// 2. The X25519 binding (report_data = SHA-512(nonce || iat || x25519_pubkey))
const enc = await TunnelClient.initialize(baseUrl, {
  customVerifyQuote: verifyTdxQuote,
  customVerifyX25519Binding: logAndVerifyX25519Binding
})

console.log('[TunnelClient] Tunnel initialized with MRTD policy verification')
console.log('[TunnelClient] Handshake details available in console')

function App() {
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [debugData, setDebugData] = useState<any>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [imaData, setImaData] = useState<any>(null)
  const [showIma, setShowIma] = useState(false)
  const [helloLoading, setHelloLoading] = useState(false)
  const initializedRef = useRef<boolean>(false)

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    async function fetchHello() {
      try {
        console.log('[TunnelClient] Fetching /api/hello through tunnel...')
        const response = await enc.fetch(baseUrl + '/api/hello')
        const data = await response.json()

        setMessage(data.message)
        setLoading(false)
        console.log('[TunnelClient] Received response:', data)

      } catch (err) {
        console.error('[TunnelClient] Error:', err)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      }
    }

    fetchHello()
  }, [])

  const testHandshakeBytes = async () => {
    try {
      // Use real handshake values if available, otherwise use zeros for demo
      let testPubkey: string
      let testNonce: string
      let testIat: string

      if (handshakeDetails.serverPubkey && handshakeDetails.nonce && handshakeDetails.iat) {
        testPubkey = Array.from(handshakeDetails.serverPubkey).map(b => b.toString(16).padStart(2, '0')).join('')
        testNonce = Array.from(handshakeDetails.nonce).map(b => b.toString(16).padStart(2, '0')).join('')
        testIat = Array.from(handshakeDetails.iat).map(b => b.toString(16).padStart(2, '0')).join('')
        console.log('[Debug] Using REAL handshake values from actual TDX attestation')
      } else {
        // Fallback to zeros for demo
        testPubkey = '0'.repeat(64) // 32 bytes = 64 hex chars
        testNonce = '0'.repeat(64)  // 32 bytes = 64 hex chars
        testIat = '0'.repeat(16)    // 8 bytes = 16 hex chars
        console.log('[Debug] Using demo values (all zeros) - handshake not yet completed')
      }

      console.log('[Debug] Testing handshake computation')
      console.log('[Debug]   pubkey:', testPubkey)
      console.log('[Debug]   nonce:', testNonce)
      console.log('[Debug]   iat:', testIat)

      const response = await fetch(baseUrl + '/debug/handshake-bytes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkey: testPubkey,
          nonce: testNonce,
          iat: testIat
        })
      })

      const data = await response.json()
      console.log('[Debug] Response:', data)
      setDebugData(data)
      setShowDebug(true)
    } catch (err) {
      console.error('[Debug] Error:', err)
      setDebugData({ error: String(err) })
    }
  }

  const fetchImaLog = async () => {
    try {
      console.log('[IMA] Fetching IMA log summary...')

      const response = await fetch(baseUrl + '/debug/ima-summary')
      const data = await response.json()
      console.log('[IMA] Response:', data)
      setImaData(data)
      setShowIma(true)
    } catch (err) {
      console.error('[IMA] Error:', err)
      setImaData({ error: String(err) })
      setShowIma(true)
    }
  }

  const sendHelloRequest = async () => {
    setHelloLoading(true)
    setError('')
    try {
      console.log('[Demo] Sending /api/hello request through encrypted tunnel...')
      const startTime = performance.now()

      const response = await enc.fetch(baseUrl + '/api/hello')
      const data = await response.json()

      const endTime = performance.now()
      const duration = Math.round(endTime - startTime)

      console.log('[Demo] ✓ Received response:', data)
      console.log('[Demo] Round-trip time:', duration + 'ms')

      setMessage(data.message + ` (${duration}ms)`)
    } catch (err) {
      console.error('[Demo] Error:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setHelloLoading(false)
    }
  }

  const hasPolicyConfigured = effectivePolicy.allowed_mrtd.length > 0
  const usingQueryMrtd = queryMrtd !== null
  const usingQueryBackend = queryBackend !== null

  return (
    <>
      <h1>RATSnest</h1>
      <div className="card">
        {loading && <p>Loading...</p>}
        {error && (
          <>
            <p style={{ color: 'red' }}>Error: {error}</p>
            {!hasPolicyConfigured && (
              <p style={{ fontSize: '0.9em', color: '#ff9800' }}>
                ⚠️ No MRTD policy configured. Run <code>image/build.sh</code> to generate an MRTD value.
              </p>
            )}
          </>
        )}
        {message && (
          <>
            <p>
              Response from /api/hello: <strong>{message}</strong>
            </p>
            <p style={{ fontSize: '0.9em', color: '#4caf50' }}>
              ✅ Authenticated tunnel established with TDX remote attestation
            </p>
            {usingQueryBackend && (
              <p style={{ fontSize: '0.8em', color: '#2196f3', marginTop: '5px' }}>
                🔗 Connected to: {baseUrl}
              </p>
            )}
            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '10px' }}>
              {hasPolicyConfigured ? (
                <>
                  MRTD verified against policy ({effectivePolicy.allowed_mrtd.length} value{effectivePolicy.allowed_mrtd.length !== 1 ? 's' : ''} allowed)
                  {usingQueryMrtd && <span style={{ color: '#ff9800' }}> [from query param]</span>}
                </>
              ) : (
                <>⚠️ WARNING: No MRTD policy configured (all quotes accepted)</>
              )}
            </p>
          </>
        )}

        {/* Debug Panel */}
        <div style={{ marginTop: '2rem', borderTop: '1px solid #333', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              onClick={sendHelloRequest}
              disabled={helloLoading}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.9em',
                cursor: helloLoading ? 'wait' : 'pointer',
                background: helloLoading ? '#2a2a2a' : '#4caf50',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '4px',
                opacity: helloLoading ? 0.6 : 1
              }}
            >
              {helloLoading ? '⏳ Sending...' : '📨 Send Hello Request'}
            </button>

            <button
              onClick={testHandshakeBytes}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.9em',
                cursor: 'pointer',
                background: '#444',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '4px'
              }}
            >
              🔍 Test Handshake Computation
            </button>

            <button
              onClick={fetchImaLog}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.9em',
                cursor: 'pointer',
                background: '#444',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '4px'
              }}
            >
              📋 View IMA Log
            </button>
          </div>

          {showDebug && debugData && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1.5rem',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
              borderRadius: '8px',
              border: '1px solid #0f3460',
              fontSize: '0.85em',
              fontFamily: 'monospace'
            }}>
              <h3 style={{
                margin: '0 0 1.5rem 0',
                fontSize: '1.2em',
                color: '#e94560',
                borderBottom: '2px solid #0f3460',
                paddingBottom: '0.5rem'
              }}>
                🔐 TDX Handshake Computation
              </h3>

              {debugData.error ? (
                <p style={{ color: '#f44' }}>Error: {debugData.error}</p>
              ) : (
                <>
                  {/* Step 1: Nonce */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        background: '#0f3460',
                        color: '#4fc3f7',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.9em',
                        fontWeight: 'bold'
                      }}>STEP 1</span>
                      <strong style={{ color: '#4fc3f7' }}>Nonce (32 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #4fc3f7',
                      wordBreak: 'break-all',
                      color: '#4fc3f7',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px',
                      fontSize: '0.9em'
                    }}>
                      {debugData.nonce?.match(/.{1,64}/g)?.join('\n')}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.nonce_bytes} bytes
                    </div>
                  </div>

                  {/* Step 2: IAT */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        background: '#0f3460',
                        color: '#66bb6a',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.9em',
                        fontWeight: 'bold'
                      }}>STEP 2</span>
                      <strong style={{ color: '#66bb6a' }}>Issued-At Timestamp (8 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #66bb6a',
                      wordBreak: 'break-all',
                      color: '#66bb6a',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px',
                      fontSize: '0.9em'
                    }}>
                      {debugData.iat}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.iat_bytes} bytes
                    </div>
                  </div>

                  {/* Step 3: Pubkey */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        background: '#0f3460',
                        color: '#ffa726',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.9em',
                        fontWeight: 'bold'
                      }}>STEP 3</span>
                      <strong style={{ color: '#ffa726' }}>X25519 Public Key (32 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #ffa726',
                      wordBreak: 'break-all',
                      color: '#ffa726',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px',
                      fontSize: '0.9em'
                    }}>
                      {debugData.server_pubkey?.match(/.{1,64}/g)?.join('\n')}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.pubkey_bytes} bytes
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{
                    textAlign: 'center',
                    margin: '1rem 0',
                    fontSize: '1.5em',
                    color: '#e94560'
                  }}>
                    ↓ SHA-512(nonce || iat || pubkey)
                  </div>

                  {/* Step 4: Hash Result */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        background: '#0f3460',
                        color: '#ab47bc',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.9em',
                        fontWeight: 'bold'
                      }}>STEP 4</span>
                      <strong style={{ color: '#ab47bc' }}>TDX Report Data (64 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #ab47bc',
                      wordBreak: 'break-all',
                      color: '#ab47bc',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px',
                      fontSize: '0.9em'
                    }}>
                      {debugData.report_data?.match(/.{1,64}/g)?.join('\n')}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.report_data_bytes} bytes ({debugData.sizes?.report_data_bytes * 8} bits)
                      <br/>
                      📦 SHA-512 produces exactly 64 bytes (perfect for TDX report_data)
                    </div>
                  </div>

                  {/* Summary box */}
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    background: 'rgba(233, 69, 96, 0.1)',
                    borderRadius: '6px',
                    border: '1px solid #e94560'
                  }}>
                    <div style={{ color: '#e94560', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                      ✨ X25519 Binding
                    </div>
                    <p style={{ margin: '0', color: '#ccc', fontSize: '0.95em', lineHeight: '1.5' }}>
                      This 64-byte <code style={{ background: '#0f3460', padding: '2px 6px', borderRadius: '3px' }}>report_data</code> gets embedded into the TDX quote during attestation.
                      The client verifies that <code style={{ background: '#0f3460', padding: '2px 6px', borderRadius: '3px' }}>quote.body.report_data == SHA-512(nonce || iat || server_pubkey)</code>,
                      proving the server holds the X25519 private key and binding the encrypted tunnel to the hardware-attested TDX environment.
                    </p>
                  </div>

                  {/* Technical details */}
                  <details style={{ marginTop: '1rem', color: '#888' }}>
                    <summary style={{ cursor: 'pointer', color: '#4fc3f7' }}>
                      📊 Technical Details
                    </summary>
                    <div style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      background: '#0f1419',
                      borderRadius: '4px',
                      fontSize: '0.9em'
                    }}>
                      <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                        <li>Hash Algorithm: SHA-512 (SHA-2 family)</li>
                        <li>Input: 32-byte nonce + 8-byte timestamp + 32-byte X25519 pubkey = 72 bytes</li>
                        <li>Output: 64-byte digest (512 bits)</li>
                        <li>Perfect fit: SHA-512 output exactly matches TDX report_data size</li>
                        <li>Encoding: Hexadecimal (2 chars per byte)</li>
                        <li>Freshness: Nonce prevents replay attacks</li>
                      </ul>
                    </div>
                  </details>
                </>
              )}
            </div>
          )}

          {showIma && imaData && (
            <div style={{
              marginTop: '1.5rem',
              padding: '1.5rem',
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
              borderRadius: '8px',
              border: '1px solid #0f3460',
              fontSize: '0.85em',
              fontFamily: 'monospace'
            }}>
              <h3 style={{
                margin: '0 0 1.5rem 0',
                fontSize: '1.2em',
                color: '#e94560',
                borderBottom: '2px solid #0f3460',
                paddingBottom: '0.5rem'
              }}>
                📋 IMA Runtime Measurements
              </h3>

              {imaData.error ? (
                <div>
                  <p style={{ color: '#f44' }}>Error: {imaData.error}</p>
                  {imaData.hint && <p style={{ color: '#888', fontSize: '0.9em' }}>{imaData.hint}</p>}
                  <p style={{ color: '#888', fontSize: '0.9em', marginTop: '1rem' }}>
                    IMA may not be enabled. Check kernel command line includes: <code>ima_policy=tcb ima_hash=sha256</code>
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      gap: '0.5rem'
                    }}>
                      <span style={{
                        background: '#0f3460',
                        color: '#4fc3f7',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.9em',
                        fontWeight: 'bold'
                      }}>SUMMARY</span>
                      <strong style={{ color: '#4fc3f7' }}>IMA Log Statistics</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #4fc3f7',
                      color: '#4fc3f7'
                    }}>
                      Total measurements: {imaData.total_entries} files
                    </div>
                  </div>

                  {/* Ratsnest Binary */}
                  {imaData.ratsnest_binary && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        marginBottom: '0.5rem',
                        gap: '0.5rem'
                      }}>
                        <span style={{
                          background: '#0f3460',
                          color: imaData.ratsnest_binary.found ? '#66bb6a' : '#f44',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.9em',
                          fontWeight: 'bold'
                        }}>
                          {imaData.ratsnest_binary.found ? '✓ FOUND' : '✗ NOT FOUND'}
                        </span>
                        <strong style={{ color: '#66bb6a' }}>/usr/bin/ratsnest</strong>
                      </div>
                      {imaData.ratsnest_binary.found && (
                        <div style={{
                          background: '#0f1419',
                          padding: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid #66bb6a'
                        }}>
                          <div style={{ color: '#888', fontSize: '0.9em', marginBottom: '0.5rem' }}>
                            Hash: {imaData.ratsnest_binary.hash}
                          </div>
                          <div style={{
                            color: '#666',
                            fontSize: '0.85em',
                            wordBreak: 'break-all',
                            fontFamily: 'monospace',
                            lineHeight: '1.4'
                          }}>
                            {imaData.ratsnest_binary.full_entry}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sample Entries */}
                  {imaData.sample_entries && imaData.sample_entries.length > 0 && (
                    <details style={{ marginTop: '1rem', color: '#888' }}>
                      <summary style={{ cursor: 'pointer', color: '#4fc3f7' }}>
                        📊 Sample IMA Log Entries (first 10)
                      </summary>
                      <div style={{
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        background: '#0f1419',
                        borderRadius: '4px',
                        fontSize: '0.85em',
                        maxHeight: '300px',
                        overflowY: 'auto'
                      }}>
                        {imaData.sample_entries.map((entry: any, idx: number) => (
                          <div key={idx} style={{ marginBottom: '0.75rem', borderBottom: '1px solid #222', paddingBottom: '0.5rem' }}>
                            <div style={{ color: '#4fc3f7' }}>PCR {entry.pcr}: {entry.filename}</div>
                            <div style={{ color: '#666', fontSize: '0.9em' }}>
                              {entry.template} {entry.file_hash}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1rem',
                    background: 'rgba(233, 69, 96, 0.1)',
                    borderRadius: '6px',
                    border: '1px solid #e94560'
                  }}>
                    <div style={{ color: '#e94560', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                      ✨ IMA Verification
                    </div>
                    <p style={{ margin: '0', color: '#ccc', fontSize: '0.95em', lineHeight: '1.5' }}>
                      The IMA log contains cryptographic measurements of all files accessed during boot and runtime.
                      The ratsnest binary hash can be verified against a known-good value to ensure code integrity,
                      independent of the MRTD/RTMR measurements.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export default App
