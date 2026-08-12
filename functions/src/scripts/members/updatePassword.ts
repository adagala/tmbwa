import * as admin from 'firebase-admin';
import * as readline from 'readline';

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

// in functions directory use like:  ~ npm run build:scripts && node lib-scripts/scripts/members/updatePassword.js
const updatePassword = async () => {
  console.log('Start updatePassword ...!');

  const uid = await askQuestion('Enter UID: ');
  const password = await askQuestion('Enter new password: ');

  await admin.auth().updateUser(uid, { password });
  console.log(`Successfully updated user password for UID: ${uid}`);
  console.log({ uid, password });

  rl.close();
  console.log('End of operation updatePassword ...!');
};

updatePassword()
  .then(() => console.log('DONE'))
  .catch((err) => {
    console.log('error :: ', err);
    rl.close();
  });
