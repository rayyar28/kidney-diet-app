import { create } from "zustand";
import type { AuthUser } from "../api/types";

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
}

const STORAGE_KEY = "kidney-diet-auth";

function loadInitial(): Pick<AuthState, "user" | "accessToken" | "refreshToken"> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null, refreshToken: null };
    return JSON.parse(raw);
  } catch {
    return { user: null, accessToken: null, refreshToken: null };
  }
}

function persist(state: Pick<AuthState, "user" | "accessToken" | "refreshToken">) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...loadInitial(),
  setSession: (user, accessToken, refreshToken) => {
    persist({ user, accessToken, refreshToken });
    set({ user, accessToken, refreshToken });
  },
  setTokens: (accessToken, refreshToken) => {
    const next = { user: get().user, accessToken, refreshToken };
    persist(next);
    set(next);
  },
  clearAuth: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ user: null, accessToken: null, refreshToken: null });
  },
}));
