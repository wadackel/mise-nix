# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Nix flake that repackages upstream [`jdx/mise`](https://github.com/jdx/mise) release tarballs for four systems (`aarch64-darwin`, `x86_64-darwin`, `aarch64-linux`, `x86_64-linux`) and exposes them as `packages.<sys>.mise` + `overlays.default`. The repo has no application source of its own. A daily GitHub Actions workflow refreshes `sources.json` against the latest upstream release.

## Language policy

- **Artifacts (commits, code, comments, workflows, PR titles/descriptions, issues): English only.** This is a public OSS repo.
- **Interactive conversation with Claude Code: follow the user's configured language** (from `~/.claude/settings.json` / global `CLAUDE.md`). Do not switch conversation language just because this repo's artifacts are English.

## Commands

Run everything through `just`. All recipes wrap with `nix develop -c <cmd>` — do not use `eval "$(nix print-dev-env)"`, it fails under macOS bash 3.2.

- `just update` — Refresh `sources.json` from the latest upstream release. Prints `changed` or `unchanged`.
- `just test` — Run Deno unit tests under `scripts/`.
- `just check` — `nix flake check` for the **current system only**. CI runs this on both `ubuntu-latest` and `macos-latest`.
- `just check-eval-all` — `nix flake show --all-systems`. Eval-only verification of all four platforms on one runner (does not build cross-system, which would fail).
- `just build` — `nix build .#mise` for the current system.
- `just fmt` / `just fmt-check` — `nixfmt` on `flake.nix`.

Do not run `nix flake check --all-systems` directly — it attempts to build the `fetchurl` derivations for every system and fails on mismatched hosts (e.g. darwin assets on a Linux runner). Use `just check-eval-all` instead.

## Non-obvious implementation choices

- **Linux uses the musl static tarballs.** `sources.json` for `aarch64-linux` and `x86_64-linux` always points at `mise-v*-linux-{x64,arm64}-musl.tar.gz`. The musl builds are fully static, so the derivation has no glibc / libgcc closure and does not need `autoPatchelfHook`. Do not switch to the glibc tarball even though nixpkgs convention would normally prefer it.
- **`fetchurl` + `sourceRoot = "mise"`, no `unzip`.** Upstream tarballs are flat `.tar.gz` on all four platforms and extract into a `mise/` directory containing `bin/`, `share/`, `man/`. `installPhase` copies `bin/mise` plus the entire `share/` tree (fish `vendor_conf.d` hook) and `man/man1/mise.1`. Bash/Zsh completion is intentionally not shipped because `mise completion {bash,zsh}` generates them on demand.
- **`stdenvNoCC.mkDerivation`.** The build has no compile step, so `stdenvNoCC` keeps a C toolchain out of the closure.
- **`SHASUMS256.txt` cross-check with `./` prefix normalization.** `scripts/update-sources.ts` downloads `SHASUMS256.txt` from the same release URL prefix and verifies the SHA-256 of each downloaded tarball against its line. The upstream file uses a `<hex>  ./<asset-name>` shape; `parseChecksums` strips the leading `./` (and accepts rows without it, defensively) so callers can look up assets by bare filename. Threat model: this catches transport-layer issues only, not a malicious upstream publisher.
- **Tag regex is defense-in-depth.** `TAG_PATTERN` in `scripts/update-sources.ts` accepts `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$` only (CalVer `vYYYY.M.D`). Prerelease suffixes are intentionally rejected because mise's release process ships stable tags only; an upstream prerelease will fail the daily update and surface as a tracking issue. The same regex is re-checked in `.github/workflows/update.yaml`'s commit guard so a hand-edited `sources.json` cannot smuggle an arbitrary tag through.
- **`SHASUMS256.txt.minisig` is not consumed.** Verifying it would require pinning an upstream public key (a TOFU decision) and putting `minisign` into the workflow image. It is intentionally deferred to a separate change.
- **GitHub Actions are SHA-pinned.** Never change a pin to `@v*`. When bumping an action, replace the full 40-char SHA and keep the `# v<major>` comment accurate.
- **Daily workflow requires `GH_TOKEN`.** `update.yaml` passes `${{ github.token }}` into the step so `gh api` can hit `repos/jdx/mise/releases/latest`. `permissions: contents: write, issues: write` for that workflow only; CI is `contents: read`.
- **`sources.json` is treated as generated.** Prefer `just update` over hand edits. A failure opens an issue labelled `update-failed`, or rewrites the title and body of the one already open — it never adds a comment, so the only notification is the initial one. The title carries the consecutive failure count (`(×N)`) so the severity is visible from the issue list. A later successful run closes that issue, which is what re-arms the notification: leaving one open would let the next outage land as a silent in-place edit.
- **No Nix store cache in CI.** `cache-nix-action` was removed after it broke every scheduled update run for 61 days straight. The cache tarball carries both `/nix/var/nix/db` and `/nix/store`; `tar` treats per-entry hard-link failures as non-fatal and only exits non-zero at the very end, so the database restores completely while an arbitrary subset of store paths does not. Every later `nix develop` then dies with `store path ... does not exist`, and because a failed restore is only a warning the job never falls back to a cache miss. The trigger was [cache-nix-action#170](https://github.com/nix-community/cache-nix-action/issues/170), and `DeterminateSystems/nix-installer-action` is not in that action's compatible-installer list to begin with ([#337](https://github.com/nix-community/cache-nix-action/issues/337)). Caching bought little here anyway: the derivation is `fetchurl` + copy with no compile step and the devShell is fully binary-cached, so a cold update run takes about a minute. If a store cache is ever reintroduced, do not reuse the `nix-v1-` key prefix.

## Commit convention

Automated bumps use `chore: bump mise to <tag>` (e.g. `chore: bump mise to v2026.5.7`). Match this style for manual updates to `sources.json`. No pre-commit hooks are configured.

## Deno script conventions

`scripts/update-sources.ts` runs under Deno 2.x via `just update`. When editing it:
- Use `Deno.Command` with `stderr: "piped"` and surface stderr in thrown errors.
- Resolve paths relative to the script with `new URL(".", import.meta.url).pathname`.
- Keep the atomic-write pattern (`writeAtomic`: tmp file + rename).
- Derive the SRI hash and the SHA-256 hex cross-check from the **same in-memory bytes**. Refetching the URL would open a TOCTOU window where an upstream asset swap between fetches could pin bytes that were never the source of a verified cross-check.
