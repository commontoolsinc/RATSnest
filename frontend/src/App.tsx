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
// Note: TunnelClient passes the already-parsed quote object
async function verifyTdxQuote(quote: any): Promise<boolean> {
  try {
    console.log('[Verify] Verifying TDX quote...')
    console.log('[Verify] Quote version:', quote.header.version)

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

    // Verify all measurements (MRTD + RTMRs) against policy
    const verification = verifyMeasurements({
      mrtd,
      rtmr1,
      rtmr2,
      rtmr3,
    })

    console.log('[Verify] Measurement verification:')
    verification.details.forEach(detail => console.log(`[Verify]   ${detail}`))
    console.log('[Verify] Overall result:', verification.allowed ? '✓ ALLOWED' : '✗ DENIED')

    if (!verification.allowed) {
      console.error('[Verify] Measurements not allowed by policy!')
      return false
    }

    console.log('[Verify] ✓ Quote verification passed')
    return true
  } catch (err) {
    console.error('[Verify] Quote verification failed:', err)
    return false
  }
}

// Custom X25519 binding verification
// Note: TunnelClient automatically verifies the binding, this is just for logging
async function verifyX25519Binding(): Promise<boolean> {
  console.log('[Verify] X25519 binding check (handled by TunnelClient)')
  return true
}

// Initialize tunnel client at module level with real verification
const enc = await TunnelClient.initialize(baseUrl, {
  customVerifyQuote: verifyTdxQuote,
  customVerifyX25519Binding: verifyX25519Binding
})

console.log('[TunnelClient] Tunnel initialized with MRTD policy verification')

function App() {
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [debugData, setDebugData] = useState<any>(null)
  const [showDebug, setShowDebug] = useState(false)
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
      // Generate a test 32-byte pubkey (all zeros for simplicity)
      const testPubkey = '0'.repeat(64) // 32 bytes = 64 hex chars

      console.log('[Debug] Testing handshake bytes with pubkey:', testPubkey)

      const response = await fetch(baseUrl + '/debug/handshake-bytes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: testPubkey })
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
                  {/* Step 1: Input */}
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
                      <strong style={{ color: '#4fc3f7' }}>X25519 Public Key (32 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #4fc3f7',
                      wordBreak: 'break-all',
                      color: '#4fc3f7',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px'
                    }}>
                      {debugData.server_pubkey?.match(/.{1,32}/g)?.join('\n')}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.pubkey_bytes} bytes ({debugData.sizes?.pubkey_bytes * 8} bits)
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{
                    textAlign: 'center',
                    margin: '1rem 0',
                    fontSize: '1.5em',
                    color: '#e94560'
                  }}>
                    ↓ SHA-384(public_key)
                  </div>

                  {/* Step 2: Hash */}
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
                      <strong style={{ color: '#66bb6a' }}>SHA-384 Digest (48 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #66bb6a',
                      wordBreak: 'break-all',
                      color: '#66bb6a',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px'
                    }}>
                      {debugData.sha384_digest?.match(/.{1,32}/g)?.join('\n')}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.sha384_bytes} bytes ({debugData.sizes?.sha384_bytes * 8} bits)
                    </div>
                  </div>

                  {/* Arrow */}
                  <div style={{
                    textAlign: 'center',
                    margin: '1rem 0',
                    fontSize: '1.5em',
                    color: '#e94560'
                  }}>
                    ↓ Pad digest with 16 zero bytes
                  </div>

                  {/* Step 3: Padded Result */}
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
                      <strong style={{ color: '#ffa726' }}>TDX Report Data (64 bytes)</strong>
                    </div>
                    <div style={{
                      background: '#0f1419',
                      padding: '0.75rem',
                      borderRadius: '4px',
                      border: '1px solid #ffa726',
                      lineHeight: '1.6',
                      letterSpacing: '0.5px'
                    }}>
                      <div style={{ color: '#66bb6a', wordBreak: 'break-all' }}>
                        <span style={{ opacity: 0.7 }}>/* SHA-384 Hash (48 bytes) */</span><br/>
                        {debugData.sha384_digest?.match(/.{1,32}/g)?.join('\n')}
                      </div>
                      <div style={{ color: '#666', wordBreak: 'break-all', marginTop: '0.5rem' }}>
                        <span style={{ opacity: 0.7 }}>/* Zero Padding (16 bytes) */</span><br/>
                        {debugData.report_data?.slice(-32)}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#888', marginTop: '0.3rem' }}>
                      📏 Length: {debugData.sizes?.report_data_bytes} bytes ({debugData.sizes?.report_data_bytes * 8} bits)
                      <br/>
                      📦 Structure: 48 bytes (hash) + 16 bytes (zeros) = 64 bytes
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
                      ✨ Result
                    </div>
                    <p style={{ margin: '0', color: '#ccc', fontSize: '0.95em', lineHeight: '1.5' }}>
                      This 64-byte <code style={{ background: '#0f3460', padding: '2px 6px', borderRadius: '3px' }}>report_data</code> gets embedded into the TDX quote during attestation.
                      The quote proves that the server generated it while in possession of the X25519 private key,
                      binding the encrypted tunnel to the hardware-attested TDX environment.
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
                        <li>Hash Algorithm: SHA-384 (SHA-2 family)</li>
                        <li>Input: 32-byte Curve25519 public key</li>
                        <li>Output: 48-byte digest (384 bits)</li>
                        <li>Padding: 16 zero bytes (0x00...)</li>
                        <li>Total: 64 bytes (required by TDX report_data)</li>
                        <li>Encoding: Hexadecimal (2 chars per byte)</li>
                      </ul>
                    </div>
                  </details>
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
