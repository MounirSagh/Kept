import { Bot } from "lucide-react";
import { EmptyAction, EmptyState, Page } from "../../components/Page";

export function AssistantPage() {
  return (
    <Page title="Assistant" description="Ask about any account: what was promised, what's overdue, what changed since the last call.">
      <EmptyState icon={Bot} title="Available once Kept has something to read" action={<EmptyAction to="../integrations">Connect a source</EmptyAction>}>
        Answers cite the emails, messages and tickets they come from, so you can check every claim before a call.
      </EmptyState>
    </Page>
  );
}
