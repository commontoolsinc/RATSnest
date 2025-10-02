# Ratsnest - Simplified TDX Remote Attestation PoC

## Goal
Build a minimal proof-of-concept that demonstrates end-to-end confidential compute with remote attestation:
- Browser client can verify it's talking to a specific version of code running in a TDX VM
- App-layer encryption that cloud providers can't intercept
- Reproducible builds with MRTD measurements

## Tech Stack
- **Backend**: Deno 2 + Hono API + TEEKit Tunnel
- **Frontend**: Vite + React with TEEKit client
- **Build**: Single compiled binary with embedded frontend
- **Image**: Custom Linux disk image (mkosi) with MRTD measurement

## Phase 1: Hello World (No Attestation)

**Goal**: Basic working app with no security features yet

### Backend
```bash
mkdir -p backend
cd backend
deno init
```

Create `backend/main.ts`:
- Basic Hono server on port 3000
- `/api/hello` endpoint that returns "world"
- Static file serving for the SPA

### Frontend
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

Create simple `App.tsx`:
- Fetches `/api/hello`
- Displays response

### Acceptance
- `deno task dev` runs backend on :3000
- `npm run dev` runs frontend on :5173
- Frontend can call `/api/hello` and display response

---

## Phase 2: Add TEEKit Tunnel (Server)

**Goal**: Wrap Hono backend with TEEKit tunnel

**Note**: TEEKit tunnel is Node-only, so we'll run it via Deno's npm compatibility

### Create tunnel server
- Install `@teekit/tunnel` via npm: specifier
- Create Express app that proxies to Hono
- Wire up TEEKit TunnelServer
- Create stub `getQuote()` function (returns mock data for now)

### Architecture
```
Browser → TunnelServer(:3000) → Hono API(:4000)
```

### Acceptance
- TunnelServer starts without errors
- Can still call `/api/hello` through the tunnel
- Mock quotes being generated

**Resources**:
- https://github.com/canvasxz/teekit
- https://hackmd.io/@raymondz/BJdO52unlg

---

## Phase 3: Add TEEKit Client (Frontend)

**Goal**: Browser does remote attestation before talking to server

### Install packages
```bash
npm install @teekit/tunnel @teekit/qvl
```

### Update App.tsx
- Initialize `TunnelClient` with origin
- Pass MRTD policy (mock value for now)
- Make API calls through `client.fetch()`
- Display tunnel status

### Acceptance
- Frontend attempts tunnel connection
- Can make authenticated API calls through tunnel
- See connection status in UI

**Resources**:
- TEEKit client examples: https://github.com/canvasxz/teekit/tree/main/examples

---

## Phase 4: Real TDX Quotes

**Goal**: Get actual attestation evidence from TDX VM

### On GCP Confidential VM
- Check `/dev/tdx_guest` exists
- Install `go-tdx-guest` or Intel Trust Authority CLI
- Implement real `getQuote(pubkey)`:
  - Hash pubkey with SHA-384
  - Bind to `report_data`
  - Call TDX guest device
  - Return quote bytes

### Update backend
Replace mock quote with real TDX quote generation

### Acceptance
- Server generates real TDX quotes
- Quotes contain expected fields (MRTD, report_data)
- Client can parse quotes

**Resources**:
- https://github.com/google/go-tdx-guest
- https://docs.trustauthority.intel.com/main/articles/articles/ita/integrate-go-tdx-cli.html

---

## Phase 5: MRTD Measurement & Policy

**Goal**: Pin client to specific version of server code

### Extract MRTD
- Boot TDX VM
- Generate quote
- Parse MRTD from quote (bytes 112-159)
- Document the value

### Update policy
Create `policy.ts` (shared between frontend/backend):
```typescript
export const policy = {
  allowed_mrtd: [
    "your_actual_mrtd_hex_value"
  ],
  report_data: {
    type: "sha384(tunnel_pubkey)"
  }
}
```

### Update client
- Pass real MRTD to TunnelClient
- Verify quotes match policy

### Acceptance
- Client only connects when MRTD matches
- Wrong MRTD = connection refused
- Attestation verified end-to-end

---

## Phase 6: Build & Bundle

**Goal**: Single binary with embedded frontend

### Build frontend
```bash
cd frontend
npm run build
# Creates frontend/dist/
```

### Compile backend
```bash
cd backend
deno compile \
  --allow-all \
  --include=../frontend/dist \
  --output=ratsnest \
  main.ts
```

### Update backend to serve embedded files
- Detect if running from compiled binary
- Serve static files from embedded `dist/`
- Handle SPA routing (serve index.html for unknown routes)

### Acceptance
- `./ratsnest` runs standalone
- Serves SPA on :3000
- API and tunnel work from single binary
- No external dependencies needed at runtime

**Resources**:
- https://docs.deno.com/runtime/reference/cli/compile/

---

## Phase 7: Reproducible Image Build

**Goal**: Bootable disk image with known MRTD

### Why this matters
Every time you change kernel/initrd/cmdline, MRTD changes. We need:
- Reproducible builds → same input = same MRTD
- Direct boot into app (no shell/SSH)
- Baked-in binary for measurement

### Choose build tool
**Option A**: mkosi (simplest)
- Used by Flashbots for TDX images
- Configuration-based
- Good Ubuntu/Debian support

**Option B**: Nix (more complex but better reproducibility)

### Build pipeline
1. Create mkosi configuration
2. Embed `ratsnest` binary in image
3. Configure systemd to boot directly into app
4. Disable SSH/shell access
5. Build image
6. Extract MRTD measurement

### Image structure
```
Boot → Kernel → initrd → systemd → ratsnest
                   ↑
                   Measured in MRTD
```

### Deploy & test
1. Upload image to GCP
2. Create Confidential VM from image
3. Boot and extract quote
4. Verify MRTD matches policy
5. Update client policy with real MRTD

### Acceptance
- Image boots directly into application
- No interactive access (no shell/SSH)
- MRTD is stable across rebuilds
- Client successfully verifies and connects

**Resources**:
- https://github.com/flashbots/mkosi-poc
- https://github.com/flashbots/flashbots-images
- https://intel.github.io/ccc-linux-guest-hardening-docs/tdx-guest-hardening.html

---

## What We're NOT Doing (For Now)

This PoC intentionally omits:
- ❌ IMA → RTMR runtime measurement (Phase 9 in old plan)
- ❌ Production hardening (Phase 13)
- ❌ Comprehensive testing (Phase 16)
- ❌ Security audits
- ❌ Monitoring/observability
- ❌ Multi-MRTD policies
- ❌ Blue/green deployments
- ❌ Documentation for every detail

We can add these later if/when needed.

---

## Key Concepts (Quick Reference)

**MRTD**: Measurement of Trust Domain - SHA-384 hash of initial VM state (kernel + initrd + cmdline). This is what proves "exact version of code".

**report_data**: 64 bytes of user data included in TDX quote. TEEKit uses this to bind the tunnel's ephemeral public key, preventing MITM.

**TEEKit Tunnel**: App-layer encryption where session key is bound into attestation quote. Browser verifies quote in JavaScript before opening channel.

**TDX VM**: Intel Trust Domain Extensions - hardware-based confidential compute. Host/VMM can't read memory.

---

## Phase Checklist

- [ ] Phase 1: Hello World (no attestation)
- [ ] Phase 2: Server tunnel (mock quotes)
- [ ] Phase 3: Client tunnel (connects)
- [ ] Phase 4: Real TDX quotes
- [ ] Phase 5: MRTD policy enforcement
- [ ] Phase 6: Single binary build
- [ ] Phase 7: Reproducible disk image

---

## Success Criteria

You know you're done when:
1. ✅ Browser client connects to server
2. ✅ Client verifies server is running in TDX VM
3. ✅ Client verifies exact version of code via MRTD
4. ✅ Connection fails if MRTD doesn't match
5. ✅ Everything runs from single binary
6. ✅ Can build reproducible disk image with MRTD measurement

---

## Next Steps After PoC

Once this works, you can add:
- IMA runtime measurement (RTMR)
- Production hardening
- Better error handling
- Monitoring
- Tests
- Multi-region deployment
- Scaling

But first: get the core loop working!
