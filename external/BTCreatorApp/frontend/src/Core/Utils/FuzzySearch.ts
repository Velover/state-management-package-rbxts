export interface FuzzyMatch {
  score: number;
  matches: number[];
}

export interface FuzzySearchResult<T> {
  item: T;
  score: number;
  matches: number[];
}

/**
 * Calculate fuzzy match score between a search term and target string
 * @param searchTerm - The search query
 * @param target - The string to search in
 * @returns FuzzyMatch object with score and character match positions
 */
export function fuzzyScore(searchTerm: string, target: string): FuzzyMatch {
  if (!searchTerm.trim()) {
    return { score: 0, matches: [] };
  }

  const search = searchTerm.toLowerCase();
  const text = target.toLowerCase();

  let searchIndex = 0;
  let score = 0;
  const matches: number[] = [];
  let consecutiveBonus = 0;
  let wordBoundaryBonus = 0;

  for (let i = 0; i < text.length && searchIndex < search.length; i++) {
    const searchChar = search[searchIndex];
    const textChar = text[i];

    if (searchChar === textChar) {
      matches.push(i);
      searchIndex++;

      // Base score for character match
      score += 1;

      // Consecutive character bonus
      if (matches.length > 1 && matches[matches.length - 2] === i - 1) {
        consecutiveBonus += 2;
        score += consecutiveBonus;
      } else {
        consecutiveBonus = 0;
      }

      // Word boundary bonus (start of word or after space/underscore)
      if (
        i === 0 ||
        text[i - 1] === " " ||
        text[i - 1] === "_" ||
        text[i - 1] === "-"
      ) {
        wordBoundaryBonus = 3;
        score += wordBoundaryBonus;
      }

      // Exact start match gets highest bonus
      if (i === 0 && searchIndex === 1) {
        score += 10;
      }
    }
  }

  // Penalize if not all characters were matched
  if (searchIndex < search.length) {
    return { score: 0, matches: [] };
  }

  // Bonus for shorter strings (more precise matches)
  const lengthBonus = Math.max(0, 20 - target.length);
  score += lengthBonus;

  // Bonus for exact match
  if (search === text) {
    score += 50;
  }

  // Bonus for prefix match
  if (text.startsWith(search)) {
    score += 25;
  }

  return { score, matches };
}

/**
 * Search through an array of items using fuzzy matching
 * @param items - Array of items to search through
 * @param searchTerm - The search query
 * @param extractText - Function to extract searchable text from each item
 * @param minScore - Minimum score threshold for results (default: 1)
 * @returns Sorted array of search results
 */
export function fuzzySearch<T>(
  items: T[],
  searchTerm: string,
  extractText: (item: T) => string,
  minScore: number = 1
): FuzzySearchResult<T>[] {
  if (!searchTerm.trim()) {
    return items.map((item) => ({ item, score: 0, matches: [] }));
  }

  const results: FuzzySearchResult<T>[] = [];

  for (const item of items) {
    const text = extractText(item);
    const match = fuzzyScore(searchTerm, text);

    if (match.score >= minScore) {
      results.push({
        item,
        score: match.score,
        matches: match.matches,
      });
    }
  }

  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Search through multiple text fields of an item
 * @param items - Array of items to search through
 * @param searchTerm - The search query
 * @param extractors - Object with field names and text extraction functions
 * @param minScore - Minimum score threshold for results
 * @returns Sorted array of search results with field-specific matches
 */
export function fuzzySearchMultiField<T>(
  items: T[],
  searchTerm: string,
  extractors: Record<string, (item: T) => string>,
  minScore: number = 1
): Array<FuzzySearchResult<T> & { fieldMatches: Record<string, FuzzyMatch> }> {
  if (!searchTerm.trim()) {
    return items.map((item) => ({
      item,
      score: 0,
      matches: [],
      fieldMatches: {},
    }));
  }

  const results: Array<
    FuzzySearchResult<T> & { fieldMatches: Record<string, FuzzyMatch> }
  > = [];

  for (const item of items) {
    let bestScore = 0;
    let bestMatches: number[] = [];
    const fieldMatches: Record<string, FuzzyMatch> = {};

    // Check each field
    for (const [fieldName, extractor] of Object.entries(extractors)) {
      const text = extractor(item);
      const match = fuzzyScore(searchTerm, text);
      fieldMatches[fieldName] = match;

      // Use the best scoring field as the primary score
      if (match.score > bestScore) {
        bestScore = match.score;
        bestMatches = match.matches;
      }
    }

    if (bestScore >= minScore) {
      results.push({
        item,
        score: bestScore,
        matches: bestMatches,
        fieldMatches,
      });
    }
  }

  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score);
}
