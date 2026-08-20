import * as admin from 'firebase-admin';
admin.initializeApp();

import * as Member from './members';
import * as Contribution from './contributions';
import * as Financial from './financial';
import * as Kcb from './kcb';
import * as Notifications from './notifications';

export const newMember = Member.newMember;
export const updateMember = Member.updateMember;
export const deleteMember = Member.deleteMember;

export const setMonthlyContributions = Contribution.setMonthlyContributions;
export const recordContributionPayment = Financial.recordContributionPayment;
export const reverseContributionPayment = Financial.reverseContributionPayment;
export const createContribution = Financial.createContribution;
export const adjustMemberBalance = Financial.adjustMemberBalance;
export const correctLegacyContribution = Financial.correctLegacyContribution;
export const reverseLegacyContributionCorrection = Financial.reverseLegacyContributionCorrection;
export const listLegacyContributionInventory = Financial.listLegacyContributionInventory;
export const removeContribution = Financial.removeContribution;
export const transitionMemberStatus = Financial.transitionMemberStatus;
export const deleteMemberSafely = Financial.deleteMemberSafely;
export const kcbTillNotification = Kcb.kcbTillNotification;
export const reconcileKcbPayment = Kcb.reconcileKcbPayment;
export const allocateKcbPaymentCredit = Kcb.allocateKcbPaymentCredit;
export const rejectKcbPayment = Kcb.rejectKcbPayment;
export const resolveKcbStkUnknownOutcome = Kcb.resolveKcbStkUnknownOutcome;
export const requestKcbStkPush = Kcb.requestKcbStkPush;
export const kcbStkCallback = Kcb.kcbStkCallback;
export const queueNotificationDeliveries = Notifications.queueNotificationDeliveries;
export const processNotificationOutbox = Notifications.processNotificationOutbox;
export const retryNotificationDelivery = Notifications.retryNotificationDelivery;
export const generateContributionReminders = Notifications.generateContributionReminders;
