#!/bin/sh
set -e

echo "Applying database migrations..."
# ★ migrate deploy（不是 migrate dev）：只會往前套用既有的 migration，
#   絕對不會因為偵測到 schema drift 而要求重置資料庫。
npx prisma migrate deploy

exec "$@"
