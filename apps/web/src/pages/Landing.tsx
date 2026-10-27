import type { ReactNode } from "react";
import { Link } from "react-router";
import { CloudShader } from "@/components/ui/cloud-shader";
import { KnotMark, Wordmark } from "@/components/Wordmark";

/**
 * Down the page the day turns to night: each section a shade darker than the last, its gradient
 * starting where the previous one ended, until the evening sky meets the midnight clouds.
 */
const SKY = {
  canvas: "#fdfcf9",
  how: "linear-gradient(180deg, #fdfcf9, #eef1f6)",
  list: "linear-gradient(180deg, #eef1f6, #e4e9f1)",
  work: "linear-gradient(180deg, #e4e9f1, #dae1ec)",
  privacy: "linear-gradient(180deg, #dae1ec, #ced7e5)",
  nightTop: "#1f2a4c",
  night: "linear-gradient(180deg, #1f2a4c, #121a35 55%, #04060d)",
  // Midnight's skyTopColor: the last section ends on it.
  midnight: "#04060d",
};

/**
 * The wave at the bottom of a section, like a soda-can banner: three swells in shades of the next
 * section's color, the last one solid, so the next section rises out of it.
 */
function Wave({ color, flip = false, className = "" }: { color: string; flip?: boolean; className?: string }) {
  return (
    <svg
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full md:h-28 ${className}`}
      viewBox="0 0 1440 120"
      preserveAspectRatio="none"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      aria-hidden
    >
      <path d="M0 46 C 300 112, 640 4, 1000 44 C 1200 66, 1340 54, 1440 40 V120 H0 Z" style={{ fill: color }} fillOpacity="0.28" />
      <path d="M0 74 C 280 30, 620 118, 980 72 C 1180 48, 1330 56, 1440 66 V120 H0 Z" style={{ fill: color }} fillOpacity="0.55" />
      <path d="M0 98 C 400 62, 820 130, 1440 86 V120 H0 Z" style={{ fill: color }} />
    </svg>
  );
}

export function Landing() {
  return (
    <div className="bg-canvas text-ink">
      <Hero />
      <GroundLevel />
      <HowItWorks />
      <TheList />
      <ShowsItsWork />
      <ClearSkies />
      <Constellation />
      <Midnight />
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

      <Wave color={SKY.canvas} className="z-[5]" />
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
    <section id="how" className="scroll-mt-6 px-4 py-28 md:px-8" style={{ background: SKY.how }}>
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

/* the view from up here: one list ---------------------------------------------------------- */

function TheList() {
  const open = commitments.filter((c) => c.status !== "kept").length;
  return (
    <section id="list" className="scroll-mt-6 px-4 py-28 md:px-8" style={{ background: SKY.list }}>
      <div className="mx-auto max-w-6xl">
        <SectionIntro heading={<>From up here, every promise is in one list.</>}>
          Each commitment keeps the words it was made in, who owns it, when it is due and where it was said. The kept ones
          are checked off by the messages that prove it. The late ones rise to the top.
        </SectionIntro>

        <div className="mt-14 overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_1px_2px_rgb(0_0_0/0.04),0_30px_60px_-30px_rgb(20_40_90/0.35)]">
          <div className="flex items-center gap-3 border-b border-line bg-sidebar px-4 py-3">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
              <span className="size-2.5 rounded-full bg-line-strong" />
            </span>
            <span className="text-[0.8125rem] font-semibold">Commitments</span>
            <span className="text-[0.8125rem] text-ink-faint">Our promises · {open} open</span>
          </div>
          <ul className="divide-y divide-line">
            {commitments.map((c) => (
              <li key={c.what} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_8rem_5rem_6rem_8rem] md:px-6">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-medium ${c.status === "kept" ? "text-ink-faint line-through decoration-ink-faint/60" : ""}`}>{c.what}</p>
                  <p className="truncate text-xs text-ink-faint">{c.account}</p>
                </div>
                <span className="hidden text-[0.8125rem] text-ink-muted md:block">{c.owner}</span>
                <span className="hidden text-[0.8125rem] text-ink-muted tabular-nums md:block">{c.due}</span>
                <span className="hidden font-mono text-[0.6875rem] tracking-[0.12em] text-ink-faint uppercase md:block">{c.source}</span>
                <span className={`justify-self-end rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[c.status].className}`}>
                  {statusStyle[c.status].label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* every flag shows its work ------------------------------------------------------------------ */

const evidence: { quote: ReactNode; source: string; stance: "supports" | "contradicts" | "data" }[] = [
  { quote: "We'll have the SSO fix live before your renewal on the 14th.", source: "Gmail · Priya to Halcyon", stance: "supports" },
  { quote: "Blocked on the identity provider upgrade. Moving to next sprint.", source: "Linear · KEP-512", stance: "contradicts" },
  { quote: "SAML single sign-on, no later than October 14.", source: "Order form · page 2", stance: "supports" },
  { quote: "2026-10 | 74 vehicles | 81 users", source: "Warehouse · usage by month", stance: "data" },
];

const stanceStyle = {
  supports: { label: "Supports", className: "text-ink-faint" },
  contradicts: { label: "Contradicts", className: "text-danger" },
  data: { label: "Live data", className: "text-brand" },
} as const;

const agents = [
  { name: "Planner", does: "asks what could break this week" },
  { name: "Investigator", does: "searches messages, documents and data" },
  { name: "Critic", does: "throws out anything it cannot quote" },
  { name: "Advisor", does: "raises the flag and drafts the next step" },
];

function ShowsItsWork() {
  return (
    <section className="px-4 py-28 md:px-8" style={{ background: SKY.work }}>
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-20">
        <figure className="rounded-2xl border border-line bg-canvas p-5 shadow-[0_24px_50px_-30px_rgb(20_40_90/0.35)] md:p-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-semibold text-danger">High</span>
            <span className="text-xs text-ink-faint">Deadline risk · Halcyon Freight</span>
          </div>
          <p className="mt-3 text-lg leading-snug font-semibold text-balance">
            The SSO fix promised for the 14th has moved to next sprint, two days before the renewal.
          </p>

          {/* The evidence: one thread through every source that backs the flag. */}
          <ol className="relative mt-6 space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[7px] before:w-px before:bg-line-strong">
            {evidence.map((e) => (
              <li key={e.source} className="relative pl-7">
                <span className="absolute top-1.5 left-0 size-[15px] rounded-full border-2 border-canvas bg-brand/70 ring-1 ring-line" aria-hidden />
                <p className={`text-sm leading-relaxed ${e.stance === "data" ? "font-mono text-[0.8125rem]" : ""}`}>“{e.quote}”</p>
                <p className="mt-0.5 text-xs">
                  <span className={`font-medium ${stanceStyle[e.stance].className}`}>{stanceStyle[e.stance].label}</span>
                  <span className="text-ink-faint"> · {e.source}</span>
                </p>
              </li>
            ))}
            <li className="relative pl-7">
              <span className="absolute top-1.5 left-0 size-[15px] rounded-full border-2 border-canvas bg-ink-faint/40 ring-1 ring-line" aria-hidden />
              <p className="text-sm leading-relaxed text-ink-faint line-through decoration-danger/70 decoration-2">“The customer is unhappy with the price.”</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                <span className="font-medium text-danger">Dropped by the critic</span> · no source says this
              </p>
            </li>
          </ol>
        </figure>

        <div>
          <SectionHeading>Every flag shows its work.</SectionHeading>
          <p className="mt-5 max-w-md text-base leading-relaxed text-ink-muted">
            Four agents review each account. Anything they cannot quote, word for word, from your messages, documents or data
            never reaches you. What does reach you comes with a drafted next step, and waits for your yes.
          </p>
          <ol className="mt-8 space-y-4">
            {agents.map((a, i) => (
              <li key={a.name} className="flex items-baseline gap-4">
                <span className="font-display text-2xl leading-none font-semibold text-brand/30 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <p className="text-[0.9375rem]">
                  <span className="font-semibold">{a.name}</span> <span className="text-ink-muted">{a.does}</span>
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* integrations: a constellation ---------------------------------------------------------------- */

/** Stars around the knot, in % of the sky's box. */
const stars: { name: string; reads: string; x: number; y: number }[] = [
  { name: "Gmail", reads: "Email", x: 14, y: 22 },
  { name: "Outlook", reads: "Email", x: 9, y: 62 },
  { name: "Google Calendar", reads: "Meetings", x: 28, y: 86 },
  { name: "Slack", reads: "Channels and threads", x: 34, y: 10 },
  { name: "Microsoft Teams", reads: "Chats", x: 70, y: 9 },
  { name: "Linear", reads: "Issues", x: 87, y: 26 },
  { name: "Notion", reads: "Pages", x: 92, y: 62 },
  { name: "HubSpot", reads: "Companies and contacts", x: 73, y: 86 },
  { name: "Drive and OneDrive", reads: "Contracts and plans", x: 51, y: 95 },
  { name: "Zetaris", reads: "Your warehouse, live", x: 55, y: 4 },
];

function Constellation() {
  return (
    <section
      id="integrations"
      className="relative scroll-mt-6 overflow-hidden px-4 pt-28 pb-40 text-white md:px-8"
      style={{
        background:
          "radial-gradient(1px 1px at 12% 18%, rgb(255 255 255 / 0.7), transparent), radial-gradient(1px 1px at 78% 30%, rgb(255 255 255 / 0.5), transparent), radial-gradient(1.5px 1.5px at 40% 72%, rgb(255 255 255 / 0.6), transparent), radial-gradient(1px 1px at 88% 80%, rgb(255 255 255 / 0.45), transparent), radial-gradient(1px 1px at 62% 48%, rgb(255 255 255 / 0.4), transparent), radial-gradient(1px 1px at 24% 56%, rgb(255 255 255 / 0.5), transparent), " + SKY.night,
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 md:grid-cols-[1.15fr_1fr] md:items-end md:gap-12">
          <SectionHeading className="text-white">Every place a promise is made, in one sky.</SectionHeading>
          <p className="max-w-md text-base leading-relaxed text-white/70 md:justify-self-end">
            Connect the tools your team already lives in. Files shared in them are read too, and through Zetaris the agents
            can check your warehouse while they work.
          </p>
        </div>

        {/* Wide screens: the constellation. Each tool is a star tied to the knot. */}
        <div className="relative mt-16 hidden aspect-[2.2/1] md:block">
          <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {stars.map((s) => (
              <line
                key={s.name}
                x1="50"
                y1="50"
                x2={s.x}
                y2={s.y}
                stroke="white"
                strokeOpacity="0.22"
                strokeWidth="1"
                strokeDasharray="2 5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
          <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <span className="flex size-20 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 backdrop-blur-sm">
              <KnotMark className="size-11 text-white" />
            </span>
            <span className="font-logo text-lg font-semibold tracking-[-0.02em]">Kept</span>
          </div>
          {stars.map((s) => (
            <div key={s.name} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
              <span className="mx-auto block size-2 rounded-full bg-white shadow-[0_0_12px_3px_rgb(255_255_255/0.45)]" aria-hidden />
              <p className="mt-2 text-sm font-semibold whitespace-nowrap">{s.name}</p>
              <p className="text-xs whitespace-nowrap text-white/60">{s.reads}</p>
            </div>
          ))}
        </div>

        {/* Phones: the same tools as a list. */}
        <ul className="mt-12 grid grid-cols-2 gap-x-6 gap-y-5 md:hidden">
          {stars.map((s) => (
            <li key={s.name} className="flex items-start gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white shadow-[0_0_8px_2px_rgb(255_255_255/0.4)]" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{s.name}</span>
                <span className="block text-xs text-white/60">{s.reads}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Wave color={SKY.midnight} />
    </section>
  );
}

/* privacy ------------------------------------------------------------------------------------- */

const principles = [
  {
    title: "Private until matched",
    body: "What Kept reads from your own mailbox stays visible to you alone until it is matched to a client your team shares.",
  },
  {
    title: "Routed by rules, not guesses",
    body: "Contacts, email domains and channel names decide which client an item belongs to. Every route shows its reason.",
  },
  {
    title: "Nothing happens without a yes",
    body: "Kept drafts; you approve. Emails leave from your own mailbox, and issues or tasks are created only after someone says so.",
  },
  {
    title: "Yours to take back",
    body: "Access to your tools is encrypted at rest. Disconnect one and everything Kept read from it is deleted.",
  },
];

function ClearSkies() {
  return (
    <section id="privacy" className="relative scroll-mt-6 px-4 pt-28 pb-44 md:px-8" style={{ background: SKY.privacy }}>
      <div className="mx-auto max-w-6xl">
        <SectionIntro heading={<>Clear skies on privacy.</>}>
          A product about keeping promises should keep its own. These are Kept's.
        </SectionIntro>
        <ol className="mt-14 grid gap-x-12 gap-y-10 border-t border-ink/10 pt-10 md:grid-cols-2">
          {principles.map((p, i) => (
            <li key={p.title} className="grid grid-cols-[auto_1fr] gap-x-5">
              <KnotMark className={`mt-0.5 size-6 ${i % 2 === 0 ? "text-brand" : "text-brand/60"}`} />
              <div>
                <h3 className="text-lg font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink/75">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <Wave color={SKY.nightTop} flip />
    </section>
  );
}

/* back above the clouds, at midnight ------------------------------------------------------------ */

/** A few stars over the night sky, in % of the section. */
const nightStars = [
  [8, 14, 1.5], [17, 32, 1], [26, 9, 1], [35, 24, 1.5], [44, 6, 1], [58, 18, 1], [66, 30, 1.5], [73, 8, 1],
  [88, 36, 1], [93, 12, 1.5], [12, 46, 1], [52, 38, 1], [81, 52, 1], [3, 62, 1], [96, 58, 1],
] as const;

function Midnight() {
  return (
    <footer className="relative overflow-hidden">
      <section className="relative flex min-h-[86vh] flex-col items-center px-4 pt-28 text-center">
        <CloudShader className="absolute inset-0" count={4} speed={0.35} skyTopColor="#04060d" skyBottomColor="#16224a" cloudColor="#7a88b0" />
        {/* Stars and the moon, over the sky and under the text. */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {nightStars.map(([x, y, r], i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{ left: `${x}%`, top: `${y}%`, width: `${r * 2}px`, height: `${r * 2}px`, opacity: 0.55 + (i % 3) * 0.15, boxShadow: "0 0 6px 1px rgb(255 255 255 / 0.35)" }}
            />
          ))}
          <span
            className="absolute top-[12%] right-[12%] size-16 rounded-full md:size-20"
            style={{
              background: "radial-gradient(circle at 38% 36%, #fffaf0, #e9e4d6 60%, #cfc8b6)",
              boxShadow: "0 0 40px 12px rgb(255 248 230 / 0.22), 0 0 120px 40px rgb(180 195 255 / 0.12)",
            }}
          />
        </div>
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center pb-16">
          <KnotMark className="size-12 text-white drop-shadow-md" />
          <h2 className="mt-6 font-display text-5xl leading-[1.02] font-semibold tracking-[-0.03em] text-white drop-shadow-md md:text-7xl">
            Every promise, kept.
          </h2>
          <p className="mt-6 max-w-xl text-base text-white/90 drop-shadow-sm md:text-lg">
            Connect your first tool in a minute. By tomorrow morning, the promises at risk are already in your inbox.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/sign-up"
              className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-brand shadow-lg transition hover:-translate-y-0.5 hover:bg-white/90"
            >
              Get started
            </Link>
            <Link
              to="/sign-in"
              className="rounded-full border border-white/50 bg-[oklch(0.3_0.06_265/0.35)] px-6 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-[oklch(0.3_0.06_265/0.5)]"
            >
              Sign in
            </Link>
          </div>
        </div>
        {/* The footer, still under the night sky: the clouds keep drifting behind it. */}
        <div className="relative z-10 flex w-full max-w-6xl flex-col items-center justify-between gap-4 border-t border-white/15 py-8 text-sm text-white/75 md:flex-row">
          <Wordmark className="text-xl text-white" markClassName="text-white" />
          <nav className="flex gap-6" aria-label="Footer">
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="#integrations" className="transition hover:text-white">Integrations</a>
            <a href="#privacy" className="transition hover:text-white">Privacy</a>
          </nav>
          <p className="text-xs text-white/55">© 2026 Kept</p>
        </div>
      </section>
    </footer>
  );
}
