INSERT INTO core.practice_methods (code, method_type, name_zh_tw, name_en, sort_order) VALUES
  ('dayan', 'group', '大雁功', 'Dayan Qigong', 10),
  ('wuqinxi', 'group', '五禽戲', 'Wuqinxi', 20),
  ('huichun', 'group', '回春功', 'Huichun Gong', 30),
  ('guishou', 'group', '龜壽功', 'Guishou Gong', 40),
  ('zhengyang', 'group', '正陽功', 'Zhengyang Gong', 50),
  ('jinggong', 'group', '靜功', 'Quiet Practice', 110)
ON CONFLICT (code) DO NOTHING;

UPDATE core.practice_methods child SET parent_id = parent.id
FROM core.practice_methods parent
WHERE parent.code = CASE
  WHEN child.code IN ('dayan_chu', 'dayan_gao') THEN 'dayan'
  WHEN child.code IN ('wuqinxi_he', 'wuqinxi_yuan', 'wuqinxi_hu', 'wuqinxi_xiong', 'wuqinxi_lu') THEN 'wuqinxi'
  WHEN child.code IN ('huichun_chu', 'huichun_zhong') THEN 'huichun'
  WHEN child.code IN ('guishou_bagua', 'guishou_qiankun', 'guishou_fengxiang_guishuo') THEN 'guishou'
  WHEN child.code IN ('zhengyang_morning', 'zhengyang_night') THEN 'zhengyang'
  WHEN child.code IN ('jinggong_zhoutian', 'jinggong_qixing', 'jinggong_songjing') THEN 'jinggong'
END;

CREATE FUNCTION platform.telegram_checkin_method_tree(input_token TEXT)
RETURNS TABLE (code TEXT, name_zh_tw TEXT, sort_order INTEGER,
  parent_code TEXT, parent_name_zh_tw TEXT, parent_sort_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT method.code, method.name_zh_tw, method.sort_order,
    parent.code, parent.name_zh_tw, parent.sort_order
  FROM platform.telegram_checkin_links link
  JOIN identity.platform_identities identity
    ON identity.platform = 'telegram' AND identity.external_subject_id = link.telegram_user_id
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.onboarding_applications application
    ON application.person_id = person.id AND application.platform = 'telegram'
      AND application.external_subject_id = link.telegram_user_id AND application.status = 'approved'
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = identity.id AND channel.person_id = person.id
  CROSS JOIN core.practice_methods method
  LEFT JOIN core.practice_methods parent ON parent.id = method.parent_id
  WHERE input_token ~ '^[A-Za-z0-9_-]{43}$'
    AND link.token_hash = public.digest(input_token, 'sha256')
    AND link.expires_at > CURRENT_TIMESTAMP AND link.used_at IS NULL
    AND identity.revoked_at IS NULL AND person.status = 'active'
    AND channel.valid_to IS NULL AND channel.valid_from <= CURRENT_TIMESTAMP
    AND method.active AND method.method_type = 'leaf'
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id
        AND availability.platform = 'telegram' AND NOT availability.available)
  ORDER BY coalesce(parent.sort_order, method.sort_order), method.sort_order, method.code
$$;

REVOKE ALL ON FUNCTION platform.telegram_checkin_method_tree(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.telegram_checkin_method_tree(TEXT) TO qigong_api_runtime;
