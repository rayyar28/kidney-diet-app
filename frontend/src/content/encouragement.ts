// 純前端靜態內容，不需要進資料庫：依「目前連續天數」與「今天是否已完成任何一餐」
// 挑選一句鼓勵文案，讓每次打開 App 都有一點溫度，而不是冷冰冰的紀錄工具。

const STARTER_MESSAGES = [
  "今天也從記錄一餐開始吧，你的腎臟會感謝你 💪",
  "每拍一張照片，都是為未來的自己多存一份健康資料 🌱",
  "小小一步，也是照顧腎臟的一大步。",
];

const STREAK_MESSAGES: Array<{ min: number; text: (days: number) => string }> = [
  { min: 30, text: (d) => `連續 ${d} 天了！你已經把記錄變成生活的一部分了 👑` },
  { min: 14, text: (d) => `連續 ${d} 天，這份堅持很不容易，繼續保持！🏆` },
  { min: 7, text: (d) => `連續 ${d} 天不間斷，一週好習慣達成 🔥` },
  { min: 3, text: (d) => `連續 ${d} 天了，勢頭正好，別停下來 🔥` },
  { min: 1, text: (d) => `連續 ${d} 天，很棒的開始！` },
];

export function pickEncouragement(currentStreakDays: number): { headline: string; sub: string } {
  const streakMsg = STREAK_MESSAGES.find((m) => currentStreakDays >= m.min);
  if (streakMsg) {
    return { headline: streakMsg.text(currentStreakDays), sub: "持續紀錄，幫助你更了解自己的飲食習慣" };
  }
  const idx = new Date().getDate() % STARTER_MESSAGES.length;
  return { headline: STARTER_MESSAGES[idx], sub: "拍下餐前、餐後照片，養成規律紀錄的習慣" };
}

export function pickCompletionMessage(): string {
  const options = [
    "太棒了！這一餐完成紀錄 🎉",
    "又完成一筆紀錄，繼續保持這個好習慣！",
    "紀錄完成！你正在為自己的健康累積寶貴資料 📊",
    "做得好，你的腎臟會感謝你的用心 💚",
  ];
  return options[Math.floor(Math.random() * options.length)];
}
