import React, { useState, useCallback, useRef, useEffect } from 'react';
import { VideoFile, ProcessingStatus } from './types';
import { 
  scanDirectoryForVideos, 
  extractFramesFromVideo, 
  saveFramesToDisk, 
  scanFilesFromInput, 
  saveAnalysisToDisk, 
  packageAllVideosZip 
} from './services/fileSystem';
import { generateVideoAnalysis } from './services/geminiService';
import { DEFAULT_PROMPT } from './constants';
import VideoCard from './components/VideoCard';
import KeywordManager from './components/KeywordManager';
import SettingsModal from './components/SettingsModal';
import QuotaModal from './components/QuotaModal';
import { loadKeywords, saveKeywords } from './services/keywordService';
import { loadSettings, saveSettings, AppSettings, DEFAULT_MODEL } from './services/settingsService';
import { 
  saveJobSession, 
  loadJobSession, 
  clearJobSession, 
  verifyDirectoryPermission, 
  requestDirectoryPermission 
} from './services/jobPersistence';
import { 
  loadStoredQuota, 
  recordApiCallUsage, 
  getTimeUntilPacificMidnight, 
  StoredDailyQuota, 
  getModelSpec 
} from './services/quotaService';
import { 
  FolderOpen, 
  Play, 
  Settings, 
  Loader2, 
  AlertTriangle, 
  Square, 
  Ban, 
  Info, 
  Download, 
  Trash2, 
  RotateCcw,
  Activity,
  Clock,
  BarChart3,
  ArrowRight
} from 'lucide-react';

// Free Tier Limit: 15 Requests Per Minute (RPM).
// We add a conservative delay.
const RATE_LIMIT_INTERVAL_MS = 15000;
const PROMPT_STORAGE_KEY = 'frame_analyzer_prompt';

const App: React.FC = () => {
  const [videoFiles, setVideoFiles] = useState<VideoFile[]>([]);
  const [prompt, setPrompt] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(PROMPT_STORAGE_KEY);
      return saved !== null ? saved : DEFAULT_PROMPT;
    } catch {
      return DEFAULT_PROMPT;
    }
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [directoryName, setDirectoryName] = useState<string | null>(null);
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | undefined>(undefined);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [showAbortModal, setShowAbortModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [quotaData, setQuotaData] = useState<StoredDailyQuota>(loadStoredQuota);
  
  // Settings State (API Key & Model)
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const apiKey = localStorage.getItem('frame_analyzer_gemini_api_key') || '';
      const model = localStorage.getItem('frame_analyzer_gemini_model') || DEFAULT_MODEL;
      return { apiKey, model };
    } catch {
      return { apiKey: '', model: DEFAULT_MODEL };
    }
  });
  const settingsRef = useRef<AppSettings>(settings);

  // Master Keyword Database State
  const [keywords, setKeywords] = useState<string[]>([]);
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  const [isSavingKeywords, setIsSavingKeywords] = useState(false);

  // Refs accessible inside async loops and persistence triggers
  const videoFilesRef = useRef<VideoFile[]>([]);
  const keywordsRef = useRef<string[]>([]);
  const promptRef = useRef<string>(prompt);
  const isProcessingRef = useRef(false);
  const currentDirHandleRef = useRef<FileSystemDirectoryHandle | undefined>(undefined);
  const isSessionLoadedRef = useRef(false);
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

  useEffect(() => {
    promptRef.current = prompt;
    try {
      localStorage.setItem(PROMPT_STORAGE_KEY, prompt);
    } catch (e) {
      console.warn("Failed to persist prompt:", e);
    }
  }, [prompt]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Auto-persist active session to IndexedDB whenever queue or processing status updates
  useEffect(() => {
    if (!isSessionLoadedRef.current) return;

    if (videoFiles.length > 0 && directoryName) {
      const timer = setTimeout(() => {
        saveJobSession({
          directoryName,
          dirHandle: currentDirHandleRef.current,
          isFallbackMode,
          videoFiles,
          isProcessing,
          timestamp: Date.now(),
        });
      }, 150);
      return () => clearTimeout(timer);
    } else if (videoFiles.length === 0 && isSessionLoadedRef.current) {
      clearJobSession();
    }
  }, [videoFiles, directoryName, isFallbackMode, isProcessing]);

  const handleSaveSettings = async (newApiKey: string, newModel: string) => {
    await saveSettings(newApiKey, newModel);
    setSettings({ apiKey: newApiKey, model: newModel });
  };

  const handleSelectDirectory = async () => {
    if (window.showDirectoryPicker) {
      try {
        const selectedHandle = await window.showDirectoryPicker();
        setIsFallbackMode(false);
        setDirHandle(selectedHandle);
        currentDirHandleRef.current = selectedHandle;
        setNeedsPermission(false);
        
        const foundVideos = await scanDirectoryForVideos(selectedHandle, selectedHandle.name);
        setDirectoryName(selectedHandle.name);

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
        videoFilesRef.current = initialVideos;

        await saveJobSession({
          directoryName: selectedHandle.name,
          dirHandle: selectedHandle,
          isFallbackMode: false,
          videoFiles: initialVideos,
          isProcessing: false,
          timestamp: Date.now(),
        });
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
    setDirHandle(undefined);
    currentDirHandleRef.current = undefined;
    setNeedsPermission(false);

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
    videoFilesRef.current = initialVideos;
  };

  const handleClearBatch = async () => {
    if (isProcessing) return;
    if (videoFiles.length > 0 && !window.confirm("Are you sure you want to clear the current queue and saved session?")) {
      return;
    }
    setVideoFiles([]);
    videoFilesRef.current = [];
    setDirectoryName(null);
    setDirHandle(undefined);
    currentDirHandleRef.current = undefined;
    setNeedsPermission(false);
    setStatusMessage("");
    await clearJobSession();
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
    if (isProcessingRef.current) return;
    
    shouldStopRef.current = false;
    setIsProcessing(true);
    isProcessingRef.current = true;
    setStatusMessage("Starting analysis...");
    setShowAbortModal(false);

    const queueIds = videoFilesRef.current.map(v => v.id);
    let lastApiCallTime = 0;
    let abortDueToQuota = false;
    
    // Maintain context history across the run
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
          
          // Get fresh video state from ref
          const currentVideo = videoFilesRef.current.find(v => v.id === videoId);

          // Skip already completed items
          if (!currentVideo || currentVideo.status === ProcessingStatus.COMPLETED) {
            isVideoComplete = true;
            continue;
          }

          const videoName = currentVideo.name;

          // Helper to update state and synchronously update ref
          const updateStatus = (status: ProcessingStatus, updates: Partial<VideoFile> = {}) => {
            setVideoFiles(prev => {
              const next = prev.map(v => v.id === videoId ? { ...v, status, ...updates } : v);
              videoFilesRef.current = next;
              return next;
            });
          };

          try {
            // --- STEP 1: PREPARE FILES (Load & Extract) ---
            let screenshots = currentVideo.screenshots;
            
            if (!screenshots || screenshots.length === 0) {
                let file: File;
                if (currentVideo.file) {
                  file = currentVideo.file;
                } else if (currentVideo.fileHandle) {
                  file = await currentVideo.fileHandle.getFile();
                } else {
                  throw new Error("No file handle available. Please re-select the folder.");
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

            const analysisResult = await generateVideoAnalysis(
              promptRef.current, 
              screenshots, 
              processedDescriptions, 
              keywordsRef.current,
              settingsRef.current.apiKey,
              settingsRef.current.model
            );

            const analysis = analysisResult.text;
            const usage = analysisResult.usage;

            // Track daily quota and token consumption
            const updatedQuota = recordApiCallUsage(settingsRef.current.model, usage);
            setQuotaData(updatedQuota);
            
            // Success!
            processedDescriptions.push(analysis);
            lastApiCallTime = Date.now();
            updateStatus(ProcessingStatus.COMPLETED, { 
              analysisResult: analysis,
              usage: usage,
            });
            isVideoComplete = true; 

            // Auto-save analysis.txt to disk if handle exists
            if (currentVideo.parentHandle) {
              try {
                await saveAnalysisToDisk(
                  currentVideo.parentHandle,
                  videoName,
                  screenshots,
                  analysis
                );
              } catch (diskErr) {
                console.warn(`Could not auto-save analysis to disk for ${videoName}:`, diskErr);
              }
            }

          } catch (error: any) {
            console.warn(`Error processing ${videoName} (Attempt ${retryCount + 1}):`, error);
            
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            
            const isResourceExhausted = errorMessage.includes('RESOURCE_EXHAUSTED');
            const isRateLimit = errorMessage.includes('429') || 
                                errorMessage.includes('quota') || 
                                isResourceExhausted;

            const effectiveMaxRetries = isResourceExhausted ? 0 : MAX_RETRIES;

            if (isRateLimit && retryCount < effectiveMaxRetries) {
                retryCount++;
                const delayMs = 60000 * Math.pow(2, retryCount - 1);
                lastApiCallTime = Date.now(); 

                for (let s = delayMs / 1000; s > 0; s--) {
                    if (shouldStopRef.current) break;
                    setStatusMessage(`Quota hit (429). Retrying in ${s}s...`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } else {
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
    isProcessingRef.current = false;
    
    if (abortDueToQuota) {
        setStatusMessage("⛔ Process Aborted: Daily Limit Reached.");
        setShowAbortModal(true);
    } else {
        setStatusMessage(shouldStopRef.current ? "Stopped by user." : "Queue processing finished.");
    }
  }, []);

  const handleResumeSession = async () => {
    const handle = currentDirHandleRef.current || dirHandle;
    if (handle) {
      const granted = await requestDirectoryPermission(handle);
      if (granted) {
        setNeedsPermission(false);
        setStatusMessage("Permission granted. Resuming analysis...");
        processQueue();
      } else {
        alert("Permission was not granted. Please click 'Change' to re-select the folder.");
      }
    } else {
      setNeedsPermission(false);
      processQueue();
    }
  };

  // Load initial settings, keywords, and restored job session on mount
  useEffect(() => {
    let isCancelled = false;

    const initData = async () => {
      const [loadedSettings, loadedKeywords, savedSession] = await Promise.all([
        loadSettings(),
        loadKeywords(),
        loadJobSession(),
      ]);

      if (isCancelled) return;

      setSettings(loadedSettings);
      setKeywords(loadedKeywords);
      setSavedKeywords(loadedKeywords);

      // Restore session if found in IndexedDB
      if (savedSession && savedSession.videoFiles && savedSession.videoFiles.length > 0) {
        setDirectoryName(savedSession.directoryName || "Restored Batch");
        setIsFallbackMode(savedSession.isFallbackMode || false);

        if (savedSession.dirHandle) {
          currentDirHandleRef.current = savedSession.dirHandle;
          setDirHandle(savedSession.dirHandle);
        }

        // Revert any video interrupted mid-operation back to PENDING
        const sanitizedVideos = savedSession.videoFiles.map(v => {
          if (
            v.status === ProcessingStatus.EXTRACTING || 
            v.status === ProcessingStatus.SAVING || 
            v.status === ProcessingStatus.ANALYZING
          ) {
            return { ...v, status: ProcessingStatus.PENDING };
          }
          return v;
        });

        setVideoFiles(sanitizedVideos);
        videoFilesRef.current = sanitizedVideos;

        // Check directory permissions for native handle
        if (savedSession.dirHandle) {
          const hasPerm = await verifyDirectoryPermission(savedSession.dirHandle);
          if (hasPerm) {
            setNeedsPermission(false);
            if (savedSession.isProcessing) {
              setStatusMessage("Resuming analysis after refresh...");
              setTimeout(() => {
                if (!isCancelled) processQueue();
              }, 300);
            } else {
              setStatusMessage("Saved session restored.");
            }
          } else {
            // Permission requires user gesture click in Chrome/Edge
            setNeedsPermission(true);
            if (savedSession.isProcessing) {
              setStatusMessage("Session restored. Click 'Resume Analysis' to re-authorize file access.");
            } else {
              setStatusMessage("Session restored. Re-authorization required to modify files.");
            }
          }
        } else if (savedSession.isFallbackMode) {
          setStatusMessage("Session restored. In read-only mode, re-select folder to continue.");
        }
      }

      isSessionLoadedRef.current = true;
    };

    initData();

    return () => {
      isCancelled = true;
    };
  }, [processQueue]);

  const pendingCount = videoFiles.filter(v => v.status === ProcessingStatus.PENDING).length;
  const completedCount = videoFiles.filter(v => v.status === ProcessingStatus.COMPLETED).length;
  const errorCount = videoFiles.filter(v => v.status === ProcessingStatus.ERROR).length;
  const totalCount = videoFiles.length;

  const batchTotalTokens = videoFiles.reduce((sum, v) => sum + (v.usage?.totalTokens || 0), 0);
  const modelSpec = getModelSpec(settings.model);
  const timeUntilReset = getTimeUntilPacificMidnight();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col items-center">
      
      {/* Quota Exceeded Abort Modal */}
      {showAbortModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-800 border border-red-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-in zoom-in-95 duration-200">
             <div className="flex flex-col items-center text-center gap-4">
                <div className="p-4 bg-red-500/10 rounded-full text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                   <Ban className="w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-white">Daily Quota Exceeded</h2>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Google returned a <strong>RESOURCE_EXHAUSTED</strong> error. You have processed <strong>{quotaData.requestsToday} requests today</strong>, reaching the Free Tier daily limit for <code className="bg-slate-900 px-1.5 py-0.5 rounded text-red-300 font-mono text-xs">{settings.model}</code>.
                  </p>
                </div>
                
                <div className="text-xs text-slate-300 bg-slate-900/70 p-3.5 rounded-xl w-full flex flex-col gap-2 text-left border border-slate-700/60">
                   <div className="flex items-center justify-between text-amber-300 font-medium">
                     <span className="flex items-center gap-1.5">
                       <Clock className="w-3.5 h-3.5" />
                       Quota Reset Countdown:
                     </span>
                     <span className="font-mono font-bold">{timeUntilReset.formatted}</span>
                   </div>
                   <span className="text-slate-400 text-[11px] leading-relaxed">
                     Google daily limits reset at Midnight Pacific Time (00:00 PT / 09:00 CET).
                   </span>
                </div>

                {/* Instant switch recommendation if on low-quota model */}
                {settings.model !== 'gemini-3.5-flash-lite' && (
                  <div className="w-full p-3.5 bg-blue-950/40 border border-blue-500/40 rounded-xl text-left space-y-2">
                    <p className="text-xs text-blue-200 font-medium leading-relaxed">
                      💡 <strong>Need to process more videos today?</strong> Switch to <strong>Gemini 3.5 Flash-Lite</strong>, which has <strong>1,500 free requests per day</strong>!
                    </p>
                    <button
                      onClick={async () => {
                        await handleSaveSettings(settings.apiKey, 'gemini-3.5-flash-lite');
                        setShowAbortModal(false);
                      }}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      Switch to Gemini 3.5 Flash-Lite (1,500 RPD)
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex gap-2 w-full pt-1">
                  <button 
                    onClick={() => {
                      setShowAbortModal(false);
                      setShowQuotaModal(true);
                    }}
                    className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl font-medium text-xs transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <BarChart3 className="w-3.5 h-3.5" />
                    Inspect Quota
                  </button>
                  <button 
                    onClick={() => setShowAbortModal(false)}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium text-xs transition-all shadow-lg shadow-red-900/20 active:scale-95 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
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

        <div className="flex items-center gap-2.5">
          {/* Quota & Token Badge Button */}
          <button
            onClick={() => setShowQuotaModal(true)}
            className="px-3.5 py-2 bg-slate-800/90 hover:bg-slate-700/90 text-slate-300 hover:text-purple-300 rounded-full border border-slate-700 hover:border-purple-500/50 transition-all shadow-sm flex items-center gap-2 text-xs font-medium cursor-pointer"
            title="View API Quota, Daily Request Limits & Token Consumption"
          >
            <Activity className="w-4 h-4 text-purple-400" />
            <span className="hidden sm:inline">Quota:</span>
            <span className="font-mono text-purple-300 font-bold">
              {quotaData.requestsToday} / ~{modelSpec.rpdFreeTier}
            </span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-full border border-slate-700 hover:border-slate-600 transition-all shadow-sm flex items-center justify-center group cursor-pointer"
            title="Settings"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-purple-400 group-hover:rotate-45 transition-transform duration-300" />
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl flex flex-col gap-6">

        {/* Permission Recovery Banner (After Browser Refresh) */}
        {needsPermission && dirHandle && (
          <div className="bg-amber-950/40 border border-amber-500/50 rounded-2xl p-5 backdrop-blur-sm shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in duration-300">
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-amber-200">
                  Session Restored: Re-authorization Required
                </h3>
                <p className="text-sm text-amber-300/80">
                  Restored <strong>{videoFiles.length} videos</strong> ({completedCount} completed, {pendingCount} pending) in folder <code className="bg-amber-900/40 px-1.5 py-0.5 rounded text-amber-200 font-mono text-xs">{directoryName}</code>.
                  Browser security requires permission to read and write to this folder.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
              <button
                onClick={handleResumeSession}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-semibold rounded-xl shadow-lg shadow-amber-900/40 transition-all active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume Analysis
              </button>
              <button
                onClick={handleClearBatch}
                className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-medium transition-colors cursor-pointer"
                title="Clear restored session"
              >
                Clear
              </button>
            </div>
          </div>
        )}
        
        {/* Controls Section */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 backdrop-blur-sm shadow-xl">
          <div className="flex flex-col md:flex-row gap-6">
            
            <div className="flex-1 flex flex-col gap-4">
               <div className="flex items-center justify-between">
                 <label className="text-sm font-semibold text-slate-300">
                   Configuration
                 </label>
                 {directoryName && (
                   <span className="text-xs px-2.5 py-1 rounded bg-slate-900/60 border border-slate-700/60 text-slate-400 font-mono truncate max-w-[220px]" title={directoryName}>
                     📁 {directoryName}
                   </span>
                 )}
               </div>
               
               <div className="flex flex-wrap gap-3">
                 <button
                   onClick={handleSelectDirectory}
                   disabled={isProcessing}
                   className="flex items-center gap-2 px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                 >
                   <FolderOpen className="w-5 h-5" />
                   {directoryName ? 'Change' : 'Select'}
                 </button>

                 {videoFiles.length > 0 && (
                   <button
                     onClick={handleClearBatch}
                     disabled={isProcessing}
                     className="flex items-center gap-2 px-4 py-3 bg-slate-800 hover:bg-red-950/60 border border-slate-700 hover:border-red-700/60 text-slate-300 hover:text-red-300 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                     title="Clear current video batch and saved session"
                   >
                     <Trash2 className="w-4 h-4 text-red-400" />
                     Clear
                   </button>
                 )}

                 {!isProcessing ? (
                   <button
                     onClick={processQueue}
                     disabled={pendingCount === 0 && errorCount === 0}
                     className={`flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all shadow-lg ${
                       (pendingCount > 0 || errorCount > 0)
                         ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:shadow-purple-500/25 text-white cursor-pointer' 
                         : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                     }`}
                   >
                     <Play className="w-5 h-5" />
                     {errorCount > 0 && pendingCount === 0 ? 'Retry Errors' : `Start Analysis (${pendingCount})`}
                   </button>
                 ) : (
                   <button
                     onClick={stopProcessing}
                     className="flex items-center gap-2 px-5 py-3 rounded-lg font-medium transition-all shadow-lg bg-red-500/80 hover:bg-red-600 text-white border border-red-500 cursor-pointer"
                   >
                     <Square className="w-4 h-4 fill-current" />
                     Stop Analysis
                   </button>
                 )}

                 <button
                   onClick={handleExportAll}
                   disabled={completedCount === 0 || isExporting}
                   className="flex items-center gap-2 px-5 py-3 bg-cyan-800 hover:bg-cyan-700 text-cyan-100 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
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
               
               {/* Stats: Found, Done, Errors, and Quota / Tokens */}
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-auto">
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
                  <button
                    onClick={() => setShowQuotaModal(true)}
                    className="bg-slate-900/50 hover:bg-slate-800/80 p-3 rounded-lg border border-purple-800/40 hover:border-purple-600/60 text-center transition-all cursor-pointer group flex flex-col items-center justify-center"
                    title="Click to view full Quota and Token Metrics"
                  >
                    <div className="text-2xl font-bold text-purple-400 group-hover:text-purple-300 flex items-center justify-center gap-1">
                      <span>{batchTotalTokens > 0 ? `${(batchTotalTokens / 1000).toFixed(1)}k` : `${quotaData.requestsToday}`}</span>
                      <Activity className="w-3.5 h-3.5 text-purple-400 opacity-70" />
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-purple-400/80 group-hover:text-purple-300">
                      {batchTotalTokens > 0 ? 'Batch Tokens' : 'Quota Today'}
                    </div>
                  </button>
               </div>
            </div>

            <div className="flex-[2] flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-slate-300">
                    AI Prompt
                  </label>
                  {prompt !== DEFAULT_PROMPT && (
                    <button
                      onClick={() => setPrompt(DEFAULT_PROMPT)}
                      className="text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-purple-300 transition-colors flex items-center gap-1 border border-slate-700/60 cursor-pointer"
                      title="Reset prompt to default template"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset Default
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="text-xs px-2.5 py-1 rounded-md bg-slate-900/60 hover:bg-slate-700/80 border border-slate-700/60 text-slate-300 hover:text-purple-300 flex items-center gap-1.5 transition-colors font-mono cursor-pointer"
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

      <QuotaModal
        isOpen={showQuotaModal}
        onClose={() => setShowQuotaModal(false)}
        currentModel={settings.model}
        quotaData={quotaData}
        batchCompletedCount={completedCount}
        batchTotalTokens={batchTotalTokens}
        onSwitchModel={async (newModel) => {
          await handleSaveSettings(settings.apiKey, newModel);
        }}
      />
    </div>
  );
};

export default App;