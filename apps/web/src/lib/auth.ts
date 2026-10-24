// Helpers shared by Kept's own sign-in and sign-up pages (Clerk custom flows).

import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";

/** Where to go after signing in: the redirect_url we were sent with, if it's on this site; otherwise home. */
export function useRedirectTarget(): string {
  const [params] = useSearchParams();
  const raw = params.get("redirect_url");
  if (!raw) return "/home";
  try {
    const url = new URL(raw, window.location.origin);
    // Only same-site destinations: an open redirect would let a link send people elsewhere after signing in.
    if (url.origin !== window.location.origin) return "/home";
    return url.pathname + url.search + url.hash || "/home";
  } catch {
    return "/home";
  }
}

/** Keeps the redirect when moving between sign-in and sign-up. */
export function useAuthLink(path: "/sign-in" | "/sign-up"): string {
  const [params] = useSearchParams();
  const redirect = params.get("redirect_url");
  return redirect ? `${path}?redirect_url=${encodeURIComponent(redirect)}` : path;
}

type DecorateUrl = (url: string) => string;

/** Navigation Clerk calls once a session exists (finalize / SSO callback). */
export function useFinishNavigation(target: string) {
  const navigate = useNavigate();
  return useCallback(
    ({ decorateUrl }: { decorateUrl: DecorateUrl }) => {
      // decorateUrl may add a Safari cookie-refresh hop, which is a full URL.
      const url = decorateUrl(target);
      if (url.startsWith("http")) window.location.href = url;
      else navigate(url, { replace: true });
    },
    [navigate, target],
  );
}

type ClerkErrorLike = { longMessage?: string; message?: string } | null | undefined;

/** The human-readable part of a Clerk error. */
export function errorText(error: ClerkErrorLike): string | null {
  if (!error) return null;
  return error.longMessage || error.message || "Something went wrong. Please try again.";
}
