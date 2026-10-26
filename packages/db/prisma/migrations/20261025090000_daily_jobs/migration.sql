-- Each org's daily sweep and each person's daily digest run once per local day.
ALTER TABLE "organizations" ADD COLUMN "last_sweep_on" DATE;
ALTER TABLE "memberships" ADD COLUMN "last_digest_on" DATE;
