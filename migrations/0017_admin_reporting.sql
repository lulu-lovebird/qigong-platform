-- Read-only admin reporting; no changes to approval, check-in writes or identities.
-- Current-person scope intentionally follows the existing authorization contract:
-- a current region/cohort administrator can read that person's practice history.
-- This is not a historical-region attribution report.
GRANT SELECT ON core.checkins, core.checkin_method_selections TO qigong_api_runtime;
CREATE POLICY admin_scoped_checkin_read ON core.checkins
FOR SELECT TO qigong_api_runtime USING (
  admin.request_principal_id() IS NOT NULL
  AND admin.has_permission('checkin.read')
  AND admin.can_access_person(person_id, 'checkin.read')
);
CREATE POLICY admin_scoped_checkin_methods_read ON core.checkin_method_selections
FOR SELECT TO qigong_api_runtime USING (
  EXISTS (SELECT 1 FROM core.checkins checkin WHERE checkin.id = checkin_id)
);
-- Cohort-scoped coaches can see only CURRENT primary-region metadata of their learners.
-- Historical assignment rows remain bound to their own original region scope.
-- Existing region-based policies are preserved, and this adds no write privilege.
CREATE POLICY admin_reporting_assignment_read ON core.person_region_assignments
FOR SELECT TO qigong_api_runtime USING (
  admin.request_principal_id() IS NOT NULL
  AND admin.can_access_person(person_id, 'learner.read')
  AND admin.can_access_person(person_id, 'stats.read')
  AND assignment_type = 'primary'
  AND valid_from <= CURRENT_DATE
  AND (valid_to IS NULL OR valid_to > CURRENT_DATE)
);
CREATE INDEX checkins_practice_date_person_idx ON core.checkins(practice_date, person_id);
CREATE INDEX checkin_methods_method_checkin_idx ON core.checkin_method_selections(practice_method_id, checkin_id);
