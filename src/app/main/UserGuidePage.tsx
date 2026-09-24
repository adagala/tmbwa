import { useMemo, useState } from 'react';
import { RiBookOpenLine, RiSearchLine } from '@remixicon/react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input } from '@/components/Input';
import { MarkdownGuide } from '@/components/MarkdownGuide';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import { cx } from '@/lib/utils';
import useUser from '@/hooks/useUser';
import administratorGuide from '../../../docs/administrator-user-guide.md?raw';
import memberGuide from '../../../docs/member-user-guide.md?raw';

export default function UserGuidePage() {
  const { role } = useUser();
  const isAdministrator = role === 'administrator';
  const [query, setQuery] = useState('');

  const memberSections = useMemo(() => parseGuideSections(memberGuide), []);
  const administratorSections = useMemo(
    () => parseGuideSections(administratorGuide),
    [],
  );

  return (
    <div className="pb-10">
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
        <div className="flex items-start gap-3">
          <span className="rounded-lg p-1 font-bold text-guardsman-red-600 dark:text-guardsman-red-400">
            <RiBookOpenLine aria-hidden="true" className="size-6" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-guardsman-red-600 dark:text-guardsman-red-400">
              User guide
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950 dark:text-gray-50">
              Find the answer you need
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Member and administrator guidance in one searchable handbook.
            </p>
          </div>
        </div>
        <Input
          type="search"
          aria-label="Search user guide"
          placeholder="Search payments, receipts, statements…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          inputClassName="h-11"
        />
      </div>

      <Tabs
        defaultValue="member"
        className="mt-6"
        onValueChange={() => setQuery('')}
      >
        {isAdministrator ? (
          <TabsList
            variant="solid"
            aria-label="User guide type"
            className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto"
          >
            <TabsTrigger value="member">Member Guide</TabsTrigger>
            <TabsTrigger value="administrator">Administrator Guide</TabsTrigger>
          </TabsList>
        ) : null}
        <TabsContent value="member" className="mt-5">
          <GuideHandbook
            guide={memberSections}
            query={query}
            onClearSearch={() => setQuery('')}
          />
        </TabsContent>
        {isAdministrator ? (
          <TabsContent value="administrator" className="mt-5">
            <GuideHandbook
              guide={administratorSections}
              query={query}
              onClearSearch={() => setQuery('')}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

type GuideSection = {
  id: string;
  title: string;
  markdown: string;
  searchableText: string;
};

type ParsedGuide = {
  introduction: string;
  sections: GuideSection[];
};

const toSectionId = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const parseGuideSections = (markdown: string): ParsedGuide => {
  const lines = markdown.split('\n');
  const firstSectionIndex = lines.findIndex((line) => line.startsWith('## '));
  const introduction = lines.slice(1, firstSectionIndex).join('\n').trim();
  const sections: GuideSection[] = [];
  let currentLines: string[] = [];

  const addSection = () => {
    if (!currentLines.length) return;
    const title = currentLines[0].replace(/^##\s+/, '');
    const sectionMarkdown = currentLines.join('\n').trim();
    sections.push({
      id: toSectionId(title),
      title,
      markdown: sectionMarkdown,
      searchableText: sectionMarkdown
        .replace(/[#*_`]/g, '')
        .toLocaleLowerCase(),
    });
  };

  lines.slice(firstSectionIndex).forEach((line) => {
    if (line.startsWith('## ')) {
      addSection();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  });
  addSection();

  return { introduction, sections };
};

function GuideHandbook({
  guide,
  query,
  onClearSearch,
}: {
  guide: ParsedGuide;
  query: string;
  onClearSearch: () => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSections = normalizedQuery
    ? guide.sections.filter((section) =>
        section.searchableText.includes(normalizedQuery),
      )
    : guide.sections;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <Card className="p-2 lg:sticky lg:top-6">
        <nav aria-label="Guide topics">
          <p className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Topics
          </p>
          <div className="space-y-1">
            {guide.sections.map((section) => {
              const matchesSearch = visibleSections.some(
                (visibleSection) => visibleSection.id === section.id,
              );
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-disabled={!matchesSearch}
                  className={cx(
                    'block rounded-md px-3 py-2 text-[13px] font-medium leading-5 transition',
                    matchesSearch
                      ? 'border-l-2 border-transparent text-gray-700 hover:border-guardsman-red-600 hover:bg-guardsman-red-50/20 hover:text-guardsman-red-700 focus-visible:border-guardsman-red-600 focus-visible:bg-guardsman-red-50/20 focus-visible:text-guardsman-red-700 dark:text-gray-300 dark:hover:border-guardsman-red-300 dark:hover:bg-guardsman-red-400/15 dark:hover:text-guardsman-red-50 dark:focus-visible:border-guardsman-red-300 dark:focus-visible:bg-guardsman-red-400/15 dark:focus-visible:text-guardsman-red-50'
                      : 'pointer-events-none text-gray-300 dark:text-gray-700',
                  )}
                >
                  {section.title}
                </a>
              );
            })}
          </div>
        </nav>
      </Card>

      <div className="min-w-0 space-y-4">
        {!normalizedQuery ? (
          <Card className="p-5 sm:p-6">
            <MarkdownGuide markdown={guide.introduction} />
          </Card>
        ) : null}

        {visibleSections.map((section) => (
          <Card asChild key={section.id} className="scroll-mt-6 p-5 sm:p-7">
            <section id={section.id}>
              <MarkdownGuide markdown={section.markdown} />
            </section>
          </Card>
        ))}

        {visibleSections.length === 0 ? (
          <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
            <span className="mb-4 rounded-full bg-guardsman-red-50 p-3 text-guardsman-red-600 dark:bg-guardsman-red-950 dark:text-guardsman-red-400">
              <RiSearchLine aria-hidden="true" className="size-6" />
            </span>
            <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-50">
              No guide topics found
            </h2>
            <p className="mt-2 max-w-md text-sm text-gray-600 dark:text-gray-400">
              Try a different word or clear the search to browse every topic.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-5"
              onClick={onClearSearch}
            >
              Clear search
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
