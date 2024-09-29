import React from "react";
import { Contribution, Member, PaymentStatusEnum } from "@/schemas/member";
import { RiWalletLine, RiArrowRightSLine } from "@remixicon/react";
import { List, ListItem } from "@tremor/react";
import { DialogContributionDetails } from "@/components/ui/contributions/DialogContributionDetails";
import { Avatar } from "@/components/Avatar";

interface ContributionsProps extends React.ComponentPropsWithoutRef<"div"> {
  member: Member;
  contributions: Contribution[];
}

const Contributions = React.forwardRef<HTMLDivElement, ContributionsProps>(
  ({ contributions, member, className, ...props }: ContributionsProps, ref) => {
    const [open, setOpen] = React.useState(false);
    const [contribution, setContribution] = React.useState<Contribution>();
    return (
      <div className={className} {...props} ref={ref}>
        <div className="my-6 text-xl font-semibold flex items-center gap-1">
          <RiWalletLine className="size-5 shrink-0" aria-hidden="true" />
          Contribution History
        </div>
        <List className="mt-4">
          {contributions.map((contribution) => (
            <ListItem
              key={contribution.contribution_id}
              className="hover:bg-gray-50 dark:hover:bg-gray-900/60 px-2 dark:border-gray-800 cursor-pointer"
              onClick={() => {
                const _contribution: Contribution = {
                  ...member,
                  ...contribution,
                };
                setContribution(_contribution);
                setOpen(true);
              }}
            >
              <div className="flex min-w-0 gap-x-4">
                <Avatar
                  initial={new Date(contribution.month)
                    .toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                    })
                    .charAt(0)}
                />
                <div className="min-w-0 flex flex-auto items-center">
                  <p className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-200">
                    {new Date(contribution.month).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="shrink-0 flex items-center gap-2">
                  <div className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200 capitalize">
                    {contribution.amount - contribution.balance}
                  </div>
                  <div className="flex items-center gap-x-1.5 sm:min-w-16">
                    <div
                      className={`flex-none rounded-full ${
                        contribution.paid === PaymentStatusEnum.enum.paid
                          ? "bg-emerald-500/20"
                          : contribution.paid === PaymentStatusEnum.enum.partial
                            ? "bg-orange-300/20"
                            : "bg-red-500/20"
                      }  p-1`}
                    >
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${
                          contribution.paid === PaymentStatusEnum.enum.paid
                            ? "bg-emerald-500"
                            : contribution.paid ===
                                PaymentStatusEnum.enum.partial
                              ? "bg-orange-300"
                              : "bg-red-500"
                        }`}
                      ></div>
                    </div>
                    <p
                      className={`hidden sm:flex text-xs leading-5 font-medium ${
                        contribution.paid === PaymentStatusEnum.enum.paid
                          ? "text-emerald-500"
                          : contribution.paid === PaymentStatusEnum.enum.partial
                            ? "text-orange-300"
                            : "text-red-500"
                      } capitalize`}
                    >
                      {contribution.paid}
                    </p>
                  </div>
                </div>
                <RiArrowRightSLine className="size-6 text-gray-400" />
              </div>
            </ListItem>
          ))}
        </List>
        {contribution ? (
          <DialogContributionDetails
            contribution={contribution}
            open={open}
            setOpen={setOpen}
          />
        ) : null}
      </div>
    );
  }
);

Contributions.displayName = "Contributions";

export { Contributions };
