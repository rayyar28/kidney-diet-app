#!/bin/sh
set -e

echo "Waiting for database and applying Prisma schema..."
npx prisma generate
npx prisma migrate dev --name init --skip-seed
npx tsx prisma/seed.ts

exec "$@"
