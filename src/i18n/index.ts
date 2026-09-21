import en from "./en.json";

type Join<K extends string, P extends string> = `${K}.${P}`;
type Paths<T> = T extends object
  ? {
      [K in Extract<keyof T, string>]: T[K] extends object
        ? Join<K, Paths<T[K]> & string>
        : K;
    }[Extract<keyof T, string>]
  : never;

export type TranslationKey = Paths<typeof en>;
export const dictionary = en;

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/** Typed lookup into the en dictionary. Falls back to the key itself. */
export function t(key: TranslationKey): string {
  const value = get(dictionary, key);
  return typeof value === "string" ? value : key;
}
