import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string; // userId
  role: string;
}

// 新版 @types/jsonwebtoken 把 expiresIn 收窄成 "15m" 這類字面格式，環境變數讀進來是一般 string
type ExpiresIn = jwt.SignOptions["expiresIn"];

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessExpiresIn as ExpiresIn });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

export function signRefreshToken(payload: AccessTokenPayload): string {
  // jwtid 給每個 refresh token 一個唯一值：同一秒內連續登入/換發時 (iat 只有秒級精度)，
  // 沒有這個欄位會簽出同一個 JWT 字串，導致 tokenHash 撞到資料庫的 unique 限制而炸掉。
  return jwt.sign(payload, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn as ExpiresIn,
    jwtid: crypto.randomUUID(),
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtRefreshSecret) as AccessTokenPayload;
}
