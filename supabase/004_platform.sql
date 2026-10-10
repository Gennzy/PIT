-- Apply after 001, 002, 003. Additive migration; no client or order data is copied/deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS pit.companies(id text PRIMARY KEY,name text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),access_until text CHECK(access_until IS NULL OR access_until ~ '^\d{4}-\d{2}-\d{2}$'),created text NOT NULL,updated text NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0));
CREATE TABLE IF NOT EXISTS pit.platform_sessions(token text PRIMARY KEY CHECK(length(token)=64),credential text NOT NULL CHECK(length(credential)=64),expires bigint NOT NULL);
CREATE TABLE IF NOT EXISTS pit.platform_audit(id text PRIMARY KEY,actor text NOT NULL,action text NOT NULL,target text NOT NULL,created text NOT NULL);
CREATE INDEX IF NOT EXISTS pit_tenant_company ON pit.tenants(owner_key);
CREATE INDEX IF NOT EXISTS pit_platform_audit_time ON pit.platform_audit(created DESC);
CREATE INDEX IF NOT EXISTS pit_platform_session_expiry ON pit.platform_sessions(expires);
INSERT INTO pit.companies(id,name,status,created,updated)
SELECT owner_key,min(config->>'name'),'active',now()::text,now()::text FROM pit.tenants GROUP BY owner_key ON CONFLICT(id) DO NOTHING;
ALTER TABLE pit.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pit.platform_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pit.platform_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pit.companies,pit.platform_sessions,pit.platform_audit FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['companies','platform_sessions','platform_audit'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='pit' AND tablename=t AND policyname='no_browser_access') THEN
 EXECUTE format('CREATE POLICY no_browser_access ON pit.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',t);
 END IF;
END LOOP; END $$;
COMMIT;
