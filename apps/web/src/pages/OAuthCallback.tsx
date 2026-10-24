import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../api";
import { ui } from "../ui";

/** Where every provider sends the user back after its consent screen. */
export function OAuthCallback() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  const [error, setError] = useState<string | null>(
    denied ? "The connection was cancelled." : !code || !state ? "This connection link is incomplete." : null,
  );
  // StrictMode runs effects twice in dev; a code can only be exchanged once.
  const started = useRef(false);

  useEffect(() => {
    if (!code || !state || denied || started.current) return;
    started.current = true;
    api.completeConnection(code, state).then(
      ({ orgSlug, provider }) => navigate(`/o/${orgSlug}/integrations?connected=${provider}`, { replace: true }),
      (err: Error) => setError(err.message),
    );
  }, [api, navigate, code, state, denied]);

  return (
    <section className="mx-auto max-w-[720px] px-4 py-24">
      {error ? (
        <>
          <h1 className="mb-3 text-[1.75rem] font-semibold tracking-tight">Couldn't connect</h1>
          <p className={`mb-6 ${ui.error}`}>{error}</p>
          <Link to="/home" className={ui.button.ghost}>
            Back to Kept
          </Link>
        </>
      ) : (
        <p className="text-lg text-ink-muted">Connecting…</p>
      )}
    </section>
  );
}
