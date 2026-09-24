import { RiBookOpenLine } from '@remixicon/react';
import { Card } from '@/components/Card';
import { MarkdownGuide } from '@/components/MarkdownGuide';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import useUser from '@/hooks/useUser';
import administratorGuide from '../../../docs/administrator-user-guide.md?raw';
import memberGuide from '../../../docs/member-user-guide.md?raw';

export default function UserGuidePage() {
  const { role } = useUser();
  const isAdministrator = role === 'administrator';

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="mt-6 flex items-start gap-3">
        <span className="rounded-lg bg-guardsman-red-50 p-2 text-guardsman-red-600 dark:bg-guardsman-red-950/30 dark:text-guardsman-red-400">
          <RiBookOpenLine aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-50">
            Help and user guides
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Step-by-step help for members and administrators.
          </p>
        </div>
      </div>

      <Tabs defaultValue="member">
        {isAdministrator ? (
          <TabsList
            variant="solid"
            aria-label="User guide type"
            className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto"
          >
            <TabsTrigger value="member">Member guide</TabsTrigger>
            <TabsTrigger value="administrator">Administrator guide</TabsTrigger>
          </TabsList>
        ) : null}
        <TabsContent value="member" className="mt-4">
          <Card className="mx-auto max-w-4xl p-5 sm:p-8">
            <MarkdownGuide markdown={memberGuide} />
          </Card>
        </TabsContent>
        {isAdministrator ? (
          <TabsContent value="administrator" className="mt-4">
            <Card className="mx-auto max-w-4xl p-5 sm:p-8">
              <MarkdownGuide markdown={administratorGuide} />
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
