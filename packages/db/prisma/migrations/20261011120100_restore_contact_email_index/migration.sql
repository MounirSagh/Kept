-- 20261011120000 renamed the partial unique index on contact email; restore its name and the
-- plain lookup index Prisma manages. The partial index keeps email unique among live contacts.
ALTER INDEX "contacts_org_id_email_key" RENAME TO "contacts_org_id_email_active_key";
CREATE INDEX "contacts_org_id_email_idx" ON "contacts"("org_id", "email");
