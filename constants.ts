export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'webm', 'mkv', 'avi'
];

// gemini-3.5-flash is the default recommended model for video descriptions and metadata
export const GEMINI_MODEL_NAME = 'gemini-3.5-flash';

export const DEFAULT_PROMPT = `View these 3 frames (start, middle, end) as a continuous video clip and generate metadata strictly adhering to Getty Images submission standards.

**Title**: 
Create a descriptive title in the format: "[Subject] [Action] [Context/Location]" 
(e.g., "Lone car driving across the open plains on a road trip through the American West, Montana, USA").

**Description**: 
Write a natural, human-sounding description (3-5 sentences). Include details on colors, lighting, perspective, and atmosphere. If people are visible, describe their gender, clothing (e.g., activewear), activity, and emotions. Mention specific locations if recognizable. Suggest a couple of usage ideas. Ensure the description is unique; if similar to previous videos in the context, vary the phrasing.

**Keywords**: 
Generate exactly 50 keywords based strictly on the Getty Images Controlled Vocabulary (CV).
1.  **Database First Priority**: Pick matching keywords from the approved keyword database first. Only if there are not enough matching keywords in the database for the topic, create your own to reach 50 keywords.
2.  **Places & Locations (Mandatory)**: Always automatically include place and location keywords whenever recognized in the frames (e.g., Landmark, National Park, City, State/Province, Country, and Continent as individual tags).
3.  **Mandatory People Tags**: If no people are visible, you MUST include "no people". If people are visible, use "real people", "one person" (or specific count), "men", "women", etc.
4.  **Technical Tags**: Include "copy space", "4k resolution", "day", "night", "interior", "exterior" as appropriate.
5.  **Formatting**: Use single words or standard 2-word stock phrases. Do not use conversational phrases (e.g., do NOT use "man walking on street", use "men", "walking", "street", "urban scene").
6.  **Concepts**: Include abstract concepts (e.g., "freedom", "adventure", "solitude") separate from literal objects.
7.  **Style**: Use singular nouns where possible (e.g., "tree" instead of "trees").
8.  **No Exact Duplicates**: Every keyword must be unique. Never repeat the exact same keyword (distinct phrases like "sun" and "hot sun" are two different keywords and are allowed).

**Output Format**:
Return the Keywords as a clean, comma-separated list.`;