CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
-- Scheduled by Supabase PostgreSQL, not an in-memory Vercel timer.
CREATE FUNCTION pit.send_reminders() RETURNS integer
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE b record; processed integer := 0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('pit-v6-write'));
 FOR b IN SELECT * FROM pit.bookings
 WHERE status='booked' AND data->>'remind'='true' AND COALESCE(data->>'reminded','false')<>'true'
 AND ((date::date + make_interval(mins=>start)) AT TIME ZONE 'Europe/Moscow') BETWEEN now() AND now()+interval '2 hours'
 FOR UPDATE SKIP LOCKED
 LOOP
  INSERT INTO pit.notifications(id,tenant,user_id,message,created,is_read)
  VALUES(gen_random_uuid()::text,b.tenant,b.user_id,'Напоминание: визит '||b.date||' '||lpad((b.start/60)::text,2,'0')||':'||lpad((b.start%60)::text,2,'0'),to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),0);
  UPDATE pit.bookings SET data=jsonb_set(data,'{reminded}','true'::jsonb) WHERE id=b.id;
  processed:=processed+1;
 END LOOP;
 DELETE FROM pit.sessions WHERE expires<(extract(epoch FROM now())*1000)::bigint;
 DELETE FROM pit.shares WHERE expires<(extract(epoch FROM now())*1000)::bigint;
 DELETE FROM pit.rate_limits WHERE window_start<now()-interval '1 day';
 RETURN processed;
END;
$$;
REVOKE ALL ON FUNCTION pit.send_reminders() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('pit-reminders','*/5 * * * *','SELECT pit.send_reminders();');
