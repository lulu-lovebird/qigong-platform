-- SYNTHETIC ONLY. No contacts, onboarding PII, external APIs or production data.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
INSERT INTO core.regions(id,code,region_type,name_zh_tw,name_en) VALUES
 ('01000000-0000-4000-8000-000000000001','vp-global','global','合成全球','Synthetic global');
INSERT INTO core.regions(id,parent_region_id,code,region_type,name_zh_tw,name_en) VALUES
 ('01000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001','vp-country','country','合成國家','Synthetic country');
INSERT INTO core.regions(id,parent_region_id,code,region_type,name_zh_tw,name_en) VALUES
 ('01000000-0000-4000-8000-000000000003','01000000-0000-4000-8000-000000000002','vp-one','operational','合成區一','Synthetic one'),
 ('01000000-0000-4000-8000-000000000004','01000000-0000-4000-8000-000000000002','vp-two','operational','合成區二','Synthetic two');
CREATE ROLE venue_people_test_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT qigong_api_runtime TO venue_people_test_login;
INSERT INTO admin.principals(id,oidc_issuer,oidc_subject,display_name) VALUES
 ('10000000-0000-4000-8000-000000000001','https://synthetic.invalid','viewer','Synthetic view only'),
 ('10000000-0000-4000-8000-000000000002','https://synthetic.invalid','exporter','Synthetic export only'),
 ('10000000-0000-4000-8000-000000000003','https://synthetic.invalid','mixed','Synthetic mixed scopes');
INSERT INTO admin.roles(code,description) VALUES ('vp_view','Synthetic checkin.read only'),('vp_export','Synthetic stats.export only');
INSERT INTO admin.role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p
 WHERE (r.code='vp_view' AND p.code='checkin.read') OR (r.code='vp_export' AND p.code='stats.export');
INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason)
 SELECT v.person,r.id,'region',v.region,'Synthetic scoped test' FROM (VALUES
 ('10000000-0000-4000-8000-000000000001'::uuid,'vp_view','01000000-0000-4000-8000-000000000003'::uuid),
 ('10000000-0000-4000-8000-000000000002'::uuid,'vp_export','01000000-0000-4000-8000-000000000003'::uuid),
 ('10000000-0000-4000-8000-000000000003'::uuid,'vp_view','01000000-0000-4000-8000-000000000003'::uuid),
 ('10000000-0000-4000-8000-000000000003'::uuid,'vp_export','01000000-0000-4000-8000-000000000004'::uuid)
 ) v(person,role,region) JOIN admin.roles r ON r.code=v.role;
INSERT INTO admin.sessions(token_hash,principal_id,expires_at)
 SELECT public.digest(repeat(v.token,43),'sha256'),v.person,clock_timestamp()+interval '1 day'
 FROM (VALUES ('v','10000000-0000-4000-8000-000000000001'::uuid),('e','10000000-0000-4000-8000-000000000002'::uuid),('m','10000000-0000-4000-8000-000000000003'::uuid)) v(token,person);
INSERT INTO identity.people(id,preferred_name) VALUES
 ('20000000-0000-4000-8000-000000000001','=SYNTHETIC()'),
 ('20000000-0000-4000-8000-000000000002','Beta'),
 ('20000000-0000-4000-8000-000000000003','Gamma');
-- Home region two; attendance in region one is visible by VENUE, not learner home.
INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from)
 VALUES('20000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000004','primary','2020-01-01');
INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES
 ('20000000-0000-4000-8000-000000000001','line','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
 ('20000000-0000-4000-8000-000000000001','telegram','synthetic-telegram');
INSERT INTO core.practice_fields(id,region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules)
 SELECT v.id,v.region,v.code,v.name,25,121,100,'Asia/Taipei','{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}'::jsonb
 FROM (VALUES
 ('30000000-0000-4000-8000-000000000001'::uuid,'01000000-0000-4000-8000-000000000003'::uuid,'vp-test-one','合成場地一'),
 ('30000000-0000-4000-8000-000000000002'::uuid,'01000000-0000-4000-8000-000000000003'::uuid,'vp-test-two','合成場地二'),
 ('30000000-0000-4000-8000-000000000003'::uuid,'01000000-0000-4000-8000-000000000004'::uuid,'vp-test-other','其他區場地')
 ) v(id,region,code,name);
INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
 SELECT v.person,v.field,v.method,(v.day::date::timestamp AT TIME ZONE 'Asia/Taipei'),v.day::date,'Asia/Taipei'
 FROM (VALUES
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'qr_gps','2026-10-01'),
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'qr_gps','2026-10-02'),
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000002'::uuid,'nfc_gps','2026-10-01'),
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000003'::uuid,'qr_gps','2026-10-03'),
 ('20000000-0000-4000-8000-000000000002'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'volunteer_manual','2026-10-05'),
 ('20000000-0000-4000-8000-000000000003'::uuid,'30000000-0000-4000-8000-000000000002'::uuid,'qr_gps','2026-10-06'),
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'qr_gps','2026-09-30'),
 ('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'qr_gps','2026-11-01')
 ) v(person,field,method,day);
