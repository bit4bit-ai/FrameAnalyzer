import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VideoFile, ProcessingStatus } from './types';
import { scanDirectoryForVideos, extractFramesFromVideo, saveFramesToDisk, scanFilesFromInput, saveAnalysisToDisk, packageAllVideosZip, formatThreeLevelPath, getCommonDirectoryPath } from './services/fileSystem';
import { generateVideoAnalysis } from './services/geminiService';
import { DEFAULT_PROMPT } from './constants';
import VideoCard from './components/VideoCard';
import KeywordManager from './components/KeywordManager';
import SettingsModal from './components/SettingsModal';
import { loadKeywords, saveKeywords } from './services/keywordService';
import { loadSettings, saveSettings, AppSettings, DEFAULT_MODEL } from './services/settingsService';
import { FolderOpen, Play, Settings, Loader2, AlertTriangle, Square, Ban, Info, Download } from 'lucide-react';

// Free Tier Limit: 15 Requests Per Minute (RPM).
// We add a conservative delay.
const RATE_LIMIT_INTERVAL_MS = 15000;

const App: React.FC = () => {
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [directoryName, setDirectoryName] = useState<string | null>(null);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  // Settings State (API Key & Model)
  const [settings, setSettings] = useState<AppSettings>({ apiKey: '', model: DEFAULT_MODEL });
  const settingsRef = useRef<AppSettings>({ apiKey: '', model: DEFAULT_MODEL });

  // Master Keyword Database State
  const [keywords, setKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  const [isSavingKeywords, setIsSavingKeywords] = useState(false);

  // Ref to hold the latest video state and keywords accessible inside async loops
  const videoFilesRef = useRef<VideoFile[]>([]);
  const keywordsRef = useRef<string[]>([]);
  const shouldStopRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep refs in sync with state
  useEffect(() => {
    videoFilesRef.current = videoFiles;
  }, [videoFiles]);

  useEffect(() => {
    keywordsRef.current = keywords;
  }, [keywords]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load initial settings and keywords on mount
  useEffect(() => {
    const initData = async () => {
      const [loadedSettings, loadedKeywords] = await Promise.all([
        loadSettings(),
        loadKeywords(),
      ]);
      setSettings(loadedSettings);
      setKeywords(loadedKeywords);
      setSavedKeywords(loadedKeywords);
    };
    initData();
  }, []);

  const handleSaveSettings = async (newApiKey: string, newModel: string) => {
    await saveSettings(newApiKey, newModel);
    setSettings({ apiKey: newApiKey, model: newModel });
  };

  const hasUnsavedChanges = JSON.stringify(keywords) !== JSON.stringify(savedKeywords);

  const handleSaveKeywords = async () => {
    setIsSavingKeywords(true);
    try {
      await saveKeywords(keywords);
      setSavedKeywords([...keywords]);
    } catch (err) {
      console.error('Failed to save keywords:', err);
    } finally {
      setIsSavingKeywords(false);
    }
  };

  const handleSelectDirectory = async () => {
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        setIsFallbackMode(false);
        
        const foundVideos = await scanDirectoryForVideos(dirHandle, dirHandle.name);
        setDirectoryName(dirHandle.name);

        const initialVideos: VideoFile[] = foundVideos.map((v, i) => ({
          id: `vid-${i}-${Date.now()}`,
          name: v.fileHandle.name,
          path: v.path,
          fileHandle: v.fileHandle,
          parentHandle: v.parentHandle,
          status: ProcessingStatus.PENDING,
          screenshots: [],
        }));

        setVideoFiles(initialVideos);
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn("File System Access API failed, falling back to input:", err);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFallbackInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsFallbackMode(true);
    const foundVideos = scanFilesFromInput(files);
    const folderName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : "Selected Folder";
    setDirectoryName(folderName);

    const initialVideos: VideoFile[] = foundVideos.map((v, i) => ({
      id: `vid-${i}-${Date.now()}`,
      name: v.file.name,
      path: v.path,
      file: v.file,
      status: ProcessingStatus.PENDING,
      screenshots: [],
    }));

    setVideoFiles(initialVideos);
  };

  const stopProcessing = () => {
    shouldStopRef.current = true;
    setStatusMessage("Stopping after current item...");
  };

  const handleManualSave = async (video: VideoFile): Promise<void> => {
    if (!video.parentHandle || !video.analysisResult) {
       console.error("Missing parent handle or analysis result");
       return;
    }
    
    try {
      await saveAnalysisToDisk(
        video.parentHandle, 
        video.name, 
        video.screenshots, 
        video.analysisResult
      );
    } catch (error) {
      console.error("Failed to save:", error);
      throw error;
    }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      await packageAllVideosZip(videoFilesRef.current);
      setStatusMessage("Export complete!");
      setTimeout(() => setStatusMessage(""), 3000);
    } catch (error: any) {
      console.error("Export failed:", error);
      alert(error.message || "Failed to create ZIP file.");
    } finally {
      setIsExporting(false);
    }
  };

  const processQueue = useCallback(async () => {
    if (isProcessing) return;
    
    shouldStopRef.current = false;
    setIsProcessing(true);
    setStatusMessage("Starting analysis...");
    setShowAbortModal(false);

    const queueIds = videoFilesRef.current.map(v => v.id);
    let lastApiCallTime = 0;
    let abortDueToQuota = false;
    
    // Maintain context history
    const processedDescriptions: string[] = videoFilesRef.current
      .filter(v => v.status === ProcessingStatus.COMPLETED && v.analysisResult)
      .map(v => v.analysisResult!);

    for (let i = 0; i < queueIds.length; i++) {
      if (shouldStopRef.current) break;

      const videoId = queueIds[i];
      let retryCount = 0;
      const MAX_RETRIES = 3;
      let isVideoComplete = false;

      // Retry loop for the current video
      while (!isVideoComplete && retryCount <= MAX_RETRIES) {
          if (shouldStopRef.current) break;
          
          // Get FRESH video state
          const currentVideo = videoFilesRef.current.find(v => v.id === videoId);

          // Skip conditions
          if (!currentVideo || currentVideo.status === ProcessingStatus.COMPLETED) {
            isVideoComplete = true;
            continue;
          }
          // Resume conditions: Pending, Error (retry), or Saving (if stuck)
          if (currentVideo.status !== ProcessingStatus.PENDING && currentVideo.status !== ProcessingStatus.ERROR && currentVideo.status !== ProcessingStatus.SAVING) {
            // e.g. EXTRACTING from a previous halted run
          }

          const videoName = currentVideo.name;

          // Helper to update state
          const updateStatus = (status: ProcessingStatus, updates: Partial<VideoFile> = {}) => {
            setVideoFiles(prev => prev.map(v => v.id === videoId ? { ...v, status, ...updates } : v));
          };

          try {
            // --- STEP 1: PREPARE FILES (Load & Extract) ---
            let screenshots = currentVideo.screenshots;
            
            if (screenshots.length === 0) {
                let file: File;
                if (currentVideo.file) {
                  file = currentVideo.file;
                } else if (currentVideo.fileHandle) {
                  file = await currentVideo.fileHandle.getFile();
                } else {
                  throw new Error("No file source available");
                }

                setStatusMessage(`Extracting frames: ${videoName}`);
                updateStatus(ProcessingStatus.EXTRACTING);
                
                await new Promise(r => setTimeout(r, 50)); 
                
                const frames = await extractFramesFromVideo(file);
                screenshots = frames.map(f => f.dataUrl);
                
                updateStatus(ProcessingStatus.SAVING, { screenshots });
                
                await saveFramesToDisk(currentVideo.parentHandle, videoName, frames);
            }

            // --- STEP 2: RATE LIMIT CHECK ---
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCallTime;
            
            if (timeSinceLastCall < RATE_LIMIT_INTERVAL_MS) {
              const waitTime = RATE_LIMIT_INTERVAL_MS - timeSinceLastCall;
              setStatusMessage(`Cooling down... ${(waitTime/1000).toFixed(1)}s`);
              updateStatus(ProcessingStatus.ANALYZING); 
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // --- STEP 3: ANALYZE ---
            setStatusMessage(retryCount > 0 
                ? `Retry ${retryCount}: Analyzing ${videoName}...`
                : `Analyzing ${videoName}...`
            );
            updateStatus(ProcessingStatus.ANALYZING);
            
            await new Promise(r => setTimeout(r, 50));

            const analysis = await generateVideoAnalysis(
              prompt, 
              screenshots, 
              processedDescriptions, 
              keywordsRef.current,
              settingsRef.current.apiKey,
              settingsRef.current.model
            );
            
            // Success!
            processedDescriptions.push(analysis);
            lastApiCallTime = Date.now();
            updateStatus(ProcessingStatus.COMPLETED, { analysisResult: analysis });
            isVideoComplete = true; 

          } catch (error: any) {
            console.warn(`Error processing ${videoName} (Attempt ${retryCount + 1}):`, error);
            
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            
            const isResourceExhausted = errorMessage.includes('RESOURCE_EXHAUSTED');
            const isRateLimit = errorMessage.includes('429') || 
                                errorMessage.includes('quota') || 
                                isResourceExhausted;

            // If it's the "RESOURCE_EXHAUSTED" error, it usually means the daily quota is hit.
            // There is no point retrying in 1 minute. Stop immediately.
            const effectiveMaxRetries = isResourceExhausted ? 0 : MAX_RETRIES;

            if (isRateLimit && retryCount < effectiveMaxRetries) {
                retryCount++;
                const delayMs = 60000 * Math.pow(2, retryCount - 1); // 60s, 120s...
                
                lastApiCallTime = Date.now(); 

                for (let s = delayMs/1000; s > 0; s--) {
                    if (shouldStopRef.current) break;
                    setStatusMessage(`Quota hit (429). Retrying in ${s}s...`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } else {
                // Non-recoverable or retries exhausted
                updateStatus(ProcessingStatus.ERROR, { 
                  error: isResourceExhausted ? "Quota Exceeded (Stopped)" : errorMessage
                });
                isVideoComplete = true;

                if (isRateLimit) {
                    abortDueToQuota = true;
                    shouldStopRef.current = true;
                }
            }
          }
      } // End retry loop

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setIsProcessing(false);
    
    if (abortDueToQuota) {
        setStatusMessage("⛔ Process Aborted: Daily/Billing Limit Reached.");
        setShowAbortModal(true);
    } else {
        setStatusMessage(shouldStopRef.current ? "Stopped by user." : "Queue processing finished.");
    }
  }, [prompt, isProcessing]);

  const pendingCount = videoFiles.filter(v => v.status === ProcessingStatus.PENDING).length;
  const completedCount = videoFiles.filter(v => v.status === ProcessingStatus.COMPLETED).length;
  const errorCount = videoFiles.filter(v => v.status === ProcessingStatus.ERROR).length;
  const totalCount = videoFiles.length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col items-center">
      {/* Abort Modal */}
      {showAbortModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-red-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 duration-200">
             <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 bg-red-500/10 rounded-full text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                   <Ban className="w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-white">Quota Exceeded</h2>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    The Gemini API returned a <strong>RESOURCE_EXHAUSTED</strong> error. 
                    This typically means the daily limit for the free tier has been reached.
                  </p>
                </div>
                
                <div className="text-xs text-slate-400 bg-slate-900/50 p-3 rounded-lg w-full flex items-start gap-2 text-left">
                   <Info className="w-4 h-4 shrink-0 text-slate-500 mt-0.5" />
                   <span>The queue has been stopped to prevent further errors. Please try again later (usually resets in 24h).</span>
                </div>

                <button 
                  onClick={() => setShowAbortModal(false)}
                  className="mt-2 w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-red-900/20 active:scale-95"
                >
                  Close
                </button>
             </div>
          </div>
        </div>
      )}

      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFallbackInputChange}
        className="hidden"
        multiple
        // @ts-ignore
        webkitdirectory="" 
        directory="" 
      />

      <header className="w-full max-w-5xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gradient-to-tr from-blue-500 to-purple-600 rounded-xl shadow-lg shadow-blue-500/20">
            <Play className="w-8 h-8 text-white" fill="currentColor" />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
              Video Frame Analyst
            </h1>
            <p className="text-slate-400 text-sm">Automated extraction & Gemini AI reasoning</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full border border-slate-700 hover:border-slate-600 transition-all shadow-sm flex items-center justify-center group"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-purple-400 group-hover:rotate-45 transition-transform duration-300" />
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl flex flex-col gap-6">
        
        {/* Controls Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm shadow-xl">
          <div className="flex flex-col md:flex-row gap-6">
            
            <div className="flex-1 flex flex-col gap-4">
               <label className="text-sm font-semibold text-slate-300">
                 Configuration
               </label>
               
               <div className="flex flex-wrap gap-3">
                 <button
                   onClick={handleSelectDirectory}
                   disabled={isProcessing}
                   className="flex items-center gap-2 px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                   <FolderOpen className="w-5 h-5" />
                   {directoryName ? 'Change' : 'Select'}
                 </button>

                 {!isProcessing ? (
                   <button
                     onClick={processQueue}
                     disabled={pendingCount === 0 && errorCount === 0}
                     className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all shadow-lg ${
                       (pendingCount > 0 || errorCount > 0)
                         ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:shadow-purple-500/25 text-white' 
                         : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                     }`}
                   >
                     <Play className="w-5 h-5" />
                     {errorCount > 0 && pendingCount === 0 ? 'Retry Errors' : `Start Analysis (${pendingCount})`}
                   </button>
                 ) : (
                   <button
                     onClick={stopProcessing}
                     className="flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all shadow-lg bg-red-500/80 hover:bg-red-600 text-white border border-red-500"
                   >
                     <Square className="w-4 h-4 fill-current" />
                     Stop Analysis
                   </button>
                 )}

                 <button
                   onClick={handleExportAll}
                   disabled={completedCount === 0 || isExporting}
                   className="flex items-center gap-2 px-5 py-3 bg-cyan-800 hover:bg-cyan-700 text-cyan-100 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                 >
                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    Export All (ZIP)
                 </button>
               </div>

               {/* Status Message Area */}
               <div className="h-6">
                  {statusMessage && (
                    <div className={`flex items-center gap-2 text-xs animate-pulse ${statusMessage.includes('Aborted') ? 'text-red-400 font-bold' : 'text-purple-300'}`}>
                      {statusMessage.includes('Aborted') ? <Ban className="w-3 h-3" /> : <Loader2 className="w-3 h-3 animate-spin" />}
                      {statusMessage}
                    </div>
                  )}
               </div>
               
               {/* Stats */}
               <div className="grid grid-cols-3 gap-2 mt-auto">
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 text-center">
                    <div className="text-2xl font-bold text-slate-200">{totalCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Found</div>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 text-center">
                    <div className="text-2xl font-bold text-green-400">{completedCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Done</div>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 text-center">
                    <div className="text-2xl font-bold text-red-400">{errorCount}</div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">Errors</div>
                  </div>
               </div>
            </div>

            <div className="flex-[2] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-300">
                  AI Prompt
                </label>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="text-xs px-2.5 py-1 rounded-md bg-slate-900/60 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-purple-300 flex items-center gap-1.5 transition-colors font-mono"
                  title="Change Model & API Key in Settings"
                >
                  <span className="text-slate-400 font-sans font-normal">Model:</span>
                  <span className="text-purple-400 font-medium">{settings.model}</span>
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isProcessing}
                className="w-full h-full min-h-[140px] bg-slate-900/80 border border-slate-700 rounded-lg p-4 text-slate-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none transition-all placeholder:text-slate-600 font-mono text-sm"
                placeholder="Enter instructions for the AI model..."
              />
            </div>

          </div>
        </div>

        {/* Keyword Database Manager (YouTube Studio Style) */}
        <KeywordManager
          dbKeywords={keywords}
          onSaveToDb={async (newKeywords) => {
            setIsSavingKeywords(true);
            try {
              await saveKeywords(newKeywords);
              setKeywords(newKeywords);
              setSavedKeywords(newKeywords);
            } catch (err) {
              console.error('Failed to save keywords:', err);
              throw err;
            } finally {
              setIsSavingKeywords(false);
            }
          }}
          onClearDb={async () => {
            setIsSavingKeywords(true);
            try {
              await saveKeywords([]);
              setKeywords([]);
              setSavedKeywords([]);
            } catch (err) {
              console.error('Failed to clear keywords:', err);
              throw err;
            } finally {
              setIsSavingKeywords(false);
            }
          }}
          isSaving={isSavingKeywords}
        />

        {/* Alerts */}
        <div className="flex flex-col gap-2">
            {isFallbackMode && (
              <div className="bg-blue-900/20 border border-blue-700/50 p-4 rounded-xl flex items-start gap-3 text-blue-200">
                 <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                 <p className="text-sm">
                   <strong>Read-Only Mode:</strong> Auto-save is disabled. Use the "Export All (ZIP)" button to save your results.
                 </p>
              </div>
            )}
        </div>

        {/* Video List */}
        <div className="space-y-4">
          {videoFiles.length === 0 ? (
            <div className="text-center py-20 text-slate-600 border-2 border-dashed border-slate-800 rounded-2xl">
              <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg">Select a directory to begin scanning for videos.</p>
            </div>
          ) : (
            videoFiles.map((video) => (
              <VideoCard 
                key={video.id} 
                video={video} 
                onSave={!isFallbackMode ? handleManualSave : undefined}
              />
            ))
          )}
        </div>

      </main>

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        apiKey={settings.apiKey}
        model={settings.model}
        onSave={handleSaveSettings}
      />
    </div>
  );
};

export default App;