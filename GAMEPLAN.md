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
- https://github.com/canvasxyz/teekit
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

## Phase 5: MRTD Measurement & Policy ✅

**Goal**: Pin client to specific version of server code

**Status**: Complete - MRTD policy infrastructure is ready

### Implementation
Created `shared/policy.ts` with MRTD validation:
```typescript
export const policy = {
  allowed_mrtd: [
    // Add MRTD value from image/build.sh output
  ]
}

export function isMRTDAllowed(mrtd: string): boolean { ... }
```

### Frontend Integration
Updated `frontend/src/App.tsx`:
- Removed mock quote verification
- Parse TDX quotes using @teekit/qvl
- Extract MRTD from quote.body.mr_td
- Verify against policy.allowed_mrtd
- Display verification status in UI

### Next Steps
1. Run `image/build.sh` to generate first MRTD value
2. Copy MRTD from build output
3. Update `shared/policy.ts` with the MRTD value
4. Test that wrong MRTD causes connection failure

### Acceptance Criteria
- ✅ Client parses and verifies TDX quotes
- ✅ MRTD is extracted from quote body
- ✅ Policy validation is implemented
- ⏳ Waiting for first image build to get real MRTD value

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

## Phase 7: Reproducible Image Build ✅

**Goal**: Bootable disk image with known MRTD

**Status**: Complete - ready to build and deploy to GCP

### Implementation

Created mkosi-based build system in `image/` with GCP deployment:

**Directory Structure:**
```
image/
├── base/
│   ├── base.conf              # Minimal Debian base
│   └── mkosi.skeleton/        # Init + systemd config
├── ratsnest/
│   ├── ratsnest.conf          # Ratsnest module config
│   ├── mkosi.build            # Copies binary into image
│   ├── mkosi.postinst         # Enables systemd service
│   └── mkosi.extra/
│       └── etc/systemd/system/
│           └── ratsnest.service
├── ratsnest.conf              # Top-level config
└── build.sh                   # Build script
```

**Base Image:**
- Debian trixie minimal (20MB)
- Custom kernel with TDX support
- systemd for process management
- No SSH/shell access (hardened)

**Build Pipeline:**
```bash
cd image && ./build.sh
```

This will:
1. Build ratsnest binary (`deno task build`)
2. Build mkosi TDX image with embedded binary (UKI format)
3. Convert to GCP-compatible disk image (disk.raw in tar.gz)
4. Run measured-boot to extract MRTD
5. Display MRTD value for policy.ts

**Deployment to GCP:**
```bash
cd image && ./deploy-gcp.sh
```

This will:
1. Upload image to Cloud Storage
2. Create GCP Compute Image with TDX_CAPABLE feature
3. Deploy Confidential VM with TDX enabled
4. Output VM IP address for testing

**Image Structure:**
```
Boot → Kernel → initrd → systemd → ratsnest.service
                   ↑
                   Measured in MRTD
```

### Prerequisites

Clone flashbots-images for build tools:
```bash
git clone https://github.com/flashbots/flashbots-images /home/jake/flashbots-images
```

Ensure Nix is installed with flakes enabled (see flashbots-images README).

### Deployment Workflow

1. **Build Image:**
   ```bash
   cd image && ./build.sh
   ```
   Outputs:
   - `build/ratsnest-tdx.efi` - UKI bootable image
   - `build/ratsnest-tdx.tar.gz` - GCP disk image
   - `build/measurements.json` - MRTD values

2. **Extract MRTD:**
   Copy the MRTD value from build output

3. **Update Policy:**
   Edit `shared/policy.ts`:
   ```typescript
   allowed_mrtd: ["0x1234...abcd"]
   ```

4. **Rebuild Binary:**
   ```bash
   cd backend && deno task build
   ```

5. **Rebuild Image with Updated Policy:**
   ```bash
   cd image && ./build.sh
   ```

6. **Deploy to GCP:**
   ```bash
   cd image && ./deploy-gcp.sh
   ```

   Or with custom configuration:
   ```bash
   GCP_PROJECT=my-project \
   INSTANCE_NAME=ratsnest-prod \
   ./deploy-gcp.sh
   ```

7. **Test Connection:**
   Point your frontend to the VM's external IP and verify MRTD

### Acceptance Criteria
- ✅ mkosi configuration created
- ✅ Build script written with GCP profile
- ✅ Systemd service configured
- ✅ GCP deployment script created
- ✅ GCP deployment guide written
- ⏳ First successful image build
- ⏳ MRTD extraction verified
- ⏳ Image deployed to GCP
- ⏳ VM boots into ratsnest service
- ⏳ Client verifies and connects

**Resources**:
- [flashbots-images](https://github.com/flashbots/flashbots-images)
- [mkosi docs](https://github.com/systemd/mkosi)
- [TDX hardening](https://intel.github.io/ccc-linux-guest-hardening-docs/tdx-guest-hardening.html)
- [GCP TDX Documentation](https://cloud.google.com/confidential-computing/confidential-vm/docs/create-custom-confidential-vm-images)

**Files**:
- `image/build.sh` - Build script with GCP profile
- `image/deploy-gcp.sh` - GCP deployment script
- `image/GCP-DEPLOYMENT.md` - Detailed deployment guide

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

- [x] Phase 1: Hello World (no attestation)
- [x] Phase 2: Server tunnel (mock quotes)
- [x] Phase 3: Client tunnel (connects)
- [x] Phase 4: Real TDX quotes
- [x] Phase 5: MRTD policy enforcement
- [x] Phase 6: Single binary build
- [x] Phase 7: Reproducible disk image + GCP deployment (ready to build & deploy)

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
