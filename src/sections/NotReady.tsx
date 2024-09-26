import { Button } from '@/components/Button';
import { ArrowAnimated } from '@/components/ui/icons/ArrowAnimated';
import { Placeholder } from '@/components/ui/icons/Placeholder';

export default function NotReady({ page }: { page: string }) {
  return (
    <div className="mt-4 sm:mt-6 lg:mt-10">
      <div className="my-40 flex w-full flex-col items-center justify-center">
        <Placeholder className="size-20 shrink-0" aria-hidden="true" />
        <h2 className="mt-6 text-lg font-semibold sm:text-xl">
          {page} is not ready.
        </h2>
        <p className="mt-3 max-w-md text-center text-gray-500">
          Please visit this page later.
        </p>
        <p className="mt-3 max-w-md text-center text-gray-500">
          Contact the administrator using the email below in case of any
          queries.
        </p>
        <Button className="group mt-6" variant="secondary">
          adagalahenry@gmail.com
          <ArrowAnimated
            className="stroke-gray-900 dark:stroke-gray-50"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  );
}
