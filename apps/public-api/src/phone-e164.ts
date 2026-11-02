/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { z } from 'zod';

export interface CountryPhoneRule {
  readonly countryCode: string;
  readonly labelZhTw: string;
  readonly labelZhCn: string;
  readonly labelEn: string;
  readonly placeholder: string;
  readonly stripLeadingZero: boolean;
}

export const supportedCountryPhoneRules: Readonly<Record<string, CountryPhoneRule>> = Object.freeze(
  {
    '+886': {
      countryCode: '+886',
      labelZhTw: '台灣 +886',
      labelZhCn: '台湾 +886',
      labelEn: 'Taiwan +886',
      placeholder: '0912345678',
      stripLeadingZero: true
    },
    '+852': {
      countryCode: '+852',
      labelZhTw: '香港 +852',
      labelZhCn: '香港 +852',
      labelEn: 'Hong Kong +852',
      placeholder: '91234567',
      stripLeadingZero: false
    },
    '+60': {
      countryCode: '+60',
      labelZhTw: '馬來西亞 +60',
      labelZhCn: '马来西亚 +60',
      labelEn: 'Malaysia +60',
      placeholder: '0123456789',
      stripLeadingZero: true
    },
    '+65': {
      countryCode: '+65',
      labelZhTw: '新加坡 +65',
      labelZhCn: '新加坡 +65',
      labelEn: 'Singapore +65',
      placeholder: '81234567',
      stripLeadingZero: false
    }
  }
);

export const regionDefaultCountryCode = (region?: string): string => {
  switch (region) {
    case 'tw-general':
      return '+886';
    case 'hk-general':
      return '+852';
    case 'my-general':
      return '+60';
    case 'sg-general':
      return '+65';
    default:
      return '+886';
  }
};

/**
 * Normalizes phone numbers into E.164 standard format (+[1-9][0-9]{6,14}).
 * - Strips whitespaces, dashes, parentheses, dots.
 * - Taiwan (+886): 09xxxxxxxx -> +8869xxxxxxxx; +88609xxxxxxxx -> +8869xxxxxxxx.
 * - Malaysia (+60): 01xxxxxxxxx -> +601xxxxxxxxx; +6001xxxxxxxxx -> +601xxxxxxxxx.
 * - Hong Kong (+852): 8 digits -> +852xxxxxxxx.
 * - Singapore (+65): 8 digits -> +65xxxxxxxx.
 * - Already standard E.164: preserved and cleaned.
 */
export const normalizeE164Phone = (raw: string, fallbackCountryCode = '+886'): string => {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/[\s\-().]+/g, '');
  if (!cleaned) return '';

  // 1. Remove duplicate leading zero after country code if user pasted e.g. +88609... or +6001...
  if (cleaned.startsWith('+8860') && cleaned.length > 5) {
    cleaned = '+886' + cleaned.slice(5);
  } else if (cleaned.startsWith('+600') && cleaned.length > 4) {
    cleaned = '+60' + cleaned.slice(4);
  }

  // 2. Already starts with '+'
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // 3. International access code '00...'
  if (cleaned.startsWith('00')) {
    let withPlus = '+' + cleaned.slice(2);
    if (withPlus.startsWith('+8860') && withPlus.length > 5) {
      withPlus = '+886' + withPlus.slice(5);
    } else if (withPlus.startsWith('+600') && withPlus.length > 4) {
      withPlus = '+60' + withPlus.slice(4);
    }
    return withPlus;
  }

  // 4. Auto-detect country code from prefix if user entered 886..., 852..., 60..., 65... without '+'
  if (/^886[1-9][0-9]{7,8}$/.test(cleaned)) {
    return '+' + cleaned;
  }
  if (/^8860[1-9][0-9]{7,8}$/.test(cleaned)) {
    return '+886' + cleaned.slice(4);
  }
  if (/^852[2-9][0-9]{7}$/.test(cleaned)) {
    return '+' + cleaned;
  }
  if (/^601[0-9]{8,9}$/.test(cleaned)) {
    return '+' + cleaned;
  }
  if (/^6001[0-9]{8,9}$/.test(cleaned)) {
    return '+60' + cleaned.slice(3);
  }
  if (/^65[89][0-9]{7}$/.test(cleaned)) {
    return '+' + cleaned;
  }

  // 5. National number format based on fallbackCountryCode
  const rule = supportedCountryPhoneRules[fallbackCountryCode];
  if (rule) {
    let national = cleaned;
    if (rule.stripLeadingZero && national.startsWith('0')) {
      national = national.slice(1);
    }
    return rule.countryCode + national;
  }

  return '+' + cleaned;
};

export const e164PhoneRegex = /^\+[1-9][0-9]{6,14}$/;

export const e164PhoneSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim().startsWith('+') ? normalizeE164Phone(val) : val),
  z.string().regex(e164PhoneRegex)
);
