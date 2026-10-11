import { UserButton } from "@clerk/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import type { MeDto } from "@kept/shared";
import { useApi } from "../api";
import { Loading } from "../components/Page";
import { ui } from "../ui";

/** Sends members to their first org; admins and people without an org stay here. */
export function Home() {
  const api = useApi();
  const [me, setMe] = useState<MeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.me().then(setMe, (err: Error) => setError(err.message));
  }, [api]);

  useEffect(refresh, [refresh]);

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (!me) return <Loading />;

  const org = me.orgs[0];
  if (!me.user.isPlatformAdmin && org) return <Navigate to={`/o/${org.slug}/overview`} replace />;

  const name = me.user.fullName ?? me.user.email;

  return (
    <div>
      <nav className={ui.nav}>
        <span className={ui.brand}>Kept</span>
        <UserButton />
      </nav>
      <section className="mx-auto max-w-[720px] px-4 py-24">
        {me.user.isPlatformAdmin ? (
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Hello, {name}</h1>
        ) : (
          <>
            <h1 className="mb-3 text-[1.75rem] font-semibold tracking-tight">Welcome, {name}</h1>
            <CreateOrg onCreated={refresh} />
          </>
        )}
      </section>
    </div>
  );
}

function CreateOrg({ onCreated }: { onCreated: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createOrg({ name, slug });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="flex max-w-[400px] flex-col gap-3" onSubmit={onSubmit}>
      <p className="mb-2 text-sm text-ink-muted">
        You're not part of an organization yet. Create one, or open an invite link you were sent.
      </p>
      <input className={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name" required />
      <input className={ui.input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="slug (e.g. acme)" required />
      <button type="submit" className={ui.button.primary}>
        Create organization
      </button>
      {error && <p className={ui.error}>{error}</p>}
    </form>
  );
}
