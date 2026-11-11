-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Restricted MCP reads only; no browser sessions, writes or transport wiring.
-- List selectors use transaction-local settings to preserve the approved SQL signature.
-- The adapter MUST set all three settings on every guidance_list operation.
CREATE FUNCTION admin.mcp_read_guidance_campaigns(p_cursor_after UUID, p_fetch_limit INTEGER)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_from DATE;
  v_until DATE;
  v_timezone TEXT;
  result JSONB;
BEGIN
  IF admin.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_fetch_limit IS NULL OR p_fetch_limit NOT BETWEEN 1 AND 51 THEN
    RAISE EXCEPTION 'invalid fetch limit' USING ERRCODE = '22023';
  END IF;
  v_from := nullif(current_setting('qigong.mcp_read_from', true), '')::date;
  v_until := nullif(current_setting('qigong.mcp_read_until', true), '')::date;
  v_timezone := nullif(current_setting('qigong.mcp_read_timezone', true), '');
  IF v_from IS NULL OR v_until IS NULL OR v_until <= v_from OR v_until - v_from > 93
    OR v_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RAISE EXCEPTION 'invalid guidance selectors' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'title', c.title, 'startDate', c.start_date::text,
    'endDate', c.end_date::text, 'timezone', c.timezone, 'isActive', c.is_active,
    'createdAt', c.created_at, 'updatedAt', c.updated_at
  ) ORDER BY c.id), '[]'::jsonb) INTO result
  FROM (
    SELECT id, title, start_date, end_date, timezone, is_active, created_at, updated_at
    FROM core.practice_guidance_campaigns
    -- 0063 uses inclusive local campaign dates (including in receipt lookup).
    WHERE start_date < v_until AND end_date >= v_from AND timezone = v_timezone
      AND (p_cursor_after IS NULL OR id > p_cursor_after)
    ORDER BY id LIMIT p_fetch_limit
  ) c;
  RETURN result;
END;
$$;

CREATE FUNCTION admin.mcp_read_guidance_entries(
  p_campaign_id UUID, p_cursor_after DATE, p_fetch_limit INTEGER
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  campaign JSONB;
  entries JSONB;
BEGIN
  IF admin.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_fetch_limit IS NULL OR p_fetch_limit NOT BETWEEN 1 AND 51 THEN
    RAISE EXCEPTION 'invalid fetch limit' USING ERRCODE = '22023';
  END IF;
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'invalid campaign' USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object(
    'id', c.id, 'title', c.title, 'startDate', c.start_date::text,
    'endDate', c.end_date::text, 'timezone', c.timezone, 'isActive', c.is_active,
    'createdAt', c.created_at, 'updatedAt', c.updated_at
  ) INTO campaign
  FROM core.practice_guidance_campaigns c WHERE c.id = p_campaign_id;
  IF campaign IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'guideDate', e.guide_date::text, 'title', e.title,
    'content', e.content, 'createdAt', e.created_at, 'updatedAt', e.updated_at
  ) ORDER BY e.guide_date), '[]'::jsonb) INTO entries
  FROM (
    SELECT id, guide_date, title, content, created_at, updated_at
    FROM core.practice_guidance_entries
    WHERE campaign_id = p_campaign_id
      AND (p_cursor_after IS NULL OR guide_date > p_cursor_after)
    ORDER BY guide_date LIMIT p_fetch_limit
  ) e;
  RETURN jsonb_build_object('campaign', campaign, 'entries', entries);
END;
$$;

CREATE FUNCTION admin.mcp_read_venues(
  p_region_id UUID, p_cursor_after UUID, p_fetch_limit INTEGER
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF admin.is_super_admin() IS NOT TRUE THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_fetch_limit IS NULL OR p_fetch_limit NOT BETWEEN 1 AND 51 THEN
    RAISE EXCEPTION 'invalid fetch limit' USING ERRCODE = '22023';
  END IF;
  IF p_region_id IS NULL THEN
    RAISE EXCEPTION 'invalid region' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id, 'regionId', v.region_id, 'code', v.code,
    'name', v.name_zh_tw, 'isActive', v.is_active
  ) ORDER BY v.id), '[]'::jsonb) INTO result
  FROM (
    SELECT id, region_id, code, name_zh_tw, is_active
    FROM core.practice_fields
    WHERE region_id = p_region_id AND (p_cursor_after IS NULL OR id > p_cursor_after)
    ORDER BY id LIMIT p_fetch_limit
  ) v;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION admin.mcp_read_guidance_campaigns(UUID, INTEGER),
  admin.mcp_read_guidance_entries(UUID, DATE, INTEGER),
  admin.mcp_read_venues(UUID, UUID, INTEGER) FROM PUBLIC, qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.mcp_read_guidance_campaigns(UUID, INTEGER),
  admin.mcp_read_guidance_entries(UUID, DATE, INTEGER),
  admin.mcp_read_venues(UUID, UUID, INTEGER) TO qigong_api_runtime;
