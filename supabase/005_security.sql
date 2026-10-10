-- Apply after 001–004, before deploying V4.3. Additive; no passwords/data copied.
BEGIN;
CREATE TABLE IF NOT EXISTS pit.platform_mfa_replay(
 credential text PRIMARY KEY CHECK(length(credential)=64),
 last_step bigint NOT NULL CHECK(last_step>=0),
 updated text NOT NULL
);
ALTER TABLE pit.platform_mfa_replay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pit.platform_mfa_replay FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='pit' AND tablename='platform_mfa_replay' AND policyname='no_browser_access') THEN
  CREATE POLICY no_browser_access ON pit.platform_mfa_replay AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
 END IF;
END $$;
COMMIT;
