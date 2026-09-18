import { describe, expect, it } from 'vitest';
import { isMigrationVersionCompatible } from '../src/index.js';

describe('migration compatibility', () => {
  it('accepts versions inside an expand-compatible range', () => {
    expect(
      isMigrationVersionCompatible('0002_expand.sql', '0001_baseline.sql', '0003_expand.sql')
    ).toBe(true);
  });

  it('rejects versions below the minimum or above the maximum', () => {
    expect(
      isMigrationVersionCompatible('0001_baseline.sql', '0002_expand.sql', '0003_expand.sql')
    ).toBe(false);
    expect(
      isMigrationVersionCompatible('0004_contract.sql', '0002_expand.sql', '0003_expand.sql')
    ).toBe(false);
    expect(isMigrationVersionCompatible(null, '0001_baseline.sql', '0003_expand.sql')).toBe(false);
  });

  it('uses distinct pre-runtime and runtime-RLS build manifests', () => {
    const preRuntimeApplicationReady = isMigrationVersionCompatible(
      '0002_identity_region_rbac.sql',
      '0001_platform_baseline.sql',
      '0002_identity_region_rbac.sql'
    );
    const runtimeApplicationReady = isMigrationVersionCompatible(
      '0003_runtime_roles_and_rls.sql',
      '0003_runtime_roles_and_rls.sql',
      '0003_runtime_roles_and_rls.sql'
    );
    expect(preRuntimeApplicationReady).toBe(true);
    expect(runtimeApplicationReady).toBe(true);
    expect(
      isMigrationVersionCompatible(
        '0002_identity_region_rbac.sql',
        '0003_runtime_roles_and_rls.sql',
        '0003_runtime_roles_and_rls.sql'
      )
    ).toBe(false);
  });
});
