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
  /** Role the UI uses. For a signed-in company member it is always the role stored in the database. */
  role: Role;
  /** The signed-in user's real company and role, read from the database (never persisted in the browser). */
  orgId: string | null;
  realRole: Role | null;
  theme: "light" | "dark";
  sidebarCollapsed: boolean;
  signIn: (u: AuthUser) => void;
  signOut: () => void;
  finishOnboarding: (demo: boolean) => void;
  setDemo: (v: boolean) => void;
  setRole: (r: Role) => void;
  setWorkspace: (w: { orgId: string; role: Role } | null) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

const persistedPart = (s: UiState) => ({
  user: s.user,
  onboarded: s.onboarded,
  demo: s.demo,
  role: s.role,
  theme: s.theme,
  sidebarCollapsed: s.sidebarCollapsed,
});
type Saved = ReturnType<typeof persistedPart>;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      user: null,
      onboarded: false,
      demo: true,
      role: "owner",
      orgId: null,
      realRole: null,
      theme: "dark",
      sidebarCollapsed: false,
      signIn: (user) => set({ user }),
      signOut: () => set({ user: null, orgId: null, realRole: null }),
      finishOnboarding: (demo) => set({ onboarded: true, demo }),
      setDemo: (demo) => set({ demo }),
      // The demo "view as role" switcher only works when nobody is signed in to a real company.
      setRole: (role) => set((s) => (s.realRole ? {} : { role })),
      setWorkspace: (w) =>
        set(w ? { orgId: w.orgId, realRole: w.role, role: w.role } : { orgId: null, realRole: null }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    {
      name: "vendora-ui",
      // The real company and role come from the database on every load and are never stored here.
      partialize: persistedPart,
      // v2: the app now follows the landing page's dark brand look by default. Existing saved
      // sessions that still hold the old light default are moved to dark once.
      version: 2,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Saved;
        return version < 2 ? { ...s, theme: "dark" as const } : s;
      },
    },
  ),
);
