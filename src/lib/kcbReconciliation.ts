export type ContributionOption = {
  id: string;
  month: string;
  balance: number;
};

type ContributionDocument = {
  id: string;
  data: unknown;
};

type ContributionOptionsResult = {
  options: ContributionOption[];
  invalidDocumentCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const contributionOptionsFromDocuments = (
  documents: ContributionDocument[],
): ContributionOptionsResult => {
  const options: ContributionOption[] = [];
  let invalidDocumentCount = 0;

  documents.forEach(({ id, data }) => {
    if (!isRecord(data) || !Number.isFinite(data.balance)) {
      invalidDocumentCount += 1;
      return;
    }

    const balance = data.balance as number;
    if (balance <= 0) return;

    options.push({
      id,
      month:
        typeof data.month === 'string' && data.month.trim() ? data.month : id,
      balance,
    });
  });

  options.sort((left, right) => right.month.localeCompare(left.month));

  return { options, invalidDocumentCount };
};
