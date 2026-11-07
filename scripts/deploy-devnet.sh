#!/usr/bin/env bash
# Deploy Leash to devnet with the committed program id, then switch .env to devnet and run setup.
# Needs ~4.5 SOL on the Solana CLI default keypair (program rent + deploy buffer).
set -euo pipefail
cd "$(dirname "$0")/.."
PAYER=$(solana address)
echo "Payer $PAYER: $(solana balance --url devnet)"
[ -f target/deploy/leash.so ] || anchor build
solana program deploy --url devnet --program-id .keys/leash-program.json target/deploy/leash.so
sed -i 's/^CLUSTER=.*/CLUSTER=devnet/; s#^RPC_URL=.*#RPC_URL=https://api.devnet.solana.com#' .env
npx tsx scripts/setup.ts
npx tsx scripts/reset-demo.ts
echo "Deployed. Program: https://explorer.solana.com/address/$(solana-keygen pubkey .keys/leash-program.json)?cluster=devnet"
