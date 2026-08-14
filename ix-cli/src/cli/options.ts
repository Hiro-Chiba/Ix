import { InvalidArgumentError } from "commander";

export function parsePickOption(value: string): number {
  const normalized = value.trim();
  if (!/^\+?[1-9]\d*$/.test(normalized)) {
    throw new InvalidArgumentError("must be a positive integer (for example, 1 or 2)");
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("must be a positive integer (for example, 1 or 2)");
  }
  return parsed;
}
