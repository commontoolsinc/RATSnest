#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration (override with environment variables)
GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || echo "")}"
GCP_BUCKET="${GCP_BUCKET:-ratsnest-images}"
GCP_ZONE="${GCP_ZONE:-us-west1-a}"
IMAGE_NAME="${IMAGE_NAME:-ratsnest-tdx}"
INSTANCE_NAME="${INSTANCE_NAME:-ratsnest-vm}"
MACHINE_TYPE="${MACHINE_TYPE:-c3-standard-4}"

if [ -z "$GCP_PROJECT" ]; then
    echo "Error: GCP_PROJECT not set and could not be detected from gcloud config"
    echo "Set it with: export GCP_PROJECT=your-project-id"
    exit 1
fi

echo "=================================================="
echo "Deploying Ratsnest TDX Image to GCP"
echo "=================================================="
echo ""
echo "Configuration:"
echo "  GCP Project:   $GCP_PROJECT"
echo "  GCP Bucket:    $GCP_BUCKET"
echo "  GCP Zone:      $GCP_ZONE"
echo "  Image Name:    $IMAGE_NAME"
echo "  Instance Name: $INSTANCE_NAME"
echo "  Machine Type:  $MACHINE_TYPE"
echo ""

# Check if image exists
if [ ! -f "$PROJECT_ROOT/build/ratsnest-tdx.tar.gz" ]; then
    echo "Error: GCP image not found at $PROJECT_ROOT/build/ratsnest-tdx.tar.gz"
    echo "Run './build.sh' first to build the image"
    exit 1
fi

# Step 1: Create GCS bucket if it doesn't exist
echo "[1/4] Checking/creating Cloud Storage bucket..."
if ! gsutil ls -b "gs://$GCP_BUCKET" &>/dev/null; then
    echo "Creating bucket gs://$GCP_BUCKET..."
    gsutil mb -p "$GCP_PROJECT" "gs://$GCP_BUCKET"
    echo "✓ Bucket created"
else
    echo "✓ Bucket exists"
fi

# Step 2: Upload image to GCS
echo ""
echo "[2/4] Uploading image to Cloud Storage..."
IMAGE_VERSION=$(date +%Y%m%d-%H%M%S)
GCS_PATH="gs://$GCP_BUCKET/${IMAGE_NAME}-${IMAGE_VERSION}.tar.gz"

gsutil cp "$PROJECT_ROOT/build/ratsnest-tdx.tar.gz" "$GCS_PATH"
echo "✓ Uploaded to $GCS_PATH"

# Step 3: Create GCP Compute Image
echo ""
echo "[3/4] Creating GCP Compute Image..."
GCP_IMAGE_NAME="${IMAGE_NAME}-${IMAGE_VERSION}"

if gcloud compute images describe "$GCP_IMAGE_NAME" --project="$GCP_PROJECT" &>/dev/null; then
    echo "Image $GCP_IMAGE_NAME already exists, skipping creation"
else
    gcloud compute images create "$GCP_IMAGE_NAME" \
        --project="$GCP_PROJECT" \
        --source-uri="$GCS_PATH" \
        --guest-os-features=TDX_CAPABLE,UEFI_COMPATIBLE,GVNIC,VIRTIO_SCSI_MULTIQUEUE
    echo "✓ Image created: $GCP_IMAGE_NAME"
fi

# Step 4: Create/Update Firewall Rules
echo ""
echo "[4/6] Creating/updating firewall rules..."

# Create firewall rule for port 3000
if gcloud compute firewall-rules describe allow-ratsnest-3000 --project="$GCP_PROJECT" &>/dev/null; then
    echo "✓ Firewall rule allow-ratsnest-3000 exists"
else
    gcloud compute firewall-rules create allow-ratsnest-3000 \
        --project="$GCP_PROJECT" \
        --allow=tcp:3000 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=ratsnest \
        --description="Allow inbound traffic on port 3000 for Ratsnest"
    echo "✓ Firewall rule created: allow-ratsnest-3000"
fi

# Step 5: Create/Update VM Instance
echo ""
echo "[5/6] Creating/updating VM instance..."

# Check if instance exists
if gcloud compute instances describe "$INSTANCE_NAME" --zone="$GCP_ZONE" --project="$GCP_PROJECT" &>/dev/null; then
    echo "Instance $INSTANCE_NAME exists. Delete it first if you want to recreate:"
    echo "  gcloud compute instances delete $INSTANCE_NAME --zone=$GCP_ZONE --project=$GCP_PROJECT"
    echo ""
    echo "Or create a new instance with a different name:"
    echo "  INSTANCE_NAME=ratsnest-vm-2 ./deploy-gcp.sh"
else
    echo "Creating TDX Confidential VM instance..."
    gcloud compute instances create "$INSTANCE_NAME" \
        --project="$GCP_PROJECT" \
        --zone="$GCP_ZONE" \
        --image="$GCP_IMAGE_NAME" \
        --confidential-compute-type=TDX \
        --machine-type="$MACHINE_TYPE" \
        --maintenance-policy=TERMINATE \
        --network-interface=nic-type=GVNIC,network-tier=PREMIUM,stack-type=IPV4_ONLY,subnet=default \
        --tags=ratsnest \
        --no-restart-on-failure

    echo "✓ Instance created: $INSTANCE_NAME"

    # Get instance IP
    EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
        --zone="$GCP_ZONE" \
        --project="$GCP_PROJECT" \
        --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

    echo ""
    echo "=================================================="
    echo "Deployment Complete!"
    echo "=================================================="
    echo ""
    echo "VM Instance:      $INSTANCE_NAME"
    echo "External IP:      $EXTERNAL_IP"
    echo "Image:            $GCP_IMAGE_NAME"
    echo "GCS Image:        $GCS_PATH"
    echo ""
    echo "The ratsnest service should start automatically."
    echo "Test connection from your frontend at: http://$EXTERNAL_IP:3000"
    echo ""
    echo "View logs:"
    echo "  gcloud compute ssh $INSTANCE_NAME --zone=$GCP_ZONE -- journalctl -u ratsnest -f"
    echo ""
fi
