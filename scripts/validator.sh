#!/usr/bin/env bash
# Local validator with the Leash program preloaded. Pass --reset for a fresh ledger.
set -euo pipefail
cd "$(dirname "$0")/.."
PROGRAM_ID=$(solana-keygen pubkey .keys/leash-program.json 2>/dev/null || grep -o '"address": "[^"]*"' shared/idl/leash.json | cut -d'"' -f4)
[ -f target/deploy/leash.so ] || { echo "target/deploy/leash.so missing, run: anchor build"; exit 1; }
exec solana-test-validator --quiet --ledger .anchor/demo-ledger \
  --bpf-program "$PROGRAM_ID" target/deploy/leash.so "$@"
