import * as admin from 'firebase-admin';
import { randomBytes } from 'node:crypto';
export const createBootstrapPassword = () => randomBytes(32).toString('base64url');

export const getCurrentMonth = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) {
    throw new Error('Unable to derive current Nairobi month.');
  }
  return `${year}-${month}-01`;
};

export const createIndex = (title: string) => {
  const arr = title.toLowerCase().split('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchableIndex: {
    [key: string]: boolean;
  } = {};

  let prevKey = '';

  for (const char of arr) {
    const key = prevKey + char;
    searchableIndex[key] = true;
    prevKey = key;
  }

  return searchableIndex;
};

export const deleteQueryBatch = async (
  query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData>,
  batchSize: number,
  resolve: () => void,
  reject: (error: Error) => void,
) => {
  try {
    const snapshot = await query.get();

    if (snapshot.empty) {
      resolve();
      return;
    }

    const batch = admin.firestore().batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    process.nextTick(() => {
      deleteQueryBatch(query, batchSize, resolve, reject);
    });
  } catch (error) {
    reject(error as unknown as Error);
  }
};

export const deleteCollection = ({
  collectionPath,
  batchSize = 500,
}: {
  collectionPath: string;
  batchSize?: number;
}): Promise<void> => {
  const collectionRef = admin.firestore().collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, batchSize, resolve, reject);
  });
};

export const deleteCollectionGroup = ({
  collectionName,
  batchSize = 500,
}: {
  collectionName: string;
  batchSize?: number;
}): Promise<void> => {
  const collectionGroupRef = admin.firestore().collectionGroup(collectionName);
  const query = collectionGroupRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, batchSize, resolve, reject);
  });
};

export const arrayToChunks = <T>(array: T[], size: number) =>
  Array.from({ length: Math.ceil(array.length / size) }, (_v, i) =>
    array.slice(i * size, i * size + size),
  );
