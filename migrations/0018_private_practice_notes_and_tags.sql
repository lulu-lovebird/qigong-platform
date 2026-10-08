-- Private notes are deliberately NOT columns on the generally readable checkins table.
CREATE TABLE core.practice_feeling_tag_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);
INSERT INTO core.practice_feeling_tag_state DEFAULT VALUES;
CREATE TABLE core.practice_feeling_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_zh_tw TEXT NOT NULL CHECK (length(trim(name_zh_tw)) BETWEEN 1 AND 40),
  name_en TEXT NOT NULL CHECK (length(trim(name_en)) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
ALTER TABLE core.checkins ADD CONSTRAINT checkins_id_person_unique UNIQUE(id,person_id);
CREATE TABLE core.checkin_notes (
  checkin_id UUID PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES identity.people(id),
  practice_note TEXT NOT NULL DEFAULT '' CHECK (length(practice_note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (checkin_id, person_id),
  FOREIGN KEY(checkin_id,person_id) REFERENCES core.checkins(id,person_id) ON DELETE CASCADE
);
CREATE TABLE core.checkin_note_tags (
  checkin_id UUID NOT NULL,
  person_id UUID NOT NULL,
  tag_id UUID NOT NULL REFERENCES core.practice_feeling_tags(id),
  name_zh_tw TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (checkin_id, tag_id),
  FOREIGN KEY (checkin_id, person_id) REFERENCES core.checkin_notes(checkin_id, person_id) ON DELETE CASCADE
);
CREATE INDEX checkin_notes_updated_idx ON core.checkin_notes(updated_at DESC,checkin_id);
ALTER TABLE core.practice_feeling_tag_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.practice_feeling_tag_state FORCE ROW LEVEL SECURITY;
ALTER TABLE core.practice_feeling_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.practice_feeling_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_note_tags FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.practice_feeling_tag_state,core.practice_feeling_tags,core.checkin_notes,core.checkin_note_tags FROM PUBLIC;
GRANT SELECT ON core.checkin_notes,core.checkin_note_tags TO qigong_api_runtime;
CREATE POLICY private_note_read ON core.checkin_notes FOR SELECT TO qigong_api_runtime USING (
  admin.request_principal_id() IS NOT NULL
  AND admin.has_permission('learner.read') AND admin.has_permission('checkin.read_private_note')
  AND admin.can_access_person(person_id,'learner.read')
  AND admin.can_access_person(person_id,'checkin.read_private_note')
);
CREATE POLICY private_note_tags_read ON core.checkin_note_tags FOR SELECT TO qigong_api_runtime USING (
  EXISTS (SELECT 1 FROM core.checkin_notes n WHERE n.checkin_id=checkin_note_tags.checkin_id AND n.person_id=checkin_note_tags.person_id)
);

-- These definer entry points follow the existing platform credential boundary.
-- LINE credentials are subjects from API-side verified LIFF ID tokens, NEVER browser subject fields.
CREATE FUNCTION platform.practice_person(input_platform TEXT,input_credential TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  CASE input_platform
    WHEN 'telegram' THEN target:=platform.telegram_checkin_person(input_credential);
    WHEN 'line' THEN target:=platform.line_checkin_person(input_credential);
    WHEN 'whatsapp' THEN target:=platform.whatsapp_checkin_person(platform.whatsapp_link_subject(input_credential,'checkin'));
    ELSE RAISE EXCEPTION 'practice identity unavailable';
  END CASE;
  IF target IS NULL THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  RETURN target;
END;
$$;
CREATE FUNCTION admin.practice_journal(input_person UUID,input_page INTEGER,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF admin.request_principal_id() IS NULL OR NOT admin.has_permission('learner.read')
    OR NOT admin.has_permission('checkin.read_private_note') THEN
    RAISE EXCEPTION 'journal access denied' USING ERRCODE='42501';
  END IF;
  IF input_page IS NULL OR input_page<1 OR input_page>100000 OR input_locale IS NULL
    OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  IF input_person IS NOT NULL AND (admin.can_access_person(input_person,'learner.read')
    AND admin.can_access_person(input_person,'checkin.read_private_note')) IS NOT TRUE THEN
    RAISE EXCEPTION 'learner unavailable';
  END IF;
  WITH visible AS (
    SELECT n.*,c.practice_date,
      coalesce(nullif(p.preferred_name,''),nullif(p.legal_name,''),nullif(p.public_nickname,''),
        CASE WHEN input_locale='en' THEN 'Unnamed learner' ELSE '未命名學員' END) display_name
    FROM core.checkin_notes n JOIN core.checkins c ON c.id=n.checkin_id
    JOIN identity.people p ON p.id=n.person_id
    WHERE p.status='active' AND (input_person IS NULL OR n.person_id=input_person)
      AND admin.can_access_person(n.person_id,'learner.read')
      AND admin.can_access_person(n.person_id,'checkin.read_private_note')
      AND (n.practice_note<>'' OR EXISTS(SELECT 1 FROM core.checkin_note_tags t WHERE t.checkin_id=n.checkin_id))
  ), entries AS (
    SELECT * FROM visible ORDER BY updated_at DESC,checkin_id DESC LIMIT 20 OFFSET (input_page-1)*20
  ) SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'checkinId',e.checkin_id,'personId',e.person_id,'name',e.display_name,'practiceDate',e.practice_date,
      'updatedAt',e.updated_at,'practiceNote',e.practice_note,
      'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',
        CASE WHEN input_locale='en' THEN t.name_en ELSE t.name_zh_tw END)
        ORDER BY t.sort_order,t.tag_id),'[]'::jsonb) FROM core.checkin_note_tags t WHERE t.checkin_id=e.checkin_id),
      'methodsVisible',coalesce(admin.can_access_person(e.person_id,'checkin.read'),FALSE),
      'methods',CASE WHEN admin.can_access_person(e.person_id,'checkin.read') THEN
        (SELECT coalesce(jsonb_agg(CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code),'[]'::jsonb)
         FROM core.checkin_method_selections cm JOIN core.practice_methods m ON m.id=cm.practice_method_id WHERE cm.checkin_id=e.checkin_id)
        ELSE '[]'::jsonb END
    ) ORDER BY e.updated_at DESC,e.checkin_id DESC) FROM entries e),'[]'::jsonb)) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION admin.practice_journal(UUID,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.practice_journal(UUID,INTEGER,TEXT) TO qigong_api_runtime;

REVOKE ALL ON FUNCTION platform.practice_person(TEXT,TEXT) FROM PUBLIC;

CREATE FUNCTION admin.feeling_tag_catalog()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF admin.request_principal_id() IS NULL OR NOT admin.has_permission('taxonomy.manage')
  THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('version',(SELECT version FROM core.practice_feeling_tag_state),
    'tags',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY sort_order,id),'[]'::jsonb) FROM core.practice_feeling_tags t));
END;
$$;
CREATE FUNCTION admin.save_feeling_tags(input_version INTEGER,input_tags JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_version INTEGER; item JSONB; target UUID; position INTEGER:=0;
BEGIN
  IF admin.request_principal_id() IS NULL OR NOT admin.has_permission('taxonomy.manage')
  THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501'; END IF;
  IF input_tags IS NULL OR jsonb_typeof(input_tags)<>'array' OR jsonb_array_length(input_tags)>30
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  SELECT version INTO current_version FROM core.practice_feeling_tag_state FOR UPDATE;
  IF input_version IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'tag version conflict' USING ERRCODE='40001'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'name_zh_tw') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'name_en') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'active') IS DISTINCT FROM 'boolean'
      OR length(trim(item->>'name_zh_tw')) NOT BETWEEN 1 AND 40
      OR length(trim(item->>'name_en')) NOT BETWEEN 1 AND 80
      OR (item ? 'id' AND (item->>'id' IS NULL OR (item->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))
    THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id'
    GROUP BY (t->>'id')::uuid HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id'
      AND NOT EXISTS (SELECT 1 FROM core.practice_feeling_tags WHERE id=(t->>'id')::uuid))
    OR EXISTS (SELECT 1 FROM core.practice_feeling_tags t WHERE NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(input_tags) proposed(value) WHERE (proposed.value->>'id')::uuid=t.id))
    OR EXISTS (SELECT 1 FROM (
      SELECT DISTINCT ordinal,lower(trim(label)) name FROM jsonb_array_elements(input_tags) WITH ORDINALITY x(item,ordinal),
        LATERAL (VALUES(x.item->>'name_zh_tw'),(x.item->>'name_en')) names(label)
    ) labels GROUP BY name HAVING count(*)>1)
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
    position:=position+1;
    IF item ? 'id' THEN
      UPDATE core.practice_feeling_tags SET name_zh_tw=trim(item->>'name_zh_tw'),name_en=trim(item->>'name_en'),
        active=(item->>'active')::boolean,sort_order=position WHERE id=(item->>'id')::uuid;
    ELSE
      INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,active,sort_order)
      VALUES(trim(item->>'name_zh_tw'),trim(item->>'name_en'),(item->>'active')::boolean,position);
    END IF;
  END LOOP;
  UPDATE core.practice_feeling_tag_state SET version=version+1;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,outcome,metadata)
  VALUES(admin.request_id(),admin.request_principal_id(),'feeling_tags.update','feeling_tag_catalog','success',
    jsonb_build_object('version',current_version+1,'count',position));
  RETURN admin.feeling_tag_catalog();
END;
$$;
REVOKE ALL ON FUNCTION admin.feeling_tag_catalog(),admin.save_feeling_tags(INTEGER,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.feeling_tag_catalog(),admin.save_feeling_tags(INTEGER,JSONB) TO qigong_api_runtime;

CREATE FUNCTION platform.save_practice_note(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_note TEXT,input_tags UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; zone TEXT; day DATE; saved_date DATE; ids UUID[]; chosen UUID;
BEGIN
  target:=platform.practice_person(input_platform,input_credential);
  SELECT practice_timezone INTO zone FROM identity.people WHERE id=target AND status='active' FOR UPDATE;
  IF zone IS NULL THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  day:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  SELECT practice_date INTO saved_date FROM core.checkins WHERE id=input_checkin AND person_id=target FOR UPDATE;
  IF saved_date IS NULL OR NOT (saved_date=day OR (saved_date=day-1 AND (CURRENT_TIMESTAMP AT TIME ZONE zone)::time<TIME '12:00'))
  THEN RAISE EXCEPTION 'practice note correction unavailable'; END IF;
  IF input_note IS NOT NULL AND length(input_note)>1000 THEN RAISE EXCEPTION 'invalid practice note'; END IF;
  IF input_tags IS NOT NULL AND (cardinality(input_tags)>30 OR array_position(input_tags,NULL) IS NOT NULL
    OR cardinality(input_tags)<>(SELECT count(DISTINCT id) FROM unnest(input_tags) id))
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  -- Omitted fields from older clients preserve notes and snapshots, including inactive tags.
  IF input_note IS NULL AND input_tags IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM core.practice_feeling_tag_state FOR SHARE;
  IF input_tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(input_tags) picked(id) WHERE NOT EXISTS (
    SELECT 1 FROM core.practice_feeling_tags t WHERE t.id=picked.id AND (t.active OR EXISTS (
      SELECT 1 FROM core.checkin_note_tags saved WHERE saved.checkin_id=input_checkin AND saved.tag_id=picked.id))))
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES(input_checkin,target,coalesce(input_note,''))
  ON CONFLICT(checkin_id) DO UPDATE SET practice_note=coalesce(input_note,core.checkin_notes.practice_note),updated_at=CURRENT_TIMESTAMP;
  IF input_tags IS NOT NULL THEN
    DELETE FROM core.checkin_note_tags WHERE checkin_id=input_checkin AND NOT(tag_id=ANY(input_tags));
    FOR chosen IN SELECT id FROM unnest(input_tags) id LOOP
      INSERT INTO core.checkin_note_tags(checkin_id,person_id,tag_id,name_zh_tw,name_en,sort_order)
      SELECT input_checkin,target,id,name_zh_tw,name_en,sort_order FROM core.practice_feeling_tags WHERE id=chosen
      ON CONFLICT(checkin_id,tag_id) DO NOTHING;
    END LOOP;
  END IF;
END;
$$;
CREATE FUNCTION platform.practice_notes(input_platform TEXT,input_credential TEXT,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  target:=platform.practice_person(input_platform,input_credential);
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid practice locale'; END IF;
  RETURN jsonb_build_object('tags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',
    CASE WHEN input_locale='en' AND input_platform<>'line' THEN name_en ELSE name_zh_tw END) ORDER BY sort_order,id),'[]'::jsonb)
    FROM core.practice_feeling_tags WHERE active),
    'notes',(SELECT coalesce(jsonb_agg(jsonb_build_object('checkin_id',n.checkin_id,'practice_note',n.practice_note,
      'feeling_tags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',
        CASE WHEN input_locale='en' AND input_platform<>'line' THEN t.name_en ELSE t.name_zh_tw END) ORDER BY t.sort_order,t.tag_id),'[]'::jsonb)
        FROM core.checkin_note_tags t WHERE t.checkin_id=n.checkin_id)) ORDER BY c.practice_date DESC),'[]'::jsonb)
      FROM core.checkin_notes n JOIN (SELECT id,practice_date FROM core.checkins WHERE person_id=target ORDER BY practice_date DESC LIMIT 14) c ON c.id=n.checkin_id));
END;
$$;
REVOKE ALL ON FUNCTION platform.save_practice_note(TEXT,TEXT,UUID,TEXT,UUID[]),platform.practice_notes(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.save_practice_note(TEXT,TEXT,UUID,TEXT,UUID[]),platform.practice_notes(TEXT,TEXT,TEXT) TO qigong_api_runtime;
