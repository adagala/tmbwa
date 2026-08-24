import { RiToolsLine } from '@remixicon/react';

export default function MaintenancePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gray-50 px-6 py-16 text-gray-950 antialiased dark:bg-gray-950 dark:text-gray-50">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-guardsman-red-500 via-gold-drop-500 to-guardsman-red-500"
      />
      <div className="relative w-full max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-drop-100 text-gold-drop-700 ring-8 ring-gold-drop-50 dark:bg-gold-drop-900/40 dark:text-gold-drop-300 dark:ring-gold-drop-950/50">
          <RiToolsLine aria-hidden="true" className="h-8 w-8" />
        </div>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-guardsman-red-600 dark:text-guardsman-red-300">
          TMBWA
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          System under maintenance
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 text-gray-600 dark:text-gray-300">
          We&apos;re carrying out scheduled maintenance. The member portal is
          temporarily unavailable and will be back online as soon as the work is
          complete.
        </p>
        <div className="mt-8 rounded-xl border border-gray-200 bg-white/70 px-5 py-4 text-sm text-gray-600 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-300">
          Thank you for your patience. Please try again later.
        </div>
      </div>
    </main>
  );
}
