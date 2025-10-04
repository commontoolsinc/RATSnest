# Deploying Ratsnest to GCP with TDX

This guide walks you through building and deploying a Ratsnest TDX image to Google Cloud Platform.

## Prerequisites

1. **GCP Project** with Confidential Computing enabled
2. **gcloud CLI** installed and authenticated
3. **Build environment** (Nix, flashbots-images) - see `BUILD-REQUIREMENTS.md`

### Check gcloud setup

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Enable required GCP APIs

```bash
gcloud services enable compute.googleapis.com
gcloud services enable confidentialcomputing.googleapis.com
gcloud services enable storage.googleapis.com
```

## Quick Start

### 1. Build the Image

```bash
cd /home/jake/ratsnest/image
./build.sh
```

This will:
- Build the ratsnest binary
- Create TDX-enabled UKI image (`ratsnest-tdx.efi`)
- Convert to GCP disk format (`ratsnest-tdx.tar.gz`)
- Extract MRTD measurements

**Build time**: 20-40 minutes first time (kernel compilation), 3-5 minutes subsequent builds.

### 2. Deploy to GCP

```bash
./deploy-gcp.sh
```

This will:
- Create Cloud Storage bucket (if needed)
- Upload image to GCS
- Create GCP Compute Image with TDX features
- Create Confidential VM instance

**Deployment time**: 5-10 minutes

### 3. Update MRTD Policy

After the first build, copy the MRTD value from the build output:

```bash
# From build.sh output, you'll see:
# MRTD (RTMR0): 0x1234...abcd
```

Update `shared/policy.ts`:

```typescript
export const policy: MRTDPolicy = {
  allowed_mrtd: [
    "0x1234...abcd"  // Replace with your MRTD
  ]
}
```

### 4. Rebuild and Redeploy

```bash
# Rebuild binary with updated policy
cd /home/jake/ratsnest/backend
deno task build

# Rebuild and redeploy image
cd /home/jake/ratsnest/image
./build.sh
./deploy-gcp.sh
```

## Configuration Options

The deployment script accepts environment variables:

```bash
# Use custom GCP project
GCP_PROJECT=my-project ./deploy-gcp.sh

# Use custom bucket
GCP_BUCKET=my-bucket ./deploy-gcp.sh

# Use custom instance name
INSTANCE_NAME=ratsnest-prod ./deploy-gcp.sh

# Use larger machine type
MACHINE_TYPE=n2d-standard-4 ./deploy-gcp.sh

# Deploy to different zone
GCP_ZONE=us-west1-a ./deploy-gcp.sh

# Combine options
GCP_PROJECT=my-project \
INSTANCE_NAME=ratsnest-prod \
MACHINE_TYPE=n2d-standard-4 \
./deploy-gcp.sh
```

## Testing the Deployment

### Check VM Status

```bash
gcloud compute instances list --filter="name:ratsnest"
```

### View Service Logs

```bash
gcloud compute ssh ratsnest-vm -- journalctl -u ratsnest -f
```

### Test from Frontend

Update your frontend to point to the VM's external IP:

```typescript
const client = new TunnelClient({
  origin: 'http://[EXTERNAL_IP]:3000'
})
```

The client should:
1. Connect to the TDX VM
2. Request a TDX quote
3. Verify MRTD matches policy
4. Establish encrypted tunnel

## Troubleshooting

### Build Fails

**Problem**: `unshare: setgroups failed: Operation not permitted`

**Solution**: Your system doesn't support user namespaces. Options:
1. Build on a different machine (bare metal, local VM)
2. Use GitHub Actions / CI/CD
3. Contact your cloud provider

**Problem**: `nix: command not found`

**Solution**: Source the Nix profile:
```bash
source ~/.nix-profile/etc/profile.d/nix.sh
```

### Deployment Fails

**Problem**: `ERROR: (gcloud.compute.images.create) Invalid resource usage: 'UEFI feature is not available'`

**Solution**: Enable required APIs:
```bash
gcloud services enable confidentialcomputing.googleapis.com
```

**Problem**: `TDX machine type not available`

**Solution**: TDX is only available on specific machine types in specific zones. Try:
```bash
# List TDX-capable machine types
gcloud compute machine-types list --filter="name:n2d*" --zones=us-central1-a

# Use a zone with TDX support
GCP_ZONE=us-central1-a ./deploy-gcp.sh
```

### VM Won't Start

**Problem**: VM starts but ratsnest service fails

**Solution**: Check logs:
```bash
gcloud compute ssh ratsnest-vm -- journalctl -u ratsnest -n 100
```

Common issues:
- Binary not executable: Check `mkosi.postinst` chmod
- Missing dependencies: Check systemd service file
- Port already in use: Another service on port 3000

### MRTD Verification Fails

**Problem**: Client rejects connection with MRTD mismatch

**Solution**:
1. Verify MRTD in `build/measurements.json` matches `shared/policy.ts`
2. Rebuild binary after updating policy
3. Redeploy image to GCP

**Debugging**: Enable verbose logging in frontend:
```typescript
const quote = await parseTDXQuote(quoteBytes)
console.log('MRTD from quote:', Buffer.from(quote.body.mr_td).toString('hex'))
console.log('Allowed MRTDs:', policy.allowed_mrtd)
```

## Security Notes

### Production Deployment

For production, consider:

1. **Firewall Rules**: Restrict access to your IP
   ```bash
   gcloud compute firewall-rules create ratsnest-allow-3000 \
     --allow tcp:3000 \
     --source-ranges=YOUR_IP/32
   ```

2. **HTTPS**: Put behind Cloud Load Balancer with SSL
3. **Monitoring**: Set up Cloud Logging alerts
4. **Backups**: Store MRTD measurements securely

### MRTD Rotation

When you deploy a new version:

1. Build new image → get new MRTD
2. Add new MRTD to `allowed_mrtd` array (keep old one)
3. Deploy new version
4. After migration, remove old MRTD from policy

This allows zero-downtime deployments.

## GCP-Specific Notes

### TDX Availability

As of 2025, TDX is available on:
- **Machine types**: N2D series (AMD) with TDX support
- **Zones**: us-central1, us-west1, europe-west4, asia-southeast1
- Check availability: https://cloud.google.com/confidential-computing/confidential-vm/docs/supported-configurations

### Image Format

The GCP profile converts the UKI to a raw disk image using:
- GPT partition table
- 500MB EFI System Partition (ESP)
- UKI placed at `EFI/BOOT/BOOTX64.EFI`
- 1GB total disk size
- Compressed as `tar.gz` with `--format=oldgnu`

See `/home/jake/flashbots-images/mkosi.profiles/gcp/mkosi.postoutput` for details.

### Cost Estimation

Approximate GCP costs (us-central1):
- **n2d-standard-2** (2 vCPU, 8GB): ~$60/month
- **Cloud Storage**: $0.02/GB/month for image storage
- **Network egress**: First 1GB free, then $0.12/GB

TDX VMs may have a premium over regular VMs.

## Next Steps

- Set up monitoring with Cloud Logging
- Configure Cloud Load Balancer for HTTPS
- Implement blue/green deployments with multiple MRTDs
- Add IMA runtime measurement (RTMR)
- Set up CI/CD for automated builds

## Resources

- [GCP Confidential Computing Docs](https://cloud.google.com/confidential-computing/confidential-vm/docs)
- [TDX on GCP](https://cloud.google.com/confidential-computing/confidential-vm/docs/create-custom-confidential-vm-images)
- [flashbots-images](https://github.com/flashbots/flashbots-images)
