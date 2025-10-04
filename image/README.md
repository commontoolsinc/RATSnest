# Ratsnest TDX Image Build & Deployment

This directory contains the mkosi configuration for building bootable TDX VM images and deploying them to GCP.

## Quick Start

```bash
# 1. Build the image
./build.sh

# 2. Deploy to GCP
./deploy-gcp.sh

# 3. Update MRTD policy and rebuild
# Edit ../shared/policy.ts with MRTD from build output
cd ../backend && deno task build
cd ../image && ./build.sh && ./deploy-gcp.sh
```

## Prerequisites

**Build Requirements:**
1. **Nix** with flakes enabled
2. **flashbots-images** cloned to `/home/jake/flashbots-images`
3. **User namespace support** (test: `unshare --map-root-user whoami`)

**Deployment Requirements:**
1. **gcloud CLI** authenticated
2. **GCP project** with Confidential Computing enabled

See `BUILD-REQUIREMENTS.md` and `GCP-DEPLOYMENT.md` for details.

### Quick Setup

```bash
# Install Nix
sh <(curl -L https://nixos.org/nix/install) --no-daemon

# Enable flakes
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Clone flashbots-images
git clone https://github.com/flashbots/flashbots-images /home/jake/flashbots-images

# Setup gcloud
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

## Files

- **`build.sh`** - Build TDX image with GCP conversion
- **`deploy-gcp.sh`** - Deploy to GCP Confidential VM
- **`GCP-DEPLOYMENT.md`** - Detailed deployment guide
- **`BUILD-REQUIREMENTS.md`** - System requirements
- **`base/`** - Minimal Debian base
- **`ratsnest/`** - Ratsnest module

## Build Process

Running `./build.sh`:

1. Builds ratsnest binary
2. Builds mkosi TDX image (UKI format)
3. Converts to GCP disk image (disk.raw in tar.gz)
4. Extracts MRTD measurements
5. Displays MRTD for policy update

**Time**: 20-40 min first build, 3-5 min subsequent

**Outputs:**
- `build/ratsnest-tdx.efi` - UKI bootable image
- `build/ratsnest-tdx.tar.gz` - GCP disk image
- `build/measurements.json` - MRTD values

## Deployment

Running `./deploy-gcp.sh`:

1. Uploads image to Cloud Storage
2. Creates GCP Compute Image with TDX_CAPABLE
3. Deploys Confidential VM with TDX enabled
4. Outputs VM IP address

**Configuration** (environment variables):
```bash
GCP_PROJECT=my-project       # GCP project ID
GCP_BUCKET=my-bucket         # Cloud Storage bucket
GCP_ZONE=us-central1-a       # Deployment zone
INSTANCE_NAME=ratsnest-vm    # VM name
```

## Structure

```
image/
├── build.sh              # Build script
├── deploy-gcp.sh         # GCP deployment
├── ratsnest.conf         # Top-level config
├── base/                 # Minimal base
│   ├── base.conf
│   └── mkosi.skeleton/
└── ratsnest/             # Ratsnest module
    ├── ratsnest.conf
    ├── mkosi.postinst
    └── mkosi.extra/
        └── etc/systemd/system/ratsnest.service
```

## MRTD Measurement

The MRTD is a SHA-384 hash of:
- Linux kernel binary (TDX-enabled)
- Initial ramdisk (contains ratsnest binary)
- Kernel command line

Any change results in a different MRTD, requiring policy update.

## Next Steps

1. Run `./build.sh` to create first image
2. Copy MRTD to `../shared/policy.ts`
3. Rebuild binary: `cd ../backend && deno task build`
4. Rebuild image: `cd ../image && ./build.sh`
5. Deploy: `./deploy-gcp.sh`

See `GCP-DEPLOYMENT.md` for production deployment.
