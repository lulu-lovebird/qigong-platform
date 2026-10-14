import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { lineJournalStreamScript } from '../src/line-journal-stream.js';
import { journalTexts } from '../src/journal-locale.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
class Node {
  children: Node[] = [];
  textContent = '';
  className = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  hidden = false;
  disabled = false;
  onclick?: () => Promise<void>;
  box = { top: 1200, bottom: 1300 };
  getBoundingClientRect() {
    return this.box;
  }
  constructor(readonly tag = 'div') {}
  append(...nodes: Node[]) {
    for (const n of nodes)
      if (n.tag === 'fragment') this.children.push(...n.children);
      else this.children.push(n);
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
}
interface Entry {
  id: string;
  version: number;
  alias: string;
  region: string;
  date: string;
  publishedAt: string;
  checkedInAt: string;
  timezone: string;
  currentStreak: number;
  totalDays: number;
  methods: string[];
  practiceNote: string;
  feelingTags: string[];
}
interface Cursor {
  snapshotAt: string;
  publishedAt: string;
  id: string;
}
interface Feed {
  pageSize: number;
  hasMore: boolean;
  nextCursor: Cursor | null;
  entries: Entry[];
}
const entry = (id: string): Entry => ({
  id,
  version: 1,
  alias: 'Synthetic alias',
  region: '台灣地區',
  date: '2026-10-13',
  publishedAt: '2026-10-13T03:00:00Z',
  checkedInAt: '2026-10-13T02:00:00Z',
  timezone: 'Asia/Taipei',
  currentStreak: 7,
  totalDays: 38,
  methods: ['大雁功初級'],
  practiceNote: '原文不翻譯',
  feelingTags: ['放鬆']
});
const cursor = (id: string): Cursor => ({
  snapshotAt: '2026-10-13T04:00:00Z',
  publishedAt: '2026-10-13T03:00:00Z',
  id
});
const batch = (ids: string[], next: Cursor | null = null): Feed => ({
  pageSize: 10,
  hasMore: next !== null,
  nextCursor: next,
  entries: ids.map(entry)
});
const fixture = (
  api: (path: string, values: { cursor: Cursor | null }, signal: AbortSignal) => Promise<Feed>,
  withObserver = true,
  withFrames = false
) => {
  const nodes = new Map<string, Node>(),
    get = (id: string) => {
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id)!;
    };
  const observers: Array<{
    callback: (entries: Array<{ isIntersecting: boolean }>) => void;
    disconnect: ReturnType<typeof vi.fn>;
    observe: ReturnType<typeof vi.fn>;
    options: { rootMargin: string };
  }> = [];
  class Observer {
    disconnect = vi.fn();
    observe = vi.fn();
    constructor(
      readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void,
      readonly options: { rootMargin: string }
    ) {
      observers.push(this);
    }
  }
  const frames: Array<() => void> = [],
    scrollTo = vi.fn();
  const status = vi.fn(),
    privacy = vi.fn();
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: (tag: string) => new Node(tag),
      createDocumentFragment: () => new Node('fragment')
    },
    journalUI: journalTexts('zh_TW'),
    journalLocale: 'zh_TW',
    api,
    status,
    onPrivacy: privacy,
    AbortController,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
    window: { scrollTo },
    ...(withFrames
      ? {
          innerHeight: 600,
          requestAnimationFrame: (callback: () => void) => {
            frames.push(callback);
            return frames.length;
          }
        }
      : {}),
    ...(withObserver ? { IntersectionObserver: Observer } : {})
  });
  new vm.Script(
    lineJournalStreamScript + '\nglobalThis.stream=createLineJournalStream({api,status,onPrivacy});'
  ).runInContext(context);
  const stream = context.stream as {
    reset: () => Promise<void>;
    stop: () => void;
    more: () => Promise<void>;
  };
  return { stream, get, observers, status, privacy, frames, scrollTo };
};
const tick = async () => {
  await setImmediate();
  await setImmediate();
};
const flatten = (node: Node): string =>
  node.textContent + ' ' + node.children.map(flatten).join(' ');
describe('LINE portrait journal stream interaction', () => {
  it('loads10 at start and appends batches with de-duplication and explicit completion', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(
        batch(
          Array.from({ length: 10 }, (_, i) => String(i)),
          cursor('9')
        )
      )
      .mockResolvedValueOnce(batch(['9', '10', '11']));
    const f = fixture(api);
    await f.stream.reset();
    expect(f.get('line-feed-entries').children).toHaveLength(10);
    await f.stream.more();
    expect(f.get('line-feed-entries').children).toHaveLength(12);
    expect(api.mock.calls[1]![1]).toEqual({ cursor: cursor('9') });
    expect(f.get('line-feed-more').hidden).toBe(true);
    expect(f.get('line-feed-sentinel').textContent).toContain('已看完');
  });
  it('rechecks the sentinel after a completed render so an intersection during loading is not lost', async () => {
    const api = vi
        .fn()
        .mockResolvedValueOnce(batch(['first'], cursor('first')))
        .mockResolvedValueOnce(batch(['last'])),
      f = fixture(api, true, true);
    await f.stream.reset();
    expect(f.scrollTo).toHaveBeenCalledWith(0, 0);
    f.get('line-feed-sentinel').box = { top: 500, bottom: 600 };
    f.frames[0]!();
    await tick();
    expect(api).toHaveBeenCalledTimes(2);
    expect(f.get('line-feed-entries').children).toHaveLength(2);
  });
  it('only sends one request while the sentinel is repeatedly intersecting', async () => {
    let resolve: (feed: Feed) => void = () => {};
    const api = vi.fn(
        () =>
          new Promise<Feed>((r) => {
            resolve = r;
          })
      ),
      f = fixture(api);
    const waiting = f.stream.reset();
    for (let i = 0; i < 6; i++) f.observers[0]!.callback([{ isIntersecting: true }]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(f.observers[0]!.options.rootMargin).toBe('300px 0px');
    resolve(batch(['first']));
    await waiting;
  });
  it('keeps loaded cards and retries the same cursor after a network failure', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(batch(['first'], cursor('first')))
      .mockRejectedValueOnce(Error('Network error'))
      .mockResolvedValueOnce(batch(['second']));
    const f = fixture(api);
    await f.stream.reset();
    await f.stream.more();
    expect(f.get('line-feed-entries').children).toHaveLength(1);
    expect(f.get('line-feed-more').textContent).toContain('重新');
    await f.get('line-feed-more').onclick?.();
    expect(f.get('line-feed-entries').children).toHaveLength(2);
    expect(api.mock.calls[1]![1]).toEqual(api.mock.calls[2]![1]);
  });
  it('aborts a stale load on mode switch and never appends its late response', async () => {
    let resolve: (feed: Feed) => void = () => {},
      signal: AbortSignal | undefined;
    const api = vi.fn((_p: string, _v: { cursor: Cursor | null }, s: AbortSignal) => {
      signal = s;
      return new Promise<Feed>((r) => {
        resolve = r;
      });
    });
    const f = fixture(api),
      waiting = f.stream.reset();
    f.stream.stop();
    expect(signal?.aborted).toBe(true);
    resolve(batch(['stale']));
    await waiting;
    expect(f.get('line-feed-entries').children).toHaveLength(0);
    expect(f.observers[0]!.disconnect).toHaveBeenCalled();
  });
  it('clears already-read cards when reader authorization fails rather than continuing to paginate', async () => {
    const error = Object.assign(Error('Denied'), { status: 403 }),
      api = vi
        .fn()
        .mockResolvedValueOnce(batch(['first'], cursor('first')))
        .mockRejectedValueOnce(error),
      f = fixture(api);
    await f.stream.reset();
    await f.stream.more();
    expect(f.get('line-feed-entries').children).toHaveLength(0);
    expect(f.get('line-feed-more').hidden).toBe(true);
    expect(f.get('line-feed-sentinel').textContent).toContain('失效');
  });
  it('resets to the latest first batch and provides manual loading when observer is absent', async () => {
    const api = vi
        .fn()
        .mockResolvedValueOnce(batch(['old'], cursor('old')))
        .mockResolvedValueOnce(batch(['new'], cursor('new')))
        .mockResolvedValueOnce(batch(['last'])),
      f = fixture(api, false);
    await f.stream.reset();
    await f.stream.reset();
    expect(f.get('line-feed-entries').children).toHaveLength(1);
    expect(f.get('line-feed-entries').children[0]!.dataset.publicationId).toBe('new');
    await f.get('line-feed-more').onclick?.();
    expect(f.get('line-feed-entries').children).toHaveLength(2);
  });
  it('renders as-of counters, timezone labels, text-only long notes and wrapping method/feeling tags', async () => {
    const data = batch(['note']);
    data.entries[0]!.practiceNote = '<img src=x onerror=alert(1)>' + '很長的原文😀'.repeat(60);
    const f = fixture(vi.fn().mockResolvedValue(data));
    await f.stream.reset();
    const card = f.get('line-feed-entries').children[0]!;
    expect(flatten(card)).toContain('連續練功');
    expect(flatten(card)).toContain('38 天');
    expect(flatten(card)).toContain('Asia/Taipei');
    expect(card.children.some((n) => n.tag === 'details')).toBe(true);
    expect(flatten(card)).toContain(data.entries[0]!.practiceNote);
    expect(card.children.some((n) => n.tag === 'img')).toBe(false);
  });
  it('shows empty and rejects a non-advancing cursor without endlessly polling', async () => {
    const f = fixture(vi.fn().mockResolvedValue(batch([])));
    await f.stream.reset();
    expect(f.get('line-feed-sentinel').textContent).toContain('沒有');
    const same = cursor('same'),
      api = vi.fn().mockResolvedValue(batch(['same'], same)),
      g = fixture(api);
    await g.stream.reset();
    await g.stream.more();
    expect(g.get('line-feed-entries').children).toHaveLength(1);
    expect(g.get('line-feed-sentinel').textContent).toContain('未完成');
  });
  it('enables the stream only on LINE, preserving Telegram/WhatsApp original paging and sharing editor', async () => {
    const line = renderChannelWorkspacePage({ platform: 'line', liffId: '123-stream' }, 'journal');
    expect(line).toContain('lineJournalStreamEnabled=true');
    expect(line).toContain('id="line-feed-sentinel"');
    expect(line).toContain('cursor');
    expect(line).toContain('sourceHash:entry.sourceHash');
    expect(line).toContain('if(!mayLeave())return;lineFeed?.stop()');
    expect(line).toContain('JSON.stringify({idToken,locale,...values})');
    const wa = renderChannelWorkspacePage({ platform: 'whatsapp' }, 'journal');
    expect(wa).toContain('lineJournalStreamEnabled=false');
    expect(wa).not.toContain('id="line-feed-sentinel"');
    await tick();
  });
});
