/**
 * Minimal className joiner (a tiny local stand-in for `clsx`). Accepts
 * strings, numbers, falsy values (skipped), and arbitrarily nested arrays.
 */
export type ClassValue = string | number | null | false | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
      continue;
    }

    out.push(String(input));
  }

  return out.join(" ");
}
