import { useEffect, useState, useRef } from 'react'
import { TunnelClient } from '@teekit/tunnel'
import { policy } from '../../shared/policy'
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

    // Check MRTD against effective policy (query param or default)
    const normalizedMrtd = mrtd.replace(/^0x/i, '').toLowerCase()
    const allowed = effectivePolicy.allowed_mrtd.some(
      allowed => allowed.replace(/^0x/i, '').toLowerCase() === normalizedMrtd
    )
    console.log('[Verify] MRTD allowed by policy:', allowed)
    console.log('[Verify] Policy allows:', effectivePolicy.allowed_mrtd)

    if (!allowed) {
      console.error('[Verify] MRTD not in allowed list!')
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
      </div>
    </>
  )
}

export default App
