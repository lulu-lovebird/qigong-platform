-- Run once using psql with -v admin_subject=... -v admin_name='...'.
-- The issuer is the verified Authgear OIDC issuer, never the Google issuer.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
VALUES ('global', 'global', '全球', 'Global');

INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'tw', 'country', '台灣', 'Taiwan', 'Asia/Taipei'
FROM core.regions WHERE code = 'global' AND region_type = 'global';

INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'tw-general', 'operational', '台灣地區', 'Taiwan Region', 'Asia/Taipei'
FROM core.regions WHERE code = 'tw' AND region_type = 'country';

INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
VALUES ('https://baiyin-qigong-j3hulm.authgear.cloud', :'admin_subject', :'admin_name');

INSERT INTO admin.role_grants
  (principal_id, role_id, scope_type, granted_by_principal_id, reason)
SELECT principal.id, role.id, 'global', principal.id,
  'Initial administrator bootstrap requested by project owner'
FROM admin.principals principal CROSS JOIN admin.roles role
WHERE principal.oidc_subject = :'admin_subject' AND role.code = 'super_admin';

INSERT INTO admin.role_grants
  (principal_id, role_id, scope_type, region_id, granted_by_principal_id, reason)
SELECT principal.id, role.id, 'region', region.id, principal.id,
  'Initial Taiwan regional administrator bootstrap requested by project owner'
FROM admin.principals principal CROSS JOIN admin.roles role CROSS JOIN core.regions region
WHERE principal.oidc_subject = :'admin_subject'
  AND role.code = 'regional_admin' AND region.code = 'tw-general'
  AND region.region_type = 'operational';

INSERT INTO audit.events
  (request_id, actor_principal_id, action, target_type, target_id, scope_type, reason, outcome)
SELECT gen_random_uuid(), id, 'admin.bootstrap', 'admin.principal', id::text, 'global',
  'Initial super and Taiwan regional admin bootstrap requested by project owner', 'success'
FROM admin.principals WHERE oidc_subject = :'admin_subject';

COMMIT;
