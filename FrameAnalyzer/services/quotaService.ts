/**
 * Quota and Token Tracking Service
 * 
 * Google Gemini Rate Limits & Quota Dimensions:
 * 1. RPM (Requests Per Minute): 15 RPM on Free Tier. (Enforced via delay)
 * 2. RPD (Requests Per Day): Resets at Midnight Pacific Time (PT).
 *    - Standard models (gemini-2.5-flash, gemini-2.5-flash-lite): 1,500 RPD
 *    - Preview / Experimental models (gemini-3.x): ~50 to 100 RPD
 * 3. TPM (Tokens Per Minute): 1,000,000 TPM on Free Tier
 * 4. Pay-As-You-Go: Removes daily limits for pennies (~$0.03 to $0.05 per 100 videos)
 */

export interface ModelQuotaSpec {
  id: string;
  name: string;
  rpm: number;
  rpdFreeTier: number;
  inputPricePerMillion: number; // USD
  outputPricePerMillion: number; // USD
  tierNote: string;
  isRecommendedForVolume?: boolean;
}

export const KNOWN_MODEL_QUOTAS: Record<string, ModelQuotaSpec> = {
  'gemini-3.6-flash': {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    rpm: 15,
    rpdFreeTier: 50,
    inputPricePerMillion: 0.75,
    outputPricePerMillion: 3.75,
    tierNote: 'Google recommended model: Best description quality. ~50 free RPD, or ~$0.10/100 videos on Pay-As-You-Go.',
    isRecommendedForVolume: true,
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash-Lite',
    rpm: 15,
    rpdFreeTier: 1500,
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.60,
    tierNote: 'Recommended High-Volume Tier: Ultra-fast and reliable for batches of 100+ videos.',
    isRecommendedForVolume: true,
  },
  'gemini-3.5-flash': {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    rpm: 15,
    rpdFreeTier: 1500,
    inputPricePerMillion: 0.30,
    outputPricePerMillion: 1.20,
    tierNote: 'High-speed reasoning model: 1,500 RPD on paper, but subject to 15 RPM and strict per-minute token (TPM) limits on Google Free Tier.',
    isRecommendedForVolume: true,
  },
  'gemini-3.7-flash': {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    rpm: 15,
    rpdFreeTier: 50,
    inputPricePerMillion: 0.30,
    outputPricePerMillion: 1.20,
    tierNote: 'Gemini 3.7 Preview: Advanced visual analysis, tight free-tier daily cap (~50 RPD).',
  },
  'gemini-3.8-flash': {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    rpm: 15,
    rpdFreeTier: 50,
    inputPricePerMillion: 0.30,
    outputPricePerMillion: 1.20,
    tierNote: 'Gemini 3.8 Preview: State-of-the-art vision, limited on Free Tier.',
  },
};

export const getModelSpec = (modelId: string): ModelQuotaSpec => {
  if (KNOWN_MODEL_QUOTAS[modelId]) {
    return KNOWN_MODEL_QUOTAS[modelId];
  }
  // Default fallback
  return {
    id: modelId,
    name: modelId,
    rpm: 15,
    rpdFreeTier: 50,
    inputPricePerMillion: 0.30,
    outputPricePerMillion: 1.20,
    tierNote: 'Model rate limit subject to active Google AI Studio project tier.',
  };
};

export interface StoredDailyQuota {
  pacificDate: string; // YYYY-MM-DD in America/Los_Angeles
  requestsToday: number;
  promptTokensToday: number;
  candidateTokensToday: number;
  totalTokensToday: number;
  modelBreakdown: Record<string, number>; // modelId -> count
  exhaustedModelsToday?: string[]; // modelIds that returned 429/quota error today
}

const STORAGE_KEY = 'frame_analyzer_quota_stats';

/**
 * Returns current date string (YYYY-MM-DD) in US Pacific Time (Google Quota Timezone)
 */
export const getPacificDateString = (): string => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // e.g. "2026-09-09"
};

/**
 * Calculates remaining hours and minutes until Midnight Pacific Time
 */
export const getTimeUntilPacificMidnight = (): { hours: number; minutes: number; formatted: string } => {
  const now = new Date();
  
  // Get current time in Los Angeles
  const laString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const laDate = new Date(laString);
  
  // Next midnight in LA
  const nextMidnight = new Date(laDate);
  nextMidnight.setHours(24, 0, 0, 0);
  
  const diffMs = nextMidnight.getTime() - laDate.getTime();
  const diffMinutesTotal = Math.max(0, Math.floor(diffMs / 60000));
  const hours = Math.floor(diffMinutesTotal / 60);
  const minutes = diffMinutesTotal % 60;

  return {
    hours,
    minutes,
    formatted: `${hours}h ${minutes}m`,
  };
};

/**
 * Load stored daily quota data, automatically resetting if a new Pacific day has arrived
 */
export const loadStoredQuota = (): StoredDailyQuota => {
  const currentPacificDate = getPacificDateString();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: StoredDailyQuota = JSON.parse(raw);
      if (parsed.pacificDate === currentPacificDate) {
        // Sanitize exhaustedModelsToday: only models that genuinely reached limit (>=20) or gemini-3.5-flash remain locked
        if (parsed.exhaustedModelsToday && Array.isArray(parsed.exhaustedModelsToday)) {
          parsed.exhaustedModelsToday = parsed.exhaustedModelsToday.filter(m => {
            const count = parsed.modelBreakdown?.[m] || 0;
            return count >= 20 || m === 'gemini-3.5-flash';
          });
        }
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to read stored quota stats:", err);
  }

  // Fresh day initialized
  const fresh: StoredDailyQuota = {
    pacificDate: currentPacificDate,
    requestsToday: 0,
    promptTokensToday: 0,
    candidateTokensToday: 0,
    totalTokensToday: 0,
    modelBreakdown: {},
    exhaustedModelsToday: [],
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  } catch {}
  return fresh;
};

/**
 * Record a completed Gemini API request and token usage
 */
export const recordApiCallUsage = (
  modelId: string,
  usage?: { promptTokens: number; candidateTokens: number; totalTokens: number }
): StoredDailyQuota => {
  const quota = loadStoredQuota();

  quota.requestsToday += 1;
  quota.modelBreakdown[modelId] = (quota.modelBreakdown[modelId] || 0) + 1;

  if (usage) {
    quota.promptTokensToday += usage.promptTokens || 0;
    quota.candidateTokensToday += usage.candidateTokens || 0;
    quota.totalTokensToday += usage.totalTokens || (usage.promptTokens + usage.candidateTokens);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quota));
  } catch (err) {
    console.warn("Failed to persist quota stats:", err);
  }

  return quota;
};

/**
 * Calculate estimated cost in USD based on input and output tokens
 */
export const calculateEstimatedCost = (
  promptTokens: number,
  candidateTokens: number,
  modelId: string
): number => {
  const spec = getModelSpec(modelId);
  const inputCost = (promptTokens / 1_000_000) * spec.inputPricePerMillion;
  const outputCost = (candidateTokens / 1_000_000) * spec.outputPricePerMillion;
  return inputCost + outputCost;
};

export interface CascadeTier {
  model: string;
  name: string;
  maxRequests: number;
  badge: string;
}

export const CASCADE_MODEL_TIERS: CascadeTier[] = [
  { model: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', maxRequests: 20, badge: 'Phase 1 (Thinking & Depth)' },
  { model: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', maxRequests: 20, badge: 'Phase 2 (Deep Reasoning)' },
  { model: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', maxRequests: 20, badge: 'Phase 3 (Foundational Vision)' },
  { model: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', maxRequests: 1500, badge: 'Phase 4 (High-Volume Free Tier)' },
];

/**
 * Mark a model as exhausted for the current Pacific day so the auto-cascade skips it
 */
export const markModelExhaustedToday = (modelId: string): void => {
  const quota = loadStoredQuota();
  if (!quota.exhaustedModelsToday) {
    quota.exhaustedModelsToday = [];
  }
  if (!quota.exhaustedModelsToday.includes(modelId)) {
    quota.exhaustedModelsToday.push(modelId);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quota));
  } catch (err) {
    console.warn("Failed to save exhausted model:", err);
  }
};

/**
 * Determine the best available model in the cascade chain based on today's usage and exhaustion
 */
export const getEffectiveCascadeModel = (): string => {
  const quota = loadStoredQuota();
  const exhausted = new Set(quota.exhaustedModelsToday || []);

  // Always evaluate tiers in strict priority order (3.7 -> 3.6 -> 3.5 -> 3.5-lite)
  for (const tier of CASCADE_MODEL_TIERS) {
    const count = quota.modelBreakdown[tier.model] || 0;
    if (!exhausted.has(tier.model) && count < tier.maxRequests) {
      return tier.model;
    }
  }

  return 'gemini-3.5-flash-lite';
};

/**
 * When a model hits quota or fails, get the next model down the cascade
 */
export const getNextCascadeModel = (currentModel: string): string | null => {
  const quota = loadStoredQuota();
  const exhausted = new Set(quota.exhaustedModelsToday || []);
  exhausted.add(currentModel);

  const currentIndex = CASCADE_MODEL_TIERS.findIndex(t => t.model === currentModel);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

  for (let i = startIndex; i < CASCADE_MODEL_TIERS.length; i++) {
    const tier = CASCADE_MODEL_TIERS[i];
    const count = quota.modelBreakdown[tier.model] || 0;
    if (!exhausted.has(tier.model) && count < tier.maxRequests) {
      return tier.model;
    }
  }

  if (currentModel !== 'gemini-3.5-flash-lite') {
    return 'gemini-3.5-flash-lite';
  }

  return null;
};

