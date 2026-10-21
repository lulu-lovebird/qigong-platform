import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  whatsappCompletionBootstrap,
  whatsappCompletionTexts
} from '../src/whatsapp-checkin-completion.js';

interface Saved {
  date: string;
  timezone: string;
  version: number;
  action: string;
  methods: string[];
}
interface CompletionApi {
  capture: (draft: { version: number; methods: string[] }) => Saved;
  validate: (result: unknown, saved: Saved) => void;
  show: (saved: Saved, result: { action: string }) => void;
  ready: () => void;
  refreshFailed: () => void;
  dismiss: () => void;
  close: () => void;
}
const result = {
  checkinId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  action: 'regular',
  receiptQueued: false
};
const fixture = (locale: 'zh_TW' | 'zh_CN' | 'en' = 'en') => {
  const makeNode = () => ({
    textContent: '',
    hidden: true,
    children: [] as { textContent: string }[],
    onclick: undefined as (() => void) | undefined,
    focus: vi.fn(),
    scrollIntoView: vi.fn(),
    replaceChildren() {
      this.children = [];
    },
    append(child: { textContent: string }) {
      this.children.push(child);
    }
  });
  const nodes = new Map<string, ReturnType<typeof makeNode>>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id)!;
  };
  get('editor').hidden = false;
  let sequence = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const dirty = vi.fn(() => false);
  const window = { closed: false, close: vi.fn(), addEventListener: vi.fn() };
  const context = {
    $: get,
    node: (_tag: string, textContent: string) => ({ textContent }),
    profile: {
      today: '2026-10-21',
      timezone: 'Asia/Taipei',
      methods: [{ code: 'method1', name: '<script>literal method</script>' }]
    },
    selectedDate: '2026-10-21',
    entryFor: vi.fn<() => object | undefined>(() => undefined),
    busy: false,
    writing: false,
    leaving: false,
    whatsappAuthenticated: true,
    dirty,
    syncClosing: vi.fn(),
    renderEditor: vi.fn(),
    window,
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++sequence, { callback, delay });
      return sequence;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    test: undefined as CompletionApi | undefined
  };
  new Script(
    whatsappCompletionBootstrap(locale) +
      '\nglobalThis.test={capture:waCaptureSaved,validate:waValidateSaved,show:waShowCompletion,ready:waCompletionReady,refreshFailed:waCompletionRefreshFailed,dismiss:waDismissCompletion,close:waAttemptCompletionClose};'
  ).runInNewContext(context);
  if (!context.test) throw Error('Completion API missing');
  const api = context.test;
  const saved = api.capture({ version: 0, methods: ['method1'] });
  const show = () => {
    api.validate(result, saved);
    api.show(saved, result);
  };
  const fire = () => {
    const queued = [...timers.values()];
    timers.clear();
    for (const timer of queued) timer.callback();
  };
  return {
    api,
    saved,
    show,
    fire,
    get,
    timers,
    context,
    window,
    dirty,
    text: whatsappCompletionTexts(locale)
  };
};

describe('WhatsApp committed check-in completion', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'shows a %s confirmed record without private notes or chat sends',
    (locale) => {
      const f = fixture(locale);
      f.show();
      expect(f.get('wa-completion').hidden).toBe(false);
      expect(f.get('editor').hidden).toBe(true);
      expect(
        f
          .get('wa-completion-record')
          .children.map((n) => n.textContent)
          .join(' ')
      ).toContain('<script>literal method</script>');
      expect(
        f
          .get('wa-completion-record')
          .children.map((n) => n.textContent)
          .join(' ')
      ).toContain('2026-10-21');
      expect(Object.keys(f.saved).sort()).toEqual([
        'action',
        'date',
        'methods',
        'timezone',
        'version'
      ]);
      expect(f.window.close).not.toHaveBeenCalled();
      expect(f.timers.size).toBe(0);
    }
  );
  it('freezes the successful date, zone and method labels before later UI changes', () => {
    const f = fixture();
    f.context.selectedDate = '2026-10-20';
    f.context.profile.timezone = 'UTC';
    f.context.profile.methods[0]!.name = 'Changed';
    expect(f.saved).toMatchObject({
      date: '2026-10-21',
      timezone: 'Asia/Taipei',
      methods: ['<script>literal method</script>']
    });
  });
  it.each([
    undefined,
    {},
    { ...result, checkinId: 'invalid' },
    { ...result, version: 0 },
    { ...result, version: 1.5 },
    { ...result, action: 'makeup' },
    { ...result, receiptQueued: true }
  ])('does not accept an unknown or inconsistent save response', (invalid) => {
    const f = fixture();
    expect(() => f.api.validate(invalid, f.saved)).toThrow();
    expect(f.get('wa-completion').hidden).toBe(true);
    expect(f.timers.size).toBe(0);
    expect(f.window.close).not.toHaveBeenCalled();
  });
  it.each(['makeup', 'corrected'] as const)(
    'uses the acknowledged %s operation rather than inventing a regular check-in',
    (action) => {
      const f = fixture();
      f.context.selectedDate = '2026-10-20';
      if (action === 'corrected') f.context.entryFor.mockReturnValue({});
      const saved = f.api.capture({ version: 0, methods: ['method1'] });
      expect(saved.action).toBe(action);
      expect(() => f.api.validate({ ...result, action }, saved)).not.toThrow();
    }
  );
  it('waits 3 seconds and retains a manual-close fallback when closing is blocked', () => {
    const f = fixture();
    f.show();
    f.api.ready();
    expect([...f.timers.values()].map((t) => t.delay)).toEqual([3000]);
    expect(f.window.close).not.toHaveBeenCalled();
    f.fire();
    expect(f.window.close).toHaveBeenCalledTimes(1);
    expect(f.get('wa-completion').hidden).toBe(false);
    expect(f.get('wa-completion-hint').textContent).toBe(f.text.manual);
    expect(f.context.leaving).toBe(false);
  });
  it('does not pretend that a throwing browser close succeeded', () => {
    const f = fixture();
    f.window.close.mockImplementation(() => {
      throw Error('Blocked');
    });
    f.show();
    f.api.ready();
    f.fire();
    expect(f.get('wa-completion-hint').textContent).toBe(f.text.manual);
    expect(f.context.leaving).toBe(false);
  });
  it('supports browsers that actually close without calling a messaging SDK or logout', () => {
    const f = fixture();
    f.window.close.mockImplementation(() => {
      f.window.closed = true;
    });
    f.show();
    f.api.ready();
    f.fire();
    expect(f.window.close).toHaveBeenCalledTimes(1);
    expect(f.context.leaving).toBe(true);
  });
  it('does not arm automatic close with another dirty date or timezone', () => {
    const f = fixture();
    f.show();
    f.dirty.mockReturnValue(true);
    f.api.ready();
    expect(f.timers.size).toBe(0);
    f.api.close();
    expect(f.window.close).not.toHaveBeenCalled();
    expect(f.get('wa-completion-hint').textContent).toBe(f.text.unsaved);
  });
  it.each(['busy', 'writing', 'dirty'] as const)('rechecks %s when the timer fires', (state) => {
    const f = fixture();
    f.show();
    f.api.ready();
    if (state === 'dirty') f.dirty.mockReturnValue(true);
    else f.context[state] = true;
    f.fire();
    expect(f.window.close).not.toHaveBeenCalled();
    expect(f.get('wa-completion-hint').textContent).toBe(f.text.unsaved);
  });
  it('cancels stale timers when returning to editing', () => {
    const f = fixture();
    f.show();
    f.api.ready();
    const stale = [...f.timers.values()][0];
    f.get('wa-completion-edit').onclick?.();
    stale?.callback();
    expect(f.get('editor').hidden).toBe(false);
    expect(f.get('wa-completion').hidden).toBe(true);
    expect(f.window.close).not.toHaveBeenCalled();
    expect(f.context.renderEditor).toHaveBeenCalledTimes(1);
  });
  it('keeps the confirmed receipt after refresh failure but pauses automatic closing', () => {
    const f = fixture();
    f.show();
    f.api.ready();
    f.api.refreshFailed();
    f.api.ready();
    expect(f.get('wa-completion').hidden).toBe(false);
    expect(f.get('wa-completion-record').children).toHaveLength(4);
    expect(f.get('wa-completion-hint').textContent).toBe(f.text.refresh);
    expect(f.timers.size).toBe(0);
    expect(f.window.close).not.toHaveBeenCalled();
  });
  it('does not close or retain the new receipt after authentication has expired', () => {
    const f = fixture();
    f.show();
    f.context.whatsappAuthenticated = false;
    f.api.close();
    expect(f.get('wa-completion').hidden).toBe(true);
    expect(f.window.close).not.toHaveBeenCalled();
  });
});
