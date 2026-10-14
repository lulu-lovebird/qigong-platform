-- LINE-only keyset stream; legacy journal, staff and external facades remain unchanged.
CREATE FUNCTION platform.line_journal_stream(input_subject TEXT,input_cursor JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor_time TIMESTAMPTZ:=clock_timestamp();after_time TIMESTAMPTZ;after_id UUID;result JSONB;
BEGIN
 PERFORM platform.practice_person('line',input_subject);
 IF input_cursor IS NOT NULL THEN
  IF jsonb_typeof(input_cursor)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(input_cursor))<>3 OR NOT(input_cursor ?& ARRAY['snapshotAt','publishedAt','id']) THEN RAISE EXCEPTION 'invalid journal cursor';END IF;
  BEGIN anchor_time:=(input_cursor->>'snapshotAt')::timestamptz;after_time:=(input_cursor->>'publishedAt')::timestamptz;after_id:=(input_cursor->>'id')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'invalid journal cursor';END;
  IF anchor_time IS NULL OR after_time IS NULL OR after_id IS NULL OR anchor_time>clock_timestamp()+INTERVAL '1 second' OR anchor_time<clock_timestamp()-INTERVAL '30 minutes' OR after_time>anchor_time THEN RAISE EXCEPTION 'invalid journal cursor';END IF;
 END IF;
 WITH candidates AS (
  SELECT j.* FROM core.journal_publications j JOIN identity.people p ON p.id=j.person_id JOIN identity.platform_identities i ON i.id=j.identity_id AND i.person_id=p.id
  WHERE j.active AND p.status='active' AND i.revoked_at IS NULL AND j.published_at<=anchor_time
  AND (after_time IS NULL OR (j.published_at,j.id)<(after_time,after_id))
  AND EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL)
  AND EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved')
  ORDER BY j.published_at DESC,j.id DESC LIMIT 11
 ), entries AS (SELECT * FROM candidates ORDER BY published_at DESC,id DESC LIMIT 10), enriched AS (
  SELECT e.*,c.created_at checked_in_at,c.practice_timezone,r.name_zh_tw region_name,core.practice_metrics(e.person_id,e.practice_date) metrics
  FROM entries e JOIN core.checkins c ON c.id=e.checkin_id AND c.person_id=e.person_id JOIN core.person_region_assignments a ON a.id=c.region_assignment_id AND a.person_id=c.person_id JOIN core.regions r ON r.id=a.region_id
 )
 SELECT jsonb_build_object('pageSize',10,'snapshotAt',anchor_time,'hasMore',(SELECT count(*)>10 FROM candidates),'nextCursor',CASE WHEN (SELECT count(*)>10 FROM candidates) THEN (SELECT jsonb_build_object('snapshotAt',anchor_time,'publishedAt',published_at,'id',id) FROM entries ORDER BY published_at,id LIMIT 1) ELSE NULL END,
 'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'version',e.revision,'alias',e.alias,'date',e.practice_date,'publishedAt',e.published_at,'checkedInAt',e.checked_in_at,'timezone',e.practice_timezone,'region',e.region_name,'currentStreak',(e.metrics->>'currentStreak')::integer,'totalDays',(e.metrics->>'totalDays')::integer,'practiceNote',e.note_snapshot,'methods',(SELECT coalesce(jsonb_agg(m->>'zh_TW'),'[]') FROM jsonb_array_elements(e.method_snapshot) m),'feelingTags',(SELECT coalesce(jsonb_agg(t->>'zh_TW'),'[]') FROM jsonb_array_elements(e.tag_snapshot) t)) ORDER BY e.published_at DESC,e.id DESC) FROM enriched e),'[]')) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION platform.line_journal_stream(TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.line_journal_stream(TEXT,JSONB) TO qigong_api_runtime;
CREATE FUNCTION ops.line_journal_stream_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-15-line-journal-stream')$$;
REVOKE ALL ON FUNCTION ops.line_journal_stream_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.line_journal_stream_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-15-line-journal-stream',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
