/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { describe, expect, it } from 'vitest';
import {
  e164PhoneSchema,
  normalizeE164Phone,
  regionDefaultCountryCode,
  supportedCountryPhoneRules
} from '../src/phone-e164.js';

describe('Phone E.164 normalization & validation', () => {
  it('maps regions to default country codes', () => {
    expect(regionDefaultCountryCode('tw-general')).toBe('+886');
    expect(regionDefaultCountryCode('hk-general')).toBe('+852');
    expect(regionDefaultCountryCode('my-general')).toBe('+60');
    expect(regionDefaultCountryCode('sg-general')).toBe('+65');
    expect(regionDefaultCountryCode('other-general')).toBe('+886');
    expect(regionDefaultCountryCode(undefined)).toBe('+886');
  });

  it('normalizes Taiwan numbers: strips leading 0 from 09xx and adds +886', () => {
    expect(normalizeE164Phone('0912345678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('0912-345-678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('0912 345 678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('+8860912345678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('+886912345678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('886912345678', '+886')).toBe('+886912345678');
    expect(normalizeE164Phone('8860912345678', '+886')).toBe('+886912345678');
  });

  it('normalizes Hong Kong numbers (+852)', () => {
    expect(normalizeE164Phone('91234567', '+852')).toBe('+85291234567');
    expect(normalizeE164Phone('5123-4567', '+852')).toBe('+85251234567');
    expect(normalizeE164Phone('+85291234567', '+852')).toBe('+85291234567');
    expect(normalizeE164Phone('85291234567', '+852')).toBe('+85291234567');
  });

  it('normalizes Malaysia numbers (+60): strips leading 0 from 01x', () => {
    expect(normalizeE164Phone('0123456789', '+60')).toBe('+60123456789');
    expect(normalizeE164Phone('012-345 6789', '+60')).toBe('+60123456789');
    expect(normalizeE164Phone('+600123456789', '+60')).toBe('+60123456789');
    expect(normalizeE164Phone('+60123456789', '+60')).toBe('+60123456789');
    expect(normalizeE164Phone('60123456789', '+60')).toBe('+60123456789');
    expect(normalizeE164Phone('600123456789', '+60')).toBe('+60123456789');
  });

  it('normalizes Singapore numbers (+65)', () => {
    expect(normalizeE164Phone('81234567', '+65')).toBe('+6581234567');
    expect(normalizeE164Phone('9123-4567', '+65')).toBe('+6591234567');
    expect(normalizeE164Phone('+6581234567', '+65')).toBe('+6581234567');
    expect(normalizeE164Phone('6591234567', '+65')).toBe('+6591234567');
  });

  it('preserves other international numbers starting with +', () => {
    expect(normalizeE164Phone('+14155552671', '+886')).toBe('+14155552671');
    expect(normalizeE164Phone('+819012345678', '+886')).toBe('+819012345678');
    expect(normalizeE164Phone('0014155552671', '+886')).toBe('+14155552671');
  });

  it('e164PhoneSchema pre-normalizes and parses valid numbers', () => {
    expect(e164PhoneSchema.parse('+8860912345678')).toBe('+886912345678');
    expect(e164PhoneSchema.parse('+886912345678')).toBe('+886912345678');
    expect(e164PhoneSchema.parse('+600123456789')).toBe('+60123456789');
    expect(e164PhoneSchema.parse('+85291234567')).toBe('+85291234567');
    expect(e164PhoneSchema.parse('+60123456789')).toBe('+60123456789');
    expect(e164PhoneSchema.parse('+6581234567')).toBe('+6581234567');
  });

  it('e164PhoneSchema rejects invalid phone numbers', () => {
    expect(() => e164PhoneSchema.parse('invalid')).toThrow();
    expect(() => e164PhoneSchema.parse('')).toThrow();
    expect(() => e164PhoneSchema.parse('123')).toThrow();
    expect(() => e164PhoneSchema.parse('+012345678')).toThrow(); // Leading 0 in country code
  });

  it('supported country rules are defined and frozen', () => {
    expect(Object.keys(supportedCountryPhoneRules)).toEqual(['+886', '+852', '+60', '+65']);
    expect(supportedCountryPhoneRules['+886']?.stripLeadingZero).toBe(true);
    expect(supportedCountryPhoneRules['+60']?.stripLeadingZero).toBe(true);
    expect(supportedCountryPhoneRules['+852']?.stripLeadingZero).toBe(false);
    expect(supportedCountryPhoneRules['+65']?.stripLeadingZero).toBe(false);
  });
});
