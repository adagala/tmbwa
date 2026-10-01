import { describe, expect, it } from 'vitest';
import {
  MAX_BENEFICIARIES,
  beneficiaryChangeReasonSchema,
  beneficiaryChangeRequestDocumentSchema,
  beneficiaryListSchema,
  beneficiarySchema,
  beneficiaryStateDocumentSchema,
  nairobiDateKey,
} from 'tmbwa-shared';

const beneficiary = {
  firstname: ' Baraka ',
  lastname: 'Adagala',
  relationship: 'son',
  dateOfBirth: '2015-04-20',
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('beneficiary schemas', () => {
  it('accepts required fields only and trims names', () => {
    const parsed = beneficiarySchema.parse(beneficiary);
    expect(parsed.firstname).toBe('Baraka');
    expect(parsed).not.toHaveProperty('email');
  });

  it('treats blank optional fields as absent', () => {
    const parsed = beneficiarySchema.parse({
      ...beneficiary, email: ' ', phonenumber: '', idnumber: '',
    });
    expect(parsed.email).toBeUndefined();
    expect(parsed.phonenumber).toBeUndefined();
    expect(parsed.idnumber).toBeUndefined();
  });

  it('validates optional contact and ID fields when given', () => {
    expect(beneficiarySchema.parse({
      ...beneficiary,
      email: 'baraka@example.test',
      phonenumber: '+254712345678',
      idnumber: 'BC 123/456-7',
    }).idnumber).toBe('BC 123/456-7');
    const result = beneficiarySchema.safeParse({
      ...beneficiary, email: 'not-an-email', phonenumber: '12345', idnumber: 'ID<script>',
    });
    expect(issuePaths(result)).toEqual(expect.arrayContaining(['email', 'phonenumber', 'idnumber']));
  });

  it('requires names, a known relationship and a date of birth', () => {
    const result = beneficiarySchema.safeParse({ firstname: '', lastname: ' ', relationship: 'friend' });
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining(['firstname', 'lastname', 'relationship', 'dateOfBirth']),
    );
  });

  it('requires a description only for an "other" relationship', () => {
    expect(issuePaths(beneficiarySchema.safeParse({ ...beneficiary, relationship: 'other' })))
      .toEqual(['relationshipOther']);
    expect(beneficiarySchema.parse({
      ...beneficiary, relationship: 'other', relationshipOther: 'Godchild',
    }).relationshipOther).toBe('Godchild');
    expect(beneficiarySchema.parse({ ...beneficiary, relationshipOther: 'Ignored' }))
      .not.toHaveProperty('relationshipOther');
  });

  it('rejects impossible, ancient and future dates of birth', () => {
    const tomorrow = nairobiDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
    for (const dateOfBirth of ['2015-02-30', '20-04-2015', '1899-12-31', tomorrow]) {
      expect(beneficiarySchema.safeParse({ ...beneficiary, dateOfBirth }).success).toBe(false);
    }
    expect(beneficiarySchema.safeParse({
      ...beneficiary, dateOfBirth: nairobiDateKey(new Date()),
    }).success).toBe(true);
  });

  it('allows one to three beneficiaries with distinct ID numbers', () => {
    expect(beneficiaryListSchema.safeParse([]).success).toBe(false);
    expect(beneficiaryListSchema.safeParse(Array(MAX_BENEFICIARIES).fill(beneficiary)).success).toBe(true);
    expect(beneficiaryListSchema.safeParse(Array(MAX_BENEFICIARIES + 1).fill(beneficiary)).success).toBe(false);
    const duplicate = beneficiaryListSchema.safeParse([
      { ...beneficiary, idnumber: '12345678' },
      { ...beneficiary, idnumber: ' 1234 5678 ' },
    ]);
    expect(issuePaths(duplicate)).toEqual(['1.idnumber']);
  });

  it('requires an explanation only for an "other" change reason', () => {
    expect(beneficiaryChangeReasonSchema.safeParse({ category: 'marriage' }).success).toBe(true);
    expect(beneficiaryChangeReasonSchema.safeParse({ category: 'other', text: ' ' }).success).toBe(false);
    expect(beneficiaryChangeReasonSchema.safeParse({ category: 'other', text: 'Name change' }).success).toBe(true);
    expect(beneficiaryChangeReasonSchema.safeParse({ category: 'whim' }).success).toBe(false);
  });

  it('requires a reason on exceptional change requests', () => {
    const request = {
      memberId: 'member-1',
      type: 'exceptional',
      proposedBeneficiaries: [beneficiary],
      baseVersion: 2,
      status: 'pending',
      submittedBy: 'member-1',
    };
    expect(beneficiaryChangeRequestDocumentSchema.safeParse(request).success).toBe(false);
    expect(beneficiaryChangeRequestDocumentSchema.safeParse({
      ...request, reason: { category: 'birth_or_adoption' },
    }).success).toBe(true);
    expect(beneficiaryChangeRequestDocumentSchema.safeParse({ ...request, type: 'annual' }).success).toBe(true);
    expect(beneficiaryChangeRequestDocumentSchema.safeParse({ ...request, type: 'annual', status: 'done' }).success)
      .toBe(false);
  });

  it('defaults beneficiary state bookkeeping', () => {
    expect(beneficiaryStateDocumentSchema.parse({ version: 0 })).toMatchObject({
      version: 0, lastAnnualChangeYear: null, pendingRequestId: null,
    });
    expect(beneficiaryStateDocumentSchema.safeParse({ version: -1 }).success).toBe(false);
  });
});
