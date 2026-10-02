import { normalizeKenyanPhone } from '../kcb/domain';

// `phoneNormalized` is a server-owned copy of the member's `phonenumber` in
// the form KCB payer phones are normalised to, so Till payments can suggest
// the member who paid. `phonenumber` stays the source of truth.

export const profilePhoneNormalized = (phonenumber: unknown): string | undefined => {
  if (typeof phonenumber !== 'string') return undefined;
  try {
    return normalizeKenyanPhone(phonenumber);
  } catch {
    return undefined;
  }
};

export type PhoneNormalizedChange =
  | { action: 'set'; value: string }
  | { action: 'remove' };

// The write that brings a member record's `phoneNormalized` in line with its
// `phonenumber`, or undefined when it already is, so syncing never loops.
export const phoneNormalizedChange = (
  data: Record<string, unknown> | undefined,
): PhoneNormalizedChange | undefined => {
  const expected = profilePhoneNormalized(data?.phonenumber);
  const stored = data?.phoneNormalized;
  if (expected) return stored === expected ? undefined : { action: 'set', value: expected };
  return stored === undefined ? undefined : { action: 'remove' };
};

export const phoneNumberChanged = (
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
) => before?.phonenumber !== after?.phonenumber;
