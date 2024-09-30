import { cx } from "@/lib/utils";
import React from "react";

interface AvatarProps extends React.ComponentPropsWithoutRef<"span"> {
  initial: string;
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ initial, className, ...props }: AvatarProps, ref) => {
    return (
      <span
        className={cx(
          "flex size-8 shrink-0 items-center font-semibold justify-center rounded-full border border-gray-300 bg-white text-xs text-guardsman-red-600 dark:border-gray-800 dark:bg-gray-950 dark:text-guardsman-red-300",
          className
        )}
        aria-hidden="true"
        {...props}
        ref={ref}
      >
        {initial}
      </span>
    );
  }
);

Avatar.displayName = "Avatar";

export { Avatar };
