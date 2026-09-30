import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { cert } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';
import { UserRecord } from 'firebase-admin/auth';
import { memberDocumentSchema } from 'tmbwa-shared';
import { admin } from '../../firebaseAdmin';
import { arrayToChunks } from '../../utils';

// Read-only: reports members whose data is missing or inaccurate. Nothing is written to Firestore or Auth.
// in functions directory use like:
//   ~ npm run validate:members -- [--credentials <service-account.json>] [--out <path>] [--skip-auth]
// Without --credentials, application default credentials are used.
// Keep the service-account file outside the repository; never commit it.
// The report contains member personal data; the default location (lib-scripts/) is gitignored.
const CREDENTIALS_FLAG = '--credentials';
const OUT_FLAG = '--out';
const SKIP_AUTH_FLAG = '--skip-auth';
const DEFAULT_OUT = 'lib-scripts/reports/member-validation-report.json';
const KENYAN_MOBILE = /^\+254[17]\d{8}$/;
const TEXT_FIELDS = [
  'firstname',
  'lastname',
  'membernumber',
  'win',
  'phonenumber',
  'email',
] as const;
const UNIQUE_FIELDS: Record<string, (value: string) => string> = {
  membernumber: (value) => value.trim(),
  win: (value) => value.trim().toUpperCase(),
  email: (value) => value.trim().toLowerCase(),
  phonenumber: (value) => value.replace(/\D/g, ''),
};

type MemberIssues = {
  member_id: string;
  name: string;
  membernumber: string;
  issues: string[];
};

const argValue = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const credentialsPath = argValue(CREDENTIALS_FLAG);
admin.initializeApp({
  credential: credentialsPath ?
    cert(resolve(credentialsPath)) :
    admin.credential.applicationDefault(),
});

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const validateDocument = (data: Record<string, unknown>) => {
  const issues: string[] = [];

  const result = memberDocumentSchema.safeParse(data);
  if (!result.success) {
    result.error.issues.forEach((issue) => {
      const field = issue.path.join('.') || 'document';
      const value = issue.path.length ? data[String(issue.path[0])] : undefined;
      issues.push(
        value === undefined ?
          `${field}: missing` :
          `${field}: ${issue.message} (found ${JSON.stringify(value)})`,
      );
    });
  }

  TEXT_FIELDS.forEach((field) => {
    const value = data[field];
    if (typeof value === 'string' && value && value !== value.trim()) {
      issues.push(`${field}: has leading/trailing whitespace`);
    }
  });

  const phone = data.phonenumber;
  if (typeof phone === 'string' && phone && !KENYAN_MOBILE.test(phone)) {
    issues.push(
      `phonenumber: must be a Kenyan mobile in +2547XXXXXXXX/+2541XXXXXXXX format (found ${JSON.stringify(phone)})`,
    );
  }

  if (
    !(data.datejoined instanceof Timestamp) &&
    !(data.createat instanceof Timestamp)
  ) {
    issues.push('datejoined/createat: no valid join date');
  }

  return issues;
};

const findDuplicates = (
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  report: Map<string, MemberIssues>,
) => {
  Object.entries(UNIQUE_FIELDS).forEach(([field, normalize]) => {
    const groups = new Map<string, string[]>();
    docs.forEach((doc) => {
      const value = text(doc.get(field));
      if (!value.trim()) return;
      const key = normalize(value);
      groups.set(key, [...(groups.get(key) ?? []), doc.id]);
    });
    groups.forEach((memberIds) => {
      if (memberIds.length < 2) return;
      memberIds.forEach((memberId) => {
        const others = memberIds.filter((id) => id !== memberId).join(', ');
        report.get(memberId)?.issues.push(`${field}: duplicated by ${others}`);
      });
    });
  });
};

const validateAuthUsers = async (
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  report: Map<string, MemberIssues>,
) => {
  const users = new Map<string, UserRecord>();
  for (const chunk of arrayToChunks(docs, 100)) {
    const result = await admin
      .auth()
      .getUsers(chunk.map((doc) => ({ uid: doc.id })));
    result.users.forEach((user) => users.set(user.uid, user));
  }

  docs.forEach((doc) => {
    const issues = report.get(doc.id)?.issues;
    if (!issues) return;
    const user = users.get(doc.id);
    if (!user) {
      issues.push('auth: no Firebase Auth user for this member');
      return;
    }
    const email = text(doc.get('email')).trim().toLowerCase();
    if (email && user.email?.toLowerCase() !== email) {
      issues.push(`auth: email out of sync (auth has ${JSON.stringify(user.email ?? null)})`);
    }
    const phone = text(doc.get('phonenumber'));
    if (phone && user.phoneNumber !== phone) {
      issues.push(`auth: phone out of sync (auth has ${JSON.stringify(user.phoneNumber ?? null)})`);
    }
    const displayName = `${text(doc.get('firstname'))} ${text(doc.get('lastname'))}`;
    if (user.displayName !== displayName) {
      issues.push(`auth: display name out of sync (auth has ${JSON.stringify(user.displayName ?? null)})`);
    }
    const role = doc.get('role');
    if (role && user.customClaims?.role !== role) {
      issues.push(`auth: role claim out of sync (auth has ${JSON.stringify(user.customClaims?.role ?? null)})`);
    }
  });
};

const validateMembers = async () => {
  const skipAuth = process.argv.includes(SKIP_AUTH_FLAG);
  const outPath = resolve(argValue(OUT_FLAG) ?? DEFAULT_OUT);

  const snapshot = await admin.firestore().collection('members').get();
  const report = new Map<string, MemberIssues>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    report.set(doc.id, {
      member_id: doc.id,
      name: `${text(data.firstname)} ${text(data.lastname)}`.trim(),
      membernumber: text(data.membernumber),
      issues: validateDocument(data),
    });
  });

  findDuplicates(snapshot.docs, report);
  if (!skipAuth) await validateAuthUsers(snapshot.docs, report);

  const invalid = [...report.values()]
    .filter((member) => member.issues.length)
    .sort((a, b) => a.name.localeCompare(b.name));

  const issueCounts = new Map<string, number>();
  invalid.forEach((member) =>
    member.issues.forEach((issue) => {
      const field = issue.split(':')[0];
      issueCounts.set(field, (issueCounts.get(field) ?? 0) + 1);
    }),
  );

  invalid.forEach((member) => {
    console.log(`\n${member.name || '(no name)'} [${member.membernumber || 'no admission number'}] members/${member.member_id}`);
    member.issues.forEach((issue) => console.log(`  - ${issue}`));
  });

  console.log(`\nChecked ${snapshot.size} members; ${invalid.length} need fixing.`);
  if (skipAuth) console.log('Auth checks skipped.');
  if (issueCounts.size) {
    console.log('Issues by field:');
    [...issueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([field, count]) => console.log(`  ${field}: ${count}`));
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        checked: snapshot.size,
        invalidCount: invalid.length,
        authChecked: !skipAuth,
        members: invalid,
      },
      null,
      2,
    ),
  );
  console.log(`Report written to ${outPath}`);
};

validateMembers()
  .then(() => console.log('DONE'))
  .catch((err) => {
    console.error('error :: ', err);
    process.exitCode = 1;
  });
