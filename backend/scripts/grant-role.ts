import { PrismaClient, UserRole } from "@prisma/client";

/**
 * 把某個帳號升級成 RESEARCHER / ADMIN。
 *
 * 角色刻意「沒有」自助申請的介面：註冊一律是 PATIENT。要開權限只能由管理者
 * 在伺服器上執行這支腳本，這樣就不存在「有人靠 API 把自己變成研究人員」的可能。
 *
 *   npm run grant-role -- nurse@hospital.tw RESEARCHER
 *   npm run grant-role -- me@example.com PATIENT     # 也可以降回病人
 */

const prisma = new PrismaClient();

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  if (!email || !roleArg) {
    console.error("用法：npm run grant-role -- <email> <PATIENT|RESEARCHER|ADMIN>");
    process.exitCode = 1;
    return;
  }

  const role = roleArg.toUpperCase() as UserRole;
  if (!Object.values(UserRole).includes(role)) {
    console.error(`角色必須是 ${Object.values(UserRole).join(" / ")}，收到的是「${roleArg}」`);
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`找不到 email 是 ${email} 的帳號`);
    process.exitCode = 1;
    return;
  }

  if (user.role === role) {
    console.log(`${email} 本來就是 ${role}，沒有變動`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`${email}：${user.role} → ${role}`);
  if (role !== "PATIENT") {
    console.log("提醒：權限是寫在 access token 裡的，請這個帳號重新登入一次才會生效。");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
