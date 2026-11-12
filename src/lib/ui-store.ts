import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Role } from "@/types/domain";

export interface AuthUser {
  name: string;
  email: string;
  company: string;
}

interface UiState {
  user: AuthUser | null;
  onboarded: boolean;
  demo: boolean;
  role: Role;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  signIn: (u: AuthUser) => void;
  signOut: () => void;
  finishOnboarding: (demo: boolean) => void;
  setDemo: (v: boolean) => void;
  setRole: (r: Role) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      user: null,
      onboarded: false,
      demo: true,
      role: "owner",
      theme: "light",
      sidebarCollapsed: false,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null }),
      finishOnboarding: (demo) => set({ onboarded: true, demo }),
      setDemo: (demo) => set({ demo }),
      setRole: (role) => set({ role }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "vendora-ui" },
  ),
);
