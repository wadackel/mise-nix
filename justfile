default:
    @just --list

# Refresh sources.json from the latest upstream release
update:
    deno run --allow-read --allow-write --allow-run --allow-env --allow-net scripts/update-sources.ts

# Run the Deno unit tests for the update script
test:
    deno test scripts/

# Verify the flake evaluates for the current system (CI runs this on both linux and darwin)
check:
    nix flake check

# Evaluate outputs for every supported system without building (eval-only)
check-eval-all:
    nix flake show --all-systems

# Build mise for the current system
build:
    nix build .#mise

# Format nix files in place
fmt:
    nix fmt

# Check nix formatting without writing changes
fmt-check:
    nixfmt --check flake.nix
