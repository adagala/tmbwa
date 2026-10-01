import {
  AppOptions,
  applicationDefault,
  getApps,
  initializeApp as initializeFirebaseApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';

const initializeApp = (options?: AppOptions) =>
  getApps()[0] ?? initializeFirebaseApp(options);

const firestore = Object.assign(getFirestore, {
  FieldPath,
  FieldValue,
  Timestamp,
});

/**
 * Compatibility facade for the pre-v14 Firebase Admin namespace API.
 *
 * Firebase Admin v14 exposes services from modular entry points. Keeping the
 * facade here lets the existing handlers migrate without changing their
 * financial behavior, while retaining the SDK's inferred Firestore types.
 */
export const admin = {
  auth: getAuth,
  credential: { applicationDefault },
  firestore,
  initializeApp,
};

export { Timestamp };
