-- References between business rows are checked at commit, so a cascade that
-- removes both sides (org or user deletion) succeeds in any order
ALTER TABLE agent_runs ALTER CONSTRAINT agent_runs_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE brief_citations ALTER CONSTRAINT brief_citations_source_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE briefs ALTER CONSTRAINT briefs_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE briefs ALTER CONSTRAINT briefs_run_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE contacts ALTER CONSTRAINT contacts_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE conversations ALTER CONSTRAINT conversations_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE extracted_items ALTER CONSTRAINT extracted_items_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE extracted_items ALTER CONSTRAINT extracted_items_source_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE flag_evidence ALTER CONSTRAINT flag_evidence_extracted_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE flag_evidence ALTER CONSTRAINT flag_evidence_source_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE flags ALTER CONSTRAINT flags_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE flags ALTER CONSTRAINT flags_run_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE message_citations ALTER CONSTRAINT message_citations_source_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages ALTER CONSTRAINT messages_run_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE proposed_actions ALTER CONSTRAINT proposed_actions_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE proposed_actions ALTER CONSTRAINT proposed_actions_flag_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE proposed_actions ALTER CONSTRAINT proposed_actions_run_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE reminders ALTER CONSTRAINT reminders_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE reminders ALTER CONSTRAINT reminders_action_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE reminders ALTER CONSTRAINT reminders_extracted_item_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE source_items ALTER CONSTRAINT source_items_account_id_org_id_fkey DEFERRABLE INITIALLY DEFERRED;
