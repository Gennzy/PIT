CREATE INDEX pit_session_user ON pit.sessions(user_id);
CREATE INDEX pit_booking_user ON pit.bookings(tenant,user_id,date);
CREATE INDEX pit_booking_vehicle ON pit.bookings(tenant,vehicle,date);
CREATE INDEX pit_audit_user ON pit.audit(tenant,user_id,id DESC);
CREATE INDEX pit_photo_booking ON pit.photos(tenant,booking);
CREATE INDEX pit_share_vehicle ON pit.shares(tenant,vehicle);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['tenants','users','sessions','vehicles','bookings','notifications','storage','shares','audit','photos','rate_limits'] LOOP EXECUTE format('CREATE POLICY no_browser_access ON pit.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',t); END LOOP; END $$;
