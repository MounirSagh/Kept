import type { ReactNode } from "react";
import { Link } from "react-router";
import { CloudShader } from "@/components/ui/cloud-shader";
import { KnotMark, Wordmark } from "@/components/Wordmark";

export function Landing() {
  return (
    <div className="bg-canvas text-ink">
      <Hero />
      <GroundLevel />
      <HowItWorks />
    </div>
  );
}


function Hero() {
  return (
    <header className="relative flex min-h-dvh w-full flex-col overflow-hidden">
      <CloudShader className="absolute inset-0" />

      <nav className="relative z-20 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" aria-label="Kept home">
          <Wordmark className="text-3xl text-white drop-shadow-sm" />
        </Link>
        <div className="hidden items-center gap-8 text-sm font-medium text-white/85 drop-shadow-sm md:flex">
          <a href="#how" className="transition hover:text-white">How it works</a>
          <a href="#integrations" className="transition hover:text-white">Integrations</a>
          <a href="#privacy" className="transition hover:text-white">Privacy</a>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/sign-in" className="text-sm font-medium text-white/90 transition hover:text-white">
            Sign in
          </Link>
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-brand shadow-md transition hover:bg-white/90"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Fills the space below the nav and centers the hero in it. */}
      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 pt-8 pb-28 text-center">
        <h1 className="font-display text-5xl leading-[1.02] font-semibold tracking-[-0.03em] text-white drop-shadow-md md:text-7xl lg:text-8xl">
          Customer success <br className="hidden md:block" />
          above the clouds
        </h1>
        <p className="mt-7 max-w-2xl text-base text-white/90 drop-shadow-sm md:text-lg">
          Kept rises above the noise of your email, chats, tickets and CRM. From up here, every promise your team made
          to a customer is in view, and the ones at risk are flagged before anyone notices.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            to="/sign-up"
            className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-brand shadow-lg transition hover:-translate-y-0.5 hover:bg-white/90"
          >
            Get started
          </Link>
          <a
            href="#ground"
            className="rounded-full border border-white/50 bg-[oklch(0.35_0.08_255/0.35)] px-6 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-[oklch(0.35_0.08_255/0.5)]"
          >
            See how it works
          </a>
        </div>
        <p className="mt-4 text-xs text-white/75">Connects to the tools you already use to run your business.</p>
      </section>

      <a
        href="#ground"
        className="absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-center font-mono text-[0.6875rem] tracking-[0.3em] text-white/80 uppercase transition hover:text-white"
      >
        Descend
        <span className="mx-auto mt-2 block h-8 w-px bg-gradient-to-b from-white/70 to-transparent" />
      </a>
    </header>
  );
}

/* Shared pieces -------------------------------------------------------------------------------- */

function SectionHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`font-display text-4xl leading-[1.08] font-semibold tracking-[-0.02em] text-balance md:text-5xl ${className}`}>
      {children}
    </h2>
  );
}

/** Heading on the left, a short paragraph on the right; stacked on phones. */
function SectionIntro({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.15fr_1fr] md:items-end md:gap-12">
      <SectionHeading>{heading}</SectionHeading>
      <p className="max-w-md text-base leading-relaxed text-ink-muted md:justify-self-end">{children}</p>
    </div>
  );
}

/* promises scattered across tools -------------------------------------------------------- */

/** A commitment inside a message, picked out the way Kept would. */
function Said({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] bg-brand-soft box-decoration-clone px-0.5 text-ink underline decoration-brand/50 decoration-2 underline-offset-[3px]">
      {children}
    </span>
  );
}

const scattered: { source: string; where: string; who: string; body: ReactNode; tilt: string }[] = [
  {
    source: "Gmail",
    where: "Re: Renewal timeline",
    who: "Priya Raman to Halcyon Freight",
    body: <>Totally understood. <Said>We'll have the SSO fix live before your renewal on the 14th.</Said></>,
    tilt: "lg:-rotate-2 lg:translate-y-6",
  },
  {
    source: "Slack",
    where: "#acct-orbit-dental",
    who: "Marcus Chen",
    body: <>@dana can you send them the usage export? <Said>I told them they'd have it by Friday.</Said></>,
    tilt: "lg:rotate-1",
  },
  {
    source: "Linear",
    where: "KEP-482 · Bulk CSV export",
    who: "Comment from Sofia Alves",
    body: <><Said>Customer was promised this in Q3.</Said> Raising priority so it doesn't slip again.</>,
    tilt: "lg:-rotate-1 lg:translate-y-10",
  },
  {
    source: "HubSpot",
    where: "Note on Marlow & Fry",
    who: "Logged by Jonah Pike",
    body: <>Call went well. <Said>Agreed to extend the pilot by two weeks</Said> while legal reviews.</>,
    tilt: "lg:rotate-2 lg:translate-y-1",
  },
  {
    source: "Notion",
    where: "QBR notes · Cobalt Labs",
    who: "Action items",
    body: <><Said>Send the revised onboarding plan next week.</Said> Owner: Priya.</>,
    tilt: "lg:-rotate-1 lg:translate-y-5",
  },
];

function GroundLevel() {
  return (
    <section id="ground" className="scroll-mt-6 overflow-hidden px-4 pt-28 pb-28 md:px-8 md:pt-36">
      <div className="mx-auto max-w-6xl">
        <SectionIntro
          heading={<>Promises are made everywhere. <span className="text-blue-200">Almost none are written down.</span></>}
        >
          A date on a call, a fix in a thread, a discount in a CRM note. Each one is small, and each one lives somewhere
          different. Down here nobody sees them all, until a customer asks why one was missed.
        </SectionIntro>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:gap-5">
          {scattered.map((m) => (
            <article
              key={m.source}
              className={`rounded-xl border border-line bg-canvas p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_28px_-14px_rgb(0_0_0/0.18)] transition-transform duration-500 ease-out hover:translate-y-0 hover:rotate-0 ${m.tilt}`}
            >
              <div className="font-mono text-[0.625rem] font-medium tracking-[0.15em] text-ink-faint uppercase">{m.source}</div>
              <p className="mt-2 truncate text-[0.8125rem] font-semibold">{m.where}</p>
              <p className="truncate text-xs text-ink-faint">{m.who}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{m.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* gathered into one list ------------------------------------------------------------- */

type Status = "kept" | "on-track" | "due-soon" | "at-risk";

const statusStyle: Record<Status, { label: string; className: string }> = {
  kept: { label: "Kept", className: "bg-brand-soft text-brand" },
  "on-track": { label: "On track", className: "bg-hover text-ink-muted" },
  "due-soon": { label: "Due in 2 days", className: "bg-warn-soft text-warn" },
  "at-risk": { label: "At risk", className: "bg-danger-soft text-danger" },
};

const commitments: { what: string; account: string; owner: string; due: string; source: string; status: Status }[] = [
  { what: "SSO fix live before renewal", account: "Halcyon Freight", owner: "Priya R.", due: "Oct 14", source: "Gmail", status: "at-risk" },
  { what: "Usage export for the finance team", account: "Orbit Dental", owner: "Dana W.", due: "Oct 17", source: "Slack", status: "due-soon" },
  { what: "Revised onboarding plan", account: "Cobalt Labs", owner: "Priya R.", due: "Oct 20", source: "Notion", status: "on-track" },
  { what: "Extend pilot by two weeks", account: "Marlow & Fry", owner: "Jonah P.", due: "Oct 24", source: "HubSpot", status: "on-track" },
  { what: "Bulk CSV export shipped", account: "Orbit Dental", owner: "Sofia A.", due: "Sep 30", source: "Linear", status: "kept" },
];

/* how it works ---------------------------------------------------------------------- */

const steps = [
  {
    n: "01",
    title: "Connect your tools",
    body: "Sign in to Outlook, Gmail, Slack, Linear, Notion or HubSpot. Kept picks up new activity every few minutes. Nothing to install, nothing to forward.",
  },
  {
    n: "02",
    title: "Every item finds its account",
    body: "Messages, issues and notes are matched to the right customer by their domains and contacts. Clear rules, no guessing; anything ambiguous waits for a person.",
  },
  {
    n: "03",
    title: "Promises surface, risks rise",
    body: "Commitments appear with an owner and a due date. The ones running late, or gone quiet, are flagged before the customer has to ask.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-6 border-y border-line bg-sidebar px-4 py-28 md:px-8">
      <div className="mx-auto max-w-6xl">
        <SectionHeading className="max-w-2xl">Three steps from scattered to seen.</SectionHeading>

        <ol className="relative mt-28 grid gap-14 md:grid-cols-3 md:gap-10">
          {/* The climb: a dotted flight path rising across the three steps. */}
          <svg
            className="pointer-events-none absolute -top-20 left-0 hidden h-14 w-full text-brand/35 md:block"
            viewBox="0 0 1000 56"
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d="M0 54 C 220 54, 300 36, 500 30 S 820 6, 1000 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 7"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {steps.map((s, i) => (
            <li key={s.n} className={i === 1 ? "md:-mt-4" : i === 2 ? "md:-mt-8" : undefined}>
              <span className="font-display text-6xl leading-none font-semibold text-brand/20">{s.n}</span>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
