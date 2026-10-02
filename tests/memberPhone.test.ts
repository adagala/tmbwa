import { describe, expect, it } from 'vitest';
import {
  phoneNormalizedChange,
  phoneNumberChanged,
  profilePhoneNormalized,
} from '../functions/src/members/phone';

describe('member profile phone normalization', () => {
  it('normalizes every Kenyan mobile form to the KCB payer phone form', () => {
    for (const value of ['0712345678', '254712345678', '+254712345678', '+254 712 345-678', '712345678']) {
      expect(profilePhoneNormalized(value)).toBe('+254712345678');
    }
    for (const value of ['0112345678', '254112345678', '+254112345678']) {
      expect(profilePhoneNormalized(value)).toBe('+254112345678');
    }
  });

  it('returns undefined for numbers that are not Kenyan mobiles', () => {
    for (const value of ['', '123', '0812345678', '+14155550100', '07123456789', undefined, null, 712345678]) {
      expect(profilePhoneNormalized(value)).toBeUndefined();
    }
  });
});

describe('phoneNormalized sync guard', () => {
  it('sets the field when it is missing or stale', () => {
    expect(phoneNormalizedChange({ phonenumber: '0712345678' })).toEqual({ action: 'set', value: '+254712345678' });
    expect(phoneNormalizedChange({ phonenumber: '0712345678', phoneNormalized: '+254700000000' }))
      .toEqual({ action: 'set', value: '+254712345678' });
  });

  it('writes nothing when the field already matches, so the trigger does not loop', () => {
    expect(phoneNormalizedChange({ phonenumber: '0712 345 678', phoneNormalized: '+254712345678' })).toBeUndefined();
  });

  it('removes the field for an invalid number and writes nothing when it is already absent', () => {
    expect(phoneNormalizedChange({ phonenumber: '123', phoneNormalized: '+254712345678' })).toEqual({ action: 'remove' });
    expect(phoneNormalizedChange({ phonenumber: '123' })).toBeUndefined();
    expect(phoneNormalizedChange(undefined)).toBeUndefined();
  });

  it('runs only when the profile phone changes', () => {
    expect(phoneNumberChanged({ phonenumber: '0712345678' }, { phonenumber: '0712345678', firstname: 'New' })).toBe(false);
    expect(phoneNumberChanged({ phonenumber: '0712345678' }, { phonenumber: '+254712345678' })).toBe(true);
    // Writing phoneNormalized itself does not change the profile phone.
    expect(phoneNumberChanged(
      { phonenumber: '0712345678' },
      { phonenumber: '0712345678', phoneNormalized: '+254712345678' },
    )).toBe(false);
  });
});
