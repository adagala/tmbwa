import { FirebaseOptions } from 'firebase/app';
import { z } from 'zod';

const configSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string(),
  VITE_FIREBASE_PROJECT_ID: z.string(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string(),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string(),
  VITE_FIREBASE_APP_ID: z.string(),
  VITE_FIREBASE_MEASUREMENT_ID: z.string(),
});

const result = configSchema.safeParse(import.meta.env);
if (!result.success) {
  console.error(result.error);
  throw new Error('Invalid configuration');
}

const config: FirebaseOptions = {
  apiKey: result.data.VITE_FIREBASE_API_KEY,
  authDomain: result.data.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: result.data.VITE_FIREBASE_PROJECT_ID,
  storageBucket: result.data.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: result.data.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: result.data.VITE_FIREBASE_APP_ID,
  measurementId: result.data.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseConfig = config;
