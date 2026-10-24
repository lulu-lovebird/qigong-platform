-- Migration 0048: Quarantine NFC tables until verified identity and scoped operations exist.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
-- Forward-only: do not change 0047 or grant access to its untrusted-ID APIs.
-- Run only through the transactional migration runner after deployment approval.

SET LOCAL search_path = pg_catalog;

-- FORCE subjects ordinary table owners to RLS too. Superusers/BYPASSRLS and
-- administrators capable of changing DDL remain outside the runtime threat model.
ALTER TABLE core.practice_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.practice_fields FORCE ROW LEVEL SECURITY;
ALTER TABLE core.field_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.field_attendance FORCE ROW LEVEL SECURITY;

-- No identity, request context, region grant or volunteer claim opens these tables.
-- RESTRICTIVE also blocks an accidentally added permissive policy in a later change.
CREATE POLICY practice_fields_security_quarantine ON core.practice_fields
AS RESTRICTIVE FOR ALL TO PUBLIC
USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY field_attendance_security_quarantine ON core.field_attendance
AS RESTRICTIVE FOR ALL TO PUBLIC
USING (FALSE) WITH CHECK (FALSE);

REVOKE ALL PRIVILEGES ON TABLE core.practice_fields, core.field_attendance
FROM PUBLIC, qigong_api_runtime, qigong_worker_runtime, qigong_authorizer CASCADE;

-- Remove pre-existing/default ACLs too, including direct session-role and column
-- grants. REVOKE on a table alone does not remove column-level privileges.
-- CASCADE removes dependent grants; never transfer ownership to a runtime role.
DO $$
DECLARE
    target RECORD;
    privilege_grant RECORD;
BEGIN
    FOR target IN
        SELECT relation.oid, relation.relowner, namespace.nspname, relation.relname
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'core'
          AND relation.relname IN ('practice_fields', 'field_attendance')
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles AS role
            WHERE role.oid = target.relowner
              AND role.rolname IN ('qigong_api_runtime', 'qigong_worker_runtime', 'qigong_authorizer')
        ) THEN
            RAISE EXCEPTION 'NFC tables must not be owned by controlled runtime roles';
        END IF;

        FOR privilege_grant IN
            SELECT DISTINCT role.rolname
            FROM pg_catalog.pg_class AS relation
            CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
            JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
            WHERE relation.oid = target.oid AND acl.grantee <> target.relowner
        LOOP
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I CASCADE',
                target.nspname, target.relname, privilege_grant.rolname
            );
        END LOOP;

        FOR privilege_grant IN
            SELECT DISTINCT attribute.attname, acl.grantee, role.rolname
            FROM pg_catalog.pg_attribute AS attribute
            CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
            LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
            WHERE attribute.attrelid = target.oid
              AND attribute.attnum > 0 AND NOT attribute.attisdropped
              AND acl.grantee <> target.relowner
        LOOP
            EXECUTE pg_catalog.format(
                'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s CASCADE',
                privilege_grant.attname, target.nspname, target.relname,
                CASE WHEN privilege_grant.grantee = 0 THEN 'PUBLIC'
                     ELSE pg_catalog.quote_ident(privilege_grant.rolname) END
            );
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- No functions, EXECUTE grants, permissive policies or data rewrites in this batch.
-- In particular, do not link attendance to checkins, invent methods or change daily practice.
