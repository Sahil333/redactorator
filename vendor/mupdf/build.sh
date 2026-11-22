#!/bin/bash
# Rebuilds package/dist from MuPDF 1.28.6 with the patches in patches/, in Emscripten's own
# image, and checks the result against SHA256SUMS. Needs git and Docker. See README.md.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
image="emscripten/emsdk@sha256:92c97951b9a6835cb5da9592e9d95226f67e09ecd01a541d817a5b4801f235a4" # 4.0.8, linux/amd64
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone --quiet --depth 1 --branch 1.28.6 --recurse-submodules --shallow-submodules \
	https://github.com/ArtifexSoftware/mupdf.git "$work/mupdf"
git -C "$work/mupdf" -c user.name=build -c user.email=build@invalid am --quiet --keep-cr "$here"/patches/*.patch
# MuPDF.js leaves its build tools (TypeScript, Terser) unpinned; this lock pins the ones used.
cp "$here/build/package-lock.json" "$work/mupdf/platform/wasm/"

docker run --rm --platform linux/amd64 -v "$work/mupdf":/src -w /src/platform/wasm "$image" \
	bash -c 'npm ci --no-audit --no-fund --silent && EMSDK=/emsdk bash tools/build.sh'

for file in mupdf.js mupdf.d.ts mupdf-wasm.js mupdf-wasm.d.ts mupdf-wasm.wasm; do
	cp "$work/mupdf/platform/wasm/dist/$file" "$here/package/dist/$file"
done
cd "$here" && shasum -a 256 -c SHA256SUMS
