import { describe, expect, it } from 'vitest';
import { isKenyanMobileNumber } from '../src/lib/kenyanPhone';

describe('Kenyan mobile number input', () => {
  it('accepts supported formats with spaces and hyphens', () => {
    for (const value of [
      '0712345678',
      '0112345678',
      '0712 345-678',
      '254712345678',
      '+254712345678',
      ' +254 712 345 678 ',
    ]) {
      expect(isKenyanMobileNumber(value)).toBe(true);
    }
  });

  it('rejects letters, misplaced plus signs and other punctuation', () => {
    for (const value of [
      '0712abc345678',
      '+foo254712345678bar',
      '254+712345678',
      '++254712345678',
      '0712.345.678',
      '(0712) 345678',
      '0712_345_678',
      '0812345678',
      '',
    ]) {
      expect(isKenyanMobileNumber(value)).toBe(false);
    }
  });
});
