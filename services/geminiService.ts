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