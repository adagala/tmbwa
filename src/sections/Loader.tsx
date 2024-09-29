import { RiLoaderLine } from '@remixicon/react';

export default function Loader() {
  return (
    <div className="h-[100vh]">
      <div className="flex w-full h-full flex-col items-center justify-center">
        <RiLoaderLine className="size-10 animate-spin" />
        <h2 className="mt-6 text-lg font-bold text-guardsman-red-600 sm:text-xl">
          The MidBar Welfare Association
        </h2>
        <p className="mt-3 max-w-md font-medium text-center text-gray-500">
          Loading the application.
        </p>
      </div>
    </div>
  );
}
