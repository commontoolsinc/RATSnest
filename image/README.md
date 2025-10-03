# Ratsnest TDX Image Builder

This directory contains the mkosi configuration for building a bootable TDX VM image with the ratsnest application baked in.

## Prerequisites

**IMPORTANT**: Building the TDX image requires:

1. **Nix Package Manager** with flakes enabled
2. **flashbots-images** repository:
   ```bash
   git clone https://github.com/flashbots/flashbots-images /home/jake/flashbots-images
   ```

### Installing Nix

```bash
# Install Nix (single user mode)
sh <(curl -L https://nixos.org/nix/install) --no-daemon

# Enable flakes
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

## Current Status (Phase 5)

For Phase 5, the full image build is **optional**. The MRTD policy system is already working with a sample MRTD value for testing:

- ✅ Frontend verifies TDX quotes and extracts MRTD
- ✅ Policy enforcement is implemented
- ✅ Sample MRTD allows testing without TDX hardware
- 🔜 Full image build (requires Nix + TDX-enabled system)

## Building

```bash
cd /home/jake/ratsnest/image
./build.sh
```

This will:
1. Build the ratsnest binary (`backend/dist/ratsnest`)
2. Build the mkosi TDX image with the binary embedded
3. Extract MRTD measurements using `measured-boot`
4. Display the MRTD value to update in `shared/policy.ts`

## Output

- `build/ratsnest-tdx.efi` - Bootable UKI image
- `build/measurements.json` - MRTD and RTMR measurements

## Structure

- `base/` - Minimal Debian base configuration
- `ratsnest/` - Ratsnest application module
- `ratsnest.conf` - Top-level configuration (includes base + ratsnest)

## What Gets Measured

The MRTD (Measurement of Trust Domain) is a SHA-384 hash of:
- Linux kernel binary
- Initial ramdisk (initrd)
- Kernel command line parameters

Any change to these components will result in a different MRTD.
