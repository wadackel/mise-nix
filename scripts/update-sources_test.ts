import {
  assert,
  assertEquals,
  assertFalse,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  parseChecksums,
  sriHash,
  TAG_PATTERN,
  verifyAgainstChecksums,
} from "./update-sources.ts";

Deno.test("TAG_PATTERN accepts canonical CalVer tags", () => {
  assert(TAG_PATTERN.test("v2026.5.7"));
  assert(TAG_PATTERN.test("v2026.4.28"));
  assert(TAG_PATTERN.test("v1.0.0"));
  assert(TAG_PATTERN.test("v10.20.30"));
});

Deno.test("TAG_PATTERN rejects leading-zero numeric components", () => {
  assertFalse(TAG_PATTERN.test("v2026.05.7"));
  assertFalse(TAG_PATTERN.test("v2026.5.07"));
  assertFalse(TAG_PATTERN.test("v02026.5.7"));
});

Deno.test("TAG_PATTERN rejects malformed shapes", () => {
  // Missing leading `v`.
  assertFalse(TAG_PATTERN.test("2026.5.7"));
  // Two-component versions are not stable upstream releases.
  assertFalse(TAG_PATTERN.test("v2026.5"));
  // Non-numeric components.
  assertFalse(TAG_PATTERN.test("vfoo.bar.baz"));
  // mise releases are stable-only; prerelease suffixes must not auto-update.
  assertFalse(TAG_PATTERN.test("v2026.5.7-rc.1"));
  assertFalse(TAG_PATTERN.test("v1.0.0-alpha"));
  // SemVer build-metadata (`+...`) is not part of the upstream tag shape.
  assertFalse(TAG_PATTERN.test("v1.0.0+meta"));
});

Deno.test("sriHash produces SRI-formatted SHA-256 used by pkgs.fetchurl", async () => {
  // SHA-256 of the empty byte string is well known; base64 of those 32 bytes
  // is the same SRI string `nix store prefetch-file` and `nix hash file --sri`
  // emit for an empty file.
  const empty = new Uint8Array(0);
  assertEquals(
    await sriHash(empty),
    "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  );

  // Round-trip property: the output must always start with `sha256-` and the
  // base64 payload must decode back to 32 bytes.
  const sample = new TextEncoder().encode("mise-nix");
  const got = await sriHash(sample);
  assert(got.startsWith("sha256-"));
  const decoded = Uint8Array.from(
    atob(got.slice("sha256-".length)),
    (c) => c.charCodeAt(0),
  );
  assertEquals(decoded.byteLength, 32);
});

// Trimmed sample of the upstream v2026.5.7 SHASUMS256.txt. Each row uses the
// real "<hex>  ./<asset>" shape so the parser is exercised against the
// upstream-specific `./` prefix. Only the four assets the flake consumes plus
// a few unrelated rows (windows, .tar.xz, .tar.zst) are kept so the parser
// has both consumed and non-consumed entries to walk.
const FIXTURE_V2026_5_7 =
  "d3b10593349a370c4dce5c1f199d1e993582c3e4df6bf7e672d1a71820be15ed  ./mise-v2026.5.7-linux-arm64\n" +
  "70df0e7251bf98013b008150e618b962c27935e7d12ceec3d6ac4dcd9ae1b17e  ./mise-v2026.5.7-linux-arm64-musl\n" +
  "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68  ./mise-v2026.5.7-linux-arm64-musl.tar.gz\n" +
  "5cfb7dc15da2b4f3d4cb6201641890fa2a9b1c04f7cd249ac659a7425f080893  ./mise-v2026.5.7-linux-arm64-musl.tar.xz\n" +
  "b1a55b9e1c1f5a2e6f6c3b9d8e7a4d2c1f0b9a8d7e6c5b4a39281706f5e4d3c2  ./mise-v2026.5.7-linux-x64-musl.tar.gz\n" +
  "c2b66cae2d2f6b3f7e7d4cae9f8b5e3d2e1c0b9a8d7e6c5b4a39281706f5e4d3  ./mise-v2026.5.7-macos-arm64.tar.gz\n" +
  "d3c77dbf3e30713f8f8e5dbf0a9c6f4e3f2d1c0b9a8d7e6c5b4a39281706f5e4  ./mise-v2026.5.7-macos-x64.tar.gz\n" +
  "e4d88e0f4f31824f9f9f6e0f1bad7a5f4f3e2d1c0b9a8d7e6c5b4a392817065f  ./mise-v2026.5.7-windows-x64.zip\n";

Deno.test("parseChecksums strips the upstream './' prefix and exposes bare names", () => {
  const map = parseChecksums(FIXTURE_V2026_5_7);
  // The four assets the flake actually consumes.
  assertEquals(
    map["mise-v2026.5.7-linux-arm64-musl.tar.gz"],
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
  );
  assertEquals(
    map["mise-v2026.5.7-linux-x64-musl.tar.gz"],
    "b1a55b9e1c1f5a2e6f6c3b9d8e7a4d2c1f0b9a8d7e6c5b4a39281706f5e4d3c2",
  );
  assertEquals(
    map["mise-v2026.5.7-macos-arm64.tar.gz"],
    "c2b66cae2d2f6b3f7e7d4cae9f8b5e3d2e1c0b9a8d7e6c5b4a39281706f5e4d3",
  );
  assertEquals(
    map["mise-v2026.5.7-macos-x64.tar.gz"],
    "d3c77dbf3e30713f8f8e5dbf0a9c6f4e3f2d1c0b9a8d7e6c5b4a39281706f5e4",
  );
  // No key retains the "./" prefix.
  for (const key of Object.keys(map)) {
    assertFalse(key.startsWith("./"));
  }
});

Deno.test("parseChecksums also accepts rows without the './' prefix", () => {
  // Defensive: if upstream ever drops the "./" prefix, parser must keep working.
  const mixed =
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68  mise-v2026.5.7-linux-arm64-musl.tar.gz\n" +
    "b1a55b9e1c1f5a2e6f6c3b9d8e7a4d2c1f0b9a8d7e6c5b4a39281706f5e4d3c2  ./mise-v2026.5.7-linux-x64-musl.tar.gz\n";
  const map = parseChecksums(mixed);
  assertEquals(Object.keys(map).length, 2);
  assertEquals(
    map["mise-v2026.5.7-linux-arm64-musl.tar.gz"],
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
  );
  assertEquals(
    map["mise-v2026.5.7-linux-x64-musl.tar.gz"],
    "b1a55b9e1c1f5a2e6f6c3b9d8e7a4d2c1f0b9a8d7e6c5b4a39281706f5e4d3c2",
  );
});

Deno.test("parseChecksums tolerates blank lines, comments, and CRLF", () => {
  const text =
    "# leading comment\r\n" +
    "\r\n" +
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68  ./mise-v2026.5.7-linux-arm64-musl.tar.gz\r\n" +
    "\n";
  const map = parseChecksums(text);
  assertEquals(Object.keys(map).length, 1);
  assertEquals(
    map["mise-v2026.5.7-linux-arm64-musl.tar.gz"],
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
  );
});

Deno.test("parseChecksums rejects malformed input", () => {
  // Hex too short.
  assertThrows(
    () => parseChecksums("abc  ./asset.tar.gz\n"),
    Error,
    "invalid sha256 hex",
  );
  // Uppercase hex is not what mise emits and is rejected to make case-mismatch
  // bugs surface immediately.
  assertThrows(
    () =>
      parseChecksums(
        "A13239C0E822B3261E6EA05B9B8C6C98D78BDEEBE5BA20AB22C0FA25BBF72E68  ./asset.tar.gz\n",
      ),
    Error,
    "invalid sha256 hex",
  );
  // Three columns instead of two (e.g. an extra signature column).
  assertThrows(
    () =>
      parseChecksums(
        "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68  ./asset.tar.gz  extra\n",
      ),
    Error,
    "malformed checksums line",
  );
  // Duplicate asset name across two lines must throw. Both rows normalize to
  // the same bare name, which is exactly what we want to catch.
  const dup =
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68  ./asset.tar.gz\n" +
    "b1a55b9e1c1f5a2e6f6c3b9d8e7a4d2c1f0b9a8d7e6c5b4a39281706f5e4d3c2  asset.tar.gz\n";
  assertThrows(() => parseChecksums(dup), Error, "duplicate checksums entry");
});

Deno.test("verifyAgainstChecksums passes on match, throws on mismatch and unknown", () => {
  const map = {
    "asset.tar.gz":
      "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
  };
  // Match: must not throw.
  verifyAgainstChecksums(
    "asset.tar.gz",
    "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
    map,
  );
  // Mismatch: must throw with explicit expected/got framing.
  assertThrows(
    () =>
      verifyAgainstChecksums(
        "asset.tar.gz",
        "0000000000000000000000000000000000000000000000000000000000000000",
        map,
      ),
    Error,
    "checksum mismatch",
  );
  // Asset not in the map: must throw rather than silently skip.
  assertThrows(
    () =>
      verifyAgainstChecksums(
        "missing.tar.gz",
        "a13239c0e822b3261e6ea05b9b8c6c98d78bdeebe5ba20ab22c0fa25bbf72e68",
        map,
      ),
    Error,
    "asset missing from checksums.txt",
  );
});
