#!/bin/bash
set -euo pipefail

# Source Nix profile if it exists
if [ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    source "$HOME/.nix-profile/etc/profile.d/nix.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FLASHBOTS_IMAGES="/home/jake/flashbots-images"

cd "$PROJECT_ROOT"

echo "=================================================="
echo "Building Ratsnest TDX Image"
echo "=================================================="

# Step 1: Build the ratsnest binary
echo ""
echo "[1/4] Building ratsnest binary..."
cd "$PROJECT_ROOT/backend"
deno task build
cd "$PROJECT_ROOT"

if [ ! -f "$PROJECT_ROOT/backend/dist/ratsnest" ]; then
    echo "Error: Binary not found at backend/dist/ratsnest"
    exit 1
fi

echo "✓ Binary built: $(ls -lh backend/dist/ratsnest | awk '{print $5}')"

# Copy binary to location mkosi can access
mkdir -p "$PROJECT_ROOT/image/ratsnest/mkosi.extra/usr/bin"
cp "$PROJECT_ROOT/backend/dist/ratsnest" "$PROJECT_ROOT/image/ratsnest/mkosi.extra/usr/bin/ratsnest"
chmod 755 "$PROJECT_ROOT/image/ratsnest/mkosi.extra/usr/bin/ratsnest"

# Step 2: Build mkosi image
echo ""
echo "[2/4] Building mkosi image with GCP conversion..."
cd "$FLASHBOTS_IMAGES"

# Call mkosi with GCP profile to generate both UKI and GCP-compatible disk.raw
nix develop -c mkosi --force -I "$PROJECT_ROOT/image/ratsnest.conf" --profile=gcp

if [ ! -f "$FLASHBOTS_IMAGES/build/tdx-debian.efi" ]; then
    echo "Error: Image not found at $FLASHBOTS_IMAGES/build/tdx-debian.efi"
    exit 1
fi

if [ ! -f "$FLASHBOTS_IMAGES/build/tdx-debian.tar.gz" ]; then
    echo "Warning: GCP disk image not found at $FLASHBOTS_IMAGES/build/tdx-debian.tar.gz"
    echo "GCP profile may not have run successfully"
fi

# Copy to project build directory
mkdir -p "$PROJECT_ROOT/build"
cp "$FLASHBOTS_IMAGES/build/tdx-debian.efi" "$PROJECT_ROOT/build/ratsnest-tdx.efi"

if [ -f "$FLASHBOTS_IMAGES/build/tdx-debian.tar.gz" ]; then
    cp "$FLASHBOTS_IMAGES/build/tdx-debian.tar.gz" "$PROJECT_ROOT/build/ratsnest-tdx.tar.gz"
    echo "✓ Image built: $(ls -lh $PROJECT_ROOT/build/ratsnest-tdx.efi | awk '{print $5}')"
    echo "✓ GCP image:   $(ls -lh $PROJECT_ROOT/build/ratsnest-tdx.tar.gz | awk '{print $5}')"
else
    echo "✓ Image built: $(ls -lh $PROJECT_ROOT/build/ratsnest-tdx.efi | awk '{print $5}')"
fi

# Step 3: Extract MRTD measurements
echo ""
echo "[3/4] Extracting MRTD measurements..."
cd "$FLASHBOTS_IMAGES"
nix develop -c measured-boot \
    "$PROJECT_ROOT/build/ratsnest-tdx.efi" \
    "$PROJECT_ROOT/build/measurements.json" \
    --direct-uki

if [ ! -f "$PROJECT_ROOT/build/measurements.json" ]; then
    echo "Error: Measurements not found at $PROJECT_ROOT/build/measurements.json"
    exit 1
fi

cd "$PROJECT_ROOT"

echo "✓ Measurements extracted to build/measurements.json"

# Step 4: Display MRTD
echo ""
echo "[4/4] Extracting MRTD value..."

# Extract MRTD from measurements.json (it's in the RTMR0 field)
MRTD=$(jq -r '.rtmr0' "$PROJECT_ROOT/build/measurements.json" 2>/dev/null || echo "unknown")

echo ""
echo "=================================================="
echo "Build Complete!"
echo "=================================================="
echo ""
echo "Image:        build/ratsnest-tdx.efi"
echo "Measurements: build/measurements.json"
echo ""
echo "MRTD (RTMR0):"
echo "  $MRTD"
echo ""
echo "Update shared/policy.ts with this MRTD value:"
echo "  allowed_mrtd: [\"$MRTD\"]"
echo ""
