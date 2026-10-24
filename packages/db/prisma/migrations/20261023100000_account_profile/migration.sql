-- Company profile on accounts, like a CRM's company record.
ALTER TABLE "accounts"
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "company_type" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "employee_count" INTEGER,
  ADD COLUMN "annual_revenue_cents" BIGINT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "postal_code" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "linkedin_url" TEXT;

ALTER TABLE "contacts" ADD COLUMN "phone" TEXT;
