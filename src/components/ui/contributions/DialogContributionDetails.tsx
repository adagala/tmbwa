import React from 'react';
import { Button } from '@/components/Button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/Dialog';
import { Contribution, Member } from 'tmbwa-shared/firebase';
import { ContributionStatusEnum, FirebaseTimestamp } from 'tmbwa-shared';
import { Badge } from '@/components/Badge';
import { Label } from '@/components/Label';
import { RiCoinsLine, RiSafe2Line, RiShoppingBag3Line } from '@remixicon/react';
import { DialogDeleteContributionPayment } from './DialogDeleteContributionPayment';
import { DialogLegacyContributionCorrection } from './DialogLegacyContributionCorrection';
import useUser from '@/hooks/useUser';
import { DialogDeleteContribution } from './DialogDeleteContribution';
import { DialogReverseLegacyCorrection } from './DialogReverseLegacyCorrection';

export const DialogContributionDetails = ({
  contribution,
  member,
  open,
  setOpen,
}: {
  open: boolean;
  contribution: Contribution;
  member?: Member;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const { role } = useUser();
  const payments = contribution?.payments || [];
  const reversedCorrectionIds = new Set(
    contribution.legacy_corrections
      .filter((correction) => correction.type === 'reversal')
      .map((correction) => correction.correctionId),
  );
  return (
    <>
      <div className="flex justify-center">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild></DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex gap-1 items-center">
                <RiShoppingBag3Line
                  className="size-5 shrink-0"
                  aria-hidden="true"
                />
                Contribution details
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-6 space-y-6">
                <div>
                  <div className="mt-3 border-t border-gray-100 dark:border-gray-800">
                    <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
                          Contributor
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
                          {contribution?.firstname} {contribution?.lastname}
                        </dd>
                      </div>
                      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
                          Status
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0 capitalize">
                          <Badge
                            variant={
                              contribution?.paid ===
                              ContributionStatusEnum.Enum.paid
                                ? 'success'
                                : contribution?.paid ===
                                    ContributionStatusEnum.Enum.partial
                                  ? 'warning'
                                  : 'error'
                            }
                          >
                            {contribution?.paid}
                          </Badge>
                        </dd>
                      </div>
                      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
                          Month
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0 capitalize">
                          {contribution
                            ? new Date(contribution?.month)?.toLocaleDateString(
                                'en-US',
                                {
                                  year: 'numeric',
                                  month: 'long',
                                },
                              )
                            : '-'}
                        </dd>
                      </div>
                      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
                          Amount
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
                          KES {contribution?.amount}
                        </dd>
                      </div>
                      <div className="px-4 py-3 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                        <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">
                          Balance due
                        </dt>
                        <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300 sm:col-span-2 sm:mt-0">
                          KES {contribution?.balance}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="text-base font-medium text-black dark:text-gray-200 flex items-center justify-between gap-1">
                  <div className="flex items-center">
                    <RiCoinsLine
                      className="size-5 shrink-0"
                      aria-hidden="true"
                    />
                    Payment details
                  </div>
                  {role === 'administrator' ? (
                    <DialogLegacyContributionCorrection
                      contribution={contribution}
                    />
                  ) : (
                    <></>
                  )}
                </div>

                {contribution && (payments?.length || 0) > 0 ? (
                  payments.map((payment) => (
                    <div
                      key={payment.payment_id}
                      className="mt-3 border-t border-gray-100 dark:border-gray-800 relative"
                    >
                      {role === 'administrator' ? (
                        <DialogDeleteContributionPayment
                          contribution={contribution}
                          payment={payment}
                        />
                      ) : (
                        <></>
                      )}
                      <dl className="divide-y divide-gray-100 dark:divide-gray-800 mt-1">
                        <div className="px-4 py-0.5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200">
                            Reference number
                          </dt>
                          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-400 sm:col-span-2 sm:mt-0">
                            {payment.referencenumber}
                          </dd>
                        </div>
                      </dl>
                      <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                        <div className="px-4 py-0.5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200">
                            Allocated amount
                          </dt>
                          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-400 sm:col-span-2 sm:mt-0">
                            KES {payment.contribution_amount}
                          </dd>
                        </div>
                      </dl>
                      <dl className="divide-y divide-gray-100 dark:divide-gray-800">
                        <div className="px-4 py-0.5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                          <dt className="text-sm font-medium leading-6 text-gray-900 dark:text-gray-200">
                            Payment date
                          </dt>
                          <dd className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-400 sm:col-span-2 sm:mt-0">
                            {new Date(
                              (payment.paymentdate as FirebaseTimestamp)
                                .seconds * 1000,
                            ).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: '2-digit',
                            })}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))
                ) : (
                  <div className="flex justify-center">
                    <div className="flex flex-col items-center gap-1.5 text-gray-500 dark:text-gray-200">
                      <RiSafe2Line className="size-6" aria-hidden="true" />
                      <Label>No payments made.</Label>
                    </div>
                  </div>
                )}

                {contribution.legacy_corrections.length > 0 ? (
                  <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      Legacy correction history
                    </div>
                    {contribution.legacy_corrections.map(
                      (correction, index) => (
                        <div
                          key={`${correction.correctionId}-${correction.type}-${index}`}
                          className="rounded-md bg-amber-50 p-3 text-sm text-amber-950"
                        >
                          <div className="font-medium capitalize">
                            {correction.type === 'reversal'
                              ? 'Correction reversed'
                              : 'Legacy correction'}
                          </div>
                          <div>{correction.reason}</div>
                          <div>
                            Financial delta: {correction.delta > 0 ? '+' : ''}
                            KES {correction.delta}
                          </div>
                          <div className="text-xs">
                            Reference: {correction.correctionId}
                          </div>
                          {role === 'administrator' &&
                          correction.type === 'correction' &&
                          !reversedCorrectionIds.has(
                            correction.correctionId,
                          ) ? (
                            <DialogReverseLegacyCorrection
                              memberId={contribution.member_id}
                              correctionId={correction.correctionId}
                            />
                          ) : null}
                        </div>
                      ),
                    )}
                  </div>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-6">
              {member && role === 'administrator' ? (
                <DialogDeleteContribution
                  contribution={contribution}
                  member={member}
                />
              ) : null}
              <DialogClose asChild>
                <Button
                  className="mt-2 w-full sm:mt-0 sm:w-fit"
                  variant="secondary"
                >
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};
