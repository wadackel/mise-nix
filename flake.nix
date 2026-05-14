{
  description = "Nix overlay for jdx/mise (polyglot runtime version manager)";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      sources = builtins.fromJSON (builtins.readFile ./sources.json);

      mkMise =
        pkgs:
        let
          lib = pkgs.lib;
          system = pkgs.stdenv.hostPlatform.system;
          platform =
            sources.platforms.${system}
              or (throw "mise-nix: unsupported system ${system}. Supported: ${lib.concatStringsSep ", " (lib.attrNames sources.platforms)}");
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "mise";
          version = sources.version;
          src = pkgs.fetchurl { inherit (platform) url hash; };

          # Upstream tarballs are flat tar.gz on every platform we support; the
          # Linux entries point at the musl static builds so no autoPatchelfHook
          # or glibc closure is needed.
          sourceRoot = "mise";
          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall
            install -Dm755 bin/mise $out/bin/mise
            # share/ carries the fish vendor_conf.d hook; bash/zsh completions
            # are produced on demand by `mise completion`, so they are not
            # shipped in the tarball.
            mkdir -p $out/share
            cp -r share/. $out/share/
            install -Dm644 man/man1/mise.1 $out/share/man/man1/mise.1
            runHook postInstall
          '';

          meta = with lib; {
            description = "Polyglot runtime manager (alternative to asdf)";
            homepage = "https://github.com/jdx/mise";
            license = licenses.mit;
            platforms = [
              "aarch64-darwin"
              "x86_64-darwin"
              "aarch64-linux"
              "x86_64-linux"
            ];
            mainProgram = "mise";
            sourceProvenance = with sourceTypes; [ binaryNativeCode ];
          };
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          mise = mkMise pkgs;
        in
        {
          inherit mise;
          default = mise;
        }
      );

      overlays.default = final: _prev: {
        mise = mkMise final;
      };

      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              deno
              gh
              jq
              just
              nixfmt
            ];
          };
        }
      );

      checks = forAllSystems (system: {
        build = self.packages.${system}.mise;
      });

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
