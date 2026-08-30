import { InvalidArgumentError, type Command, type Option } from "commander";

/**
 * Parse a flag that must be a positive integer, rejecting anything else.
 *
 * The regex is the check; `Number` is only the conversion. `Number.parseInt`
 * on its own is not a validator and never was: it reads `"10abc"` as 10,
 * `"0x10"` as 0, `"1e3"` as 1 and `"-5"` as -5, so every one of those reaches
 * the command as a value the caller never typed. `Number.isSafeInteger` then
 * rejects the digit strings too large to survive the round trip.
 *
 * `example` is interpolated into the message so each flag can show a plausible
 * value for itself; the wording is otherwise identical, because the rule is.
 */
function parsePositiveInt(value: string, example: string): number {
  const normalized = value.trim();
  const reject = () =>
    new InvalidArgumentError(`must be a positive integer (for example, ${example})`);
  if (!/^\+?[1-9]\d*$/.test(normalized)) throw reject();

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw reject();
  return parsed;
}

function parseNonNegativeInt(value: string, example: string): number {
  const normalized = value.trim();
  const reject = () =>
    new InvalidArgumentError(`must be a non-negative integer (for example, ${example})`);
  if (!/^\+?\d+$/.test(normalized)) throw reject();

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw reject();
  return parsed;
}

function documentedChoices(option: Option, command: Command): string[] | null {
  const group = option.description.match(/\(([^()]*(?:\|)[^()]*)\)/)?.[1];
  if (!group) return null;
  const choices = group.split("|").map((choice) => choice.trim());
  if (option.long === "--format" && command.name() === "map") choices.push("silent");
  return choices;
}

function invalidOption(option: Option, detail: string): InvalidArgumentError {
  return new InvalidArgumentError(`option '${option.long}' ${detail}`);
}

/**
 * Validate common option domains before a command can contact the backend.
 *
 * Most commands read numeric options with `parseInt` and route any unrecognized
 * output format through their text branch. That turns typos into a different,
 * successful request. Keeping this at the root command covers OSS and optional
 * Pro commands consistently, including the long-lived MCP runner.
 */
export function validateCliOptions(command: Command): void {
  const values = command.opts();

  for (const option of command.options) {
    const value = values[option.attributeName()];
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      const choices = documentedChoices(option, command);
      if (choices && !choices.includes(value)) {
        throw invalidOption(option, `must be one of: ${choices.join(", ")}`);
      }

      if (option.long === "--as-of") {
        try { parseRevisionOption(value); }
        catch { throw invalidOption(option, "must be a positive integer"); }
      }

      if (option.long === "--min-confidence") {
        const parsed = Number(value);
        if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value.trim()) || parsed < 0 || parsed > 1) {
          throw invalidOption(option, "must be a number from 0 to 1");
        }
      } else if (option.long === "--offset") {
        try { parseNonNegativeInt(value, "0 or 10"); }
        catch { throw invalidOption(option, "must be a non-negative integer"); }
      } else if (option.flags.includes("<n>")) {
        try { parsePositiveInt(value, "1 or 10"); }
        catch { throw invalidOption(option, "must be a positive integer"); }
      }
    }
  }
}

export function parsePickOption(value: string): number {
  return parsePositiveInt(value, "1 or 2");
}

/**
 * Parse a `--max-*` budget flag.
 *
 * Validated at parse time rather than read back out of the raw option string
 * later, so the value is parsed once and a malformed one is refused where the
 * user can see which flag they mistyped. `ix context --diff` reports the
 * requested budget back to the caller, and a silently repaired number
 * (`--max-entities 1e3` becoming 1) is a misreport of the one thing that record
 * exists to carry.
 *
 * `example` is the flag's own default, supplied by the caller. A shared literal
 * would be wrong for at least one flag: `--max-chars` starts at 12000 and
 * clamps up from anything below 1000, so suggesting 50 there names a value the
 * command silently replaces.
 */
export function parseBudgetOption(value: string, example: string): number {
  return parsePositiveInt(value, example);
}

/**
 * Parse a revision flag: a positive integer graph revision.
 *
 * `parseInt(opts.asOfRev, 10)` reached `client.query({ asOfRev })` and
 * `buildBundle` unchecked, so `--as-of-rev abc` sent NaN to the backend,
 * `--as-of-rev 3.9` silently became 3, and `--as-of-rev 10abc` became 10 — the
 * same not-a-validator failure the budget flags had, on the flag two lines
 * above them.
 */
export function parseRevisionOption(value: string): number {
  return parsePositiveInt(value, "12");
}
