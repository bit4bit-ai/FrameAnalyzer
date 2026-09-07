const STORAGE_KEY = 'frame_analyzer_keywords';

/**
 * Load keywords from the local JSON database (via Vite dev server middleware)
 * or fallback to localStorage if running offline/without API.
 */
export const loadKeywords = async (): Promise<string[]> => {
  try {
    const response = await fetch('/api/keywords', {
      headers: { 'Accept': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
          // localStorage quota exceeded (e.g. for 80k+ items), ignore safely
        }
        return data;
      }
    }
  } catch (err) {
    console.warn('Could not fetch from /api/keywords, falling back to localStorage', err);
  }

  // Fallback to localStorage
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('Failed to parse cached keywords from localStorage', err);
  }

  return [];
};

/**
 * Save keywords to the local JSON file (via /api/keywords)
 * and sync to localStorage if space permits.
 */
export const saveKeywords = async (keywords: string[]): Promise<{ success: boolean; count: number }> => {
  // Best-effort local cache (may exceed 5MB quota for 80k+ items)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keywords));
  } catch {
    // Ignore localStorage QuotaExceededError, disk-based keywords.json is authoritative
  }

  try {
    const response = await fetch('/api/keywords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(keywords),
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true, count: result.count ?? keywords.length };
    }
  } catch (err) {
    console.warn('Could not save to /api/keywords:', err);
  }

  return { success: true, count: keywords.length };
};

export interface ParseKeywordsResult {
  added: string[];
  duplicatesCount: number;
  sampleDuplicates: string[];
}

/**
 * Process an array of string keywords directly (optimized for 50k - 100k items)
 */
export const parseKeywordsFromArray = (
  rawItems: string[],
  existingKeywords: string[] = []
): ParseKeywordsResult => {
  const existingLower = new Set(existingKeywords.map(k => k.toLowerCase()));
  const added: string[] = [];
  const sampleDuplicates: string[] = [];
  let duplicatesCount = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const trimmed = rawItems[i].trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    if (existingLower.has(lower)) {
      duplicatesCount++;
      if (sampleDuplicates.length < 5) {
        sampleDuplicates.push(trimmed);
      }
    } else {
      existingLower.add(lower);
      added.push(trimmed);
    }
  }

  return { added, duplicatesCount, sampleDuplicates };
};

/**
 * Parse pasted text or comma-separated string into unique, trimmed keywords.
 * Only completely repeated keywords (exact full-string match, case-insensitive)
 * are filtered out. Distinct phrases (e.g. "sun" and "hot sun") are preserved.
 */
export const parseCommaSeparatedKeywords = (
  input: string,
  existingKeywords: string[] = []
): ParseKeywordsResult => {
  if (!input || !input.trim()) {
    return { added: [], duplicatesCount: 0, sampleDuplicates: [] };
  }

  const rawItems = input
    .split(/[\r\n,;]+/)
    .map(k => k.trim())
    .filter(k => k.length > 0);

  return parseKeywordsFromArray(rawItems, existingKeywords);
};

/**
 * Deduplicate an array of keywords ensuring only completely repeated entries are removed.
 */
export const deduplicateKeywords = (keywords: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const kw of keywords) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result;
};

/**
 * Trigger download of keywords as a .json file
 */
export const exportKeywordsToFile = (keywords: string[]) => {
  const blob = new Blob([JSON.stringify(keywords, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'keywords.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
