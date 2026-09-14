import { PrismaClient } from "@prisma/client";

// 單例 PrismaClient，避免 dev 模式下熱重載時開出一堆連線
export const prisma = new PrismaClient();
