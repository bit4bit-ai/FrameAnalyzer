import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL_NAME } from "../constants";
import { getActiveApiKey, getActiveModel } from "./settingsService";

export interface AnalysisResultWithUsage {
  text: string;
  usage?: {
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
  };
}

export const generateVideoAnalysis = async (
  prompt: string,
  base64Images: string[],
  previousDescriptions: string[] = [],
  keywordPool: string[] = [],
  customApiKey?: string,
  customModel?: string
): Promise<AnalysisResultWithUsage> => {
  const apiKey = (customApiKey || getActiveApiKey()).trim();

  if (!apiKey) {
    throw new Error("API Key is missing. Please click Settings (gear icon) in the header to enter your Gemini API key.");
  }

  const modelToUse = customModel || getActiveModel() || GEMINI_MODEL_NAME;
  const ai = new GoogleGenAI({ apiKey });

  try {
    const parts = [];

    // Add images
    for (const base64 of base64Images) {
      // Strip prefix if present (data:image/jpeg;base64,)
      const parts_base64 = base64.split(',');
      const cleanBase64 = parts_base64[1] || base64;
      
      // Determine actual mimeType from dataURL if possible, fallback to image/jpeg
      let mimeType = 'image/jpeg';
      if (parts_base64[0].includes('image/png')) mimeType = 'image/png';
      
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64,
        },
      });
    }

    // Construct Contextual Prompt
    let finalPrompt = prompt;
    
    // Inject Target Keyword Pool if available (Option A: filter & prioritize)
    if (keywordPool && keywordPool.length > 0) {
      if (keywordPool.length <= 5000) {
        finalPrompt += `

TARGET / APPROVED KEYWORD DATABASE:
The user has provided a curated database of target keywords:
[ ${keywordPool.join(", ")} ]

KEYWORD GENERATION INSTRUCTIONS:
1. DATABASE FIRST PRIORITY: You MUST pick matching keywords from the approved database list above first.
2. CREATE ONLY WHEN NEEDED: Only if there are not enough matching keywords in the database for the topic/scene to reach the required 50 keywords, create your own additional keywords following Getty Images Controlled Vocabulary standards.
3. PLACES & LOCATIONS (ALWAYS MANDATORY): If any location, place, landmark, park, mountain, water body, city, state, country, or continent is recognizable in the video frames, ALWAYS automatically include those place keywords.
4. NO EXACT DUPLICATES: Ensure all keywords are strictly unique with zero exact duplicates. Do not repeat the exact same keyword (note: distinct phrases such as "sun" and "hot sun" are two different keywords and are fully permitted).`;
      } else {
        // For massive taxonomy datasets (e.g. 80k+ Getty Controlled Vocabulary terms),
        // we instruct the model on the full vocabulary standard to prevent exceeding API TPM token limits.
        finalPrompt += `

TARGET / APPROVED KEYWORD DATABASE:
The user's database contains ${keywordPool.length.toLocaleString()} approved Getty Images Controlled Vocabulary terms.

KEYWORD GENERATION INSTRUCTIONS:
1. DATABASE FIRST PRIORITY: You MUST select keywords matching the scene from the approved database first.
2. CREATE ONLY WHEN NEEDED: Only if there are not enough matching keywords in the database for the topic/scene to reach the required 50 keywords, create your own additional keywords following Getty Images Controlled Vocabulary standards.
3. PLACES & LOCATIONS (ALWAYS MANDATORY): If any location, place, landmark, park, mountain, water body, city, state, country, or continent is recognizable in the video frames, ALWAYS automatically include those place keywords.
4. NO EXACT DUPLICATES: Ensure all keywords are strictly unique with zero exact duplicates. Do not repeat the exact same keyword (note: distinct phrases such as "sun" and "hot sun" are two different keywords and are fully permitted).`;
      }
    }

    if (previousDescriptions.length > 0) {
      // We take the last 5 descriptions to keep context relevant but not overwhelming
      const recentHistory = previousDescriptions.slice(-5).map((desc, i) => `(Video ${i + 1}): ${desc}`).join("\n");
      
      finalPrompt = `
CONTEXT - PREVIOUS VIDEO DESCRIPTIONS:
The following are descriptions of other videos in this directory. The current video might be very similar. 
Your goal is to write a FRESH and UNIQUE description for the current video. 
Avoid repeating the exact same sentence structures or phrasing used below.
---
${recentHistory}
---

CURRENT TASK:
${finalPrompt}`;
    }

    // Add text prompt
    parts.push({ text: finalPrompt });

    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: {
        parts: parts,
      },
    });

    const rawText = response.text || "No analysis generated.";
    const cleanText = cleanDuplicateKeywordsInText(rawText);

    let usage: { promptTokens: number; candidateTokens: number; totalTokens: number } | undefined;
    if (response.usageMetadata) {
      const promptTokens = response.usageMetadata.promptTokenCount || 0;
      const candidateTokens = response.usageMetadata.candidatesTokenCount || 0;
      const totalTokens = response.usageMetadata.totalTokenCount || (promptTokens + candidateTokens);
      usage = { promptTokens, candidateTokens, totalTokens };
    }

    return {
      text: cleanText,
      usage,
    };
  } catch (error: any) {
    let message = "Unknown error connecting to Gemini.";
    
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'object' && error !== null) {
      if (error.error) {
        const code = error.error.code ? `[${error.error.code}] ` : '';
        const status = error.error.status ? `[${error.error.status}] ` : '';
        const msg = error.error.message || JSON.stringify(error.error);
        message = `${code}${status}${msg}`;
        console.warn(`Gemini API Error details: ${message}`);
      } else {
        message = JSON.stringify(error);
        console.warn(`Gemini API Error object:`, error);
      }
    }
    
    throw new Error(message);
  }
};

/**
 * Strips exact duplicate keywords from the generated Keywords section,
 * while strictly preserving distinct multi-word phrases (e.g. 'sun' and 'hot sun' are both kept).
 */
export const cleanDuplicateKeywordsInText = (text: string): string => {
  if (!text) return text;

  return text.replace(
    /((?:\*\*Keywords\*\*|Keywords)\s*:\s*)([\s\S]*?)(?=(?:\n\s*\n\s*\*\*|\n\s*\n\s*[A-Z][a-zA-Z\s]+:|$))/i,
    (match, label, keywordContent) => {
      const tags = keywordContent.split(/,\s*/);
      const seen = new Set<string>();
      const uniqueTags: string[] = [];

      for (const tag of tags) {
        const cleanTag = tag.trim();
        if (!cleanTag) continue;
        const lower = cleanTag.toLowerCase();
        // Exact complete-phrase matching: only completely identical items are filtered
        if (!seen.has(lower)) {
          seen.add(lower);
          uniqueTags.push(cleanTag);
        }
      }

      return `${label}\n${uniqueTags.join(', ')}`;
    }
  );
};

export interface ExtractedLocation {
  location: string;
  score: number; // 100: specific landmark/park, 80: city, 40: region/state, 20: country, 5: continent
}

// Landmark Normalizations map: maps lowercase terms to clean specific display names
const LANDMARK_NAME_MAP: Record<string, string> = {
  'yosemite': 'Yosemite',
  'yosemite national park': 'Yosemite',
  'yosemite valley': 'Yosemite',
  'half dome': 'Yosemite',
  'el capitan': 'Yosemite',
  'yellowstone': 'Yellowstone',
  'yellowstone national park': 'Yellowstone',
  'old faithful': 'Yellowstone',
  'grand canyon': 'Grand Canyon',
  'grand canyon national park': 'Grand Canyon',
  'horseshoe bend': 'Horseshoe Bend',
  'antelope canyon': 'Antelope Canyon',
  'zion': 'Zion',
  'zion national park': 'Zion',
  'bryce canyon': 'Bryce Canyon',
  'bryce canyon national park': 'Bryce Canyon',
  'joshua tree': 'Joshua Tree',
  'joshua tree national park': 'Joshua Tree',
  'death valley': 'Death Valley',
  'death valley national park': 'Death Valley',
  'glacier': 'Glacier',
  'glacier national park': 'Glacier',
  'grand teton': 'Grand Teton',
  'grand teton national park': 'Grand Teton',
  'monument valley': 'Monument Valley',
  'big sur': 'Big Sur',
  'lake tahoe': 'Lake Tahoe',
  'lake como': 'Lake Como',
  'lake garda': 'Lake Garda',
  'lake bled': 'Lake Bled',
  'mount rainier': 'Mount Rainier',
  'mount fuji': 'Mount Fuji',
  'matterhorn': 'Matterhorn',
  'mont blanc': 'Mont Blanc',
  'dolomites': 'Dolomites',
  'crater lake': 'Crater Lake',
  'arches national park': 'Arches',
  'delicate arch': 'Arches',
  'canyonlands': 'Canyonlands',
  'capitol reef': 'Capitol Reef',
  'acadia': 'Acadia',
  'acadia national park': 'Acadia',
  'everglades': 'Everglades',
  'everglades national park': 'Everglades',
  'great smoky mountains': 'Great Smoky Mountains',
  'smoky mountains': 'Great Smoky Mountains',
  'sequoia': 'Sequoia',
  'sequoia national park': 'Sequoia',
  'kings canyon': 'Kings Canyon',
  'olympic national park': 'Olympic',
  'banff': 'Banff',
  'banff national park': 'Banff',
  'lake louise': 'Lake Louise',
  'moraine lake': 'Moraine Lake',
  'jasper': 'Jasper',
  'torres del paine': 'Torres del Paine',
  'niagara falls': 'Niagara Falls',
  'iguazu falls': 'Iguazu Falls',
  'victoria falls': 'Victoria Falls',
  'amalfi coast': 'Amalfi Coast',
  'cinque terre': 'Cinque Terre',
  'positano': 'Positano',
  'capri': 'Capri',
  'santorini': 'Santorini',
  'mykonos': 'Mykonos',
  'oia': 'Oia',
  'golden gate bridge': 'Golden Gate Bridge',
  'alcatraz': 'Alcatraz',
  'central park': 'Central Park',
  'times square': 'Times Square',
  'brooklyn bridge': 'Brooklyn Bridge',
  'empire state building': 'Empire State Building',
  'statue of liberty': 'Statue of Liberty',
  'manhattan': 'Manhattan',
  'brooklyn': 'Brooklyn',
  'eiffel tower': 'Eiffel Tower',
  'louvre': 'Louvre',
  'notre dame': 'Notre Dame',
  'arc de triomphe': 'Arc de Triomphe',
  'colosseum': 'Colosseum',
  'vatican': 'Vatican',
  'trevi fountain': 'Trevi Fountain',
  'sagrada familia': 'Sagrada Familia',
  'park guell': 'Park Güell',
  'acropolis': 'Acropolis',
  'parthenon': 'Parthenon',
  'big ben': 'Big Ben',
  'tower bridge': 'Tower Bridge',
  'shibuya': 'Shibuya',
  'shinjuku': 'Shinjuku',
  'waikiki': 'Waikiki',
  'hollywood': 'Hollywood',
  'beverly hills': 'Beverly Hills',
  'santa monica': 'Santa Monica',
  'venice beach': 'Venice Beach',
  'south beach': 'South Beach',
};

// Cities (Score 80)
const KNOWN_CITIES = new Set([
  'san francisco', 'los angeles', 'san diego', 'san jose', 'sacramento', 'monterey', 'carmel', 'santa barbara', 'palm springs',
  'las vegas', 'reno', 'phoenix', 'scottsdale', 'tucson', 'flagstaff', 'sedona',
  'seattle', 'portland', 'spokane', 'tacoma',
  'denver', 'boulder', 'aspen', 'vail', 'salt lake city', 'moab', 'park city',
  'austin', 'dallas', 'houston', 'san antonio', 'el paso',
  'chicago', 'minneapolis', 'detroit', 'cleveland', 'milwaukee',
  'miami', 'orlando', 'tampa', 'key west', 'fort lauderdale', 'naples',
  'new york city', 'new york', 'boston', 'philadelphia', 'pittsburgh', 'washington dc', 'baltimore',
  'nashville', 'memphis', 'new orleans', 'atlanta', 'savannah', 'charleston',
  'honolulu', 'anchorage', 'fairbanks', 'juneau',
  'paris', 'nice', 'cannes', 'marseille', 'lyon', 'bordeaux',
  'rome', 'florence', 'venice', 'milan', 'naples', 'verona', 'bologna', 'palermo',
  'london', 'edinburgh', 'manchester', 'liverpool', 'oxford', 'cambridge', 'bath', 'dublin',
  'barcelona', 'madrid', 'seville', 'valencia', 'granada', 'malaga', 'bilbao',
  'berlin', 'munich', 'hamburg', 'frankfurt', 'cologne', 'dresden',
  'vienna', 'salzburg', 'innsbruck',
  'zurich', 'geneva', 'lucerne', 'interlaken', 'zermatt',
  'amsterdam', 'rotterdam', 'the hague', 'brussels', 'bruges', 'antwerp',
  'prague', 'budapest', 'warsaw', 'krakow', 'copenhagen', 'stockholm', 'oslo', 'helsinki', 'reykjavik',
  'athens', 'santorini', 'mykonos', 'istanbul',
  'tokyo', 'kyoto', 'osaka', 'nara', 'hiroshima', 'sapporo',
  'seoul', 'busan', 'beijing', 'shanghai', 'hong kong', 'taipei',
  'bangkok', 'chiang mai', 'phuket', 'singapore', 'kuala lumpur', 'bali', 'jakarta', 'hanoi', 'ho chi minh city',
  'sydney', 'melbourne', 'brisbane', 'perth', 'auckland', 'queenstown',
  'vancouver', 'toronto', 'montreal', 'quebec city', 'calgary', 'ottawa',
  'dubai', 'abu dhabi', 'doha', 'cairo', 'cape town'
]);

// States & Regions (Score 40)
const KNOWN_REGIONS = new Set([
  'california', 'florida', 'texas', 'hawaii', 'alaska', 'colorado', 'utah', 'arizona',
  'washington', 'washington state', 'oregon', 'montana', 'wyoming', 'nevada', 'idaho', 'new mexico',
  'illinois', 'ohio', 'pennsylvania', 'north carolina', 'south carolina', 'georgia', 'tennessee', 'virginia', 'massachusetts',
  'bavaria', 'tuscany', 'provence', 'andalusia', 'catalonia', 'lombardy', 'sicily', 'sardinia', 'tyrol', 'scotland', 'wales',
  'ontario', 'quebec', 'british columbia', 'alberta', 'new south wales', 'queensland',
  'alps', 'rocky mountains', 'appalachians', 'pyrenees', 'andes'
]);

// Countries (Score 20)
const KNOWN_COUNTRIES = new Set([
  'united states', 'usa', 'united kingdom', 'uk', 'germany', 'france', 'italy', 'spain', 'japan', 'china',
  'canada', 'australia', 'switzerland', 'austria', 'greece', 'norway', 'sweden', 'iceland', 'netherlands',
  'ireland', 'portugal', 'mexico', 'brazil', 'egypt', 'south africa', 'turkey', 'thailand', 'vietnam',
  'india', 'indonesia', 'new zealand', 'philippines', 'malaysia'
]);

// Continents (Score 5)
const KNOWN_CONTINENTS = new Set([
  'north america', 'south america', 'europe', 'asia', 'africa', 'oceania'
]);

const evaluateCandidate = (candidate: string): ExtractedLocation | null => {
  if (!candidate) return null;
  const clean = candidate.replace(/["'*]/g, '').trim();
  const lower = clean.toLowerCase();

  const stopWords = ['4k', 'hd', 'copy space', 'slow motion', 'timelapse', 'real time', 'fps', 'day', 'night', 'background', 'scenic', 'view', 'footage', 'clip', 'video'];
  if (stopWords.some(w => lower === w || lower.includes('4k') || lower.includes('resolution'))) {
    return null;
  }

  // 1. Direct Landmark Map Match (Score 100)
  if (LANDMARK_NAME_MAP[lower]) {
    return { location: LANDMARK_NAME_MAP[lower], score: 100 };
  }

  // 2. Pattern Match for National/State Parks, Canyons, Valleys, Falls (Score 95)
  const parkMatch = clean.match(/^([A-Z][a-zA-Z\s]+?)\s+(?:National Park|State Park|National Monument|National Forest|Canyon|Valley|Falls|Glacier|Bridge)$/i);
  if (parkMatch && parkMatch[1]) {
    const base = parkMatch[1].trim();
    const lowerBase = base.toLowerCase();
    if (LANDMARK_NAME_MAP[lowerBase]) {
      return { location: LANDMARK_NAME_MAP[lowerBase], score: 100 };
    }
    const formatted = base.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { location: formatted, score: 95 };
  }

  // Search if string contains a known landmark (e.g. "Hiking in Yosemite Valley")
  for (const [k, v] of Object.entries(LANDMARK_NAME_MAP)) {
    if (lower === k || lower.includes(k)) {
      return { location: v, score: 100 };
    }
  }

  // 3. Known City (Score 80)
  if (KNOWN_CITIES.has(lower)) {
    const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { location: formatted, score: 80 };
  }

  // 4. Known Region / State (Score 40)
  if (KNOWN_REGIONS.has(lower)) {
    const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { location: formatted, score: 40 };
  }

  // 5. Known Country (Score 20)
  if (KNOWN_COUNTRIES.has(lower)) {
    if (lower === 'usa') return { location: 'USA', score: 20 };
    if (lower === 'uk') return { location: 'UK', score: 20 };
    const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { location: formatted, score: 20 };
  }

  // 6. Known Continent (Score 5)
  if (KNOWN_CONTINENTS.has(lower)) {
    const formatted = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { location: formatted, score: 5 };
  }

  return null;
};

/**
 * Extracts geographical location with specificity score.
 * Prioritizes: Specific Landmark/National Park (100) > City (80) > State/Region (40) > Country (20).
 * e.g., if a clip is in Yosemite, returns 'Yosemite' instead of 'California' or 'USA'.
 */
export const extractLocationDetails = (analysisText: string, promptText?: string): ExtractedLocation | null => {
  const candidates: ExtractedLocation[] = [];

  // 1. Explicit Location in Prompt
  if (promptText) {
    const promptMatch = promptText.match(/(?:location|place|city|country|filmed in|shot in|trip to|set in):\s*([^\r\n,]+(?:,\s*[^\r\n,]+)?)/i);
    if (promptMatch && promptMatch[1]) {
      const parts = promptMatch[1].split(',').map(p => p.trim());
      for (const p of parts) {
        const ev = evaluateCandidate(p);
        if (ev) candidates.push({ location: ev.location, score: ev.score + 5 });
      }
    }
  }

  if (!analysisText) {
    return candidates.length > 0 ? candidates.sort((a, b) => b.score - a.score)[0] : null;
  }

  // 2. Extract from Title
  const titleMatch = analysisText.match(/(?:\*\*Title\*\*|Title)\s*:\s*([^\r\n]+)/i);
  if (titleMatch && titleMatch[1]) {
    const cleanTitle = titleMatch[1].replace(/["'*]/g, '').trim();

    // Check prepositional phrases ("in [Location]", "at [Location]")
    const prepMatch = cleanTitle.match(/(?:in|at|over|near|through|around|along)\s+([^,.\r\n]+(?:,\s*[^,.\r\n]+)*)/i);
    if (prepMatch && prepMatch[1]) {
      const parts = prepMatch[1].split(',').map(p => p.trim());
      for (const p of parts) {
        const ev = evaluateCandidate(p);
        if (ev) candidates.push(ev);
      }
    }

    // Also check comma parts of title
    const commaParts = cleanTitle.split(',').map(p => p.trim());
    for (const p of commaParts) {
      const ev = evaluateCandidate(p);
      if (ev) candidates.push(ev);
    }
  }

  // 3. Extract from Keywords
  const kwMatch = analysisText.match(/(?:\*\*Keywords\*\*|Keywords)\s*:\s*([\s\S]+?)$/i);
  if (kwMatch && kwMatch[1]) {
    const keywords = kwMatch[1].split(/,\s*/).map(k => k.trim());
    for (const kw of keywords) {
      const ev = evaluateCandidate(kw);
      if (ev) candidates.push(ev);
    }
  }

  // 4. Extract from Description
  const descMatch = analysisText.match(/(?:\*\*Description\*\*|Description)\s*:\s*([\s\S]+?)(?=(?:\*\*Keywords\*\*|Keywords|$))/i);
  if (descMatch && descMatch[1]) {
    const locInDesc = descMatch[1].match(/(?:located in|filmed in|shot in|landmark of|set in)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)?)/i);
    if (locInDesc && locInDesc[1]) {
      const parts = locInDesc[1].split(',').map(p => p.trim());
      for (const p of parts) {
        const ev = evaluateCandidate(p);
        if (ev) candidates.push(ev);
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort candidates by score descending: most specific location wins
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
};

/**
 * Evaluates all candidates present in a single analysis text, returning unique locations with source context.
 */
export const extractAllLocationsFromAnalysis = (analysisText: string): { location: string; score: number; inTitle: boolean }[] => {
  const result: { location: string; score: number; inTitle: boolean }[] = [];
  const seenInVideo = new Set<string>();

  // 1. Title
  const titleMatch = analysisText.match(/(?:\*\*Title\*\*|Title)\s*:\s*([^\r\n]+)/i);
  if (titleMatch && titleMatch[1]) {
    const cleanTitle = titleMatch[1].replace(/["'*]/g, '').trim();
    const prepMatch = cleanTitle.match(/(?:in|at|over|near|through|around|along)\s+([^,.\r\n]+(?:,\s*[^,.\r\n]+)*)/i);
    if (prepMatch && prepMatch[1]) {
      const parts = prepMatch[1].split(',').map(p => p.trim());
      for (const p of parts) {
        const ev = evaluateCandidate(p);
        if (ev && !seenInVideo.has(ev.location)) {
          seenInVideo.add(ev.location);
          result.push({ location: ev.location, score: ev.score, inTitle: true });
        }
      }
    }
    const commaParts = cleanTitle.split(',').map(p => p.trim());
    for (const p of commaParts) {
      const ev = evaluateCandidate(p);
      if (ev && !seenInVideo.has(ev.location)) {
        seenInVideo.add(ev.location);
        result.push({ location: ev.location, score: ev.score, inTitle: true });
      }
    }
  }

  // 2. Keywords
  const kwMatch = analysisText.match(/(?:\*\*Keywords\*\*|Keywords)\s*:\s*([\s\S]+?)$/i);
  if (kwMatch && kwMatch[1]) {
    const keywords = kwMatch[1].split(/,\s*/).map(k => k.trim());
    for (const kw of keywords) {
      const ev = evaluateCandidate(kw);
      if (ev && !seenInVideo.has(ev.location)) {
        seenInVideo.add(ev.location);
        result.push({ location: ev.location, score: ev.score, inTitle: false });
      }
    }
  }

  // 3. Description
  const descMatch = analysisText.match(/(?:\*\*Description\*\*|Description)\s*:\s*([\s\S]+?)(?=(?:\*\*Keywords\*\*|Keywords|$))/i);
  if (descMatch && descMatch[1]) {
    const locInDesc = descMatch[1].match(/(?:located in|filmed in|shot in|landmark of|set in)\s+([A-Z][a-zA-Z\s]+(?:,\s*[A-Z][a-zA-Z\s]+)?)/i);
    if (locInDesc && locInDesc[1]) {
      const parts = locInDesc[1].split(',').map(p => p.trim());
      for (const p of parts) {
        const ev = evaluateCandidate(p);
        if (ev && !seenInVideo.has(ev.location)) {
          seenInVideo.add(ev.location);
          result.push({ location: ev.location, score: ev.score, inTitle: false });
        }
      }
    }
  }

  return result;
};

/**
 * Determines the most probable consensus location across ALL generated descriptions in a group.
 * Analyzes the frequency, specificity tier, and title placements across all videos in the group
 * rather than relying on just a single video/frame.
 */
export const determineConsensusGroupLocation = (
  analyses: string[], 
  promptText?: string
): { location: string; confidence: number } | null => {
  if (!analyses || analyses.length === 0) {
    if (promptText) {
      const loc = extractLocationDetails('', promptText);
      return loc ? { location: loc.location, confidence: loc.score } : null;
    }
    return null;
  }

  // Tally candidate frequency and title presence across all video analyses
  const tally = new Map<string, { location: string; score: number; videoCount: number; titleCount: number }>();

  for (const analysis of analyses) {
    if (!analysis || !analysis.trim()) continue;
    const locsInAnalysis = extractAllLocationsFromAnalysis(analysis);
    for (const item of locsInAnalysis) {
      if (!tally.has(item.location)) {
        tally.set(item.location, { location: item.location, score: item.score, videoCount: 0, titleCount: 0 });
      }
      const entry = tally.get(item.location)!;
      entry.videoCount += 1;
      if (item.inTitle) {
        entry.titleCount += 1;
      }
    }
  }

  // Factor in prompt if it specifically mentions a place
  if (promptText) {
    const promptLoc = extractLocationDetails('', promptText);
    if (promptLoc) {
      if (!tally.has(promptLoc.location)) {
        tally.set(promptLoc.location, { location: promptLoc.location, score: promptLoc.score, videoCount: 1, titleCount: 1 });
      } else {
        const entry = tally.get(promptLoc.location)!;
        entry.videoCount += 1;
        entry.titleCount += 1;
      }
    }
  }

  if (tally.size === 0) return null;

  // Calculate confidence = (baseScore * videoCount^1.25) + (titleCount * 25)
  let bestCandidate: { location: string; confidence: number } | null = null;
  let highestConfidence = -1;

  tally.forEach(({ location, score, videoCount, titleCount }) => {
    // High specificity (Landmarks=100, Cities=80) is heavily rewarded
    // Frequency across multiple videos provides high confidence consensus
    const frequencyWeight = Math.pow(videoCount, 1.25);
    const confidence = Math.round((score * frequencyWeight) + (titleCount * 25));

    if (confidence > highestConfidence) {
      highestConfidence = confidence;
      bestCandidate = { location, confidence };
    }
  });

  return bestCandidate;
};

/**
 * Convenience wrapper returning the top extracted location string.
 */
export const extractLocationFromAnalysis = (analysisText: string, promptText?: string): string | null => {
  const details = extractLocationDetails(analysisText, promptText);
  return details ? details.location : null;
};