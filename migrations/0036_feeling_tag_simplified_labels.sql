-- Explicit catalog translations only. No backfill of labels, notes, selections or publications.
ALTER TABLE core.practice_feeling_tags ADD COLUMN name_zh_cn TEXT
 CHECK(name_zh_cn IS NULL OR length(trim(name_zh_cn)) BETWEEN 1 AND 40);
ALTER TABLE core.checkin_note_tags ADD COLUMN name_zh_cn TEXT
 CHECK(name_zh_cn IS NULL OR length(trim(name_zh_cn)) BETWEEN 1 AND 40);

CREATE OR REPLACE FUNCTION admin.save_feeling_tags(input_version INTEGER,input_tags JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_version INTEGER;item JSONB;position INTEGER:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 IF NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.principals a ON a.id=g.principal_id JOIN admin.role_permissions rp ON rp.role_id=g.role_id JOIN admin.permissions p ON p.id=rp.permission_id WHERE a.id=admin.request_principal_id() AND a.status='active' AND p.code='taxonomy.manage' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501';END IF;
 IF input_tags IS NULL OR jsonb_typeof(input_tags)<>'array' OR jsonb_array_length(input_tags)>30 THEN RAISE EXCEPTION 'invalid feeling tags';END IF;
 SELECT version INTO current_version FROM core.practice_feeling_tag_state FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.principals a ON a.id=g.principal_id JOIN admin.role_permissions rp ON rp.role_id=g.role_id JOIN admin.permissions p ON p.id=rp.permission_id WHERE a.id=admin.request_principal_id() AND a.status='active' AND p.code='taxonomy.manage' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501';END IF;
 IF input_version IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'tag version conflict' USING ERRCODE='40001';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'name_zh_tw') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'name_en') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'active') IS DISTINCT FROM 'boolean'
   OR length(trim(item->>'name_zh_tw')) NOT BETWEEN 1 AND 40 OR length(trim(item->>'name_en')) NOT BETWEEN 1 AND 80
   OR (item ? 'name_zh_cn' AND item->'name_zh_cn'<>'null'::jsonb AND (jsonb_typeof(item->'name_zh_cn') IS DISTINCT FROM 'string' OR length(trim(item->>'name_zh_cn'))>40))
   OR (item ? 'id' AND (item->>'id' IS NULL OR (item->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')) THEN RAISE EXCEPTION 'invalid feeling tags';END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id' GROUP BY (t->>'id')::uuid HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id' AND NOT EXISTS(SELECT 1 FROM core.practice_feeling_tags WHERE id=(t->>'id')::uuid))
  OR EXISTS(SELECT 1 FROM core.practice_feeling_tags t WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(input_tags) proposed(value) WHERE (proposed.value->>'id')::uuid=t.id))
  OR EXISTS(SELECT 1 FROM(SELECT DISTINCT ordinal,lower(trim(label)) name FROM jsonb_array_elements(input_tags) WITH ORDINALITY x(item,ordinal),LATERAL(VALUES(x.item->>'name_zh_tw'),(x.item->>'name_en'),(CASE WHEN x.item ? 'name_zh_cn' THEN nullif(trim(x.item->>'name_zh_cn'),'') ELSE(SELECT name_zh_cn FROM core.practice_feeling_tags WHERE id=(x.item->>'id')::uuid) END)) names(label) WHERE label IS NOT NULL) labels GROUP BY name HAVING count(*)>1)
 THEN RAISE EXCEPTION 'invalid feeling tags';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
  position:=position+1;
  IF item ? 'id' THEN
   UPDATE core.practice_feeling_tags SET name_zh_tw=trim(item->>'name_zh_tw'),name_en=trim(item->>'name_en'),name_zh_cn=CASE WHEN item ? 'name_zh_cn' THEN nullif(trim(item->>'name_zh_cn'),'') ELSE name_zh_cn END,active=(item->>'active')::boolean,sort_order=position WHERE id=(item->>'id')::uuid;
  ELSE
   INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,name_zh_cn,active,sort_order) VALUES(trim(item->>'name_zh_tw'),trim(item->>'name_en'),nullif(trim(item->>'name_zh_cn'),''),(item->>'active')::boolean,position);
  END IF;
 END LOOP;
 UPDATE core.practice_feeling_tag_state SET version=version+1;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,outcome,metadata) VALUES(admin.request_id(),admin.request_principal_id(),'feeling_tags.update','feeling_tag_catalog','success',jsonb_build_object('version',current_version+1,'count',position));
 RETURN admin.feeling_tag_catalog();
END$$;

-- Retain the consent/eligibility wrapper and all existing save locks/omission semantics.
DO $$DECLARE definition TEXT;updated TEXT;BEGIN
 definition:=pg_get_functiondef('platform._pre_privacy_save_practice_note(text,text,uuid,text,uuid[])'::regprocedure);
 updated:=replace(definition,'tag_id,name_zh_tw,name_en,sort_order)','tag_id,name_zh_tw,name_en,name_zh_cn,sort_order)');
 updated:=replace(updated,'SELECT input_checkin,target,id,name_zh_tw,name_en,sort_order','SELECT input_checkin,target,id,name_zh_tw,name_en,name_zh_cn,sort_order');
 IF updated=definition THEN RAISE EXCEPTION 'unexpected feeling tag snapshot writer';END IF;
 EXECUTE updated;
 definition:=pg_get_functiondef('platform.journal_source(uuid)'::regprocedure);
 updated:=replace(definition,'jsonb_build_object(''zh_TW'',t.name_zh_tw,''en'',t.name_en)','(jsonb_build_object(''zh_TW'',t.name_zh_tw,''en'',t.name_en)||CASE WHEN t.name_zh_cn IS NULL THEN ''{}''::jsonb ELSE jsonb_build_object(''zh_CN'',t.name_zh_cn) END)');
 IF updated=definition THEN RAISE EXCEPTION 'unexpected journal tag source';END IF;
 EXECUTE updated;
END$$;

-- Explicit tag-column expressions only: no method/name/note/reason conversion and no authority changes.
DO $$DECLARE f RECORD;definition TEXT;updated TEXT;changed INTEGER:=0;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('platform','core','admin') AND p.proargnames @> ARRAY['input_locale']::text[] AND(p.prosrc LIKE '%core.checkin_note_tags%' OR p.prosrc LIKE '%core.practice_feeling_tags%') LOOP
  definition:=pg_get_functiondef(f.oid);
  updated:=replace(definition,'CASE WHEN input_locale=''en'' THEN t.name_en ELSE t.name_zh_tw END','CASE input_locale WHEN ''en'' THEN t.name_en WHEN ''zh_CN'' THEN coalesce(t.name_zh_cn,t.name_zh_tw) ELSE t.name_zh_tw END');
  updated:=replace(updated,'CASE WHEN input_locale=''en'' THEN name_en ELSE name_zh_tw END','CASE input_locale WHEN ''en'' THEN name_en WHEN ''zh_CN'' THEN coalesce(name_zh_cn,name_zh_tw) ELSE name_zh_tw END');
  updated:=replace(updated,'CASE WHEN input_locale=''en'' AND input_platform<>''line'' THEN name_en ELSE name_zh_tw END','CASE WHEN input_locale=''zh_CN'' THEN coalesce(name_zh_cn,name_zh_tw) WHEN input_locale=''en'' AND input_platform<>''line'' THEN name_en ELSE name_zh_tw END');
  updated:=replace(updated,'CASE WHEN input_locale=''en'' AND input_platform<>''line'' THEN t.name_en ELSE t.name_zh_tw END','CASE WHEN input_locale=''zh_CN'' THEN coalesce(t.name_zh_cn,t.name_zh_tw) WHEN input_locale=''en'' AND input_platform<>''line'' THEN t.name_en ELSE t.name_zh_tw END');
  IF updated IS DISTINCT FROM definition THEN EXECUTE updated;changed:=changed+1;END IF;
 END LOOP;
 IF changed<6 THEN RAISE EXCEPTION 'unexpected feeling tag readers';END IF;
 -- Legacy published JSON remains untouched. Missing locale keys display the original Traditional snapshot.
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('platform','core') AND p.proargnames @> ARRAY['input_locale']::text[] AND p.prosrc LIKE '%tag_snapshot%' LOOP
  definition:=pg_get_functiondef(f.oid);updated:=replace(definition,'t->>input_locale','coalesce(t->>input_locale,t->>''zh_TW'')');
  updated:=replace(updated,'m->>input_locale','coalesce(m->>input_locale,m->>''zh_TW'')');
  IF updated IS DISTINCT FROM definition THEN EXECUTE updated;END IF;
 END LOOP;
END$$;
-- The LINE cursor retains current eligibility checks and original ordering/cursor boundaries.
DO $$DECLARE definition TEXT;updated TEXT;BEGIN
 definition:=pg_get_functiondef('platform.line_journal_stream(text,jsonb,text)'::regprocedure);
 updated:=replace(definition,'jsonb_build_object(''alias'',CASE','jsonb_build_object(''feelingTags'',(SELECT coalesce(jsonb_agg(coalesce(tag->>input_locale,tag->>''zh_TW'')),''[]''::jsonb) FROM jsonb_array_elements(j.tag_snapshot) tag),''alias'',CASE');
 IF updated=definition THEN RAISE EXCEPTION 'unexpected LINE journal tag reader';END IF;
 EXECUTE updated;
END$$;
CREATE FUNCTION ops.feeling_tag_locales_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-21-feeling-tag-locales')$$;
REVOKE ALL ON FUNCTION ops.feeling_tag_locales_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.feeling_tag_locales_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-21-feeling-tag-locales',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
