# Contributing to RATSnest

Thank you for your interest in contributing! This guide will help you get set up and understand the development workflow.

## Development Environment Setup

### Prerequisites

1. **Deno 2.0+**: https://deno.land/
2. **Node.js 20+**: https://nodejs.org/
3. **Nix with flakes**: https://nixos.org/download.html
   ```bash
   # Enable flakes
   mkdir -p ~/.config/nix
   echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
   ```
4. **Google Cloud SDK** (for deployment): https://cloud.google.com/sdk/docs/install
5. **flashbots-images** (for image builds):
   ```bash
   git clone https://github.com/flashbots/flashbots-images /home/$USER/flashbots-images
   ```

### First-Time Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR-ORG/ratsnest.git
cd ratsnest

# 2. Install frontend dependencies
cd frontend && npm install && cd ..

# 3. Verify Deno works
cd backend && deno --version

# 4. Run tests to verify setup
make test
```

## Development Workflow

### Running Locally

**Terminal 1 - Backend:**
```bash
cd backend
deno task dev  # Runs tunnel server with hot reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev  # Runs Vite dev server on :5173
```

**Browser:**
Open http://localhost:5173

### Testing

```bash
# Run all tests
make test

# Run backend tests only
cd backend && deno test --allow-all

# Run specific test file
cd backend && deno test tdx.test.ts --allow-all

# Run frontend tests
cd frontend && npm run test

# Run with watch mode
cd backend && deno test --allow-all --watch
```

### Linting

```bash
# Lint all code
make lint

# Lint backend only
cd backend && deno lint

# Lint frontend only
cd frontend && npm run lint

# Auto-fix linting issues
cd frontend && npm run lint -- --fix
```

### Building

```bash
# Build everything
make build

# Build frontend only (outputs to frontend/dist/)
cd frontend && npm run build

# Build backend binary (includes embedded frontend)
cd backend && deno task build  # Outputs to backend/dist/ratsnest

# Build TDX disk image
make image  # or: cd image && ./build.sh
```

## Code Style Guidelines

### Backend (Deno/TypeScript)

- Use **semicolons** at line endings
- **2 spaces** for indentation
- **Double quotes** for strings
- Prefer `const` over `let`
- Use explicit return types for exported functions
- Add JSDoc comments for public APIs

**Example:**
```typescript
/**
 * Generate a TDX quote bound to an X25519 public key
 */
export async function getQuote(pubkey: Uint8Array): Promise<Uint8Array> {
  const reportData = await hashPubkey(pubkey);
  return await generateQuote(reportData);
}
```

### Frontend (React/TypeScript)

- Follow the same TypeScript style as backend
- Use **functional components** with hooks
- Prefer `async/await` over `.then()`
- Extract complex logic into separate functions
- Use descriptive variable names

**Example:**
```typescript
async function verifyTdxQuote(quote: TdxQuote): Promise<boolean> {
  const mrtd = extractMRTD(quote);
  return isMRTDAllowed(mrtd);
}
```

### Shared Code

- Place shared types and utilities in `shared/`
- Export interfaces, not implementation details
- Keep dependencies minimal

## Project Structure

```
ratsnest/
├── backend/              # Deno backend
│   ├── main.ts          # Hono API server
│   ├── tunnel.ts        # TunnelServer wrapper
│   ├── tdx.ts           # TDX quote generation
│   ├── debug.ts         # Debug endpoints
│   ├── samples.ts       # Sample quotes for testing
│   ├── *.test.ts        # Unit tests
│   └── deno.json        # Deno config & tasks
├── frontend/            # React frontend
│   ├── src/
│   │   ├── App.tsx     # Main component
│   │   └── main.tsx    # Entry point
│   ├── package.json
│   └── vite.config.ts
├── shared/              # Shared code
│   └── policy.ts       # MRTD policy & validation
├── image/               # Image build system
│   ├── build.sh        # Build TDX image + extract MRTD
│   ├── deploy-gcp.sh   # Deploy to Google Cloud
│   ├── ratsnest.conf   # Top-level mkosi config
│   ├── base/           # Base image config
│   └── ratsnest/       # Ratsnest module config
├── Makefile            # Build automation
└── GAMEPLAN.md         # Development roadmap
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Your Changes

- Write tests for new functionality
- Update documentation if needed
- Follow code style guidelines
- Run `make lint` and `make test` before committing

### 3. Test Locally

```bash
# Run tests
make test

# Build to verify everything compiles
make build

# Test image build (requires Nix)
make image
```

### 4. Commit

```bash
git add .
git commit -m "feat: add new feature"
# or
git commit -m "fix: resolve issue with X"
```

**Commit message format:**
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `test:` for test additions/changes
- `refactor:` for code refactoring
- `chore:` for build/tooling changes

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Testing Strategy

### Unit Tests

- **Location**: `backend/*.test.ts`
- **Run**: `cd backend && deno test --allow-all`
- **Coverage**: Aim for >80% coverage on critical paths

**Test Categories:**
1. **Crypto tests** (`tdx.test.ts`): Hash functions, report_data generation
2. **Verification tests** (`verify.test.ts`): Quote parsing, MRTD extraction
3. **Negative tests** (`verify-negative.test.ts`): Error handling, invalid inputs

### Integration Tests

- **Location**: `backend/tunnel.test.ts` (future)
- **Purpose**: Test full handshake flow
- **Requires**: Mock or real TDX environment

### Frontend Tests

- **Location**: `frontend/src/*.test.tsx` (future)
- **Framework**: Vitest
- **Run**: `cd frontend && npm run test`

## Debugging

### Backend Debugging

```bash
# Enable debug logging
USE_REAL_TDX=true deno run --allow-all --inspect-brk tunnel.ts

# Or use console.log statements
console.log('[Debug]', variableName);
```

### Frontend Debugging

- Use browser DevTools console
- Click "🔍 Test Handshake Computation" button for crypto details
- Check Network tab for TunnelServer requests

### TDX Quote Debugging

```bash
# Check if TDX is available
ls /sys/kernel/config/tsm/report

# Generate test quote
cd backend
deno run --allow-all tdx.ts

# View quote in logs
journalctl -u ratsnest -f
```

## Deployment Workflow

### 1. Update Policy After Build

```bash
# Build image
make image

# Copy MRTD from output
# Edit shared/policy.ts with new MRTD
# Rebuild binary
make build

# Rebuild image with updated policy
make image
```

### 2. Deploy to GCP

```bash
# Set environment
export GCP_PROJECT=your-project-id

# Deploy
make deploy

# Or step-by-step:
make image          # Build image
make deploy-gcp     # Upload & create VM
```

### 3. Verify Deployment

```bash
# Get VM IP
gcloud compute instances describe ratsnest-vm \
  --zone=us-west1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'

# Check logs
gcloud compute ssh ratsnest-vm --zone=us-west1-a -- journalctl -u ratsnest -f

# Test connection
curl http://VM_IP:3000/api/hello
```

## Common Issues

### "Permission denied" errors in backend

**Solution**: Ensure all `deno run` commands include `--allow-all` or specific permissions:
```bash
deno run --allow-net --allow-read tunnel.ts
```

### Frontend build fails

**Solution**: Clear node_modules and reinstall:
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### TDX quote generation fails

**Solution**:
1. Check if running on TDX-capable hardware
2. Verify `/sys/kernel/config/tsm/report` exists
3. Use sample quote for testing: Set `USE_REAL_TDX=false`

### MRTD mismatch after deploy

**Solution**: Rebuild with updated policy:
```bash
# Get MRTD from last build output or logs
# Update shared/policy.ts
make build
make image
make deploy
```

## Questions?

- Check the [README](README.md) for architecture overview
- Review [GAMEPLAN.md](GAMEPLAN.md) for project roadmap
- Open an issue on GitHub for bugs or feature requests

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Accept feedback gracefully
- Help others learn and grow

Happy hacking! 🦫
