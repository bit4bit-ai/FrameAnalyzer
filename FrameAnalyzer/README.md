# FrameAnalyzer (Video Frame Analyst)

**FrameAnalyzer** is an automated batch video frame analysis and metadata generation application engineered specifically for professional stock footage contributors (Getty Images, iStock, Shutterstock, Adobe Stock, Pond5, etc.). 

It combines client-side browser video decoding with Google Gemini multimodal AI reasoning to extract keyframes, inspect continuous video motion, and produce publication-ready titles, natural descriptions, and 50 controlled vocabulary keywords.

---

## Table of Contents

- [Overview & Workflow](#overview--workflow)
- [Key Features](#key-features)
  - [1. Temporal 3-Frame Extraction](#1-temporal-3-frame-extraction)
  - [2. Gemini Multimodal Reasoning](#2-gemini-multimodal-reasoning)
  - [3. Getty Images Controlled Vocabulary Standards](#3-getty-images-controlled-vocabulary-standards)
  - [4. Master Keyword Database (YouTube Studio-Style)](#4-master-keyword-database-youtube-studio-style)
  - [5. Settings & API Management](#5-settings--api-management)
  - [6. File System Access & Auto-Saving](#6-file-system-access--auto-saving)
  - [7. Rate Limiting & Queue Resilience](#7-rate-limiting--queue-resilience)
  - [8. Full State & Job Session Persistence](#8-full-state--job-session-persistence-refresh--crash-resilience)
- [Application Architecture](#application-architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Quick Start (Windows `start.bat`)](#quick-start-windows-startbat)
  - [Manual Installation](#manual-installation)
- [Project Structure](#project-structure)
- [Model Selection & Cost Efficiency](#model-selection--cost-efficiency)
- [License](#license)

---

## Overview & Workflow

```
[Select Folder] ──> [Scan Videos Recursively]
                         │
                         ▼
             [Extract 3 Keyframes] (Start, Middle, End)
                         │
                         ▼
             [Gemini Multimodal Analysis] (API Reasoning)
             ├── Checks Master Keyword Database First
             ├── Identifies Subjects, Motion, Lighting, Locations
             └── Generates Title + Description + 50 CV Keywords
                         │
                         ▼
             [Save Results In-Place]
             ├── first_frame.jpg
             ├── middle_frame.jpg
             ├── last_frame.jpg
             └── analysis.txt
                         │
                         ▼
             [Optional: 1-Click ZIP Export]
```

1. **Select Video Directory**: Pick any local directory containing footage (`.mp4`, `.mov`, `.webm`, `.mkv`, `.avi`). Subdirectories are automatically scanned recursively.
2. **Batch Processing**: The app runs through the queue with managed concurrency and rate-limit intervals.
3. **In-Place Output**: Each video gets a dedicated folder created right beside the original video file containing extracted JPEG keyframes and `analysis.txt`.
4. **ZIP Archive**: Completed batches can be exported as a consolidated `.zip` file at any time.

---

## Key Features

### 1. Temporal 3-Frame Extraction
- **Zero External Dependencies**: Uses native HTML5 `<video>` and `<canvas>` elements to decode video directly inside the browser—no FFmpeg or server-side video pipelines required.
- **Smart Sampling**: Extracts three keyframes per video:
  - **Start**: `10%` mark of the video duration.
  - **Middle**: `50%` mark.
  - **End**: `90%` mark.
- **Aspect-Preserving Normalization**: Frames are capped to `1024px` max dimension with preserved aspect ratio, optimizing payload size for Gemini multimodal inspection without loss of visual detail.
- **Hardware Throttling Prevention**: Implements singleton decoders with audio disabled and canvas alpha off to prevent decoder exhaustion during large batch runs.

### 2. Gemini Multimodal Reasoning
- **Multi-Frame Continuity**: Sends all 3 frames simultaneously in a single API interaction. Gemini evaluates the temporal relationship between frames (e.g. subject motion, camera pan, changing light, panning scenery).
- **Current Model Support**:
  - **`gemini-3.6-flash`** *(Default & Recommended)*: High throughput, sub-second latency, and lowest cost.
  - **`gemini-3.7-flash`**: High-speed, efficient execution model.
  - **`gemini-3.8-flash`**: Highest intelligence flash model for complex scenes and obscure visual landmarks.
  - **`gemini-3-flash-preview`**: Experimental preview model.

### 3. Getty Images Controlled Vocabulary Standards
The built-in prompt enforces stock photography and footage metadata criteria:
- **Title**: Formatted strictly as `"[Subject] [Action] [Context/Location]"` (e.g. *"Lone car driving across the open plains on a road trip through the American West, Montana, USA"*).
- **Description**: 3–5 sentences of natural, editorial prose detailing lighting, perspective, colors, emotions, human activities, visible locations, and commercial use-case ideas.
- **Exact 50 Keywords**: Generates exactly 50 terms conforming to Getty Images Controlled Vocabulary (CV):
  - **Database-First Priority**: Picks matching terms from the user's master approved database first.
  - **Mandatory People Tags**: Automatically detects presence/absence (`"no people"`, `"real people"`, `"one person"`, `"two people"`, `"men"`, `"women"`, etc.).
  - **Mandatory Location Tags**: Automatically assigns country, state/province, city, national park, landmark, and continent tags if recognized.
  - **Technical Tags**: Adds appropriate technical tags (`"4k resolution"`, `"copy space"`, `"interior"`, `"exterior"`, etc.).
  - **Singular Form**: Enforces singular nouns (e.g. `"tree"` rather than `"trees"`).

### 4. Master Keyword Database (YouTube Studio-Style)
- **Persistent Storage**: Keywords are stored in `keywords.json` and served via Vite backend middleware (`GET/POST /api/keywords`).
- **Interactive Staging Manager**:
  - Add single keywords or paste massive comma/newline/tab/semicolon delimited lists.
  - **Strict Exact-Duplicate Filtering**: Case-insensitive whole-term duplicate suppression prevents identical tags while preserving distinct multi-word phrases (e.g. `"sun"` and `"hot sun"` remain separate).
  - Visual tag chips with individual deletion buttons and real-time counter.
  - **Auto-Clearing**: Text input and staged chips are automatically cleared upon committing to the database.
  - Search, filter, clear database, and import/export capabilities.

### 5. Settings & API Management
- **In-App Settings Dialog**: Accessible anytime via the header gear icon or the model selector button above the prompt.
- **Secure Key Input**: Masked password field with show/hide toggle.
- **Live Key Testing**: Click **Test Key** to perform a live handshake with Google Gemini API to verify validity and quota availability before running batches.
- **Instant Dual-Layer Persistence**:
  - Saved immediately to `localStorage` for instant client-side execution without reloading.
  - Automatically written to `.env.local` on disk via `POST /api/settings` to persist across restarts.

### 6. File System Access & Auto-Saving
- **Direct File System Access API**: Uses `window.showDirectoryPicker()` to gain direct read/write access to user-selected folders.
- **Automated Directory Organization**: Saves output files in-place:
  ```
  /SelectedFolder/
    ├── clip_01.mp4
    ├── clip_01/
    │   ├── first_frame.jpg
    │   ├── middle_frame.jpg
    │   ├── last_frame.jpg
    │   └── analysis.txt
    └── clip_02.mp4
  ```
- **Fallback Read-Only Mode**: In browsers or environments without File System Access API support, an `<input type="file" webkitdirectory>` fallback allows reading video folders, with batch results exportable via **Export All (ZIP)**.

### 7. Rate Limiting & Queue Resilience
- **Safe Request Pacing**: Default 15-second interval between API calls to conform to Google Gemini Free Tier limits (15 Requests Per Minute).
- **Auto-Retry Loop**: Automatically retries failed videos up to 3 times before marking them with an error status.
- **Quota Guard Modal**: If an API quota is exhausted (`429 RESOURCE_EXHAUSTED`), processing halts automatically and displays an alert modal to avoid burning through connection attempts.
- **Independent Controls**: Start, Pause, Stop, and Retry Errors buttons with live counts (Found, Done, Errors).

### 8. Full State & Job Session Persistence (Refresh & Crash Resilience)
- **Zero Data Loss on Refresh**: All configuration settings, text inputs, and running batch jobs are persisted automatically so refreshing the browser never loses your work:
  - **AI Prompt**: Saved to `localStorage` as you type, with an instant "Reset Default" button to revert to the default template anytime.
  - **Pasted & Staged Keywords**: Inputs, bulk text, and staged keyword chips are preserved across refreshes until explicitly committed to the database.
  - **API Key & Selected Model**: Stored in `localStorage` and synchronized with `.env.local` on disk.
  - **Active Job Run & Queue (IndexedDB)**: Complete video queue state (file names, paths, extracted keyframes, completed analysis texts, and errors) is persisted to browser IndexedDB (`FrameAnalyzerSessionDB`), avoiding browser 5MB `localStorage` limits.
  - **Automatic Job Continuation**: If the page is refreshed while an analysis is running, the app restores the queue, verifies directory access permissions, and prompts to resume processing or auto-resumes smoothly with no duplicate work.


---

## Application Architecture

```
FrameAnalyzer/
├── App.tsx                      # Main application view, state orchestration & batch queue
├── constants.ts                 # Default model definition and Getty Images metadata prompt
├── types.ts                     # TypeScript definitions (VideoFile, ProcessingStatus, etc.)
├── index.html                   # HTML entry point with modern Inter font
├── vite.config.ts               # Vite dev server + /api/keywords and /api/settings middleware
├── start.bat                    # One-click Windows launch script
├── components/
│   ├── VideoCard.tsx            # Video card with thumbnail previews, status badges & path display
│   ├── KeywordManager.tsx       # YouTube Studio-style tag staging & database management
│   └── SettingsModal.tsx        # Settings dialog for Gemini API key and model selection
└── services/
    ├── fileSystem.ts            # HTML5 video frame extractor, recursive directory scanner, ZIP exporter
    ├── geminiService.ts         # Google GenAI SDK integration with dynamic model & prompt construction
    ├── keywordService.ts        # Client-side API client for keywords.json persistence
    └── settingsService.ts       # Settings persistence (localStorage + .env.local) & live key testing
```

---

## Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or later recommended).
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/).

### Quick Start (Windows `start.bat`)
Double-click `start.bat` in the project folder. The script will:
1. Verify that Node.js is installed.
2. Check for an active API key in `.env.local` / `.env`.
3. Launch the Vite development server on `http://localhost:3000`.
4. Automatically open your default browser.

### Manual Installation
1. Clone or download the repository:
   ```bash
   git clone https://github.com/bit4bit-ai/FrameAnalyzer.git
   cd FrameAnalyzer
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set your Gemini API key in `.env.local`:
   ```bash
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
   *(You can also configure the API key directly in the app's Settings dialog).*
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in Google Chrome or Microsoft Edge (recommended for direct File System Access API support).

---

## Project Structure

| File / Folder | Purpose |
| :--- | :--- |
| `start.bat` | Windows batch launcher for zero-configuration startup |
| `vite.config.ts` | Server configuration with custom REST endpoints for keywords and settings |
| `components/VideoCard.tsx` | UI card for each video file displaying extracted frames, status, and path |
| `components/KeywordManager.tsx` | Staging area and tag management for the Getty Images keyword database |
| `components/SettingsModal.tsx` | Dialog for updating API keys, testing keys, and choosing Gemini models |
| `services/fileSystem.ts` | Video decoding, frame extraction, directory scanning, and ZIP creation |
| `services/geminiService.ts` | `@google/genai` API client with prompt injection and fallback handling |
| `services/settingsService.ts` | Local storage management, disk sync, and API key connection tests |
| `keywords.json` | Master persistent database of approved stock keywords |

---

## Model Selection & Cost Efficiency

You can switch between Gemini models at any time via the **Model** button in the header or the **Settings** dialog:

| Model | Speed | Cost (per 1M In / Out) | Best For |
| :--- | :--- | :--- | :--- |
| **`gemini-3.6-flash`** *(Recommended)* | ~1.2s | **$0.75 / $3.75** (Free tier available) | High-volume batch footage analysis; lowest cost per frame |
| **`gemini-3.7-flash`** | ~1.0s | **$0.75 / $3.75** | Everyday fast execution and multi-step tasks |
| **`gemini-3.8-flash`** | ~2.0s | Standard Flash pricing | Complex visual reasoning, obscure landmarks & specific species |

> **Cost Estimate with `gemini-3.6-flash`:**  
> Analyzing a 3-frame video clip costs approximately **$0.0015** (less than one-sixth of a cent).  
> **$1.00** can analyze approximately **650–700 videos** (~2,100 frames).

---

## License

MIT License. Designed and built with Google Gemini multimodal AI.
