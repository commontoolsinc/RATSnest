import { useEffect, useState, useRef } from 'react'
import { TunnelClient } from '@teekit/tunnel'
import { isMRTDAllowed, policy } from '../../shared/policy'
import './App.css'

const baseUrl = 'http://localhost:3000'

// Helper to convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
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

    // Check MRTD against policy
    const allowed = isMRTDAllowed(mrtd)
    console.log('[Verify] MRTD allowed by policy:', allowed)
    console.log('[Verify] Policy allows:', policy.allowed_mrtd)

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

  const hasPolicyConfigured = policy.allowed_mrtd.length > 0

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
            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '10px' }}>
              {hasPolicyConfigured ? (
                <>MRTD verified against policy ({policy.allowed_mrtd.length} value{policy.allowed_mrtd.length !== 1 ? 's' : ''} allowed)</>
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
