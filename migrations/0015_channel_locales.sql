CREATE TABLE platform.identity_preferences (
  platform TEXT NOT NULL CHECK (platform IN ('telegram','whatsapp')),
  external_subject_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh_TW' CHECK (locale IN ('zh_TW','en')),
  last_telegram_update_id BIGINT,
  PRIMARY KEY (platform,external_subject_id)
);
ALTER TABLE platform.identity_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.identity_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.identity_preferences FROM PUBLIC;

-- Raw subject setters are used only by secret/signature-verified webhook adapters.
CREATE FUNCTION platform.get_identity_locale(input_platform TEXT, input_subject TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT locale FROM platform.identity_preferences
    WHERE platform=input_platform AND external_subject_id=input_subject), 'zh_TW')
$$;
CREATE FUNCTION platform.set_identity_locale(input_platform TEXT, input_subject TEXT, input_locale TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF input_platform IS NULL OR input_platform NOT IN ('telegram','whatsapp')
    OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$'
    OR input_locale IS NULL OR input_locale NOT IN ('zh_TW','en')
  THEN RAISE EXCEPTION 'invalid identity locale'; END IF;
  INSERT INTO platform.identity_preferences(platform,external_subject_id,locale)
  VALUES(input_platform,input_subject,input_locale)
  ON CONFLICT(platform,external_subject_id) DO UPDATE SET locale=EXCLUDED.locale;
END;
$$;
CREATE FUNCTION platform.set_telegram_locale_from_update(input_update_id BIGINT,input_subject TEXT,input_locale TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF input_update_id IS NULL OR input_update_id<0 OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$'
    OR input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid identity locale'; END IF;
  INSERT INTO platform.identity_preferences(platform,external_subject_id,locale,last_telegram_update_id)
  VALUES('telegram',input_subject,input_locale,input_update_id)
  ON CONFLICT(platform,external_subject_id) DO UPDATE SET locale=EXCLUDED.locale,last_telegram_update_id=EXCLUDED.last_telegram_update_id
  WHERE coalesce(platform.identity_preferences.last_telegram_update_id,-1)<input_update_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION platform.set_telegram_locale_from_update(BIGINT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.set_telegram_locale_from_update(BIGINT,TEXT,TEXT) TO qigong_api_runtime;

CREATE FUNCTION platform.set_telegram_locale_by_token(input_token TEXT,input_locale TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE subject TEXT;
BEGIN
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid language link'; END IF;
  SELECT telegram_user_id INTO subject FROM platform.telegram_application_links
  WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>CURRENT_TIMESTAMP AND used_at IS NULL;
  IF subject IS NULL AND platform.telegram_checkin_person(input_token) IS NOT NULL THEN
    SELECT telegram_user_id INTO subject FROM platform.telegram_checkin_links
    WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>CURRENT_TIMESTAMP;
  END IF;
  IF subject IS NULL THEN RAISE EXCEPTION 'invalid language link'; END IF;
  PERFORM platform.set_identity_locale('telegram',subject,input_locale);
END;
$$;
CREATE FUNCTION platform.telegram_localized_methods(input_token TEXT)
RETURNS TABLE(code TEXT,name_zh_tw TEXT,sort_order INTEGER,parent_code TEXT,parent_name_zh_tw TEXT,parent_sort_order INTEGER,name_en TEXT,parent_name_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tree.*,method.name_en,parent.name_en FROM platform.telegram_checkin_method_tree(input_token) tree
  JOIN core.practice_methods method ON method.code=tree.code
  LEFT JOIN core.practice_methods parent ON parent.code=tree.parent_code
$$;
CREATE FUNCTION platform.telegram_checkin_history(input_token TEXT,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB := platform.telegram_checkin_history(input_token);
DECLARE entries JSONB;
BEGIN
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid identity locale'; END IF;
  IF input_locale='en' THEN
    SELECT coalesce(jsonb_agg(entry || jsonb_build_object('method_names',(
      SELECT jsonb_agg(method.name_en ORDER BY codes.position)
      FROM jsonb_array_elements_text(entry->'method_codes') WITH ORDINALITY codes(code,position)
      JOIN core.practice_methods method ON method.code=codes.code
    )) ORDER BY entry->>'practice_date' DESC),'[]'::jsonb) INTO entries
    FROM jsonb_array_elements(result->'entries') entry;
    result := jsonb_set(result,'{entries}',entries);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION platform.get_identity_locale(TEXT,TEXT),platform.set_identity_locale(TEXT,TEXT,TEXT),
  platform.set_telegram_locale_by_token(TEXT,TEXT),platform.telegram_localized_methods(TEXT),platform.telegram_checkin_history(TEXT,TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION platform.get_identity_locale(TEXT,TEXT) TO qigong_api_runtime,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION platform.set_identity_locale(TEXT,TEXT,TEXT),platform.set_telegram_locale_by_token(TEXT,TEXT),
  platform.telegram_localized_methods(TEXT),platform.telegram_checkin_history(TEXT,TEXT) TO qigong_api_runtime;
