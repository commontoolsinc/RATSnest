# RATSnest

**Remote Attestation Tunnel with TDX** - A minimal proof-of-concept demonstrating end-to-end confidential computing with Intel TDX remote attestation.

Browser clients verify they're talking to a specific version of code running in a TDX VM using cryptographic attestation, with app-layer encryption that cloud providers cannot intercept.

## Overview

RATSnest demonstrates how to build a **verifiable confidential computing application** where:
- Browser clients cryptographically verify they're talking to **specific code** running in a hardware-attested TDX VM
- All communication is encrypted end-to-end using **X25519 keys bound to TDX quotes**
- Runtime integrity is verified using **IMA measurements** of executed binaries
- Cloud providers (even with root access) **cannot decrypt or tamper** with the communication

### Quick Glossary

| Term | What It Means |
|------|---------------|
| **TDX** | Intel Trust Domain Extensions - hardware-based confidential computing technology |
| **MRTD** | Measurement of Trust Domain - cryptographic hash of VM infrastructure (firmware + config) |
| **RTMR** | Runtime Measurement Register - boot-time measurements (kernel + initrd + cmdline) |
| **IMA** | Integrity Measurement Architecture - runtime file integrity measurements |
| **ConfigFS-TSM** | Linux kernel interface for generating TDX attestation quotes |
| **TEEKit** | Library for building attested encrypted tunnels (@teekit/tunnel) https://github.com/canvasxyz/teekit |
| **Quote** | Hardware-signed attestation report containing measurements + custom data |
| **X25519** | Elliptic curve Diffie-Hellman for key exchange (used by TEEKit) |
| **XSalsa20-Poly1305** | Authenticated encryption algorithm (encrypts tunnel messages) |

## Quick Start

### Prerequisites
- **Deno 2.0+** ([install](https://deno.land/))
- **Node.js 20+** + npm
- **Nix** with flakes enabled ([install](https://nixos.org/download.html))
- **Google Cloud SDK** for deployment ([install](https://cloud.google.com/sdk/docs/install))

### Local Development

```bash
# 1. Install frontend dependencies
cd frontend && npm install

# 2. Run backend (in one terminal)
cd backend && deno task dev

# 3. Run frontend (in another terminal)
cd frontend && npm run dev

# 4. Open http://localhost:5173
```

### Test Suite

```bash
# Run all tests
make test

# Or manually:
cd backend && deno test --allow-all
cd frontend && npm run test
```

## Architecture

### High-Level Overview

```
┌─────────────────┐                       ┌──────────────────────────────┐
│     Browser     │◄────── HTTPS ────────►│   TDX Confidential VM (GCP)  │
│     Client      │                       │                              │
│                 │  1. WebSocket         │  ┌────────────────────────┐  │
│  @teekit/tunnel │     Handshake         │  │    TunnelServer        │  │
│  @teekit/qvl    │────────────────────►  │  │   (Express + WS)       │  │
│                 │  2. TDX Quote +       │  │                        │  │
│  - Verify Quote │     X25519 Pubkey     │  │  - Generate Quote      │  │
│  - Verify MRTD  │◄────────────────────  │  │  - Bind X25519 Key     │  │
│  - Verify RTMRs │  3. Encrypted Key     │  │  - Proxy Requests      │  │
│  - Verify IMA   │────────────────────►  │  └──────────┬─────────────┘  │
│  - X25519 ECDH  │  4. XSalsa20-Poly1305 │             │                │
│                 │◄───────────────────►  │             ↓                │
└─────────────────┘     Encrypted         │  ┌────────────────────────┐  │
                        Messages          │  │   Hono API Server      │  │
                                          │  │   (localhost:4000)     │  │
                                          │  │                        │  │
                                          │  │  - GET /api/hello      │  │
                                          │  │  - GET /api/ima/log    │  │
                                          │  │  - POST /debug/*       │  │
                                          │  │  - Static files (SPA)  │  │
                                          │  └────────────────────────┘  │
                                          │                              │
                                          │  ┌────────────────────────┐  │
                                          │  │  TDX Quote Generation  │  │
                                          │  │  (ConfigFS-TSM)        │  │
                                          │  │                        │  │
                                          │  │  /sys/kernel/config/   │  │
                                          │  │       tsm/report/      │  │
                                          │  └────────────────────────┘  │
                                          │                              │
                                          │  ┌────────────────────────┐  │
                                          │  │  IMA Runtime           │  │
                                          │  │  Measurements          │  │
                                          │  │                        │  │
                                          │  │  /sys/kernel/security/ │  │
                                          │  │    ima/ascii_runtime_  │  │
                                          │  │    measurements        │  │
                                          │  └────────────────────────┘  │
                                          └──────────────────────────────┘
```

### Key Components

**Frontend** (React + TypeScript):
- **@teekit/tunnel** - TunnelClient for WebSocket handshake & encryption
- **@teekit/qvl** - Quote verification library (TDX quote parsing)
- **shared/policy.ts** - MRTD/RTMR/IMA policy verification

**Backend** (Deno + TypeScript):
- **TunnelServer** (Express, port 3000) - WebSocket server for attestation handshake
- **Hono API** (port 4000) - HTTP API for application logic
- **tdx.ts** - TDX quote generation via ConfigFS-TSM
- **ima.ts** - IMA runtime measurement verification

**Attestation Stack**:
- **ConfigFS-TSM** - Linux kernel interface for TDX quote generation
- **IMA (Integrity Measurement Architecture)** - Runtime file integrity measurements
- **TEEKit** - Client/server libraries for attested encrypted tunnels

## TEEKit Protocol: How It Works

RATSnest uses **TEEKit** (`@teekit/tunnel`) to establish an encrypted, hardware-attested tunnel between the browser and TDX VM. Here's the complete handshake flow:

### WebSocket Handshake Protocol

**1. Client Opens WebSocket**
```typescript
// Client initiates WebSocket connection
const client = await TunnelClient.initialize('https://your-vm.com')
// This opens: wss://your-vm.com/__ra__
```

**2. Server Sends Key Exchange (`server_kx` message)**

The server sends a message containing:
```typescript
{
  type: "server_kx",
  x25519PublicKey: Uint8Array(32),  // Server's ephemeral X25519 public key
  quote: Uint8Array,                // TDX quote (with report_data embedded)
  verifier_data: {                  // CBOR-encoded freshness proof
    val: Uint8Array(32),           // nonce (32 random bytes)
    iat: Uint8Array(8)             // timestamp (8-byte big-endian)
  },
  runtime_data: Uint8Array          // Optional: IMA log bytes
}
```

**3. Quote Generation (Server-Side)**

The quote is **pre-generated** when `TunnelServer.initialize()` is called:

```typescript
// backend/tunnel.ts
async function getQuote(x25519PublicKey: Uint8Array): Promise<QuoteData> {
  // 1. Generate ephemeral X25519 keypair (once per boot)

  // 2. Generate nonce + timestamp
  const nonce = crypto.getRandomValues(new Uint8Array(32))  // 32 random bytes
  const iat = new Uint8Array(8)                             // 8-byte timestamp
  const now = BigInt(Date.now())
  new DataView(iat.buffer).setBigUint64(0, now, false)     // Big-endian

  // 3. Compute report_data = SHA-512(nonce || iat || x25519_pubkey)
  const combined = new Uint8Array(32 + 8 + 32)  // 72 bytes total
  combined.set(nonce, 0)
  combined.set(iat, 32)
  combined.set(x25519PublicKey, 40)

  const reportData = await crypto.subtle.digest("SHA-512", combined)  // 64 bytes

  // 4. Get TDX quote with embedded report_data
  const quote = await getTdxQuote(reportData)  // Calls ConfigFS-TSM

  // 5. Return quote + verifier_data
  return {
    quote,
    verifier_data: { val: nonce, iat },
    runtime_data: await getIMALogBytes()  // Optional IMA measurements
  }
}
```

**4. Client Verification**

The client verifies the server's identity:

```typescript
// frontend/src/App.tsx - customVerifyQuote
async function verifyTdxQuote(quote: ParsedQuote): Promise<boolean> {
  // Extract measurements from quote
  const mrtd = quote.body.mr_td          // 48 bytes - infrastructure measurement
  const rtmr1 = quote.body.rtmr1         // 48 bytes - boot measurements
  const reportData = quote.body.report_data  // 64 bytes - binding data

  // Verify MRTD against policy
  if (!policy.allowed_mrtd.includes(mrtd)) {
    return false  // Wrong VM image!
  }

  // Verify RTMRs (optional, varies with code changes)
  if (policy.allowed_rtmr1 && !policy.allowed_rtmr1.includes(rtmr1)) {
    return false  // Wrong code version!
  }

  // Verify IMA measurements (runtime integrity)
  const imaLog = await fetch('/api/ima/log').then(r => r.text())
  const imaResult = verifyIMAMeasurements(imaLog)
  if (!imaResult.allowed) {
    return false  // Binary has been tampered with!
  }

  return true
}
```

**5. X25519 Key Binding Verification**

TEEKit automatically verifies the X25519 public key is bound to the quote:

```typescript
// Performed by @teekit/tunnel internally
function verifyX25519Binding(serverKx): boolean {
  const { x25519PublicKey, quote, verifier_data } = serverKx

  // 1. Extract report_data from quote
  const reportData = quote.body.report_data  // 64 bytes

  // 2. Compute expected report_data
  const combined = new Uint8Array(72)
  combined.set(verifier_data.val, 0)        // nonce (32 bytes)
  combined.set(verifier_data.iat, 32)       // iat (8 bytes)
  combined.set(x25519PublicKey, 40)         // pubkey (32 bytes)

  const expected = await crypto.subtle.digest("SHA-512", combined)

  // 3. Verify they match
  if (!bytesEqual(reportData, expected)) {
    throw new Error("X25519 public key is not bound to quote!")
  }

  return true
}
```

**This proves:**
- The server **owns the X25519 private key** (report_data contains hash of pubkey)
- The quote is **fresh** (nonce prevents replay attacks)
- The **TDX hardware signed** the binding (quote signature validates report_data)

**6. Client Sends Encrypted Symmetric Key (`client_kx`)**

```typescript
// Client generates symmetric key and seals it
const symmetricKey = crypto.getRandomValues(new Uint8Array(32))
const sealed = crypto_box_seal(symmetricKey, serverX25519PublicKey)

client.send({
  type: "client_kx",
  sealed_key: sealed  // Encrypted with server's X25519 public key
})
```

**7. Server Decrypts Symmetric Key**

```typescript
// Server unseals using X25519 private key
const symmetricKey = crypto_box_seal_open(
  sealed_key,
  serverX25519PrivateKey,
  serverX25519PublicKey
)
```

**8. Encrypted Communication**

All future messages are encrypted with **XSalsa20-Poly1305** using the shared symmetric key:

```typescript
// Client sends encrypted request
const plaintext = JSON.stringify({ method: 'GET', url: '/api/hello' })
const encrypted = xsalsa20_poly1305_encrypt(plaintext, symmetricKey, nonce)
client.send({ type: 'message', data: encrypted })

// Server decrypts, processes, encrypts response
const decrypted = xsalsa20_poly1305_decrypt(encrypted, symmetricKey, nonce)
const response = await fetch('/api/hello')
const encryptedResponse = xsalsa20_poly1305_encrypt(response, symmetricKey, nonce)
client.send({ type: 'response', data: encryptedResponse })
```

### Complete Message Flow Diagram

```
BROWSER CLIENT                     TDX VM (GCP)
==============                     ============

[1] WebSocket Handshake
    |
    | GET wss://vm.example.com/__ra__
    |---------------------------------->
    |                                  [TunnelServer receives connection]
    |
    |                                  [2] Server generates quote
    |                                  - Generate X25519 keypair (cached)
    |                                  - Generate nonce (32 bytes)
    |                                  - Generate iat (8 bytes timestamp)
    |                                  - SHA-512(nonce || iat || x25519_pubkey)
    |                                  - Request quote from TDX hardware
    |                                  - Read IMA log
    |
    |       server_kx message
    | <----------------------------------
    | {
    |   x25519PublicKey,
    |   quote (TDX-signed),
    |   verifier_data: {nonce, iat},
    |   runtime_data (IMA log)
    | }
    |
[3] Client verifies quote
    - Parse quote with @teekit/qvl
    - Extract MRTD from quote.body.mr_td
    - Verify: MRTD ∈ policy.allowed_mrtd ✅
    - Extract RTMR1 from quote.body.rtmr1
    - Verify: RTMR1 ∈ policy.allowed_rtmr1 ✅
    - Extract report_data (64 bytes)
    - Compute: SHA-512(nonce || iat || x25519PublicKey)
    - Verify: report_data == computed hash ✅
    - Parse IMA log from runtime_data
    - Verify: /usr/bin/ratsnest hash matches ✅
    |
[4] Client generates session key
    - Generate 32-byte symmetric key
    - Seal with server X25519 pubkey
    |
    |       client_kx message
    |---------------------------------->
    | { sealed_key }
    |                                  [5] Server unseals session key
    |                                  - Use X25519 private key
    |                                  - Both sides now have shared key
    |
[6] Encrypted communication
    |
    |  Encrypted: GET /api/hello
    |---------------------------------->
    |                                  - Decrypt with XSalsa20-Poly1305
    |                                  - Proxy to Hono API (localhost:4000)
    |                                  - Encrypt response
    |  Encrypted: {"message":"world"}
    | <----------------------------------
    - Decrypt response
    - Return to application
    |
    ✅ End-to-end encrypted tunnel established
       Cloud provider cannot decrypt traffic
       Client verified exact code version
```

### Security Guarantees

✅ **Confidentiality**: All messages encrypted with XSalsa20-Poly1305
✅ **Authenticity**: TDX hardware signature proves VM identity
✅ **Integrity**: MRTD/RTMR/IMA verify exact code version
✅ **Freshness**: Nonce + timestamp prevent replay attacks
✅ **Key Binding**: X25519 pubkey cryptographically bound to TDX quote

❌ **Does NOT protect against**: Supply chain attacks on the build process (use reproducible builds + code transparency for this)

## Measurements & Policy

RATSnest uses **three layers of verification** to ensure code integrity:

### 1. MRTD (Measurement of Trust Domain)

**What it measures**: TDX infrastructure (TDVF firmware + machine configuration)
**When it's set**: At VM launch by TDX hardware
**What it validates**: Running on legitimate GCP TDX infrastructure

```typescript
// shared/policy.ts
allowed_mrtd: [
  "0xc5bf87009d9aaeb2a40633710b2edab43c0b0b8cbe5a036fa45b1057e7086b0726711d0c78ed5859f12b0d76978df03c"
]
```

**MRTD is fixed per GCP machine type** and does NOT vary with your application code.

### 2. RTMRs (Runtime Measurement Registers)

**What they measure**: Boot-time measurements (kernel, initrd, command line)
**When they're set**: During boot by systemd-stub
**What they validate**: Exact code version running in the VM

```typescript
// shared/policy.ts
allowed_rtmr1: [
  "0x4484eea1a5ad776567a76d381d0e4233b28adab4d94e0f4c426f8761d98a6463b9dadb8ad4db878611a09ab5e0a999d2"
]
```

**RTMRs change with every code modification**, providing strong code identity guarantees.

TDX provides 4 RTMRs:
- **RTMR0**: Usually empty
- **RTMR1**: Kernel + initrd + cmdline (use this for code identity)
- **RTMR2**: Additional boot measurements
- **RTMR3**: Additional boot measurements

### 3. IMA (Integrity Measurement Architecture)

**What it measures**: Runtime file integrity (SHA256 hashes of executed binaries)
**When it's measured**: At file access/execution time
**What it validates**: No runtime tampering of binaries

```typescript
// shared/policy.ts
expected_ima_measurements: {
  "/usr/bin/ratsnest": "12c7226a0a41dfd2456b4fc8eb7e547f87c6ced1a9cc18c7657d4bce550997a4",
  "/usr/lib/systemd/systemd-executor": "a0e08eb8f3e086b6d28b66369db05b45915e9bb8584859a282168b1cc44ef78d",
  ...
}
```

**IMA provides runtime integrity** independent of boot measurements. Even if an attacker modifies a binary after boot, the IMA hash won't match.

### Updating Policy After Build

1. **Build image**: `make image`
2. **Deploy to VM**: `make deploy`
3. **Extract measurements** from VM logs:
   ```bash
   make console-output | grep "TDX ATTESTATION - MEASUREMENTS"
   ```
4. **Update `shared/policy.ts`** with new values
5. **Rebuild frontend**: `make build`

## Deployment to GCP

### Build & Deploy

```bash
# Full deployment (build image + deploy to GCP)
make deploy

# Replace existing VM with new image
REPLACE_VM=true make deploy

# Or step-by-step:
make image          # Build TDX disk image
make deploy-gcp     # Upload and deploy to GCP
```

### Environment Variables

```bash
# GCP Configuration
export GCP_PROJECT=your-project-id
export GCP_ZONE=us-west1-a
export INSTANCE_NAME=ratsnest-vm

# Deployment Options
export REPLACE_VM=true  # Delete and recreate VM during deploy
```

### Access Deployed Instance

```bash
# Get VM IP
gcloud compute instances describe ratsnest-vm \
  --zone=us-west1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'

# View logs
gcloud compute ssh ratsnest-vm \
  --zone=us-west1-a \
  -- journalctl -u ratsnest -f

# Test from local frontend
cd frontend && npm run dev
# Then open: http://localhost:5173/?backend=http://VM_IP:3000
```

## Development Workflow

### Frontend with Remote Backend

Test local frontend against deployed TDX backend:

```bash
# Terminal 1: Run local frontend
cd frontend && npm run dev

# Terminal 2: Set up Cloudflare Tunnel (for HTTPS)
cloudflared tunnel --url http://VM_IP:3000

# Browser: Open with query params
http://localhost:5173/?backend=https://your-tunnel.trycloudflare.com&mrtd=0xACTUAL_MRTD
```

### Debug Handshake

The `/debug/handshake-bytes` endpoint shows cryptographic details:

```bash
curl -X POST http://localhost:3000/debug/handshake-bytes \
  -H "Content-Type: application/json" \
  -d '{"pubkey":"0000000000000000000000000000000000000000000000000000000000000000"}'
```

Or use the frontend debug panel (click "🔍 Test Handshake Computation").

## Project Structure

```
ratsnest/
├── backend/              # Deno server (TypeScript)
│   ├── tunnel.ts        # ⭐ TunnelServer + Express proxy (port 3000)
│   │                    #    - Initializes TunnelServer with getQuote()
│   │                    #    - Proxies HTTP requests to Hono API
│   │                    #    - Handles WebSocket /__ra__ endpoint
│   ├── main.ts          # ⭐ Hono API server (port 4000)
│   │                    #    - GET /api/hello - Example API endpoint
│   │                    #    - GET /api/ima/* - IMA log endpoints
│   │                    #    - Serves static frontend (SPA)
│   ├── tdx.ts           # ⭐ TDX quote generation
│   │                    #    - getQuote(reportData) → TDX quote bytes
│   │                    #    - Uses ConfigFS-TSM: /sys/kernel/config/tsm/report
│   │                    #    - Extracts MRTD + RTMRs for policy updates
│   ├── ima.ts           # ⭐ IMA runtime measurements
│   │                    #    - Reads /sys/kernel/security/ima/ascii_runtime_measurements
│   │                    #    - Parses IMA log entries
│   │                    #    - Returns binary hashes for verification
│   ├── debug.ts         # Debug endpoints (for development only)
│   │                    #    - POST /debug/handshake-bytes - Verify SHA-512 computation
│   │                    #    - GET /debug/ima-summary - View IMA log summary
│   ├── deno.json        # Deno config + build tasks
│   └── *.test.ts        # Unit tests
│
├── frontend/            # React SPA (TypeScript + Vite)
│   ├── src/
│   │   └── App.tsx      # ⭐ Main application + TunnelClient
│   │                    #    - TunnelClient.initialize(baseUrl, { customVerifyQuote })
│   │                    #    - verifyTdxQuote() - Checks MRTD/RTMRs/IMA against policy
│   │                    #    - logAndVerifyX25519Binding() - Logs handshake details
│   │                    #    - Encrypted API calls: enc.fetch('/api/hello')
│   ├── package.json     # Dependencies: @teekit/tunnel, @teekit/qvl, react
│   ├── vite.config.ts   # Vite build configuration
│   └── dist/            # Built static files (generated by 'npm run build')
│
├── shared/              # Shared TypeScript code (used by both frontend & backend)
│   └── policy.ts        # ⭐ MRTD/RTMR/IMA policy + verification logic
│                        #    - policy.allowed_mrtd - List of trusted MRTD values
│                        #    - policy.allowed_rtmr1 - List of trusted RTMR1 values
│                        #    - policy.expected_ima_measurements - Binary hash expectations
│                        #    - verifyMeasurements() - Multi-layer verification function
│
├── image/               # TDX image build system
│   ├── build.sh         # ⭐ Build script
│   │                    #    1. Compile backend: deno task build → dist/ratsnest
│   │                    #    2. Build UKI: mkosi → ratsnest-tdx.efi
│   │                    #    3. Extract measurements: measured-boot → measurements.json
│   │                    #    4. Display MRTD for policy updates
│   ├── deploy-gcp.sh    # ⭐ GCP deployment script
│   │                    #    1. Upload image to GCS
│   │                    #    2. Create GCE image
│   │                    #    3. Create/update TDX-enabled VM instance
│   ├── ratsnest/        # mkosi configuration
│   │   ├── mkosi.conf   # Image build settings (Debian, kernel, etc.)
│   │   └── mkosi.extra/ # Files to include in image
│   │       └── usr/bin/ratsnest - Compiled binary (copied during build)
│   └── ratsnest.conf    # Main mkosi config (references flashbots-images)
│
├── build/               # Build artifacts (generated)
│   ├── ratsnest-tdx.efi     # Unified Kernel Image (UKI)
│   ├── ratsnest-tdx.tar.gz  # GCP-compatible disk image
│   └── measurements.json    # Boot measurements (MRTD/RTMRs)
│
└── Makefile             # Build automation
                         #    - make build: Build frontend + backend
                         #    - make image: Build TDX disk image
                         #    - make deploy: Build + deploy to GCP
                         #    - make test: Run tests
```

### Key Files & Their Interconnections

**1. Policy Flow** (`shared/policy.ts`):
```
Build → Extract Measurements → Update policy.ts → Rebuild Frontend → Deploy
```
- Modified by: Developer (after extracting measurements from VM logs)
- Used by: `frontend/src/App.tsx` (client verification)
- Contains: MRTD, RTMRs, IMA hashes

**2. Quote Generation Flow** (`backend/tdx.ts` → `backend/tunnel.ts`):
```
TunnelServer.initialize()
  → getQuote(x25519PublicKey)
    → SHA-512(nonce || iat || pubkey) = report_data
      → ConfigFS-TSM: /sys/kernel/config/tsm/report
        → TDX hardware signs quote
          → Returns quote bytes + verifier_data
```

**3. Client Verification Flow** (`frontend/src/App.tsx`):
```
WebSocket Connect
  → Receive server_kx (quote + verifier_data + runtime_data)
    → Parse quote with @teekit/qvl
      → Extract MRTD, RTMRs, report_data
        → Verify against shared/policy.ts
          → Verify X25519 binding (SHA-512 computation)
            → Fetch IMA log from /api/ima/log
              → Verify IMA hashes against policy
                → ✅ Tunnel established
```

**4. Request Proxying Flow** (`backend/tunnel.ts` → `backend/main.ts`):
```
Client: enc.fetch('/api/hello')
  → Encrypt with XSalsa20-Poly1305
    → Send via WebSocket
      → TunnelServer (port 3000) decrypts
        → Proxy to Hono API (localhost:4000)
          → Hono processes /api/hello
            → Response → TunnelServer encrypts
              → Client decrypts → Returns JSON
```

**5. Build & Deploy Flow**:
```
make build
  → npm run build (frontend → dist/)
  → deno task build (backend → dist/ratsnest)

make image
  → build.sh:
    → Copy ratsnest binary to mkosi.extra/
    → mkosi --profile=gcp → UKI + disk image
    → measured-boot → Extract MRTD/RTMRs
    → Display measurements for policy update

make deploy
  → make image (if needed)
  → deploy-gcp.sh:
    → Upload to GCS
    → Create GCE image
    → Launch TDX VM
  → VM boots → ratsnest service starts
  → Browser connects → Verifies quote → ✅ Encrypted tunnel
```

## Security Model

### What RATSnest Protects Against

✅ **Malicious Cloud Provider**
- Even with root access, GCP cannot decrypt your traffic (end-to-end encryption)
- Cannot modify your code without detection (MRTD/RTMR verification)
- Cannot impersonate your VM (TDX hardware signature)

✅ **Code Tampering**
- Boot-time: MRTD/RTMRs detect modified kernel/initrd
- Runtime: IMA detects modified binaries after boot
- Network: X25519 binding prevents quote reuse

✅ **Man-in-the-Middle Attacks**
- TDX quote proves VM identity
- X25519 ECDH establishes authenticated tunnel
- XSalsa20-Poly1305 provides authenticated encryption

✅ **Rollback Attacks**
- Nonce + timestamp in quote binding
- Client can enforce minimum RTMR versions

### What RATSnest Does NOT Protect Against

❌ **Supply Chain Attacks**
- If your build toolchain is compromised, the attacker can generate valid measurements
- **Mitigation**: Use reproducible builds + code transparency logs

❌ **Side-Channel Attacks**
- TDX provides memory encryption but some side channels may exist
- **Mitigation**: Follow TDX best practices for sensitive data handling

❌ **Kernel Vulnerabilities**
- A kernel exploit could compromise the VM
- **Mitigation**: Keep kernel updated, use minimal attack surface

❌ **Physical Attacks**
- TDX assumes physical security of the CPU package
- **Mitigation**: This is a hardware assumption (trust Intel/AMD)

### Defense in Depth

RATSnest uses **multiple layers** of security:

1. **Hardware Root of Trust**: Intel TDX provides memory encryption + attestation
2. **Boot Integrity**: MRTD/RTMRs verify boot-time measurements
3. **Runtime Integrity**: IMA verifies binary hashes at execution time
4. **Network Security**: TLS (client→server) + attested tunnel (end-to-end)
5. **Cryptographic Binding**: X25519 keys bound to TDX quotes via SHA-512

Each layer is independent - compromising one doesn't compromise the others.

## Extending RATSnest for Production

This is a **proof-of-concept**. Do NOT use this for production...

## Related Projects & Resources

- **TEEKit**: https://github.com/canvasxyz/teekit
- **Flashbots images**: https://github.com/flashbots/flashbots-images
- **Intel TDX**: https://www.intel.com/content/www/us/en/developer/tools/trust-domain-extensions/overview.html
- **ConfigFS-TSM**: https://docs.kernel.org/ABI/testing/configfs-tsm
- **IMA**: https://sourceforge.net/p/linux-ima/wiki/Home/
- **go-configfs-tsm**: https://github.com/google/go-configfs-tsm
