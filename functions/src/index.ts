import * as admin from 'firebase-admin';
admin.initializeApp();

import * as Member from './members';
import * as Contribution from './contributions';

export const newMember = Member.newMember;
export const updateMember = Member.updateMember;
export const deleteMember = Member.deleteMember;

export const setMonthlyContributions = Contribution.setMonthlyContributions;
