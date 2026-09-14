import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    set({ message });
    setTimeout(() => set((s) => (s.message === message ? { message: null } : s)), 3000);
  },
  clear: () => set({ message: null }),
}));
