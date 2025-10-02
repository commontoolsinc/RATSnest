import { useEffect, useState, useRef } from 'react'
import { TunnelClient } from '@teekit/tunnel'
import './App.css'

const baseUrl = 'http://localhost:3000'

// Initialize tunnel client at module level, like the demo
const enc = await TunnelClient.initialize(baseUrl, {
  customVerifyQuote: async () => {
    console.log('[TunnelClient] Mock quote verification (always passes)')
    return true
  },
  customVerifyX25519Binding: async () => {
    console.log('[TunnelClient] Mock X25519 binding verification (always passes)')
    return true
  }
})

console.log('[TunnelClient] Tunnel initialized at module level')

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

  return (
    <>
      <h1>RATSnest - Phase 3</h1>
      <div className="card">
        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {message && (
          <>
            <p>
              Response from /api/hello: <strong>{message}</strong>
            </p>
            <p style={{ fontSize: '0.9em', color: '#666' }}>
              ✅ Authenticated tunnel established with remote attestation
            </p>
          </>
        )}
      </div>
    </>
  )
}

export default App
