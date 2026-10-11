import { Calendar, FileText, Headphones, Inbox, Mail, MessageSquare, MessagesSquare, Briefcase, type LucideIcon } from "lucide-react";
import { can } from "@kept/shared";
import { useOrg } from "../../app/org-context";
import { Page, Section } from "../../components/Page";
import { ui } from "../../ui";

interface Source {
  name: string;
  reads: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; sources: Source[] }[] = [
  {
    title: "Email and calendar",
    sources: [
      { name: "Gmail", reads: "Threads with customers, to find what was promised and when.", icon: Mail },
      { name: "Outlook", reads: "Threads with customers, to find what was promised and when.", icon: Inbox },
      { name: "Google Calendar", reads: "Upcoming customer meetings, to prepare briefs ahead of each call.", icon: Calendar },
    ],
  },
  {
    title: "Chat",
    sources: [
      { name: "Slack", reads: "Shared and internal channels where customer commitments are discussed.", icon: MessageSquare },
      { name: "Microsoft Teams", reads: "Channels and chats where customer commitments are discussed.", icon: MessagesSquare },
    ],
  },
  {
    title: "CRM, support and documents",
    sources: [
      { name: "HubSpot", reads: "Accounts, owners, deal values and renewal dates.", icon: Briefcase },
      { name: "Zendesk", reads: "Tickets, to see whether promised fixes actually shipped.", icon: Headphones },
      { name: "Google Drive", reads: "Contracts and SOWs, for obligations written into agreements.", icon: FileText },
    ],
  },
];

export function IntegrationsPage() {
  const { actor } = useOrg();
  const ownerNote = can(actor, { action: "org.manage" }) ? "" : " Owners connect sources for the whole organization.";
  return (
    <Page
      title="Integrations"
      description={`Kept only reads from the tools you connect. Nothing is sent from them without approval.${ownerNote}`}
    >
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {group.sources.map(({ name, reads, icon: Icon }) => (
              <li key={name} className="flex items-center gap-4 px-4 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-sidebar text-ink-muted">
                  <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{name}</p>
                  <p className={ui.hint}>{reads}</p>
                </div>
                <span className="hidden text-xs text-ink-faint sm:inline">Not connected</span>
                <button className={ui.button.ghostSm} disabled title="Coming soon">
                  Coming soon
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </Page>
  );
}
