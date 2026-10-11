import { Link } from "react-router";
import { ui } from "../ui";

export function Landing() {
  return (
    <div>
      <nav className={ui.nav}>
        <span className={ui.brand}>Kept</span>
        <Link to="/sign-in" className={ui.button.ghost}>
          Sign in
        </Link>
      </nav>
      <section className="mx-auto max-w-[720px] px-4 pt-32 pb-16 text-center">
        <h1 className="mb-5 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.1] font-bold tracking-[-0.03em]">
          Never miss a promise made to a customer.
        </h1>
        <p className="mx-auto mb-10 max-w-[560px] text-lg leading-relaxed text-ink-muted">
          Kept reads your email, chats, tickets and CRM, tracks every commitment your team makes,
          and flags the ones at risk before your customer notices.
        </p>
        <Link to="/sign-up" className={ui.button.primary}>
          Getting Started
        </Link>
      </section>
    </div>
  );
}
