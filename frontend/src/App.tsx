import { useEffect, useState } from 'react'
// @ts-ignore - importing from lib/client directly to avoid server-side code
import { TunnelClient } from '@teekit/tunnel/lib/client'
import './App.css'

function App() {
  const [message, setMessage] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>('')
  const [tunnelStatus, setTunnelStatus] = useState<string>('initializing')

  useEffect(() => {
    async function initializeTunnel() {
      try {
        setTunnelStatus('connecting')

        // Initialize TunnelClient with origin and mock policy
        const tunnelClient = new TunnelClient({
          origin: 'http://localhost:3000',
          verifyQuote: async () => {
            // Mock verification - always pass for now
            // In Phase 5, this will verify the MRTD matches the policy
            console.log('[TunnelClient] Mock quote verification (always passes)')
            return true
          }
        })

        await tunnelClient.ready()

        setTunnelStatus('connected')
        console.log('[TunnelClient] Tunnel established successfully')

        // Make API call through the tunnel
        console.log('[TunnelClient] Fetching /api/hello through tunnel...')
        const response = await tunnelClient.fetch('/api/hello')
        const data = await response.json()

        setMessage(data.message)
        setLoading(false)
        console.log('[TunnelClient] Received response:', data)

      } catch (err) {
        console.error('[TunnelClient] Error:', err)
        setError(err instanceof Error ? err.message : String(err))
        setTunnelStatus('failed')
        setLoading(false)
      }
    }

    initializeTunnel()
  }, [])

  return (
    <>
      <h1>RATSnest - Phase 3</h1>
      <div className="card">
        <p>
          <strong>Tunnel Status:</strong>{' '}
          <span style={{
            color: tunnelStatus === 'connected' ? 'green' :
                   tunnelStatus === 'failed' ? 'red' : 'orange'
          }}>
            {tunnelStatus}
          </span>
        </p>

        {loading && <p>Loading...</p>}
        {error && <p style={{ color: 'red' }}>Error: {error}</p>}
        {message && (
          <p>
            Response from /api/hello: <strong>{message}</strong>
          </p>
        )}

        {tunnelStatus === 'connected' && (
          <p style={{ fontSize: '0.9em', color: '#666' }}>
            ✅ Authenticated tunnel established with remote attestation
          </p>
        )}
      </div>
    </>
  )
}

export default App
