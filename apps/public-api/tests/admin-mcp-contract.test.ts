/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { describe, expect, it } from 'vitest';
import {
  adminMcpLimits,
  adminMcpScopesFor,
  getAdminMcpToolCatalog,
  isAdminMcpToolName,
  parseAdminMcpCall,
  parseAdminMcpReadResult
} from '../src/admin-mcp-contract.js';

const id = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const page = { cursor: null, limit: 10 };
const range = { from: '2026-10-01', until: '2026-11-01', timezone: 'Asia/Taipei' };
const args = { regionId: id, ...range };
const meta = {
  asOf: '2026-11-01T10:00:00+08:00',
  nextCursor: null,
  truncated: false,
  warnings: []
};
const search = {
  tool: 'learners_search',
  arguments: { regionId: id, query: 'Synthetic', ...page }
};
const learner = { learnerId: id, displayName: 'Synthetic learner', regionId: id };
const result = { data: { items: [learner] }, ...meta };

describe('phase-one internal tool contract', () => {
  it('catalogs only twelve read-only tools with strict JSON schemas', () => {
    const catalog = getAdminMcpToolCatalog();
    expect(catalog).toHaveLength(12);
    for (const tool of catalog) {
      expect(tool.phase).toBe('read_only');
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.properties).toHaveProperty('data');
      expect(tool.errorCodes).toContain('result_unavailable');
      expect(tool.limits.maximumRows).toBe(50);
      expect(tool.name).not.toMatch(/prepare|commit|export|sql|shell/);
    }
    expect(adminMcpScopesFor('attendance_search')).toEqual([
      'admin:venues:read',
      'admin:learners:read'
    ]);
    expect(isAdminMcpToolName('__proto__')).toBe(false);
    expect(isAdminMcpToolName('constructor')).toBe(false);
  });

  it.each([
    { tool: 'admin_get_capabilities', arguments: {} },
    { tool: 'dashboard_get_summary', arguments: args },
    search,
    { tool: 'learners_get', arguments: { learnerId: id } },
    { tool: 'applications_list', arguments: { regionId: id, status: 'pending', ...page } },
    {
      tool: 'invites_list',
      arguments: { regionId: id, channel: 'line', status: 'active', ...page }
    },
    { tool: 'guidance_list', arguments: { ...range, ...page } },
    { tool: 'guidance_get', arguments: { campaignId: id, ...page } },
    { tool: 'venues_list', arguments: { regionId: id, ...page } },
    { tool: 'attendance_search', arguments: { ...args, venueId: null, learnerId: null, ...page } },
    { tool: 'attendance_get_summary', arguments: { ...args, venueId: id } },
    { tool: 'audit_search', arguments: { ...args, targetId: null, ...page } }
  ])('accepts explicit bounded selectors: $tool', (input) => {
    const parsed = parseAdminMcpCall(input);
    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.arguments)).toBe(true);
  });

  it.each([
    { ...search, principalId: id },
    { ...search, arguments: { ...search.arguments, principalId: id } },
    { ...search, arguments: { ...search.arguments, role: 'super_admin' } },
    { ...search, arguments: { ...search.arguments, clientId: 'forged' } },
    { ...search, arguments: { ...search.arguments, scopes: ['admin:learners:read'] } },
    { ...search, arguments: { ...search.arguments, token: 'synthetic-secret' } },
    { ...search, arguments: { ...search.arguments, confirmed: true } },
    { ...search, arguments: { ...search.arguments, limit: '10' } },
    { ...search, arguments: { ...search.arguments, limit: 0 } },
    { ...search, arguments: { ...search.arguments, limit: 51 } },
    { ...search, arguments: { ...search.arguments, cursor: 'x'.repeat(257) } },
    { ...search, arguments: { ...search.arguments, query: '' } },
    { ...search, arguments: { ...search.arguments, query: '   ' } },
    { ...search, arguments: { ...search.arguments, query: 'x'.repeat(101) } },
    { ...search, arguments: { ...search.arguments, regionId: 'all' } },
    { tool: 'admin_get_capabilities', arguments: { phase: 'write' } },
    { tool: 'operations_commit', arguments: { confirmed: true } },
    { tool: 'invites_prepare_create', arguments: {} },
    { tool: 'unknown', arguments: {} },
    { tool: '__proto__', arguments: {} },
    { tool: 'learners_search' }
  ])('rejects unknown fields, writes, identity injection and coercion: %j', (input) => {
    expect(() => parseAdminMcpCall(input)).toThrow();
  });

  it.each([
    { ...args, until: args.from },
    { ...args, until: '2026-09-30' },
    { ...args, until: '2027-10-01' },
    { ...args, from: '2026-02-29' },
    { ...args, from: '0000-01-01' },
    { ...args, timezone: undefined },
    { ...args, timezone: 'device-local' },
    { ...args, timezone: '+08:00' },
    { ...args, from: 'yesterday' }
  ])('rejects ambiguous or excessive date ranges: %j', (input) => {
    expect(() => parseAdminMcpCall({ tool: 'dashboard_get_summary', arguments: input })).toThrow();
  });
});

describe('minimal output contracts', () => {
  it('clones and freezes explicit name/id fields without returning contact information', () => {
    const parsed = parseAdminMcpReadResult(parseAdminMcpCall(search), result);
    expect(parsed).toEqual(result);
    expect(parsed).not.toBe(result);
    expect(Object.isFrozen(parsed.data)).toBe(true);
    if (!('items' in parsed.data)) throw new Error('fixture');
    expect(Object.isFrozen(parsed.data.items)).toBe(true);
    expect(Object.isFrozen(parsed.data.items[0])).toBe(true);
  });
  it.each(['phone', 'email', 'privateJournal', 'consent', 'token', 'sessionCookie'])(
    'fails closed on sensitive extra field %s',
    (field) => {
      expect(() =>
        parseAdminMcpReadResult(parseAdminMcpCall(search), {
          ...result,
          data: { items: [{ ...learner, [field]: 'synthetic-secret' }] }
        })
      ).toThrow();
    }
  );
  it.each([
    { ...result, debug: 'SQL/secret' },
    { ...result, warnings: ['raw error secret'] },
    { ...result, asOf: '2026-11-01T00:00:00' },
    { ...result, nextCursor: 'next' },
    { ...result, data: { items: Array.from({ length: 11 }, () => learner) } },
    { ...result, data: { items: [{ ...learner, regionId: other }] } },
    { ...result, data: { items: [] }, truncated: 'false' }
  ])('rejects unsafe or unbound results: %j', (input) => {
    expect(() => parseAdminMcpReadResult(parseAdminMcpCall(search), input)).toThrow();
  });
  it('does not present page counts as aggregate totals', () => {
    const call = parseAdminMcpCall({
      tool: 'attendance_get_summary',
      arguments: { ...args, venueId: null }
    });
    const data = {
      ...args,
      venueId: null,
      basis: 'all_matching_records',
      attendanceCount: 4,
      learnerCount: 2,
      attendanceDays: 1
    };
    expect(parseAdminMcpReadResult(call, { data, ...meta }).data).toEqual(data);
    for (const changed of [
      { regionId: other },
      { timezone: 'UTC' },
      { basis: 'page' },
      { from: '2026-10-02' }
    ]) {
      expect(() =>
        parseAdminMcpReadResult(call, { data: { ...data, ...changed }, ...meta })
      ).toThrow();
    }
  });
  it('requires a matching individual target and terminal metadata', () => {
    const call = parseAdminMcpCall({ tool: 'learners_get', arguments: { learnerId: id } });
    expect(parseAdminMcpReadResult(call, { data: learner, ...meta }).data).toEqual(learner);
    expect(() =>
      parseAdminMcpReadResult(call, { data: { ...learner, learnerId: other }, ...meta })
    ).toThrow();
    expect(() =>
      parseAdminMcpReadResult(call, { data: learner, ...meta, truncated: true })
    ).toThrow();
  });
  it('refuses invitation secrets even when the other metadata is valid', () => {
    const call = parseAdminMcpCall({
      tool: 'invites_list',
      arguments: { regionId: id, channel: 'line', status: 'active', ...page }
    });
    const item = {
      inviteId: id,
      regionId: id,
      channel: 'line',
      status: 'active',
      expiresAt: meta.asOf,
      usedCount: 0,
      maxUses: 10
    };
    expect(parseAdminMcpReadResult(call, { data: { items: [item] }, ...meta }).data).toEqual({
      items: [item]
    });
    for (const extra of [
      { token: 'synthetic' },
      { url: 'https://example.invalid/#synthetic' },
      { tokenHash: 'synthetic' }
    ]) {
      expect(() =>
        parseAdminMcpReadResult(call, { data: { items: [{ ...item, ...extra }] }, ...meta })
      ).toThrow();
    }
  });
  it('binds audit timestamps to the requested business timezone and target', () => {
    const call = parseAdminMcpCall({
      tool: 'audit_search',
      arguments: { ...args, targetId: id, ...page }
    });
    const item = {
      auditId: id,
      targetId: id,
      regionId: id,
      occurredAt: '2026-09-30T16:00:00Z',
      action: 'read',
      outcome: 'succeeded'
    };
    expect(parseAdminMcpReadResult(call, { data: { items: [item] }, ...meta }).data).toEqual({
      items: [item]
    });
    for (const changed of [
      { occurredAt: '2026-09-30T15:59:59Z' },
      { occurredAt: '2026-10-31T16:00:00Z' },
      { targetId: other }
    ]) {
      expect(() =>
        parseAdminMcpReadResult(call, { data: { items: [{ ...item, ...changed }] }, ...meta })
      ).toThrow();
    }
  });
  it('requires guidance lists to overlap the selected range in the same timezone', () => {
    const call = parseAdminMcpCall({ tool: 'guidance_list', arguments: { ...range, ...page } });
    const item = { campaignId: id, title: 'Synthetic', status: 'published', ...range };
    expect(parseAdminMcpReadResult(call, { data: { items: [item] }, ...meta }).data).toEqual({
      items: [item]
    });
    for (const changed of [{ from: range.until, until: '2026-11-02' }, { timezone: 'UTC' }]) {
      expect(() =>
        parseAdminMcpReadResult(call, { data: { items: [{ ...item, ...changed }] }, ...meta })
      ).toThrow();
    }
  });
  it('requires forward cursors and enforces the absolute row bound', () => {
    const call = parseAdminMcpCall({
      ...search,
      arguments: { ...search.arguments, cursor: 'previous' }
    });
    expect(() =>
      parseAdminMcpReadResult(call, { ...result, nextCursor: 'previous', truncated: true })
    ).toThrow();
    expect(
      parseAdminMcpReadResult(call, { ...result, nextCursor: 'next', truncated: true }).nextCursor
    ).toBe('next');
    expect(adminMcpLimits.maximumOutputBytes).toBe(65536);
  });
});
