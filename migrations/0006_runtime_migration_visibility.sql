GRANT SELECT ON public.schema_migrations TO qigong_api_runtime;

UPDATE core.platform_metadata
SET architecture_version = 'phase-2-runtime-migration-visibility', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
