export type ErrandListCandidate = {
  readonly name: string;
};

export type ErrandListMatch<T extends ErrandListCandidate> =
  | { readonly kind: "matched"; readonly candidate: T; readonly method: "exact" | "fuzzy" }
  | { readonly kind: "review"; readonly reason: "no-match" | "ambiguous" };

// Fuzzy matches compare consonant skeletons, so vowel and doubled-letter slips
// ("casco", "cosco", "costo") map onto "costco". Names whose skeleton is shorter
// than this are too short to fuzzy-match safely ("new" -> "nw").
const MIN_FUZZY_SKELETON_LENGTH = 3;
const MIN_CANDIDATE_SKELETON_LENGTH = 4;
// One skeleton edit is allowed per three skeleton characters.
const SKELETON_CHARACTERS_PER_EDIT = 3;
// The best fuzzy candidate must beat the runner-up by this many edits.
const FUZZY_MARGIN = 2;

const VOWELS: ReadonlySet<string> = new Set(["a", "e", "i", "o", "u"]);

/**
 * Chooses the existing Errands list folder for a spoken list name.
 *
 * Order: exact normalized match, then a unique high-confidence fuzzy match.
 * Anything else (no candidate, a weak match, or a tie) is sent to review.
 */
export function matchErrandList<T extends ErrandListCandidate>(
  spokenName: string,
  candidates: ReadonlyArray<T>,
): ErrandListMatch<T> {
  const spokenKey = toMatchKey(spokenName);

  if (spokenKey.length === 0) {
    return { kind: "review", reason: "no-match" };
  }

  const keyed = candidates
    .map((candidate) => ({ candidate, key: toMatchKey(candidate.name) }))
    .filter((entry) => entry.key.length > 0);

  const exactMatches = keyed.filter((entry) => entry.key === spokenKey);

  if (exactMatches.length > 1) {
    return { kind: "review", reason: "ambiguous" };
  }

  const exactMatch = exactMatches[0];

  if (exactMatch !== undefined) {
    return { kind: "matched", candidate: exactMatch.candidate, method: "exact" };
  }

  const spokenSkeleton = toSkeleton(spokenKey);

  if (spokenSkeleton.length < MIN_FUZZY_SKELETON_LENGTH) {
    return { kind: "review", reason: "no-match" };
  }

  const maxDistance = Math.floor(spokenSkeleton.length / SKELETON_CHARACTERS_PER_EDIT);
  const scored = keyed
    .map((entry) => {
      const candidateSkeleton = toSkeleton(entry.key);
      const distance = levenshteinDistance(spokenSkeleton, candidateSkeleton);
      return {
        candidate: entry.candidate,
        distance,
        spellingDistance: levenshteinDistance(spokenKey, entry.key),
        lengthDifference: Math.abs(spokenKey.length - entry.key.length),
        candidateLength: entry.key.length,
        eligible: candidateSkeleton.length >= MIN_CANDIDATE_SKELETON_LENGTH &&
          entry.key.startsWith(spokenKey[0] ?? "") &&
          (!/[\s-]/u.test(entry.candidate.name) || distance === 0),
      };
    })
    .sort((left, right) => left.distance - right.distance);
  const best = scored[0];
  const runnerUp = scored[1];

  if (best !== undefined && runnerUp !== undefined && runnerUp.distance - best.distance < FUZZY_MARGIN) {
    return { kind: "review", reason: "ambiguous" };
  }

  if (best === undefined || !best.eligible || best.distance > maxDistance ||
    best.lengthDifference > Math.max(1, Math.floor(best.candidateLength / 5)) ||
    best.spellingDistance > Math.max(2, Math.floor(best.candidateLength / 4))) {
    return { kind: "review", reason: "no-match" };
  }

  return { kind: "matched", candidate: best.candidate, method: "fuzzy" };
}

function toMatchKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function toSkeleton(key: string): string {
  const [first = "", ...rest] = Array.from(key);
  let skeleton = first;

  for (const character of rest) {
    if (VOWELS.has(character) || skeleton.endsWith(character)) {
      continue;
    }

    skeleton += character;
  }

  return skeleton;
}

function levenshteinDistance(left: string, right: string): number {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  let previous = rightCharacters.map((_, index) => index + 1);
  previous.unshift(0);

  for (const [leftIndex, leftCharacter] of leftCharacters.entries()) {
    const current = [leftIndex + 1];

    for (const [rightIndex, rightCharacter] of rightCharacters.entries()) {
      const substitutionCost = leftCharacter === rightCharacter ? 0 : 1;
      current.push(Math.min(
        (previous[rightIndex + 1] ?? 0) + 1,
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + substitutionCost,
      ));
    }

    previous = current;
  }

  return previous[rightCharacters.length] ?? 0;
}
