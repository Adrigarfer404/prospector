#!/bin/sh
set -eu
TEST_DIR=$(mktemp -d /tmp/prospector-sweep-XXXXXX)
trap 'rm -rf "$TEST_DIR"' EXIT
export DATABASE_URL="file:$TEST_DIR/test.db"
export RUST_LOG=debug
npx prisma db push --skip-generate --schema prisma/schema.prisma >/dev/null
node --import tsx scripts/test-sweep.ts
