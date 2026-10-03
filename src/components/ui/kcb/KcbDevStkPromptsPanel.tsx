import React from 'react';
import { Button } from '@/components/Button';
import {
  KcbDevStkPrompt,
  KcbDevStkPromptOutcome,
  kcbDevSimulatorEnabled,
  listKcbDevStkPrompts,
  resolveKcbDevStkPrompt,
} from '@/lib/firebase/kcb';
import { cx } from '@/lib/utils';

const POLL_MS = 4000;

const formatKes = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

const outcomeLabels: Record<KcbDevStkPromptOutcome, string> = {
  approve: 'Approve',
  cancel: 'Cancel',
  timeout: 'Time out',
};

// Development-only stand-in for the phone that receives an STK prompt. Renders
// nothing unless the development simulator is enabled for this build.
export const KcbDevStkPromptsPanel = ({
  stkRequestId,
  className,
}: {
  // Shows only the prompt for this STK request when given.
  stkRequestId?: string;
  className?: string;
}) => {
  const [prompts, setPrompts] = React.useState<KcbDevStkPrompt[]>([]);
  const [busy, setBusy] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [result, setResult] = React.useState<string>();

  const refresh = React.useCallback(async () => {
    try {
      setPrompts(await listKcbDevStkPrompts(stkRequestId));
      setError(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load simulated prompts.',
      );
    }
  }, [stkRequestId]);

  React.useEffect(() => {
    if (!kcbDevSimulatorEnabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!kcbDevSimulatorEnabled) return null;

  const resolve = async (
    prompt: KcbDevStkPrompt,
    outcome: KcbDevStkPromptOutcome,
  ) => {
    setBusy(`${prompt.promptId}:${outcome}`);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await resolveKcbDevStkPrompt(prompt.promptId, outcome);
      setResult(
        response.data.duplicate
          ? 'That prompt was already answered.'
          : `Sent the simulated ${outcomeLabels[outcome].toLowerCase()} result to the STK callback.`,
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not resolve the simulated prompt.',
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section
      aria-label="Simulated M-Pesa prompts"
      className={cx(
        'space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40',
        className,
      )}
    >
      <div>
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Simulated M-Pesa prompts
        </h3>
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Development only. Answering a prompt posts a synthetic KCB result to
          the deployed STK callback.
        </p>
      </div>
      {prompts.length ? (
        <ul className="space-y-2">
          {prompts.map((prompt) => (
            <li
              key={prompt.promptId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 text-sm dark:bg-gray-950"
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-gray-50">
                  {formatKes(prompt.amount)} to +{prompt.phoneNumber}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {prompt.purpose === 'account_top_up'
                    ? 'Account top-up'
                    : 'Contribution payment'}
                  {prompt.status === 'resolving' ? ' · sending result…' : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['approve', 'cancel', 'timeout'] as const).map((outcome) => (
                  <Button
                    key={outcome}
                    type="button"
                    variant={outcome === 'approve' ? 'primary' : 'secondary'}
                    disabled={!!busy || prompt.status !== 'pending'}
                    isLoading={busy === `${prompt.promptId}:${outcome}`}
                    onClick={() => void resolve(prompt, outcome)}
                  >
                    {outcomeLabels[outcome]}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-amber-900 dark:text-amber-200">
          No pending simulated prompts.
        </p>
      )}
      {result ? (
        <p
          role="status"
          className="text-sm font-medium text-green-700 dark:text-green-400"
        >
          {result}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
};
