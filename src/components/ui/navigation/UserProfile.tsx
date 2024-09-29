import { Button } from "@/components/Button";
import { cx, focusRing, getMemberInitials } from "@/lib/utils";
import { RiMore2Fill } from "@remixicon/react";

import { DropdownUserProfile } from "./DropdownUserProfile";
import useUser from "@/hooks/useUser";
import { Avatar } from "@/components/Avatar";

export const UserProfileDesktop = () => {
  const { user } = useUser();
  return (
    <DropdownUserProfile>
      <Button
        aria-label="User settings"
        variant="ghost"
        className={cx(
          focusRing,
          "group flex w-full items-center justify-between rounded-md p-2 text-sm font-medium text-gray-900 hover:bg-gray-100 data-[state=open]:bg-gray-100 data-[state=open]:bg-gray-400/10 hover:dark:bg-gray-400/10"
        )}
      >
        <span className="flex items-center gap-3">
          <Avatar initial={getMemberInitials(user?.displayName)} />
          <span className="text-guardsman-red-600">{user?.displayName}</span>
        </span>
        <RiMore2Fill
          className="size-4 shrink-0 text-gray-500 group-hover:text-gray-700 group-hover:dark:text-gray-400"
          aria-hidden="true"
        />
      </Button>
    </DropdownUserProfile>
  );
};

export const UserProfileMobile = () => {
  const { user } = useUser();
  return (
    <DropdownUserProfile align="end">
      <Button
        aria-label="User settings"
        variant="ghost"
        className={cx(
          "group flex items-center rounded-md p-1 text-sm font-medium text-gray-900 hover:bg-gray-100 data-[state=open]:bg-gray-100 data-[state=open]:bg-gray-400/10 hover:dark:bg-gray-400/10"
        )}
      >
        <Avatar initial={getMemberInitials(user?.displayName)} className="size-7" />
      </Button>
    </DropdownUserProfile>
  );
};
