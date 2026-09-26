import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../utils/jwt.js";

export interface AuthedRequest extends Request {
  user?: { id: string; role: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "缺少登入憑證" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: "登入憑證無效或已過期" });
  }
}

/**
 * 只允許特定角色通過。一定要接在 requireAuth 後面用。
 *
 * 目前只有「衛教師/研究人員代病人重設密碼」會用到。角色不是自助申請的——
 * 註冊一律是 PATIENT，要升級只能由管理者在伺服器上執行 `npm run grant-role`。
 */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "缺少登入憑證" });
    }
    if (!roles.includes(req.user.role)) {
      // 刻意不說明缺哪個角色：這個端點的存在本身不需要對一般病人交代
      return res.status(403).json({ error: "沒有權限執行這個操作" });
    }
    next();
  };
}
