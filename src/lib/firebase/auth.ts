import {
  signInWithEmailAndPassword as _signInWithEmailAndPassword,
  onAuthStateChanged as _onAuthStateChanged,
  NextOrObserver,
  User,
  sendPasswordResetEmail,
  updatePassword as _updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';

import { auth } from '@/lib/firebase/clientApp';
import { ResetPasswordSchema, UserSchema } from '@/schemas/user';

export const onAuthStateChanged = (cb: NextOrObserver<User>) =>
  _onAuthStateChanged(auth, cb);

export const signInWithEmailAndPassword = (params: UserSchema) =>
  _signInWithEmailAndPassword(auth, params.email, params.password);

export const resetPassword = (params: ResetPasswordSchema) =>
  sendPasswordResetEmail(auth, params.email);

export const updatePassword = (user: User, password: string) =>
  _updatePassword(user, password);

export const reauthenticateUser = (user: User, currentPassword: string) => {
  if (!user.email) {
    throw new Error('User email not provided');
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, credential);
};

export const signOut = () => auth.signOut();
