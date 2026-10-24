/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderCheckinPage, isNfcTouchQuery, parseCheckinQuery } from '../src/checkin-page.js';
import { lineCheckinPage } from '../src/line-checkin-page.js';

interface ElementStub {
  tagName: string;
  children: ElementStub[];
  listeners: Map<string, (event?: unknown) => void | Promise<void>>;
  hidden: boolean;
  disabled: boolean;
  textContent: string;
  className: string;
  id: string;
  href: string;
  append: (...children: ElementStub[]) => void;
  addEventListener: (event: string, handler: (event?: unknown) => void | Promise<void>) => void;
  querySelector: (selector: string) => ElementStub | undefined;
  querySelectorAll: (selector: string) => ElementStub[];
}

const createElementStub = (tagName = 'div'): ElementStub => {
  const node: ElementStub = {
    tagName,
    children: [],
    listeners: new Map(),
    hidden: false,
    disabled: false,
    textContent: '',
    className: '',
    id: '',
    href: '',
    append: (...children) => {
      node.children.push(...children);
    },
    addEventListener: (event, handler) => {
      node.listeners.set(event, handler);
    },
    querySelector: (selector) => {
      const match = (child: ElementStub) =>
        selector.startsWith('#')
          ? child.id === selector.slice(1)
          : selector.startsWith('.')
            ? child.className.includes(selector.slice(1))
            : child.tagName === selector;
      for (const child of node.children) {
        if (match(child)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return undefined;
    },
    querySelectorAll: (selector) => {
      const match = (child: ElementStub) =>
        selector.startsWith('#')
          ? child.id === selector.slice(1)
          : selector.startsWith('.')
            ? child.className.includes(selector.slice(1))
            : child.tagName === selector;
      return node.children.flatMap((child) => [
        ...(match(child) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    }
  };
  return node;
};

const extractScript = (html: string): Script => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('Missing inline page script');
  return new Script(match[1]);
};

describe('LINE Checkin LIFF Dual-Mode Integration (Batch 3)', () => {
  describe('Query parameter detection helpers', () => {
    it('detects nfc_touch action and field parameter', () => {
      expect(isNfcTouchQuery()).toBe(false);
      expect(isNfcTouchQuery('')).toBe(false);
      expect(isNfcTouchQuery({})).toBe(false);
      expect(isNfcTouchQuery('lang=zh_TW')).toBe(false);
      expect(isNfcTouchQuery({ action: 'regular' })).toBe(false);

      expect(isNfcTouchQuery('action=nfc_touch')).toBe(true);
      expect(isNfcTouchQuery('?action=nfc_touch')).toBe(true);
      expect(isNfcTouchQuery({ action: 'nfc_touch' })).toBe(true);
      expect(isNfcTouchQuery('field=TP-01')).toBe(true);
      expect(isNfcTouchQuery({ field: 'TP-01' })).toBe(true);
      expect(isNfcTouchQuery(new URLSearchParams('action=nfc_touch&field=TP-01'))).toBe(true);
    });

    it('parses various query inputs into normalized options', () => {
      expect(parseCheckinQuery()).toEqual({});
      expect(parseCheckinQuery('?action=nfc_touch&field=TP-02')).toEqual({
        action: 'nfc_touch',
        field: 'TP-02'
      });
      expect(parseCheckinQuery(new URLSearchParams('action=nfc_touch'))).toEqual({
        action: 'nfc_touch'
      });
      expect(parseCheckinQuery({ action: 'nfc_touch', field: 'DAAN' })).toEqual({
        action: 'nfc_touch',
        field: 'DAAN'
      });
    });
  });

  describe('General Mode (Daily Practice Check-in)', () => {
    it('maintains 100% backward compatible daily check-in HTML when no parameters are passed', () => {
      const html = lineCheckinPage('test-liff-id');

      // Maintains daily practice headings and form elements
      expect(html).toContain('練功打卡');
      expect(html).toContain('<form id="checkin"');
      expect(html).toContain('id="methods"');
      expect(html).toContain('id="practiceNote"');
      expect(html).toContain('id="feelingTags"');
      expect(html).toContain('id="entries"');
      expect(html).toContain('id="todayTab"');
      expect(html).toContain('id="makeupTab"');

      // Does not render outdoor group practice heading
      expect(html).not.toContain('白雁氣功戶外團練 - 樂齡大字體簽到面板');
      expect(html).not.toContain('id="nfcSuccessCard"');

      // Contains required BBB Tech footer attribution
      expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');

      // Inline script is syntactically valid
      expect(() => extractScript(html)).not.toThrow();
    });

    it('renders daily check-in via renderCheckinPage with default channel', () => {
      const html = renderCheckinPage({ platform: 'line', liffId: 'test-liff-id' });
      expect(html).toContain('練功打卡');
      expect(html).toContain('<form id="checkin"');
    });
  });

  describe('Outdoor Group Practice Mode (action=nfc_touch & field=...) - Senior High-Contrast Panel', () => {
    it('renders the senior large-font outdoor group practice panel when action=nfc_touch', () => {
      const html = lineCheckinPage('test-liff-id', { action: 'nfc_touch' });

      // Title & Headings
      expect(html).toContain('白雁氣功戶外團練 - 樂齡大字體簽到面板');
      expect(html).toContain('<h1>白雁氣功戶外團練</h1>');
      expect(html).toContain('樂齡大字體簽到面板');

      // High-contrast and large-font styling
      expect(html).toContain('font-size: 20px');
      expect(html).toContain('font-size: 32px');
      expect(html).toContain('.nfc-card');
      expect(html).toContain('border: 3px solid #166534');

      // Clear big checkmark feedback element
      expect(html).toContain('id="nfcSuccessCard"');
      expect(html).toContain('nfc-checkmark');
      expect(html).toContain('✓');
      expect(html).toContain('團練簽到成功！');

      // Geolocation permission guidance
      expect(html).toContain('id="nfcGpsCard"');
      expect(html).toContain('請允許瀏覽器定位授權');
      expect(html).toContain('id="nfcGpsButton"');
      expect(html).toContain('允許定位並自動打卡');
      expect(html).toContain('id="nfcRetryBtn"');

      // Switch link to supplement daily practice methods
      expect(html).toContain('id="nfcSupplementLink"');
      expect(html).toContain('href="/line/checkin"');
      expect(html).toContain('補充今日練功功法');

      // GPS automatic checkin script
      expect(html).toContain('navigator.geolocation.getCurrentPosition');
      expect(html).toContain('/line/checkin/field');

      // Footer attribution
      expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');

      // Inline script is syntactically valid
      expect(() => extractScript(html)).not.toThrow();
    });

    it('renders outdoor group practice UI when field parameter is specified', () => {
      const html = lineCheckinPage('test-liff-id', { field: 'TP-DAAN-01' });

      expect(html).toContain('白雁氣功戶外團練 - 樂齡大字體簽到面板');
      expect(html).toContain('TP-DAAN-01');
      expect(html).toContain('團練場地定位確認');
      expect(() => extractScript(html)).not.toThrow();
    });

    it('supports URL query strings and URLSearchParams for NFC mode', () => {
      const htmlFromString = lineCheckinPage('test-liff-id', '?action=nfc_touch&field=PARK-01');
      expect(htmlFromString).toContain('PARK-01');
      expect(htmlFromString).toContain('白雁氣功戶外團練');

      const htmlFromSearchParams = renderCheckinPage(
        { platform: 'line', liffId: 'test-liff-id' },
        new URLSearchParams('action=nfc_touch')
      );
      expect(htmlFromSearchParams).toContain('白雁氣功戶外團練');
    });

    it('renders English locale when channel locale is en', () => {
      const html = renderCheckinPage(
        { platform: 'line', liffId: 'test-liff-id', locale: 'en' },
        { action: 'nfc_touch' }
      );

      expect(html).toContain('Baiyin Qigong Outdoor Group Practice - Senior Large-Font Check-in Panel');
      expect(html).toContain('Senior Large-Font Check-in Panel');
      expect(html).toContain('Supplement Today’s Practice Methods');
      expect(html).toContain('Allow Location & Check In');
    });
  });

  describe('NFC GPS Automatic Check-in Script Execution', () => {
    it('automatically checks in via GPS upon LIFF initialization and reveals checkmark', async () => {
      const html = lineCheckinPage('test-liff-id', { action: 'nfc_touch', field: 'FIELD-PARK-01' });
      const script = extractScript(html);

      const elements = new Map<string, ElementStub>();
      const getElement = (id: string): ElementStub => {
        if (!elements.has(id)) {
          const el = createElementStub();
          el.id = id;
          elements.set(id, el);
        }
        return elements.get(id)!;
      };

      const nfcStatus = getElement('nfcStatus');
      const nfcGpsCard = getElement('nfcGpsCard');
      const nfcSuccessCard = getElement('nfcSuccessCard');
      const nfcGpsNotice = getElement('nfcGpsNotice');
      const nfcGpsErrorNotice = getElement('nfcGpsErrorNotice');
      const nfcGpsErrorText = getElement('nfcGpsErrorText');
      const nfcGpsButton = getElement('nfcGpsButton');
      const nfcRetryBtn = getElement('nfcRetryBtn');
      const nfcSupplementLink = getElement('nfcSupplementLink');

      nfcSuccessCard.hidden = true;
      nfcGpsErrorNotice.hidden = true;

      const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          field?: string;
          latitude?: number;
          longitude?: number;
          idToken?: string;
        };
        expect(url).toBe('/line/checkin/field');
        expect(body.field).toBe('FIELD-PARK-01');
        expect(body.latitude).toBe(25.033);
        expect(body.longitude).toBe(121.565);
        expect(body.idToken).toBe('mock-verified-id-token');
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', attendanceId: 'att-123' })
        } as unknown as Response;
      });

      const getCurrentPositionMock = vi.fn(
        (success: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
          success({ coords: { latitude: 25.033, longitude: 121.565 } });
        }
      );

      const context = {
        location: {
          search: '?action=nfc_touch&field=FIELD-PARK-01',
          pathname: '/line/checkin',
          href: 'https://checkin.baiyinqigong.org/line/checkin?action=nfc_touch&field=FIELD-PARK-01'
        },
        document: {
          getElementById: (id: string) => getElement(id),
          createElement: createElementStub,
          cookie: ''
        },
        history: { replaceState: vi.fn() },
        liff: {
          init: vi.fn(async () => {}),
          isLoggedIn: vi.fn(() => true),
          isInClient: vi.fn(() => true),
          getIDToken: vi.fn(() => 'mock-verified-id-token')
        },
        navigator: {
          geolocation: {
            getCurrentPosition: getCurrentPositionMock
          }
        },
        fetch: fetchMock,
        URLSearchParams,
        JSON,
        Error
      };

      script.runInNewContext(context);
      await setImmediate();
      await setImmediate();

      // GPS position obtained and checkin posted
      expect(getCurrentPositionMock).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();

      // UI reveals big checkmark and hides GPS card
      expect(nfcGpsCard.hidden).toBe(true);
      expect(nfcSuccessCard.hidden).toBe(false);
      expect(nfcStatus.textContent).toBe('簽到完成！');
    });

    it('shows elder-friendly location guidance if geolocation permission is denied', async () => {
      const html = lineCheckinPage('test-liff-id', { action: 'nfc_touch' });
      const script = extractScript(html);

      const elements = new Map<string, ElementStub>();
      const getElement = (id: string): ElementStub => {
        if (!elements.has(id)) {
          const el = createElementStub();
          el.id = id;
          elements.set(id, el);
        }
        return elements.get(id)!;
      };

      const nfcStatus = getElement('nfcStatus');
      const nfcGpsCard = getElement('nfcGpsCard');
      const nfcSuccessCard = getElement('nfcSuccessCard');
      const nfcGpsErrorNotice = getElement('nfcGpsErrorNotice');
      const nfcGpsErrorText = getElement('nfcGpsErrorText');
      nfcGpsErrorNotice.hidden = true;
      nfcSuccessCard.hidden = true;

      const getCurrentPositionMock = vi.fn(
        (_success: unknown, error: (err: { code: number; message: string }) => void) => {
          error({ code: 1, message: 'User denied Geolocation' });
        }
      );

      const context = {
        location: {
          search: '?action=nfc_touch',
          pathname: '/line/checkin',
          href: 'https://checkin.baiyinqigong.org/line/checkin?action=nfc_touch'
        },
        document: {
          getElementById: (id: string) => getElement(id),
          createElement: createElementStub,
          cookie: ''
        },
        history: { replaceState: vi.fn() },
        liff: {
          init: vi.fn(async () => {}),
          isLoggedIn: vi.fn(() => true),
          isInClient: vi.fn(() => true),
          getIDToken: vi.fn(() => 'mock-verified-id-token')
        },
        navigator: {
          geolocation: {
            getCurrentPosition: getCurrentPositionMock
          }
        },
        fetch: vi.fn(),
        URLSearchParams,
        JSON,
        Error
      };

      script.runInNewContext(context);
      await setImmediate();
      await setImmediate();

      expect(getCurrentPositionMock).toHaveBeenCalled();
      expect(nfcGpsErrorNotice.hidden).toBe(false);
      expect(nfcGpsErrorText.textContent).toContain('定位授權已被拒絕');
      expect(nfcSuccessCard.hidden).toBe(true);
    });
  });
});
