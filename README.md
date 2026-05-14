# mise-nix

[![CI](https://github.com/wadackel/mise-nix/actions/workflows/ci.yaml/badge.svg)](https://github.com/wadackel/mise-nix/actions/workflows/ci.yaml)

Nix flake that packages [`jdx/mise`](https://github.com/jdx/mise) — a polyglot
runtime version manager (alternative to `asdf`) — as an overlay, with a daily
GitHub Actions workflow that tracks new upstream releases automatically.

## Why this flake

- Track upstream releases more closely than the version currently in nixpkgs;
  upstream `mise` ships frequently (CalVer `vYYYY.M.D`) and the nixpkgs entry
  often lags by days to weeks.
- Keep the supply-chain trust boundary minimal by self-hosting the packaging
  rather than depending on a community flake.
- Cross-check every platform tarball against the upstream `SHASUMS256.txt`
  before the SRI hash is recorded in `sources.json`, so transport-layer
  tampering (CDN, in-flight corruption, asset misnaming) fails the update.

## Supported systems

- `aarch64-darwin`
- `x86_64-darwin`
- `aarch64-linux` (musl)
- `x86_64-linux` (musl)

Windows and 32-bit / armv7 targets are intentionally out of scope. Linux
artifacts use the upstream musl static builds, so the resulting derivation has
no glibc closure and does not need `autoPatchelfHook`.

## Install

### Run ad-hoc

```sh
nix run github:wadackel/mise-nix -- --version
```

### Use as a flake input

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    mise-nix = {
      url = "github:wadackel/mise-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, mise-nix, ... }: {
    # Expose `pkgs.mise` through your overlays list.
    # nixpkgs.overlays = [ mise-nix.overlays.default ];
  };
}
```

The overlay exposes `mise` (alias to `pkgs.mise`). You can also reference the
package directly:

```nix
mise-nix.packages.${system}.mise
```

The derivation installs `$out/bin/mise` plus the upstream `share/` (fish
`vendor_conf.d` hook) and `share/man/man1/mise.1`. Bash and Zsh completion are
produced on demand by `mise completion {bash,zsh}` and are not shipped.

## How updates work

The [`update.yaml`](./.github/workflows/update.yaml) workflow runs daily. It:

1. Queries `gh api repos/jdx/mise/releases/latest`.
2. Validates the tag against `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`
   (stable CalVer only; prereleases fail and surface as a tracking issue).
3. Downloads `SHASUMS256.txt` from the same release and downloads each of the
   four platform tarballs, cross-checking the SHA-256 of the downloaded bytes
   against the line in `SHASUMS256.txt` for that asset.
4. Computes the SRI hash directly from the same in-memory bytes that were
   just cross-checked, and writes `sources.json` atomically.
5. Re-validates the tag in a shell guard before committing
   `chore: bump mise to <tag>` and pushing.

If anything fails, the workflow opens (or appends to) an issue labelled
`update-failed` and leaves the repository untouched.

The corresponding `SHASUMS256.txt.minisig` (minisign signature over the
checksums file) is intentionally not consumed yet — adding minisign
verification would require pinning an upstream public key, which is tracked
as a follow-up.

## License

[MIT](./LICENSE). Upstream `mise` is also MIT-licensed.
