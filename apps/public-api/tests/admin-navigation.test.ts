import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminShell } from '../src/admin-dashboard.js';
import { adminTexts, type AdminLocale } from '../src/admin-locale.js';
type Event = { target: { closest: (selector: string) => Node | null }; preventDefault: () => void };
type Handler = (event: Event) => unknown;
interface Node {
  hidden: boolean;
  value: string;
  open: boolean;
  href: string;
  dataset: Record<string, string>;
  links: Node[];
  listeners: Map<string, Handler>;
  querySelectorAll: (selector: string) => Node[];
  addEventListener: (event: string, handler: Handler) => void;
}
const make = (): Node => {
  const node: Node = {
    hidden: false,
    value: '',
    open: true,
    href: '',
    dataset: {},
    links: [],
    listeners: new Map(),
    querySelectorAll: () => node.links,
    addEventListener: (event, handler) => {
      node.listeners.set(event, handler);
    }
  };
  return node;
};
const fixture = (
  locale: AdminLocale = 'zh_TW',
  options: {
    allowed?: boolean;
    achievements?: boolean;
    admin?: boolean;
    mobile?: boolean;
    fail?: boolean;
  } = {}
) => {
  const html = renderAdminShell('tags', '', '', locale, options.admin ?? false),
    nodes = new Map<string, Node>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(m[1]!, make());
  const groups = new Map<string, Node>();
  const links: Node[] = [];
  for (const section of html.matchAll(/<details class="nav-group"([^>]*)>([\s\S]*?)<\/details>/g)) {
    const id = /data-nav-group="([^"]+)"/.exec(section[1]!)![1]!,
      group = make();
    group.hidden = /\bhidden\b/.test(section[1]!);
    group.open = /\bopen\b/.test(section[1]!);
    groups.set(id, group);
    for (const anchor of section[2]!.matchAll(/<a ([^>]+)>/g)) {
      const link = make(),
        attrs = anchor[1]!;
      link.href = /href="([^"]+)"/.exec(attrs)![1]!;
      link.hidden = /\bhidden\b/.test(attrs);
      const page = /data-journal-nav="([^"]+)"/.exec(attrs)?.[1];
      if (page) link.dataset.journalNav = page;
      if (attrs.includes('data-line-invites-nav')) link.dataset.invites = 'true';
      if (attrs.includes('data-achievements-nav')) link.dataset.achievements = 'true';
      group.links.push(link);
      links.push(link);
    }
  }
  let resize: (() => void) | undefined;
  const media = {
    matches: options.mobile ?? false,
    addEventListener: (_event: string, handler: () => void) => {
      resize = handler;
    }
  };
  const mayLeave = vi.fn(() => true),
    location = {
      href: 'https://checkin.baiyinqigong.org/admin/practice-feeling-tags?lang=' + locale,
      assign: vi.fn()
    };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    if (options.fail) throw Error('Synthetic transport failure');
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Response.json(
      url.includes('line-invites')
        ? { canManage: options.allowed ?? false }
        : url.includes('achievements')
          ? { canReadAchievements: options.achievements ?? options.allowed ?? false }
          : {
              canReadJournal: options.allowed ?? false,
              canManageTags: options.allowed ?? false,
              canManageLearners: options.allowed ?? false,
              canReadShared: options.allowed ?? false,
              canPublishPrivacy: options.allowed ?? false
            }
    );
  });
  const document = {
    cookie: '',
    getElementById: (id: string) => nodes.get(id),
    querySelectorAll: (selector: string) =>
      selector === '[data-nav-group]'
        ? [...groups.values()]
        : selector === '[data-journal-nav]'
          ? links.filter((link) => link.dataset.journalNav)
          : selector === '[data-line-invites-nav]'
            ? links.filter((link) => link.dataset.invites)
            : selector === '[data-achievements-nav]'
              ? links.filter((link) => link.dataset.achievements)
              : []
  };
  const context = vm.createContext({
    document,
    window: { qigongJournalMayLeave: mayLeave },
    location,
    fetch,
    confirm: () => true,
    URL,
    matchMedia: () => media
  });
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new vm.Script(script[1]!).runInContext(context);
  return {
    html,
    groups,
    links,
    nodes,
    fetch,
    mayLeave,
    location,
    resize: (mobile: boolean) => {
      media.matches = mobile;
      resize?.();
    }
  };
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};
describe('Compact grouped admin navigation', () => {
  it('shares density tokens while keeping touch targets and form fonts independently accessible', () => {
    const html = fixture().html;
    expect(html).toContain('--admin-input-font:.875rem');
    expect(html).toContain('--admin-control-height:34px');
    expect(html).toContain('font-size:var(--admin-input-font)');
    expect(html).toContain('@media(max-width:760px),(pointer:coarse)');
    expect(html).toContain('--admin-control-height:44px; --admin-input-font:1rem');
    expect(html).toContain(
      'textarea { display:block; width:100%; min-height:var(--admin-textarea-height); resize:vertical; }'
    );
    expect(html).toContain('.access-error:empty { min-height:0; margin:0; }');
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'preserves ordered routes and three-language group names in %s',
    async (locale) => {
      const f = fixture(locale, { allowed: true, admin: true });
      await settle();
      expect([...f.groups.keys()]).toEqual(['reports', 'learners', 'journal', 'settings']);
      const expected = {
        reports: ['/admin/', '/admin/leaderboard', '/admin/achievements', '/admin/method-analysis'],
        learners: ['/admin/applications', '/admin/learners', '/admin/line-invites'],
        journal: ['/admin/journal', '/admin/shared-journal', '/admin/practice-feeling-tags'],
        settings: ['/admin/administrators', '/admin/privacy-policy', '/admin/notifications']
      };
      for (const [key, paths] of Object.entries(expected))
        expect(f.groups.get(key)?.links.map((link) => link.href)).toEqual(
          paths.map((path) => path + '?lang=' + locale)
        );
      const t = adminTexts(locale);
      for (const title of [
        t.navGroupReports,
        t.navGroupLearners,
        t.navGroupJournal,
        t.navGroupSettings
      ])
        expect(f.html).toContain(title);
      expect(f.html).toContain('aria-current="page"');
      expect(f.html).toContain('aria-labelledby="nav-group-journal"');
      expect(f.groups.get('journal')?.hidden).toBe(false);
    }
  );
  it('starts capability-dependent groups hidden and never renders the admin-access link without the existing server grant', async () => {
    const f = fixture();
    expect(f.groups.get('journal')?.hidden).toBe(true);
    await settle();
    expect(f.groups.get('journal')?.hidden).toBe(true);
    expect(
      f.links
        .filter((link) => link.dataset.journalNav || link.dataset.invites)
        .every((link) => link.hidden)
    ).toBe(true);
    expect(f.links.some((link) => link.href.startsWith('/admin/administrators'))).toBe(false);
    expect(f.groups.get('settings')?.links.some((link) => !link.hidden)).toBe(true);
  });
  it('requires an independent reporting capability for the achievement link', async () => {
    const granted = fixture('en', { achievements: true });
    const denied = fixture('en', { allowed: true, achievements: false });
    const failed = fixture('en', { achievements: true, fail: true });
    expect(granted.links.find((link) => link.dataset.achievements)?.hidden).toBe(true);
    await settle();
    expect(granted.links.find((link) => link.dataset.achievements)?.hidden).toBe(false);
    expect(denied.links.find((link) => link.dataset.achievements)?.hidden).toBe(true);
    expect(failed.links.find((link) => link.dataset.achievements)?.hidden).toBe(true);
    expect(granted.groups.get('journal')?.hidden).toBe(true);
  });
  it('keeps capability links and empty headings hidden on failed permission requests', async () => {
    const f = fixture('en', { fail: true });
    await settle();
    expect(f.groups.get('journal')?.hidden).toBe(true);
    expect(
      f.links
        .filter((link) => link.dataset.journalNav || link.dataset.invites)
        .every((link) => link.hidden)
    ).toBe(true);
  });
  it.each([true, false])(
    'uses native disclosure and restores visible desktop navigation after mobile=%s',
    (mobile) => {
      const f = fixture('en', { mobile }),
        details = f.nodes.get('admin-nav-disclosure')!;
      expect(details.open).toBe(!mobile);
      f.resize(false);
      expect(details.open).toBe(true);
      f.resize(true);
      expect(details.open).toBe(false);
      expect(f.html).toContain('<summary>');
    }
  );
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'starts every category closed in %s even after capabilities arrive',
    async (locale) => {
      const f = fixture(locale, { allowed: true, admin: true });
      await settle();
      expect(f.groups.size).toBe(4);
      expect([...f.groups.values()].every((group) => !group.open)).toBe(true);
      expect(f.html.match(/name="admin-navigation-groups"/g)).toHaveLength(4);
      expect(f.html).toContain('data-current-group="true"');
      expect(f.html).toContain('.nav-group:not([open]) > .nav-group-links { display:none; }');
      expect(f.html).toContain(".nav-group-title::after { content:'+';");
    }
  );
  it('opens only the requested category without navigation, fetching or a draft veto', async () => {
    const f = fixture('en', { allowed: true });
    await settle();
    const reports = f.groups.get('reports')!,
      learners = f.groups.get('learners')!;
    const event = { target: { closest: () => null }, preventDefault: vi.fn() },
      calls = f.fetch.mock.calls.length;
    reports.open = true;
    reports.listeners.get('toggle')!(event);
    expect(reports.open).toBe(true);
    learners.open = true;
    learners.listeners.get('toggle')!(event);
    expect(learners.open).toBe(true);
    expect(reports.open).toBe(false);
    reports.listeners.get('toggle')!(event);
    expect(learners.open).toBe(true);
    learners.open = false;
    learners.listeners.get('toggle')!(event);
    expect([...f.groups.values()].every((group) => !group.open)).toBe(true);
    expect(f.fetch).toHaveBeenCalledTimes(calls);
    expect(f.mayLeave).not.toHaveBeenCalled();
    expect(f.location.assign).not.toHaveBeenCalled();
  });
  it('closes empty or denied groups when pending capability results settle', async () => {
    const f = fixture('en', { fail: true }),
      journal = f.groups.get('journal')!;
    journal.open = true;
    journal.hidden = false;
    await settle();
    expect(journal.hidden).toBe(true);
    expect(journal.open).toBe(false);
    journal.open = true;
    journal.listeners.get('toggle')!({ target: { closest: () => null }, preventDefault: vi.fn() });
    expect(journal.open).toBe(false);
    expect(journal.links.every((link) => link.hidden)).toBe(true);
  });
  it('does not expand categories during responsive layout changes and resets them on a new page', async () => {
    const f = fixture('en', { allowed: true });
    await settle();
    const journal = f.groups.get('journal')!;
    journal.open = true;
    journal.listeners.get('toggle')!({ target: { closest: () => null }, preventDefault: vi.fn() });
    f.resize(true);
    f.resize(false);
    expect(journal.open).toBe(true);
    expect([...f.groups.values()].filter((group) => group.open)).toHaveLength(1);
    const fresh = fixture('en', { allowed: true });
    await settle();
    expect([...fresh.groups.values()].every((group) => !group.open)).toBe(true);
  });
  it('retains the existing unsaved-draft navigation veto through grouped links', () => {
    const f = fixture();
    f.mayLeave.mockReturnValue(false);
    const preventDefault = vi.fn();
    f.nodes.get('admin-navigation')!.listeners.get('click')!({
      target: { closest: () => f.links[0]! },
      preventDefault
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(f.location.assign).not.toHaveBeenCalled();
  });
});
