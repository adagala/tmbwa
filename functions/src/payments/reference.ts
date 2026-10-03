import { normalizeMpesaReference } from 'tmbwa-shared';

// `referenceNormalized` is a server-owned copy of a payment's `referencenumber`
// in the form KCB statements report M-Pesa receipts, so a statement payment
// can be matched to one already recorded by hand. `referencenumber` stays the
// source of truth. `receipt_number` is always an internal `TMBWA-…` receipt,
// so it is not considered.

export const paymentReferenceNormalized = (data: Record<string, unknown> | undefined) =>
  normalizeMpesaReference(data?.referencenumber);

// The payment as written: `referenceNormalized` set from `referencenumber`, or
// absent when that is not an M-Pesa code.
export const withReferenceNormalized = <Payment extends Record<string, unknown>>(
  payment: Payment,
): Payment => {
  const written: Record<string, unknown> = { ...payment };
  delete written.referenceNormalized;
  const normalized = paymentReferenceNormalized(payment);
  if (normalized) written.referenceNormalized = normalized;
  return written as Payment;
};

// Normalized references held by more than one payment, with their paths. A
// statement receipt matching one of these cannot be matched automatically.
export const sharedReferences = (
  payments: Array<{ path: string; referenceNormalized: string | undefined }>,
) => {
  const pathsByReference = new Map<string, string[]>();
  payments.forEach(({ path, referenceNormalized }) => {
    if (!referenceNormalized) return;
    pathsByReference.set(referenceNormalized, [...(pathsByReference.get(referenceNormalized) ?? []), path]);
  });
  return [...pathsByReference.values()].filter((paths) => paths.length > 1);
};

export type ReferenceNormalizedChange =
  | { action: 'set'; value: string }
  | { action: 'remove' };

// The write that brings a payment's `referenceNormalized` in line with its
// `referencenumber`, or undefined when it already is.
export const referenceNormalizedChange = (
  data: Record<string, unknown> | undefined,
): ReferenceNormalizedChange | undefined => {
  const expected = paymentReferenceNormalized(data);
  const stored = data?.referenceNormalized;
  if (expected) return stored === expected ? undefined : { action: 'set', value: expected };
  return stored === undefined ? undefined : { action: 'remove' };
};
