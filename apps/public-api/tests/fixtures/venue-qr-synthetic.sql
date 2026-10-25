-- SYNTHETIC ONLY, loaded solely by the disposable local PostgreSQL harness.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
CREATE ROLE venue_qr_test_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT qigong_api_runtime TO venue_qr_test_login;
INSERT INTO admin.principals(id,oidc_issuer,oidc_subject,display_name) VALUES
 ('10000000-0000-4000-8000-000000000001','https://synthetic.invalid','viewer','Synthetic viewer'),
 ('10000000-0000-4000-8000-000000000002','https://synthetic.invalid','exporter','Synthetic exporter');
INSERT INTO admin.roles(code,description) VALUES('venue_test_exporter','Synthetic scoped CSV-only role');
INSERT INTO admin.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code='venue_test_exporter' AND p.code='stats.export';
INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id)
 SELECT '10000000-0000-4000-8000-000000000001',r.id,'region',g.id FROM admin.roles r CROSS JOIN core.regions g
 WHERE r.code='regional_viewer' AND g.code='tw-general';
INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id)
 SELECT '10000000-0000-4000-8000-000000000002',r.id,'region',g.id FROM admin.roles r CROSS JOIN core.regions g
 WHERE r.code='venue_test_exporter' AND g.code='tw-general';
INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES
 (public.digest(repeat('v',43),'sha256'),'10000000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 day'),
 (public.digest(repeat('e',43),'sha256'),'10000000-0000-4000-8000-000000000002',clock_timestamp()+interval '1 day');
INSERT INTO identity.people(id,preferred_name,legal_name) VALUES
 ('20000000-0000-4000-8000-000000000001','=SYNTHETIC()','Synthetic learner');
-- Home Singapore; check-in in Taiwan must NOT be rejected or hidden.
INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from)
 SELECT '20000000-0000-4000-8000-000000000001',id,'primary',CURRENT_DATE FROM core.regions WHERE code='sg-general';
INSERT INTO identity.platform_identities(id,person_id,platform,external_subject_id) VALUES
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','line','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source)
 VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','onboarding');
INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,status,decided_by_principal_id,decided_at,person_id)
 SELECT 'line','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','Synthetic learner',id,'approved','10000000-0000-4000-8000-000000000001',clock_timestamp(),'20000000-0000-4000-8000-000000000001'
 FROM core.regions WHERE code='sg-general';
UPDATE platform.learner_privacy_policies SET state='active',published_at=clock_timestamp() WHERE version='baiyin-checkin-supplement-v1';
INSERT INTO platform.learner_privacy_acceptances(platform,subject_hash,policy_version,document_hash,locale,reflection_consent)
 SELECT 'line',platform.privacy_subject_hash('line','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),version,document_hash,'zh_TW',FALSE
 FROM platform.learner_privacy_policies WHERE state='active';
-- All-day synthetic windows. No live venue or deployment configuration is changed.
INSERT INTO core.practice_fields(region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules)
 SELECT r.id,v.code,v.name,25,121,100,v.timezone,'{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}'::jsonb
 FROM core.regions r CROSS JOIN (VALUES
 ('tw-test-one','合成場地一','Asia/Taipei','tw-general'),
 ('tw-test-two','合成場地二','Asia/Taipei','tw-general'),
 ('sg-test-one','合成新加坡場地','Asia/Singapore','sg-general'),
 ('tw-test-east','合成日期線東','Etc/GMT-14','tw-general'),
 ('tw-test-west','合成日期線西','Etc/GMT+12','tw-general')
 ) v(code,name,timezone,region) WHERE r.code=v.region;
INSERT INTO core.practice_fields(region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules)
 SELECT id,'tw-test-window','合成關閉時段',25,121,100,'UTC',
 jsonb_build_object('day_of_week',jsonb_build_array(0,1,2,3,4,5,6),
 'start_time',CASE WHEN EXTRACT(HOUR FROM clock_timestamp() AT TIME ZONE 'UTC')<12 THEN '18:00' ELSE '06:00' END,
 'end_time',CASE WHEN EXTRACT(HOUR FROM clock_timestamp() AT TIME ZONE 'UTC')<12 THEN '19:00' ELSE '07:00' END)
 FROM core.regions WHERE code='tw-general';
