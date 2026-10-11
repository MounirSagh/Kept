import { ClerkProvider, Show } from "@clerk/react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { AppShell } from "./app/AppShell";
import { AcceptInvite } from "./pages/AcceptInvite";
import { AccountsPage } from "./pages/org/Accounts";
import { ApprovalsPage } from "./pages/org/Approvals";
import { AssistantPage } from "./pages/org/Assistant";
import { CommitmentsPage } from "./pages/org/Commitments";
import { FlagsPage } from "./pages/org/Flags";
import { IntegrationsPage } from "./pages/org/Integrations";
import { InvitationsPage } from "./pages/org/Invitations";
import { MembersPage } from "./pages/org/Members";
import { MyTeamPage } from "./pages/org/MyTeam";
import { OverviewPage } from "./pages/org/Overview";
import { SettingsPage } from "./pages/org/Settings";
import { TeamsPage } from "./pages/org/Teams";
import { Home } from "./pages/Home";
import { Landing } from "./pages/Landing";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env");

export function App() {
  const navigate = useNavigate();

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/home"
      signUpFallbackRedirectUrl="/home"
      afterSignOutUrl="/"
    >
      <Routes>
        <Route path="/" element={<SignedOutOnly><Landing /></SignedOutOnly>} />
        <Route path="/sign-in/*" element={<SignedOutOnly><SignInPage /></SignedOutOnly>} />
        <Route path="/sign-up/*" element={<SignedOutOnly><SignUpPage /></SignedOutOnly>} />
        <Route path="/home" element={<SignedInOnly><Home /></SignedInOnly>} />
        <Route path="/invite" element={<SignedInOnly><AcceptInvite /></SignedInOnly>} />
        <Route path="/o/:orgSlug" element={<SignedInOnly><AppShell /></SignedInOnly>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="commitments" element={<CommitmentsPage />} />
          <Route path="flags" element={<FlagsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="team" element={<MyTeamPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="invitations" element={<InvitationsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ClerkProvider>
  );
}

function SignedInOnly({ children }: { children: ReactNode }) {
  // Come back to the same page (e.g. an invite link) after signing in.
  const { pathname, search } = useLocation();
  const signIn = `/sign-in?redirect_url=${encodeURIComponent(pathname + search)}`;
  return (
    <Show when="signed-in" fallback={<Navigate to={signIn} replace />}>
      {children}
    </Show>
  );
}

function SignedOutOnly({ children }: { children: ReactNode }) {
  return (
    <Show when="signed-out" fallback={<Navigate to="/home" replace />}>
      {children}
    </Show>
  );
}
