# RATSnest

**Remote Attestation Tunnel with TDX** - A minimal proof-of-concept demonstrating end-to-end confidential computing with Intel TDX remote attestation.

Browser clients verify they're talking to a specific version of code running in a TDX VM using cryptographic attestation, with app-layer encryption that cloud providers cannot intercept.

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

```
┌─────────────┐                    ┌──────────────────────────┐
│   Browser   │◄──────HTTPS───────►│   TDX Confidential VM    │
│   Client    │                    │                          │
│             │  1. Handshake      │  ┌────────────────────┐  │
│  - Verify   │────────────────────┼─►│  TunnelServer      │  │
│    MRTD     │  2. Get TDX Quote  │  │  (Express + WS)    │  │
│  - Check    │◄───────────────────┼──│  - Generate Quote  │  │
│    X25519   │  3. Encrypted Msgs │  │  - Bind Pubkey     │  │
│    Binding  │◄──────────────────►│  └────────────────────┘  │
│             │                    │           ↓               │
└─────────────┘                    │  ┌────────────────────┐  │
                                   │  │  Hono API Server   │  │
                                   │  │  - /api/hello      │  │
                                   │  │  - Static files    │  │
                                   │  └────────────────────┘  │
                                   │                          │
                                   │  /sys/kernel/config/tsm  │
                                   │  (ConfigFS-TSM for TDX)  │
                                   └──────────────────────────┘
```

**Key Components:**
- **Frontend**: React + Vite + @teekit/tunnel client
- **Backend**: Deno + Express TunnelServer → Hono API
- **Attestation**: Intel TDX quotes via ConfigFS-TSM
- **Policy**: MRTD-based code identity verification

## MRTD Policy

The MRTD (Measurement of Trust Domain) is a SHA-384 hash of the kernel, initrd, and boot parameters. The client verifies this to ensure it's talking to the exact version of code you deployed.

**Update policy:**
1. Build image: `make image`
2. Copy MRTD from build output
3. Update `shared/policy.ts`:
   ```typescript
   export const policy = {
     allowed_mrtd: ["0xYOUR_MRTD_HERE"]
   }
   ```
4. Rebuild: `make build`

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
├── backend/           # Deno server
│   ├── main.ts       # Hono API
│   ├── tunnel.ts     # TunnelServer with TDX
│   ├── tdx.ts        # ConfigFS-TSM quote generation
│   ├── debug.ts      # Debug endpoints
│   └── *.test.ts     # Unit tests
├── frontend/         # React SPA
│   └── src/
│       └── App.tsx   # Client with verification
├── shared/           # Shared code
│   └── policy.ts     # MRTD policy
├── image/            # Build system
│   ├── build.sh      # Build TDX image
│   └── deploy-gcp.sh # Deploy to GCP
└── Makefile          # Build tasks
```

## Key Files

- **`shared/policy.ts`** - MRTD policy (update after each build)
- **`backend/tdx.ts`** - TDX quote generation via ConfigFS-TSM
- **`frontend/src/App.tsx`** - Client-side verification
- **`image/build.sh`** - Build reproducible TDX image
- **`image/deploy-gcp.sh`** - Deploy to Google Cloud

## Security Model

1. **Boot-time Measurement**: MRTD captures kernel + initrd + cmdline
2. **Quote Generation**: TDX hardware signs a quote containing MRTD + report_data
3. **Binding**: X25519 pubkey hashed into report_data (SHA-384 → 48 bytes + 16 zeros)
4. **Verification**: Client checks MRTD matches policy AND pubkey binding is correct
5. **Encryption**: All traffic encrypted with ephemeral session key

**Threat Model:**
- ✅ Protects against malicious cloud provider
- ✅ Verifies exact code version running
- ✅ Prevents MITM attacks
- ❌ Does NOT protect against supply chain attacks on build
- ❌ Does NOT protect against runtime compromise (IMA/RTMR needed)

## Troubleshooting

### Connection Fails
```bash
# Check VM is running
gcloud compute instances list --filter="name=ratsnest-vm"

# Check logs for errors
gcloud compute ssh ratsnest-vm --zone=us-west1-a -- journalctl -u ratsnest -f
```

### MRTD Mismatch
- The MRTD changes with ANY modification to kernel/initrd/cmdline
- Rebuild image and update `shared/policy.ts` with new MRTD
- Use `?mrtd=` query param for testing without rebuilding

### WebCrypto Errors
- TunnelClient requires HTTPS
- Use Cloudflare Tunnel or ngrok for local testing
- Or access via `https://` in production

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
