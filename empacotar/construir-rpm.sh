#!/usr/bin/env bash
# Gera o pacote .rpm do Fedora em build/: npm ci, empacota o cérebro, monta a
# pasta do app só com as dependências de produção e roda o rpmbuild.
# Requer: node/npm e rpmbuild (Fedora: sudo dnf install rpm-build; Ubuntu: apt install rpm).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSAO=$(node -p "require('./package.json').version")
SDK=$(node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version" 2>/dev/null || true)
[ -n "$SDK" ] || { npm ci; SDK=$(node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version"); }

rm -rf build
FONTES=build/rpmbuild/SOURCES
mkdir -p "$FONTES/app/dist"

echo "→ cérebro (src/*.ts → dist/servidor.js)"
npx esbuild src/servidor.ts --bundle --platform=node --format=esm --target=node18 \
  --external:@anthropic-ai/claude-agent-sdk --log-level=warning --outfile="$FONTES/app/dist/servidor.js"
cp -r web "$FONTES/app/web"

echo "→ dependências de produção (Agent SDK $SDK + Claude Code para linux-x64/glibc)"
cat > "$FONTES/app/package.json" <<JSON
{ "name": "escritorio-pixel", "version": "$VERSAO", "private": true, "type": "module",
  "dependencies": { "@anthropic-ai/claude-agent-sdk": "$SDK" } }
JSON
(cd "$FONTES/app" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
rm -rf "$FONTES"/app/node_modules/@anthropic-ai/claude-agent-sdk-*-musl "$FONTES/app/package-lock.json"
test -x "$FONTES/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"

cp empacotar/escritorio-pixel empacotar/io.github.cronistc.EscritorioPixel.desktop empacotar/icone.png "$FONTES/"
sed "s/@VERSAO@/$VERSAO/" empacotar/escritorio-pixel.spec > build/rpmbuild/escritorio-pixel.spec

echo "→ rpmbuild"
rpmbuild --quiet -bb --define "_topdir $PWD/build/rpmbuild" build/rpmbuild/escritorio-pixel.spec
cp build/rpmbuild/RPMS/x86_64/*.rpm build/
ls -lh build/*.rpm
