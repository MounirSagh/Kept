import { Flag } from "lucide-react";
import { EmptyState, Page } from "../../components/Page";

export function FlagsPage() {
  return (
    <Page title="Flags" description="Commitments that may slip, contradictions, and early churn signals.">
      <EmptyState icon={Flag} title="Nothing flagged">
        When a deadline approaches with no follow-up, or a promise is contradicted later, Kept flags it here with the
        evidence and how much revenue is at stake.
      </EmptyState>
    </Page>
  );
}
