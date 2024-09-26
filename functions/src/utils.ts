export const MONTHLY_CONTRIBUTION = 200;

export const getCurrentMonth = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};

export const createIndex = (title: string) => {
  const arr = title.toLowerCase().split('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchableIndex: {
    [key: string]: boolean;
  } = {};

  let prevKey = '';

  for (const char of arr) {
    const key = prevKey + char;
    searchableIndex[key] = true;
    prevKey = key;
  }

  return searchableIndex;
};
