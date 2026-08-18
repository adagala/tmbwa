import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Navigate } from 'react-router-dom';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import useUser from '@/hooks/useUser';
import { db } from '@/lib/firebase/clientApp';
import {
  ContributionOption,
  contributionOptionsFromDocuments,
} from '@/lib/kcbReconciliation';
import {
  allocateKcbPaymentCredit,
  KcbPaymentNotification,
  reconcileKcbPayment,
  rejectKcbPayment,
  sendKcbDevTillNotification,
  subscribeToKcbPaymentsWithCredit,
  subscribeToUnresolvedKcbPayments,
} from '@/lib/firebase/kcb';
import { Member, parseMemberDocument } from 'tmbwa-shared/firebase';

const devSimulatorEnabled =
  import.meta.env.VITE_APP_ENV === 'development' &&
  import.meta.env.VITE_KCB_DEV_MOCK_ENABLED === 'true';

type AllocationDraft = { id: string; contributionId: string; amount: string };

const AllocationEditor = ({
  receiptAmount,
  options,
  rows,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: {
  receiptAmount: number;
  options: ContributionOption[];
  rows: AllocationDraft[];
  disabled: boolean;
  onAdd: () => void;
  onChange: (id: string, patch: Partial<AllocationDraft>) => void;
  onRemove: (id: string) => void;
}) => {
  const allocated = rows.reduce(
    (sum, row) => sum + (Number(row.amount) || 0),
    0,
  );
  return (
    <div className="space-y-3 sm:col-span-2">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <select
            aria-label="Contribution month"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            value={row.contributionId}
            disabled={disabled}
            onChange={(event) =>
              onChange(row.id, { contributionId: event.target.value })
            }
          >
            <option value="">Choose contribution</option>
            {options.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={rows.some(
                  (other) =>
                    other.id !== row.id && other.contributionId === item.id,
                )}
              >
                {item.month} — KES {item.balance.toLocaleString('en-KE')} due
              </option>
            ))}
          </select>
          <input
            aria-label="Allocation amount"
            type="number"
            min="1"
            step="1"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="Amount"
            value={row.amount}
            disabled={disabled}
            onChange={(event) =>
              onChange(row.id, { amount: event.target.value })
            }
          />
          <button
            type="button"
            className="text-sm font-medium text-red-700 underline"
            onClick={() => onRemove(row.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <Button variant="secondary" disabled={disabled} onClick={onAdd}>
        Add allocation
      </Button>
      <dl className="grid gap-2 rounded-md bg-gray-50 p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-gray-500">Receipt</dt>
          <dd className="font-semibold">
            KES {receiptAmount.toLocaleString('en-KE')}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Allocated</dt>
          <dd className="font-semibold">
            KES {allocated.toLocaleString('en-KE')}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Account credit</dt>
          <dd className="font-semibold">
            KES {(receiptAmount - allocated).toLocaleString('en-KE')}
          </dd>
        </div>
      </dl>
    </div>
  );
};

export default function KcbReconciliationPage() {
  const { role } = useUser();
  const [payments, setPayments] = useState<KcbPaymentNotification[]>([]);
  const [creditPayments, setCreditPayments] = useState<
    KcbPaymentNotification[]
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<
    Record<string, string>
  >({});
  const [allocationDrafts, setAllocationDrafts] = useState<
    Record<string, AllocationDraft[]>
  >({});
  const [contributions, setContributions] = useState<
    Record<string, ContributionOption[]>
  >({});
  const [contributionLoadStatus, setContributionLoadStatus] = useState<
    Record<string, 'loading' | 'loaded' | 'error'>
  >({});
  const [contributionWarnings, setContributionWarnings] = useState<
    Record<string, number>
  >({});
  const [contributionErrors, setContributionErrors] = useState<
    Record<string, string>
  >({});
  const contributionRequests = useRef<Record<string, Promise<void>>>({});
  const loadedContributionMembers = useRef(new Set<string>());
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [testAmount, setTestAmount] = useState(100);
  const [testResult, setTestResult] = useState<string>();
  const pendingTestRequestId = useRef<string>();

  const loadMemberContributions = useCallback((memberId: string) => {
    if (!memberId || loadedContributionMembers.current.has(memberId)) {
      return Promise.resolve();
    }
    const pendingRequest = contributionRequests.current[memberId];
    if (pendingRequest) return pendingRequest;

    setContributionLoadStatus((current) => ({
      ...current,
      [memberId]: 'loading',
    }));
    setContributionWarnings((current) => ({
      ...current,
      [memberId]: 0,
    }));
    setContributionErrors((current) => ({
      ...current,
      [memberId]: '',
    }));

    const request = getDocs(collection(db, `members/${memberId}/contributions`))
      .then((snapshot) => {
        const { options, invalidDocumentCount } =
          contributionOptionsFromDocuments(
            snapshot.docs.map((item) => ({
              id: item.id,
              data: item.data(),
            })),
          );
        loadedContributionMembers.current.add(memberId);
        setContributions((current) => ({
          ...current,
          [memberId]: options,
        }));
        setContributionWarnings((current) => ({
          ...current,
          [memberId]: invalidDocumentCount,
        }));
        setContributionLoadStatus((current) => ({
          ...current,
          [memberId]: 'loaded',
        }));
      })
      .catch((cause: unknown) => {
        const errorCode =
          cause instanceof FirebaseError ? cause.code : 'unknown';
        const message =
          cause instanceof FirebaseError && cause.code === 'permission-denied'
            ? 'Your session is not authorized to read member contributions. Sign out and sign in again.'
            : cause instanceof FirebaseError && cause.code === 'unavailable'
              ? 'Firestore is temporarily unavailable. Check your connection and retry.'
              : `Firestore could not load this member’s contributions (${errorCode}).`;
        console.error(
          'Could not load KCB reconciliation contributions.',
          errorCode,
        );
        setContributionErrors((current) => ({
          ...current,
          [memberId]: message,
        }));
        setContributionLoadStatus((current) => ({
          ...current,
          [memberId]: 'error',
        }));
      })
      .finally(() => {
        delete contributionRequests.current[memberId];
      });

    contributionRequests.current[memberId] = request;
    return request;
  }, []);

  useEffect(() => {
    if (role !== 'administrator') return;
    const unsubscribe = subscribeToUnresolvedKcbPayments(setPayments);
    const unsubscribeCredit =
      subscribeToKcbPaymentsWithCredit(setCreditPayments);
    void getDocs(query(collection(db, 'members'), orderBy('firstname'))).then(
      (snapshot) =>
        setMembers(
          snapshot.docs.map((item) =>
            parseMemberDocument(item.id, item.data()),
          ),
        ),
    );
    return () => {
      unsubscribe();
      unsubscribeCredit();
    };
  }, [role]);

  useEffect(() => {
    const suggestions = payments.flatMap((payment) =>
      payment.suggestedMemberId
        ? [
            {
              paymentId: payment.providerTransactionId,
              memberId: payment.suggestedMemberId,
            },
          ]
        : [],
    );
    setSelectedMembers((current) => {
      const next = { ...current };
      suggestions.forEach(({ paymentId, memberId }) => {
        if (!next[paymentId]) next[paymentId] = memberId;
      });
      return next;
    });
    suggestions.forEach(({ memberId }) => {
      void loadMemberContributions(memberId);
    });
  }, [loadMemberContributions, payments]);

  useEffect(() => {
    creditPayments.forEach((payment) => {
      if (payment.memberId) void loadMemberContributions(payment.memberId);
    });
  }, [creditPayments, loadMemberContributions]);

  const memberNames = useMemo(
    () =>
      new Map(
        members.map((member) => [
          member.member_id,
          `${member.firstname} ${member.lastname}`,
        ]),
      ),
    [members],
  );

  const loadContributions = async (paymentId: string, memberId: string) => {
    setSelectedMembers((current) => ({ ...current, [paymentId]: memberId }));
    setAllocationDrafts((current) => ({ ...current, [paymentId]: [] }));
    await loadMemberContributions(memberId);
  };

  const addAllocation = (paymentId: string) =>
    setAllocationDrafts((current) => ({
      ...current,
      [paymentId]: [
        ...(current[paymentId] ?? []),
        { id: crypto.randomUUID(), contributionId: '', amount: '' },
      ],
    }));

  const updateAllocation = (
    paymentId: string,
    id: string,
    patch: Partial<AllocationDraft>,
  ) =>
    setAllocationDrafts((current) => ({
      ...current,
      [paymentId]: (current[paymentId] ?? []).map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));

  const removeAllocation = (paymentId: string, id: string) =>
    setAllocationDrafts((current) => ({
      ...current,
      [paymentId]: (current[paymentId] ?? []).filter((item) => item.id !== id),
    }));

  const allocationsFor = (paymentId: string) =>
    (allocationDrafts[paymentId] ?? []).map((item) => ({
      contributionId: item.contributionId,
      amount: Number(item.amount),
    }));

  const validateDrafts = (
    allocations: Array<{ contributionId: string; amount: number }>,
    options: ContributionOption[],
    available: number,
    requireAllocation: boolean,
  ) => {
    if (requireAllocation && !allocations.length) {
      return 'Add at least one allocation.';
    }
    if (allocations.some((item) => !item.contributionId || item.amount <= 0)) {
      return 'Complete or remove every allocation row.';
    }
    if (
      new Set(allocations.map((item) => item.contributionId)).size !==
      allocations.length
    ) {
      return 'Each contribution can be selected only once.';
    }
    if (allocations.reduce((sum, item) => sum + item.amount, 0) > available) {
      return 'Allocations exceed the available receipt amount.';
    }
    if (
      allocations.some((allocation) => {
        const option = options.find(
          (item) => item.id === allocation.contributionId,
        );
        return !option || allocation.amount > option.balance;
      })
    )
      return 'An allocation exceeds the contribution balance.';
    return undefined;
  };

  const reconcile = async (payment: KcbPaymentNotification) => {
    const memberId = selectedMembers[payment.providerTransactionId];
    const allocations = allocationsFor(payment.providerTransactionId);
    if (!memberId) return setError('Choose a member.');
    const validationError = validateDrafts(
      allocations,
      contributions[memberId] ?? [],
      payment.amount,
      false,
    );
    if (validationError) return setError(validationError);
    const allocated = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (
      !window.confirm(
        `Allocate KES ${allocated.toLocaleString('en-KE')} and leave KES ${(payment.amount - allocated).toLocaleString('en-KE')} as account credit?`,
      )
    )
      return;
    setBusy(payment.providerTransactionId);
    setError(undefined);
    try {
      await reconcileKcbPayment({
        providerTransactionId: payment.providerTransactionId,
        memberId,
        allocations,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reconcile payment.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const allocateCredit = async (payment: KcbPaymentNotification) => {
    const allocations = allocationsFor(payment.providerTransactionId);
    const memberId = payment.memberId ?? '';
    const validationError = validateDrafts(
      allocations,
      (contributions[memberId] ?? []).filter(
        (option) =>
          !payment.allocations.some(
            (allocation) => allocation.contributionId === option.id,
          ),
      ),
      Number(payment.unallocatedAmount ?? 0),
      true,
    );
    if (validationError) return setError(validationError);
    setBusy(payment.providerTransactionId);
    setError(undefined);
    try {
      await allocateKcbPaymentCredit({
        providerTransactionId: payment.providerTransactionId,
        allocations,
      });
      setAllocationDrafts((current) => ({
        ...current,
        [payment.providerTransactionId]: [],
      }));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not allocate credit.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const reject = async (payment: KcbPaymentNotification) => {
    const reason = window.prompt('Why should this payment be rejected?');
    if (!reason?.trim()) return;
    setBusy(payment.providerTransactionId);
    setError(undefined);
    try {
      await rejectKcbPayment(payment.providerTransactionId, reason.trim());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reject payment.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  const sendDevelopmentTest = async () => {
    const requestId = pendingTestRequestId.current ?? crypto.randomUUID();
    pendingTestRequestId.current = requestId;
    setBusy('dev-simulator');
    setError(undefined);
    setTestResult(undefined);
    try {
      const result = await sendKcbDevTillNotification(testAmount, requestId);
      const data = result.data as { providerTransactionId?: string };
      pendingTestRequestId.current = undefined;
      setTestResult(
        `Synthetic payment ${data.providerTransactionId ?? ''} was accepted for reconciliation.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not send the development test payment.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  if (role && role !== 'administrator')
    return <Navigate to="/profile" replace />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mt-6 text-xl font-bold text-guardsman-red-600">
          KCB payment reconciliation
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Review Paybill notifications before they change a member balance.
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {devSimulatorEnabled ? (
        <Card className="space-y-3 border-amber-300 bg-amber-50">
          <div>
            <h2 className="font-semibold text-amber-900">
              Development test payment
            </h2>
            <p className="text-sm text-amber-800">
              Sends an unsigned KCB Sandbox-style payment through the deployed
              callback. It is disabled outside development.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-amber-950">
              Test amount (KES)
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                value={testAmount}
                onChange={(event) => {
                  pendingTestRequestId.current = undefined;
                  setTestAmount(Number(event.target.value));
                }}
                className="mt-1 block w-40 rounded-md border border-amber-400 bg-white px-3 py-2"
              />
            </label>
            <Button
              variant="secondary"
              isLoading={busy === 'dev-simulator'}
              onClick={() => void sendDevelopmentTest()}
            >
              Send Sandbox test payment
            </Button>
          </div>
          {testResult ? (
            <p role="status" className="text-sm font-medium text-green-700">
              {testResult}
            </p>
          ) : null}
        </Card>
      ) : null}
      <div className="space-y-4">
        {payments.map((payment) => {
          const memberId = selectedMembers[payment.providerTransactionId] ?? '';
          const contributionStatus = memberId
            ? contributionLoadStatus[memberId]
            : undefined;
          const contributionOptions = memberId
            ? (contributions[memberId] ?? [])
            : [];
          return (
            <Card key={payment.providerTransactionId} className="space-y-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="block text-gray-500">KCB receipt</span>
                  <strong>{payment.providerTransactionId}</strong>
                </div>
                <div>
                  <span className="block text-gray-500">Payer</span>
                  <strong>{payment.payerName}</strong>
                  <br />
                  {payment.payerPhone}
                </div>
                <div>
                  <span className="block text-gray-500">Amount</span>
                  <strong>
                    {payment.currency} {payment.amount.toLocaleString('en-KE')}
                  </strong>
                </div>
                <div>
                  <span className="block text-gray-500">Reference</span>
                  <strong>{payment.billReference}</strong>
                </div>
              </div>
              {payment.suggestedMemberId ? (
                <p className="text-xs text-amber-700">
                  Suggested from a unique verified phone:{' '}
                  {memberNames.get(payment.suggestedMemberId) ??
                    payment.suggestedMemberId}
                  . Confirm before reconciling.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Member
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
                    value={memberId}
                    onChange={(event) =>
                      void loadContributions(
                        payment.providerTransactionId,
                        event.target.value,
                      )
                    }
                  >
                    <option value="">Choose member</option>
                    {members.map((member) => (
                      <option key={member.member_id} value={member.member_id}>
                        {member.firstname} {member.lastname}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-sm font-medium">
                  Contribution allocations
                  {contributionStatus === 'error' ? (
                    <span className="mt-1 block text-xs text-red-700">
                      {contributionErrors[memberId]}
                      <button
                        type="button"
                        className="ml-2 font-semibold underline"
                        onClick={() => void loadMemberContributions(memberId)}
                      >
                        Retry
                      </button>
                    </span>
                  ) : null}
                  {(contributionWarnings[memberId] ?? 0) > 0 ? (
                    <span className="mt-1 block text-xs text-amber-700">
                      {contributionWarnings[memberId]} invalid contribution
                      {contributionWarnings[memberId] === 1 ? '' : 's'} could
                      not be shown.
                    </span>
                  ) : null}
                </div>
                <AllocationEditor
                  receiptAmount={payment.amount}
                  options={contributionOptions}
                  rows={allocationDrafts[payment.providerTransactionId] ?? []}
                  disabled={
                    !memberId ||
                    contributionStatus === 'loading' ||
                    contributionStatus === 'error'
                  }
                  onAdd={() => addAllocation(payment.providerTransactionId)}
                  onChange={(id, patch) =>
                    updateAllocation(payment.providerTransactionId, id, patch)
                  }
                  onRemove={(id) =>
                    removeAllocation(payment.providerTransactionId, id)
                  }
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => void reconcile(payment)}
                  isLoading={busy === payment.providerTransactionId}
                >
                  Reconcile payment
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void reject(payment)}
                  disabled={Boolean(busy)}
                >
                  Reject
                </Button>
              </div>
            </Card>
          );
        })}
        {!payments.length ? (
          <p className="text-sm text-gray-500">No unresolved KCB payments.</p>
        ) : null}
      </div>
      {creditPayments.length ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Unallocated KCB credit</h2>
          <p className="text-sm text-gray-600">
            Allocate existing receipt credit without changing the member account
            balance again.
          </p>
          {creditPayments.map((payment) => {
            const memberId = payment.memberId ?? '';
            const available = Number(payment.unallocatedAmount ?? 0);
            return (
              <Card key={payment.providerTransactionId} className="space-y-4">
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <span className="block text-gray-500">Receipt</span>
                    <strong>{payment.receiptNumber}</strong>
                  </div>
                  <div>
                    <span className="block text-gray-500">Member</span>
                    <strong>{memberNames.get(memberId) ?? memberId}</strong>
                  </div>
                  <div>
                    <span className="block text-gray-500">
                      Available credit
                    </span>
                    <strong>KES {available.toLocaleString('en-KE')}</strong>
                  </div>
                </div>
                <AllocationEditor
                  receiptAmount={available}
                  options={(contributions[memberId] ?? []).filter(
                    (option) =>
                      !payment.allocations.some(
                        (allocation) => allocation.contributionId === option.id,
                      ),
                  )}
                  rows={allocationDrafts[payment.providerTransactionId] ?? []}
                  disabled={contributionLoadStatus[memberId] !== 'loaded'}
                  onAdd={() => addAllocation(payment.providerTransactionId)}
                  onChange={(id, patch) =>
                    updateAllocation(payment.providerTransactionId, id, patch)
                  }
                  onRemove={(id) =>
                    removeAllocation(payment.providerTransactionId, id)
                  }
                />
                <Button
                  onClick={() => void allocateCredit(payment)}
                  isLoading={busy === payment.providerTransactionId}
                >
                  Allocate existing credit
                </Button>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
