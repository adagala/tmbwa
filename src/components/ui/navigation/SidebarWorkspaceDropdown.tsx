import { DropdownMenu, DropdownMenuTrigger } from "@/components/Dropdown";
import { cx, focusInput } from "@/lib/utils";
import { RiArrowRightSLine } from "@remixicon/react";
import React from "react";

export const WorkspacesDropdownDesktop = () => {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <>
      {/* sidebar (lg+) */}
      <DropdownMenu
        open={dropdownOpen}
        onOpenChange={setDropdownOpen}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            className={cx(
              "flex w-full items-center gap-x-2.5 rounded-md border border-gray-300 bg-white p-2 text-sm shadow-sm transition-all hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 hover:dark:bg-gray-900",
              focusInput
            )}
          >
            <span
              className="flex aspect-square size-8 items-center justify-center rounded bg-guardsman-red-600 p-2 text-xs font-medium text-white dark:bg-guardsman-red-500"
              aria-hidden="true"
            >
              YB
            </span>
            <div className="flex w-full items-center justify-between gap-x-4 truncate">
              <div className="truncate">
                <p className="truncate whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
                  MidBar Welfare
                </p>
                <p className="whitespace-nowrap text-left text-xs text-gray-700 dark:text-gray-300">
                  Member
                </p>
              </div>
            </div>
          </button>
        </DropdownMenuTrigger>
      </DropdownMenu>
    </>
  );
};

export const WorkspacesDropdownMobile = () => {
  return (
    <>
      {/* sidebar (xs-lg) */}
      <button className="flex items-center gap-x-1.5 rounded-md p-2 hover:bg-gray-100 focus:outline-none hover:dark:bg-gray-900">
        <span
          className={cx(
            "flex aspect-square size-7 items-center justify-center rounded bg-guardsman-red-600 p-2 text-xs font-medium text-white dark:bg-guardsman-red-500"
          )}
          aria-hidden="true"
        >
          YB
        </span>
        <RiArrowRightSLine
          className="size-4 shrink-0 text-gray-500"
          aria-hidden="true"
        />
        <div className="flex w-full items-center justify-between gap-x-3 truncate">
          <p className="truncate whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
            MidBar Welfare
          </p>
        </div>
      </button>
    </>
  );
};
