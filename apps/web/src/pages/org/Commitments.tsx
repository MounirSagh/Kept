import { ListChecks } from "lucide-react";
import { EmptyAction, EmptyState, Page } from "../../components/Page";

export function CommitmentsPage() {
  return (
    <Page title="Commitments" description="Promises your team made to customers: what, to whom, by whom and by when.">
      <EmptyState icon={ListChecks} title="No commitments yet" action={<EmptyAction to="../integrations">Connect a source</EmptyAction>}>
        Once a source is connected, Kept reads new messages and records each promise it finds. Every commitment links
        back to the message it came from.
      </EmptyState>
    </Page>
  );
}
