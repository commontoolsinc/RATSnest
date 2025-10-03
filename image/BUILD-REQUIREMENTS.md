# TDX Image Build Requirements

## System Requirements

To build the TDX image with mkosi, you need a system with:

### 1. Full User Namespace Support

**Check if your system supports it**:
```bash
unshare --map-root-user whoami
# Should output: root
```

If you get "Operation not permitted", your system doesn't support unprivileged user namespaces properly.

**Systems that work**:
- ✅ Bare metal Linux (Ubuntu 20.04+)
- ✅ Local VMs with full privileges
- ✅ Some cloud VMs (AWS/Azure specific instance types)
- ✅ Development workstations/laptops

**Systems that may not work**:
- ❌ GCP VMs (some security restrictions)
- ❌ Docker containers (unless run with --privileged)
- ❌ WSL2 (limited user namespace support)
- ❌ Some CI/CD environments

### 2. Software Dependencies

```bash
# Install Nix
sh <(curl -L https://nixos.org/nix/install) --no-daemon

# Enable flakes
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Install uidmap (if not already present)
sudo apt-get install -y uidmap

# Configure subuid/subgid (if not already configured)
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $USER
```

### 3. Disk Space

- At least 30GB free space
- First build downloads/builds custom kernel (~10GB)
- Subsequent builds are cached and faster

### 4. Time

- First build: 20-40 minutes (builds kernel)
- Subsequent builds: 3-5 minutes (uses cache)

## Building

Once requirements are met:

```bash
cd /home/jake/ratsnest/image
./build.sh
```

## Troubleshooting

### "unshare: setgroups failed: Operation not permitted"

**Cause**: User namespaces are restricted by the system.

**Solutions**:
1. Use a different machine (bare metal/local VM)
2. Use podman/docker with --privileged flag
3. Contact your cloud provider about enabling user namespaces

### "No such file: newuidmap"

**Solution**: Install uidmap package
```bash
sudo apt-get install -y uidmap
```

### Nix not found

**Solution**: Source the Nix profile
```bash
source ~/.nix-profile/etc/profile.d/nix.sh
```

## Alternative: Use Pre-built Image

If you can't build locally, you can:

1. Build on a compatible CI/CD system (GitHub Actions, GitLab CI)
2. Build on a local VM
3. Use the sample MRTD for development/testing

For testing Phase 5, building the image is **optional** - the MRTD policy system works with sample quotes.
