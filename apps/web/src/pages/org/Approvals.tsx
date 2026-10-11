import { CircleCheck } from "lucide-react";
import { EmptyState, Page } from "../../components/Page";

export function ApprovalsPage() {
  return (
    <Page title="Approvals" description="Follow-ups Kept proposes. Nothing is sent until someone approves it.">
      <EmptyState icon={CircleCheck} title="Nothing to review">
        For each flag, Kept drafts the next step: a follow-up email, a ticket, a CRM update or a reminder. You can edit,
        approve or reject each one here.
      </EmptyState>
    </Page>
  );
}
