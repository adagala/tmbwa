import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { RulesTestEnvironment, assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

// Statement PDFs (#94) are written by Functions only; clients have no Storage
// access at all.
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-tmbwa',
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), 'kcb_statements/hash.pdf'), new Uint8Array([37, 80, 68, 70]));
  });
});

afterAll(async () => testEnv.cleanup());

describe('Storage rules', () => {
  it('denies every client read and write, whatever the role', async () => {
    for (const context of [
      testEnv.unauthenticatedContext(),
      testEnv.authenticatedContext('member-a', { roles: ['member'] }),
      testEnv.authenticatedContext('admin', { roles: ['super_admin'] }),
      testEnv.authenticatedContext('treasurer', { roles: ['treasurer'] }),
    ]) {
      const storage = context.storage();
      await assertFails(getBytes(ref(storage, 'kcb_statements/hash.pdf')));
      await assertFails(uploadBytes(ref(storage, 'kcb_statements/other.pdf'), new Uint8Array([37, 80, 68, 70])));
    }
  });
});
