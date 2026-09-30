// Mirrors the server's accepted formats for display only; the backend
// validates and normalises the number before sending the prompt.
export const isKenyanMobileNumber = (value: string) => {
  const trimmed = value.trim();
  if (!/^\+?[\d\s-]+$/.test(trimmed)) return false;
  return /^(?:254|0)?[17]\d{8}$/.test(trimmed.replace(/\D/g, ''));
};
