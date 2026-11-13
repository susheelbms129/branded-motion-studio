import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { AuthScreen } from "../components/landing/AuthScreen";
import { clearAuthCache } from "../lib/auth";
import { getSupabase, isSupabaseConfigured } from "../lib/supabase";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    // Replace these placeholders with the app's name and description when first building the app.
    // Each content route, / included, must still set its own head(). Never add og:image or
    // twitter:image here: every page without its own would inherit the root's preview image.
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vendora" },
      { name: "description", content: "AI-native procurement for growing Indian businesses." },
      { name: "author", content: "Vendora" },
      { property: "og:title", content: "Vendora" },
      { property: "og:description", content: "AI-native procurement for growing Indian businesses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Sign up / sign in is one full-screen panel whose side and mode live in the URL:
//   buyers:    /signup  /signin
//   suppliers: /supplier/signup  /supplier/signin
// The two sides are fully separate: each tab and link stays on its own side.
const AUTH_PATHS: Record<string, { mode: "signup" | "signin"; variant: "buyer" | "supplier" }> = {
  "/signup": { mode: "signup", variant: "buyer" },
  "/signin": { mode: "signin", variant: "buyer" },
  "/supplier/signup": { mode: "signup", variant: "supplier" },
  "/supplier/signin": { mode: "signin", variant: "supplier" },
};

function AuthRoute() {
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = AUTH_PATHS[path] ?? null;
  const mode = current?.mode ?? "signup";
  const variant = current?.variant ?? "buyer";
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAuthCache();
        // Signed out inside a workspace: go to that side's own sign-in.
        const p = window.location.pathname;
        if (p.startsWith("/app")) void nav({ to: "/signin" });
        else if (p === "/supplier/dashboard" || p === "/supplier/onboarding") void nav({ to: "/supplier/signin" });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [nav]);
  return (
    <AuthScreen
      open={current !== null}
      mode={mode}
      variant={variant}
      onModeChange={(m) => {
        if (m === mode) return;
        const to = variant === "supplier" ? (m === "signup" ? "/supplier/signup" : "/supplier/signin") : m === "signup" ? "/signup" : "/signin";
        void nav({ to, replace: true });
      }}
      onClose={() => void nav({ to: "/" })}
      onAuthed={() =>
        void nav({
          // A brand-new supplier sets up their business; a returning supplier goes to their dashboard
          // (which sends them to setup if it isn't finished). Buyers go to their own workspace.
          to: variant === "supplier" ? (mode === "signup" ? "/supplier/onboarding" : "/supplier/dashboard") : "/app",
        })
      }
    />
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <AuthRoute />
    </QueryClientProvider>
  );
}
