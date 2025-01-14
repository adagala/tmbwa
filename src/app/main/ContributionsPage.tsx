import React from 'react';
import {
  RiArrowRightSLine,
  RiLoaderLine,
  RiSafe2Line,
  RiWalletLine,
} from '@remixicon/react';
import { List, ListItem } from '@tremor/react';
import { Input } from '@/components/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/Select';
import { Button } from '@/components/Button';
import { DialogContributionDetails } from '@/components/ui/contributions/DialogContributionDetails';
import {
  Contribution,
  PaymentStatus,
  ContributionStatusEnum,
  contribution_status,
} from '@/schemas/member';
import { getMonthlyMembersContributions } from '@/lib/firebase/firestore';
import { getMonth, months, years } from '@/lib/utils';
import debounce from 'lodash.debounce';
import { Avatar } from '@/components/Avatar';

const currentYear = new Date().getFullYear().toString();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

export default function ContributionsPage() {
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus | ''>(
    '',
  );
  const [open, setOpen] = React.useState(false);
  const [contribution, setContribution] = React.useState<Contribution>();
  const [contributions, setContributions] = React.useState<Contribution[]>([]);
  const [allContributions, setAllContributions] = React.useState<
    Contribution[]
  >([]);
  const [month, setMonth] = React.useState(currentMonth);
  const [year, setYear] = React.useState(currentYear);
  const [isLoading, setIsLoading] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState('');
  const [querySearch, setQuerySearch] = React.useState('');

  React.useEffect(() => {
    setIsLoading(true);
    const selectedMonth = getMonth(`${year}-${month}-01`);
    const unsubscribe = getMonthlyMembersContributions(
      (contributions) => {
        if (querySearch.length < 1 && paymentStatus === '') {
          setContributions(contributions);
        }
        setAllContributions(contributions);
        setIsLoading(false);
        const _contribution = contributions.find(
          (cont) => cont.member_id === contribution?.member_id,
        );
        setContribution(_contribution);
      },
      { month: selectedMonth },
    );
    return () => unsubscribe();
  }, [month, year]);

  const debouncedSearch = React.useCallback(
    debounce((query: string) => setQuerySearch(query), 500),
    [],
  );

  React.useEffect(() => {
    debouncedSearch(searchValue);

    return () => {
      debouncedSearch.cancel();
    };
  }, [searchValue, debouncedSearch]);

  React.useEffect(() => {
    if (querySearch.length < 1 && paymentStatus === '') {
      setContributions(allContributions);
    } else {
      const filteredContributions = allContributions.filter((contribution) => {
        const regex = new RegExp(querySearch, 'gi');
        const isNameMatch =
          contribution.firstname.match(regex) ||
          contribution.lastname.match(regex);
        const isEmailMatch = contribution.email.match(regex);
        const isWinMatch =
          querySearch.length < 1 ? true : contribution.win === querySearch;
        const isPaymentMatch = !paymentStatus
          ? true
          : contribution.paid === paymentStatus;
        return (isNameMatch || isEmailMatch || isWinMatch) && isPaymentMatch;
      });
      setContributions(filteredContributions);
    }
  }, [querySearch, paymentStatus]);

  return (
    <div className="flex flex-col gap-6 h-auto">
      <div className="flex justify-between mt-6 font-bold">
        <div className="flex items-center gap-1 text-xl text-guardsman-red-600">
          <RiWalletLine className="size-6 shrink-0" aria-hidden="true" />
          Contributions
        </div>
        <div className="">{/* <DialogMemberContributionForm /> */}</div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="">
          <Input
            placeholder="Search members"
            id="search"
            name="search"
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex flex-col gap-2 sm:flex-row">
            <Select
              name="paymentStatus"
              value={paymentStatus}
              onValueChange={(value) =>
                setPaymentStatus(value as PaymentStatus)
              }
            >
              <SelectTrigger
                id="paymentstatus"
                name="paymentstatus"
                className="capitalize"
              >
                <SelectValue
                  placeholder="Payment Status"
                  aria-label={paymentStatus}
                />
              </SelectTrigger>
              <SelectContent>
                {contribution_status.map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    className="capitalize"
                  >
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 flex gap-3">
            <div className="flex-1">
              <Select
                name="year"
                value={year}
                onValueChange={(value) => {
                  setSearchValue('');
                  setQuerySearch('');
                  setPaymentStatus('');
                  setYear(value);
                }}
              >
                <SelectTrigger id="year" name="year" className="capitalize">
                  <SelectValue placeholder="Year" aria-label={year} />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year} className="capitalize">
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Select
                name="month"
                value={month}
                onValueChange={(value) => {
                  setSearchValue('');
                  setQuerySearch('');
                  setPaymentStatus('');
                  setMonth(value);
                }}
              >
                <SelectTrigger id="month" name="month" className="capitalize">
                  <SelectValue placeholder="Month" aria-label={month} />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem
                      key={month.value}
                      value={month.value}
                      className="capitalize"
                    >
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="col-span-full flex justify-end gap-2">
          <Button
            className="h-10 whitespace-nowrap"
            variant="secondary"
            onClick={() => {
              setYear(currentYear);
              setMonth(currentMonth);
              setSearchValue('');
              setQuerySearch('');
              setPaymentStatus('');
            }}
          >
            Reset filter
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center items-center h-96">
          <div className="flex flex-col items-center space-y-3">
            <RiLoaderLine className="size-6 animate-spin" />
            <div className="font-medium">Loading Contributions</div>
          </div>
        </div>
      ) : (
        <>
          {contributions.length > 0 ? (
            <>
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-200 ml-2">
                {contributions.length} Member
                {contributions.length === 1 ? '' : 's'}
              </div>
              <List>
                {contributions.map((contribution) => (
                  <ListItem
                    key={contribution.member_id}
                    className="hover:bg-gray-50 hover:dark:bg-gray-400/10 px-2 cursor-pointer dark:border-gray-800"
                    onClick={() => {
                      setContribution(contribution);
                      setOpen(true);
                    }}
                  >
                    <div className="flex min-w-0 gap-x-4">
                      <Avatar
                        initial={`${contribution.firstname.charAt(0)}${contribution.lastname.charAt(0)}`}
                      />
                      <div className="min-w-0 flex-auto">
                        <p className="text-sm font-semibold leading-6 text-gray-900 dark:text-gray-200">
                          {contribution.firstname} {contribution.lastname}
                        </p>
                        <p className="truncate text-xs leading-5 text-gray-500 dark:text-gray-400">
                          {contribution.email}
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
                              contribution.paid ===
                              ContributionStatusEnum.Enum.paid
                                ? 'bg-emerald-500/20'
                                : contribution.paid ===
                                    ContributionStatusEnum.Enum.partial
                                  ? 'bg-orange-300/20'
                                  : 'bg-red-500/20'
                            } p-1`}
                          >
                            <div
                              className={`h-1.5 w-1.5 rounded-full ${
                                contribution.paid ===
                                ContributionStatusEnum.Enum.paid
                                  ? 'bg-emerald-500'
                                  : contribution.paid ===
                                      ContributionStatusEnum.Enum.partial
                                    ? 'bg-orange-300'
                                    : 'bg-red-500'
                              }`}
                            ></div>
                          </div>
                          <p
                            className={`hidden sm:flex text-xs leading-5 font-medium ${
                              contribution.paid ===
                              ContributionStatusEnum.Enum.paid
                                ? 'text-emerald-500'
                                : contribution.paid ===
                                    ContributionStatusEnum.Enum.partial
                                  ? 'text-orange-300'
                                  : 'text-red-500'
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
            </>
          ) : (
            <div className="flex justify-center items-center h-96">
              <div className="flex flex-col items-center space-y-3">
                <RiSafe2Line className="size-8" />
                <div className="font-medium">No Contributions</div>
              </div>
            </div>
          )}
        </>
      )}
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
