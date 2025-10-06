.PHONY: help lint test build clean image deploy deploy-gcp dev-backend dev-frontend logs console-output extract-mrtd watch-logs

# Default target
help:
	@echo "RATSnest - Remote Attestation Tunnel with TDX"
	@echo ""
	@echo "Available targets:"
	@echo "  make lint        - Run linters on backend and frontend"
	@echo "  make test        - Run all tests"
	@echo "  make build       - Build frontend and backend binary"
	@echo "  make image       - Build TDX disk image (requires Nix)"
	@echo "  make deploy      - Full deployment: build image + deploy to GCP"
	@echo "  make deploy-gcp  - Deploy to Google Cloud (requires image)"
	@echo "  make clean       - Remove build artifacts"
	@echo "  make dev-backend - Run backend in watch mode"
	@echo "  make dev-frontend- Run frontend dev server"
	@echo ""
	@echo "Monitoring targets:"
	@echo "  make logs           - View latest logs from VM (last 100 lines)"
	@echo "  make watch-logs     - Auto-refresh logs every 2 seconds"
	@echo "  make console-output - View full serial console output (for MRTD)"
	@echo "  make extract-mrtd   - Extract MRTD from console output"
	@echo ""
	@echo "Environment variables:"
	@echo "  REPLACE_VM=true  - Delete and recreate VM during deploy"
	@echo "                     Usage: REPLACE_VM=true make deploy"
	@echo ""

# Linting
lint:
	@echo "==> Linting backend..."
	@cd backend && deno lint
	@echo "==> Linting frontend..."
	@cd frontend && npm run lint
	@echo "✓ Linting complete"

# Testing
test:
	@echo "==> Running backend tests..."
	@cd backend && deno test --allow-all
	@echo "==> Running frontend tests (if configured)..."
	@cd frontend && npm run test || echo "Frontend tests not yet configured"
	@echo "✓ Tests complete"

# Build frontend and backend
build:
	@echo "==> Building frontend..."
	@cd frontend && npm run build
	@echo "==> Building backend binary..."
	@cd backend && deno task build
	@echo "✓ Build complete"
	@echo "   Binary: backend/dist/ratsnest"
	@echo "   Frontend: frontend/dist/"

# Build TDX disk image
image:
	@echo "==> Building TDX disk image..."
	@cd image && ./build.sh
	@echo "✓ Image built"
	@echo "   UKI:  build/ratsnest-tdx.efi"
	@echo "   GCP:  build/ratsnest-tdx.tar.gz"
	@echo ""
	@echo "MRTD value has been displayed above."
	@echo "Update shared/policy.ts with the MRTD, then run 'make build' and 'make image' again."

# Full deployment: build image + deploy to GCP
deploy: image deploy-gcp

# Deploy to Google Cloud
deploy-gcp:
	@echo "==> Deploying to Google Cloud..."
	@cd image && ./deploy-gcp.sh
	@echo "✓ Deployment complete"

# Clean build artifacts
clean:
	@echo "==> Cleaning build artifacts..."
	@rm -rf backend/dist
	@rm -rf frontend/dist
	@rm -rf build/
	@echo "✓ Clean complete"

# Development servers
dev-backend:
	@echo "==> Starting backend development server..."
	@cd backend && deno task dev

dev-frontend:
	@echo "==> Starting frontend development server..."
	@cd frontend && npm run dev

# Monitoring and debugging
logs:
	@echo "==> Fetching latest logs from ratsnest-vm..."
	@echo "Note: Serial console doesn't stream. Run this repeatedly to see updates."
	@echo ""
	@gcloud compute instances get-serial-port-output ratsnest-vm --zone=us-west1-a --start=0 2>/dev/null | tail -100

console-output:
	@echo "==> Fetching serial console output..."
	@echo "This shows ALL console output including MRTD on first boot"
	@echo ""
	@gcloud compute instances get-serial-port-output ratsnest-vm --zone=us-west1-a

extract-mrtd:
	@echo "==> Extracting MRTD from console output..."
	@echo ""
	@gcloud compute instances get-serial-port-output ratsnest-vm --zone=us-west1-a 2>/dev/null | grep -A 5 "TDX ATTESTATION - MRTD VALUE" || echo "MRTD not found in console output. The VM may still be booting or TDX quote generation may have failed."
	@echo ""
	@echo "Tip: Run 'make console-output' to see full console output"
	@echo "Tip: Run 'make watch-logs' to auto-refresh logs"

watch-logs:
	@echo "==> Watching logs from ratsnest-vm (refreshing every 2s)..."
	@echo "Press Ctrl+C to stop"
	@echo ""
	@while true; do \
		clear; \
		echo "==> Ratsnest VM Logs (last 50 lines) - $$(date)"; \
		echo ""; \
		gcloud compute instances get-serial-port-output ratsnest-vm --zone=us-west1-a --start=0 2>/dev/null | tail -50 || echo "Error fetching logs"; \
		sleep 2; \
	done
