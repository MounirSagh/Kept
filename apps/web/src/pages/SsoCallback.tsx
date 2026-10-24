import { HandleSSOCallback } from "@clerk/react";
import { useNavigate } from "react-router";
import { useAuthLink, useFinishNavigation, useRedirectTarget } from "@/lib/auth";

/** Google and Microsoft send people back here; Clerk finishes the sign-in or sign-up. */
export function SsoCallback() {
  const navigate = useNavigate();
  const finish = useFinishNavigation(useRedirectTarget());
  const signIn = useAuthLink("/sign-in");
  const signUp = useAuthLink("/sign-up");

  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-ink-muted">
      Signing you in…
      <HandleSSOCallback
        navigateToApp={finish}
        navigateToSignIn={() => navigate(signIn, { replace: true })}
        navigateToSignUp={() => navigate(signUp, { replace: true })}
      />
      <div id="clerk-captcha" />
    </div>
  );
}
