/**
 * A short course label for lists and titles: "COSC332.001_Fall 2026" → "COSC 332",
 * "PSYC101.W02_Fall 2026" → "PSYC 101". Tries each candidate (e.g. code, then name)
 * and falls back to the first one given when none looks like a course code.
 */
export function courseLabel(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    const m = c?.trim().match(/^([A-Za-z]{2,5})[\s_-]*(\d{3}[A-Za-z]?)(?![0-9])/);
    if (m?.[1] && m[2]) return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
  }
  return candidates.find((c) => c?.trim())?.trim() ?? "";
}
