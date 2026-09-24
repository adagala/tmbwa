import { RiArrowLeftLine, RiHome4Line, RiRefreshLine } from '@remixicon/react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';

import { Button } from '@/components/Button';

export default function RouteErrorPage() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  const heading = isNotFound
    ? 'We couldn’t find that stop.'
    : 'We hit an unexpected detour.';
  const description = isNotFound
    ? 'The page you are looking for may have moved, been renamed, or never existed. Choose a familiar route to continue.'
    : 'We could not load this page. Your data is safe—try the route again or return to the dashboard.';

  return (
    <main className="relative isolate grid min-h-screen grid-cols-1 content-center items-center gap-10 overflow-hidden bg-[#fffaf4] px-6 py-10 sm:px-10 lg:grid-cols-[minmax(20rem,32.5rem)_minmax(20rem,32.5rem)] lg:justify-center lg:gap-16 lg:px-16 xl:gap-24 dark:bg-gray-950">
      <div
        className="absolute inset-x-0 top-0 -z-10 h-1 bg-gradient-to-r from-guardsman-red-600 via-gold-drop-500 to-guardsman-red-600"
        aria-hidden="true"
      />

      <div
        className="relative mx-auto aspect-[1.12] w-full max-w-[32.5rem] overflow-hidden rounded-[1.625rem] border border-[#f1ded0] bg-gradient-to-br from-white from-50% to-[#fff5e9] shadow-[0_18px_50px_rgba(82,35,3,0.08)] dark:border-gray-800 dark:from-gray-900 dark:from-50% dark:to-gray-900/80 dark:shadow-black/30"
        aria-hidden="true"
      >
        <div className="absolute -left-[20%] top-[42%] h-[22%] w-[130%] -rotate-[35deg] border-y-[1.375rem] border-[#e9ded7] dark:border-gray-700">
          <div className="absolute inset-x-0 top-2 border-t-[3px] border-dashed border-white dark:border-gray-500" />
        </div>
        <span className="absolute left-6 top-8 rounded-md bg-white/90 px-2 py-1 text-[0.6875rem] text-[#8f7e74] shadow-sm dark:bg-gray-950/90 dark:text-gray-400">
          Dashboard
        </span>
        <span className="absolute bottom-8 right-6 rounded-md bg-white/90 px-2 py-1 text-[0.6875rem] text-[#8f7e74] shadow-sm dark:bg-gray-950/90 dark:text-gray-400">
          Members
        </span>
        <div className="absolute left-[52%] top-[38%] flex size-14 -rotate-45 items-center justify-center rounded-[50%_50%_50%_0.5rem] bg-guardsman-red-600 shadow-[0_10px_24px_rgba(184,3,12,0.28)] dark:bg-guardsman-red-500">
          <div className="rotate-45 text-2xl font-extrabold text-white">
            {isNotFound ? '?' : '!'}
          </div>
        </div>
      </div>

      <section
        className="mx-auto w-full max-w-[32.5rem]"
        aria-labelledby="error-title"
      >
        <p className="mb-0 text-xs font-bold uppercase tracking-[0.13em] text-guardsman-red-600 dark:text-guardsman-red-400">
          {isNotFound ? '404 · Wrong turn' : 'Unexpected error · Detour ahead'}
        </p>
        <h1
          id="error-title"
          className="mt-3 text-[2.375rem] font-bold leading-[1.06] tracking-[-0.04em] text-gray-950 sm:text-5xl lg:text-[3.5rem] dark:text-white"
        >
          {heading}
        </h1>
        <p className="mt-4 text-base leading-7 text-[#6e625c] dark:text-gray-400">
          {description}
        </p>

        <div className="mt-7 flex flex-col items-stretch gap-3 min-[420px]:flex-row min-[420px]:items-center">
          <Button asChild className="gap-2 px-5 py-2.5">
            <Link to="/">
              <RiHome4Line className="size-4" aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
          {isNotFound ? (
            <Button
              variant="secondary"
              className="gap-2 px-5 py-2.5"
              onClick={() => window.history.back()}
            >
              <RiArrowLeftLine className="size-4" aria-hidden="true" />
              Go back
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="gap-2 px-5 py-2.5"
              onClick={() => window.location.reload()}
            >
              <RiRefreshLine className="size-4" aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
