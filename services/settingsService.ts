import { GoogleGenAI } from '@google/genai';

const API_KEY_STORAGE_KEY = 'frame_analyzer_gemini_api_key';
const MODEL_STORAGE_KEY = 'frame_analyzer_gemini_model';

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export interface AppSettings {
  apiKey: string;
  model: string;
}

/**
 * Get the active Gemini API Key (checking localStorage first, then /api/settings, then process.env)
 */
export const getActiveApiKey = (): string => {
  const local = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (local && local.trim()) return local.trim();
  return (process.env.API_KEY || '').trim();
};

/**
 * Get the active Model name
 */
export const getActiveModel = (): string => {
  const local = localStorage.getItem(MODEL_STORAGE_KEY);
  if (local && local.trim() && !local.includes('gemini-2.5')) return local.trim();
  return DEFAULT_MODEL;
};

/**
 * Load settings from server and localStorage
 */
export const loadSettings = async (): Promise<AppSettings> => {
  let apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  let model = localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  if (model.includes('gemini-2.5')) {
    model = DEFAULT_MODEL;
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  }

  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.apiKey && !apiKey) {
        apiKey = data.apiKey;
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
      }
    }
  } catch (err) {
    console.warn('Could not fetch /api/settings, using local/env values', err);
  }

  if (!apiKey) {
    apiKey = (process.env.API_KEY || '').trim();
  }

  return { apiKey, model };
};

/**
 * Save settings to localStorage and update .env.local on disk via /api/settings
 */
export const saveSettings = async (apiKey: string, model: string): Promise<boolean> => {
  const cleanKey = apiKey.trim();
  localStorage.setItem(API_KEY_STORAGE_KEY, cleanKey);
  localStorage.setItem(MODEL_STORAGE_KEY, model);

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cleanKey, model }),
    });
    return res.ok;
  } catch (err) {
    console.warn('Could not save to /api/settings, saved to localStorage only:', err);
    return true;
  }
};

/**
 * Test a Gemini API Key with a lightweight ping
 */
export const testGeminiApiKey = async (apiKey: string, modelToTest?: string): Promise<{ success: boolean; message: string }> => {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, message: 'API key cannot be empty.' };
  }

  const model = (modelToTest || getActiveModel() || DEFAULT_MODEL).trim();

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    const response = await ai.models.generateContent({
      model: model,
      contents: 'Ping. Reply with "pong".',
    });

    if (response && response.text) {
      return { success: true, message: `Connection successful! (${model}) is responsive.` };
    }
    return { success: false, message: 'Received empty response from Gemini.' };
  } catch (err: any) {
    return { success: false, message: err.message || 'Failed to authenticate API key.' };
  }
};
