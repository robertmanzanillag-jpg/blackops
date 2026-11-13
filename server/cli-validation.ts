import { hasRealValue } from "./ceo-doctor-cli";

export function validateRequiredRealCliValue(value: string, label: string): string | null {
  if (!hasRealValue(value)) return `${label} must be a real value, not a placeholder.`;
  return null;
}
