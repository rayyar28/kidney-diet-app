import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const badges = [
  { code: "FIRST_MEAL", name: "跨出第一步", description: "完成第一筆餐前紀錄", iconEmoji: "🌱", sortOrder: 1 },
  { code: "STREAK_3", name: "三天不間斷", description: "連續 3 天都有紀錄飲食", iconEmoji: "🔥", sortOrder: 2 },
  { code: "STREAK_7", name: "一週好習慣", description: "連續 7 天都有紀錄飲食", iconEmoji: "🔥", sortOrder: 3 },
  { code: "STREAK_14", name: "兩週堅持", description: "連續 14 天都有紀錄飲食", iconEmoji: "🔥", sortOrder: 4 },
  { code: "STREAK_30", name: "月度達人", description: "連續 30 天都有紀錄飲食", iconEmoji: "🏆", sortOrder: 5 },
  { code: "STREAK_60", name: "兩月堅持", description: "連續 60 天都有紀錄飲食", iconEmoji: "🏆", sortOrder: 6 },
  { code: "STREAK_100", name: "百日修煉", description: "連續 100 天都有紀錄飲食", iconEmoji: "👑", sortOrder: 7 },
  { code: "PERFECT_DAY", name: "完美的一天", description: "同一天內完成早、中、晚三餐紀錄", iconEmoji: "⭐", sortOrder: 8 },
  { code: "BREAKFAST_10", name: "早餐達人", description: "累計完成 10 次早餐紀錄", iconEmoji: "🍳", sortOrder: 9 },
  { code: "MEALS_10", name: "紀錄小達人", description: "累計完成 10 筆用餐紀錄", iconEmoji: "📸", sortOrder: 10 },
  { code: "MEALS_50", name: "紀錄能手", description: "累計完成 50 筆用餐紀錄", iconEmoji: "📸", sortOrder: 11 },
  { code: "MEALS_100", name: "百餐紀錄", description: "累計完成 100 筆用餐紀錄", iconEmoji: "💯", sortOrder: 12 },
  { code: "MEALS_200", name: "紀錄大師", description: "累計完成 200 筆用餐紀錄", iconEmoji: "💯", sortOrder: 13 },
];

async function main() {
  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { code: badge.code },
      create: badge,
      update: badge,
    });
  }
  console.log(`Seeded ${badges.length} badges`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
