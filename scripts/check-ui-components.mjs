import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const prohibited = [
  'button',
  'input',
  'select',
  'option',
  'textarea',
  'label',
  'table',
];
const files = [];
const walk = (directory) =>
  readdirSync(directory).forEach((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.tsx')) files.push(path);
  });
walk(root);

const violations = [];
for (const file of files) {
  const local = relative(root, file);
  // Shared primitive implementations are the only approved native-control boundary.
  if (dirname(local) === 'components') continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (/from\s+['\"]@tremor\/react['\"]/.test(line)) {
      violations.push(
        `${local.split(sep).join('/')}:${index + 1} imports @tremor/react directly; import through src/components instead.`,
      );
    }
  });
  lines.forEach((line, index) =>
    prohibited.forEach((tag) => {
      if (new RegExp(`<${tag}\\b`).test(line)) {
        violations.push(
          `${local.split(sep).join('/')}:${index + 1} uses <${tag}>; use src/components/${tag === 'table' ? 'Table' : tag[0].toUpperCase() + tag.slice(1)}.`,
        );
      }
    }),
  );
}

if (violations.length) {
  console.error(
    [
      'UI implementations and vendor components must use the src/components boundary:',
      ...violations,
    ].join('\n'),
  );
  process.exit(1);
}
console.log('Shared UI component boundary verified.');
