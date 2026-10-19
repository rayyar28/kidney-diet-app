// 讀設定檔：開發機是 backend/.env；醫院主機由 6_staff_account.bat 用 DOTENV_CONFIG_PATH 指到 config\kidney.env
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { UserRole } from "../domain/enums.js";
import { findUserByAccount, accountLabel } from "../domain/account.js";

/**
 * 在主機上管理帳號（只能在主機上執行，沒有對應的 API）。
 *
 *   create-staff <email> <密碼> [顯示名稱]   建一個衛教師/研究人員帳號
 *   set-role     <帳號> <PATIENT|RESEARCHER|ADMIN>
 *   summary                                    目前收了多少帳號與紀錄
 *
 * **為什麼建衛教師帳號只能在主機上做**：病人帳號由衛教師在 App 裡建，那衛教師帳號誰建？
 * 如果也開一個 API，就等於有一條「從網路上變成衛教師」的路。只放在主機上，
 * 能建衛教師帳號的人就只有坐在那台電腦前面的人。
 *
 * 衛教師帳號用 email 當登入帳號：研究編號（patient_ref）只給病人用，欄位名稱就是這個意思。
 *
 * 醫院主機上用 6_staff_account.bat 呼叫；開發機上：
 *   npm run account -- create-staff nurse@example.invalid 12345678 王衛教師
 *   npm run grant-role -- nurse@example.invalid RESEARCHER     （set-role 的舊名字）
 */

const ROLES = Object.values(UserRole);

function usage(): never {
  console.error(
    [
      "用法：",
      "  create-staff <email> <密碼> [顯示名稱]",
      `  set-role <帳號> <${ROLES.join("|")}>`,
      "  summary",
    ].join("\n")
  );
  process.exit(2);
}

async function createStaff(email: string | undefined, password: string | undefined, name: string | undefined) {
  if (!email || !password) usage();
  if (!email.includes("@")) {
    throw new Error("衛教師帳號請用 email 當帳號（研究編號只給病人用）");
  }
  if (password.length < 8) throw new Error("密碼至少需要 8 個字元");
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new Error(`${email} 已經有帳號了。要改權限請用 set-role`);
  }
  const user = await prisma.user.create({
    data: {
      email,
      displayName: name?.trim() || null,
      passwordHash: await bcrypt.hash(password, 10),
      role: UserRole.RESEARCHER,
    },
  });
  await prisma.userStreak.create({ data: { userId: user.id } });
  console.log(`已建立衛教師帳號：${email}（${UserRole.RESEARCHER}）`);
  console.log("用這個帳號登入 App →「我的」→「衛教師工具」，就能幫病人建帳號、開重設代碼。");
}

async function setRole(account: string | undefined, roleArg: string | undefined) {
  if (!account || !roleArg) usage();
  const role = roleArg.toUpperCase() as UserRole;
  if (!ROLES.includes(role)) throw new Error(`角色必須是 ${ROLES.join(" / ")}，收到的是「${roleArg}」`);

  const user = await findUserByAccount(account);
  if (!user) throw new Error(`找不到帳號：${account}`);
  const label = accountLabel(user);
  if (user.role === role) {
    console.log(`${label} 本來就是 ${role}，沒有變動`);
    return;
  }
  await prisma.user.update({ where: { id: user.id }, data: { role } });
  console.log(`${label}：${user.role} → ${role}`);
  // 權限寫在 access token 裡（15 分鐘效期），重新登入才會立刻生效
  console.log("提醒：請這個帳號登出再登入一次，新的權限才會生效。");
}

async function summary() {
  const [patients, staff, legacy, meals, photos, last] = await Promise.all([
    prisma.user.count({ where: { role: UserRole.PATIENT, patientRef: { not: null } } }),
    prisma.user.count({ where: { role: { in: [UserRole.RESEARCHER, UserRole.ADMIN] } } }),
    // 研究編號制度之前建的病人帳號（用 email 註冊的）。正式收案時應該是 0
    prisma.user.count({ where: { role: UserRole.PATIENT, patientRef: null } }),
    prisma.mealRecord.count({ where: { deletedAt: null } }),
    prisma.photo.count(),
    prisma.photo.findFirst({ orderBy: { uploadedAt: "desc" }, select: { uploadedAt: true } }),
  ]);
  console.log(`病人帳號（研究編號）：${patients}`);
  console.log(`衛教師/研究人員帳號：${staff}`);
  if (legacy > 0) console.log(`⚠ 舊制病人帳號（email 註冊，有可能存了姓名）：${legacy}`);
  console.log(`用餐紀錄：${meals}　照片：${photos}`);
  console.log(`最後一次收到照片：${last ? last.uploadedAt.toLocaleString("zh-TW") : "（還沒有）"}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "create-staff":
      return createStaff(args[0], args[1], args.slice(2).join(" "));
    case "set-role":
      return setRole(args[0], args[1]);
    case "summary":
      return summary();
    default:
      usage();
  }
}

main()
  .catch((e: unknown) => {
    console.error(`失敗：${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
