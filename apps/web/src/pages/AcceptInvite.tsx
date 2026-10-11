import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useApi } from "../api";
import { ui } from "../ui";

export function AcceptInvite() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(token ? null : "This invitation link is incomplete.");
  // StrictMode runs effects twice in dev; a second accept would fail as already used.
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.acceptInvitation(token).then(
      () => navigate("/home", { replace: true }),
      (err: Error) => setError(err.message),
    );
  }, [api, navigate, token]);

  return (
    <section className="mx-auto max-w-[720px] px-4 py-24">
      {error ? (
        <>
          <h1 className="mb-3 text-[clamp(1.75rem,5vw,2.5rem)] font-bold tracking-tight">Couldn't join</h1>
          <p className={`mb-6 ${ui.error}`}>{error}</p>
          <Link to="/home" className={ui.button.ghost}>Go home</Link>
        </>
      ) : (
        <p className="text-lg text-ink-muted">Joining organization…</p>
      )}
    </section>
  );
}
