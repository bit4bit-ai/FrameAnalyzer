import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { VideoFile, ProcessingStatus } from './types';
import { 
  scanDirectoryForVideos, 
  extractFramesFromVideo, 
  saveFramesToDisk, 
  scanFilesFromInput, 
  saveAnalysisToDisk, 
  packageAllVideosZip,
  downloadSingleVideoZip 
} from './services/fileSystem';
import { 
  generateVideoAnalysis, 
  extractLocationDetails, 
  extractLocationFromAnalysis, 
  determineConsensusGroupLocation 
} from './services/geminiService';
import { DEFAULT_PROMPT } from './constants';
import VideoCard from './components/VideoCard';
import KeywordManager from './components/KeywordManager';
import SettingsModal from './components/SettingsModal';
import QuotaModal from './components/QuotaModal';
import FolderPreviewThumbnails from './components/FolderPreviewThumbnails';
import ModalDialog, { ModalDialogConfig } from './components/ModalDialog';
import { loadKeywords, saveKeywords } from './services/keywordService';
import { 
  loadSettings, 
  saveSettings, 
  AppSettings, 
  DEFAULT_MODEL,
  loadCustomGroupNames,
  saveCustomGroupName,
  removeCustomGroupName
} from './services/settingsService';
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
  Folder,
  Play, 
  Settings, 
  Loader2, 
  AlertTriangle, 
  Square, 
  Ban, 
  Info, 
  Download, 
  RotateCcw,
  Activity,
  Calendar,
  Clock,
  BarChart3,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Edit2,
  Trash2,
  X,
  FileVideo
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
  const [modalDialogConfig, setModalDialogConfig] = useState<ModalDialogConfig | null>(null);
  const [activeJobGroupId, setActiveJobGroupId] = useState<string | null>(null);
  
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
  const filesInputRef = useRef<HTMLInputElement>(null);
  const directoryHandlesRef = useRef<Record<string, FileSystemDirectoryHandle>>({});
  const hasLocationRenamedRef = useRef<Record<string, boolean>>({});
  const groupLocationScoreRef = useRef<Record<string, number>>({});
  const priorityVideoIdRef = useRef<string | null>(null);
  const priorityGroupIdRef = useRef<string | null>(null);
  const activeJobGroupIdRef = useRef<string | null>(null);
  const processQueueRef = useRef<((targetGroupId?: string) => Promise<void>) | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    activeJobGroupIdRef.current = activeJobGroupId;
  }, [activeJobGroupId]);

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
          directoryHandles: directoryHandlesRef.current,
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

  // Custom Dialog Helpers (replacing browser alert/confirm/prompt)
  const showConfirm = useCallback((
    title: string, 
    message: string, 
    options?: { confirmText?: string; cancelText?: string; isDestructive?: boolean }
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setModalDialogConfig({
        isOpen: true,
        type: 'confirm',
        title,
        message,
        confirmText: options?.confirmText || 'Confirm',
        cancelText: options?.cancelText || 'Cancel',
        isDestructive: options?.isDestructive ?? false,
        onConfirm: () => {
          setModalDialogConfig(null);
          resolve(true);
        },
        onCancel: () => {
          setModalDialogConfig(null);
          resolve(false);
        }
      });
    });
  }, []);

  const showPrompt = useCallback((
    title: string, 
    message: string, 
    defaultValue = '', 
    placeholder = '', 
    confirmText = 'Save'
  ): Promise<string | null> => {
    return new Promise((resolve) => {
      setModalDialogConfig({
        isOpen: true,
        type: 'prompt',
        title,
        message,
        promptValue: defaultValue,
        promptPlaceholder: placeholder,
        confirmText,
        cancelText: 'Cancel',
        onConfirm: (val) => {
          setModalDialogConfig(null);
          resolve(val !== undefined ? val : null);
        },
        onCancel: () => {
          setModalDialogConfig(null);
          resolve(null);
        }
      });
    });
  }, []);

  const showAlert = useCallback((title: string, message: string): Promise<void> => {
    return new Promise((resolve) => {
      setModalDialogConfig({
        isOpen: true,
        type: 'alert',
        title,
        message,
        confirmText: 'OK',
        onConfirm: () => {
          setModalDialogConfig(null);
          resolve();
        },
        onCancel: () => {
          setModalDialogConfig(null);
          resolve();
        }
      });
    });
  }, []);

  const handleRenameParentFolder = async (
    groupId: string, 
    currentName: string, 
    folderPath?: string, 
    folderName?: string, 
    groupVideos?: VideoFile[]
  ) => {
    const defaultVal = currentName || folderName || folderPath || "";
    const newName = await showPrompt(
      "Rename Group / Location",
      "Enter a custom location or name for this group:",
      defaultVal,
      "e.g. Yosemite, Project 1, Vacation 2024"
    );
    if (newName !== null) {
      const trimmed = newName.trim();
      if (!trimmed) return;

      // 1. Save into persistent settings strictly by unique groupId
      if (groupId && groupId.startsWith('grp-')) {
        saveCustomGroupName(groupId, trimmed);
      }

      // 2. Lock in-memory score to 9999 so automatic consensus is permanently disabled for this group
      if (groupId) {
        groupLocationScoreRef.current[groupId] = 9999;
      }

      // 3. Mark all videos in this group as isUserRenamed: true and update parentFolderName
      const videoIds = new Set((groupVideos || []).map(v => v.id));
      setVideoFiles(prev => {
        const next = prev.map(v => {
          const matchesGroup = (groupId && v.groupId === groupId) || videoIds.has(v.id);
          if (matchesGroup) {
            return { 
              ...v, 
              parentFolderName: trimmed, 
              isUserRenamed: true 
            };
          }
          return v;
        });
        videoFilesRef.current = next;
        return next;
      });

      // 4. Save session to IndexedDB immediately so it survives refresh
      saveJobSession({
        directoryName,
        dirHandle: currentDirHandleRef.current || dirHandle,
        directoryHandles: directoryHandlesRef.current,
        isFallbackMode,
        videoFiles: videoFilesRef.current,
        isProcessing: isProcessingRef.current,
        timestamp: Date.now(),
      });
    }
  };

  const handleSelectDirectory = async () => {
    if (window.showDirectoryPicker) {
      try {
        let selectedHandle: FileSystemDirectoryHandle;
        try {
          // Request 'readwrite' mode directly within showDirectoryPicker so Chrome/Edge presents ONE combined prompt
          selectedHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (pickerErr: any) {
          if (pickerErr?.name === 'AbortError') return;
          selectedHandle = await window.showDirectoryPicker();
        }

        const folderName = selectedHandle.name;
        const now = Date.now();
        const newGroupId = `grp-${now}-${Math.random().toString(36).substr(2, 4)}`;
        setActiveJobGroupId(newGroupId);

        const parentFolderName = undefined;

        setIsFallbackMode(false);
        setDirHandle(selectedHandle);
        currentDirHandleRef.current = selectedHandle;

        // Check if write permission was already granted in the single combined picker dialog
        let permGranted = await verifyDirectoryPermission(selectedHandle, true);
        if (!permGranted) {
          // Fallback: only request separately if the picker didn't grant it
          permGranted = await requestDirectoryPermission(selectedHandle, true);
        }
        setNeedsPermission(!permGranted);

        // Store directory handle in ref map
        directoryHandlesRef.current = {
          ...directoryHandlesRef.current,
          [folderName]: selectedHandle,
        };
        
        const foundVideos = await scanDirectoryForVideos(selectedHandle, folderName);
        
        setDirectoryName(prev => {
          if (!prev) return folderName;
          if (prev.includes(folderName)) return prev;
          return `${prev}, ${folderName}`;
        });

        const newVideos: VideoFile[] = foundVideos.map((v, i) => ({
          id: `vid-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
          name: v.fileHandle.name,
          path: v.path,
          groupId: newGroupId,
          parentFolderName: parentFolderName,
          createdAt: now,
          fileHandle: v.fileHandle,
          parentHandle: v.parentHandle,
          status: ProcessingStatus.PENDING,
          screenshots: [],
        }));

        // Deduplicate against existing video items
        const existingKeys = new Set(videoFilesRef.current.map(v => `${v.groupId || ''}::${v.path}`));
        const uniqueNewVideos = newVideos.filter(v => !existingKeys.has(`${v.groupId}::${v.path}`));
        // Prepend new videos so new groups appear at the top of the list
        const mergedVideos = [...uniqueNewVideos, ...videoFilesRef.current];

        // Shrink (collapse) all previously existing folder groups so only new folder is open
        setCollapsedFolders(prev => {
          const next = { ...prev };
          folderGroups.forEach(g => {
            next[g.groupKey] = true;
          });
          return next;
        });

        setVideoFiles(mergedVideos);
        videoFilesRef.current = mergedVideos;
        setActiveJobGroupId(newGroupId);
        activeJobGroupIdRef.current = newGroupId;

        await saveJobSession({
          directoryName: folderName,
          dirHandle: selectedHandle,
          directoryHandles: directoryHandlesRef.current,
          isFallbackMode: false,
          videoFiles: mergedVideos,
          isProcessing: false,
          timestamp: Date.now(),
        });

        if (permGranted) {
          setStatusMessage("Folder loaded and permission verified.");
        } else {
          setStatusMessage("Folder loaded. Re-authorization required to save files.");
        }
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

  const handleFallbackInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const folderName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : "Selected Folder";
    const now = Date.now();
    const newGroupId = `grp-${now}-${Math.random().toString(36).substr(2, 4)}`;
    setActiveJobGroupId(newGroupId);
    const parentFolderName = undefined;

    setIsFallbackMode(true);
    setDirHandle(undefined);
    currentDirHandleRef.current = undefined;
    setNeedsPermission(false);

    const foundVideos = scanFilesFromInput(files);
    setDirectoryName(prev => {
      if (!prev) return folderName;
      if (prev.includes(folderName)) return prev;
      return `${prev}, ${folderName}`;
    });

    const newVideos: VideoFile[] = foundVideos.map((v, i) => ({
      id: `vid-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
      name: v.file.name,
      path: v.path,
      groupId: newGroupId,
      parentFolderName: parentFolderName,
      createdAt: now,
      file: v.file,
      status: ProcessingStatus.PENDING,
      screenshots: [],
    }));

    const existingKeys = new Set(videoFilesRef.current.map(v => `${v.groupId || ''}::${v.path}`));
    const uniqueNewVideos = newVideos.filter(v => !existingKeys.has(`${v.groupId}::${v.path}`));
    // Prepend new videos so new groups appear at the top of the list
    const mergedVideos = [...uniqueNewVideos, ...videoFilesRef.current];

    // Shrink existing folder groups
    setCollapsedFolders(prev => {
      const next = { ...prev };
      folderGroups.forEach(g => {
        next[g.groupKey] = true;
      });
      return next;
    });

    setVideoFiles(mergedVideos);
    videoFilesRef.current = mergedVideos;
    setActiveJobGroupId(newGroupId);
    activeJobGroupIdRef.current = newGroupId;

    setStatusMessage("Files loaded successfully.");
  };

  const handleSelectFiles = async () => {
    if (window.showOpenFilePicker) {
      try {
        const fileHandles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Video Files',
              accept: {
                'video/*': ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wmv']
              }
            }
          ]
        });

        if (!fileHandles || fileHandles.length === 0) return;

        const now = Date.now();
        const newGroupId = `grp-${now}-${Math.random().toString(36).substr(2, 4)}`;
        setActiveJobGroupId(newGroupId);
        const groupLabel = fileHandles.length === 1 
          ? fileHandles[0].name.replace(/\.[^/.]+$/, "") 
          : `Selected Videos (${fileHandles.length})`;

        const newVideos: VideoFile[] = [];
        for (let i = 0; i < fileHandles.length; i++) {
          const handle = fileHandles[i];
          try {
            const file = await handle.getFile();
            newVideos.push({
              id: `vid-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
              name: file.name,
              path: file.name,
              groupId: newGroupId,
              parentFolderName: groupLabel,
              createdAt: now,
              fileHandle: handle,
              file,
              status: ProcessingStatus.PENDING,
              screenshots: [],
            });
          } catch (fileErr) {
            console.warn(`Could not read file handle for ${handle.name}:`, fileErr);
          }
        }

        if (newVideos.length === 0) return;

        setDirectoryName(prev => {
          if (!prev) return groupLabel;
          if (prev.includes(groupLabel)) return prev;
          return `${prev}, ${groupLabel}`;
        });

        const existingKeys = new Set(videoFilesRef.current.map(v => `${v.groupId || ''}::${v.path}`));
        const uniqueNewVideos = newVideos.filter(v => !existingKeys.has(`${v.groupId}::${v.path}`));
        const mergedVideos = [...uniqueNewVideos, ...videoFilesRef.current];

        setCollapsedFolders(prev => {
          const next = { ...prev };
          folderGroups.forEach(g => {
            next[g.groupKey] = true;
          });
          return next;
        });

        setVideoFiles(mergedVideos);
        videoFilesRef.current = mergedVideos;
        setActiveJobGroupId(newGroupId);
        activeJobGroupIdRef.current = newGroupId;

        await saveJobSession({
          directoryName: directoryName || groupLabel,
          dirHandle: currentDirHandleRef.current || dirHandle,
          directoryHandles: directoryHandlesRef.current,
          isFallbackMode,
          videoFiles: mergedVideos,
          isProcessing: false,
          timestamp: Date.now(),
        });

        setStatusMessage(`Loaded ${uniqueNewVideos.length} video ${uniqueNewVideos.length === 1 ? 'file' : 'files'}.`);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn("showOpenFilePicker failed, falling back to input:", err);
      }
    }

    if (filesInputRef.current) {
      filesInputRef.current.click();
    }
  };

  const handleFallbackFilesInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const now = Date.now();
    const newGroupId = `grp-${now}-${Math.random().toString(36).substr(2, 4)}`;
    setActiveJobGroupId(newGroupId);
    const groupLabel = files.length === 1 
      ? files[0].name.replace(/\.[^/.]+$/, "") 
      : `Selected Videos (${files.length})`;

    const newVideos: VideoFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newVideos.push({
        id: `vid-${now}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        name: file.name,
        path: file.name,
        groupId: newGroupId,
        parentFolderName: groupLabel,
        createdAt: now,
        file,
        status: ProcessingStatus.PENDING,
        screenshots: [],
      });
    }

    setDirectoryName(prev => {
      if (!prev) return groupLabel;
      if (prev.includes(groupLabel)) return prev;
      return `${prev}, ${groupLabel}`;
    });

    const existingKeys = new Set(videoFilesRef.current.map(v => `${v.groupId || ''}::${v.path}`));
    const uniqueNewVideos = newVideos.filter(v => !existingKeys.has(`${v.groupId}::${v.path}`));
    const mergedVideos = [...uniqueNewVideos, ...videoFilesRef.current];

    setCollapsedFolders(prev => {
      const next = { ...prev };
      folderGroups.forEach(g => {
        next[g.groupKey] = true;
      });
      return next;
    });

    setVideoFiles(mergedVideos);
    videoFilesRef.current = mergedVideos;
    setActiveJobGroupId(newGroupId);
    activeJobGroupIdRef.current = newGroupId;

    await saveJobSession({
      directoryName: directoryName || groupLabel,
      dirHandle: currentDirHandleRef.current || dirHandle,
      directoryHandles: directoryHandlesRef.current,
      isFallbackMode,
      videoFiles: mergedVideos,
      isProcessing: false,
      timestamp: Date.now(),
    });

    setStatusMessage(`Loaded ${uniqueNewVideos.length} video ${uniqueNewVideos.length === 1 ? 'file' : 'files'}.`);
    event.target.value = '';
  };

  const handleClearBatch = async () => {
    if (isProcessing) return;
    if (videoFiles.length > 0) {
      const confirmed = await showConfirm(
        "Clear Queue",
        "Are you sure you want to clear the current queue and saved session?",
        { confirmText: "Clear All", isDestructive: true }
      );
      if (!confirmed) return;
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
    if (!video.analysisResult) {
       console.error("Missing analysis result");
       return;
    }
    
    try {
      if (video.parentHandle) {
        await saveAnalysisToDisk(
          video.parentHandle, 
          video.name, 
          video.screenshots, 
          video.analysisResult
        );
      } else {
        await downloadSingleVideoZip(video);
      }
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
      await showAlert("Export Error", error.message || "Failed to create ZIP file.");
    } finally {
      setIsExporting(false);
    }
  };

  const processQueue = useCallback(async (targetGroupId?: string) => {
    if (isProcessingRef.current) return;
    
    shouldStopRef.current = false;
    setIsProcessing(true);
    isProcessingRef.current = true;
    setStatusMessage("Starting analysis...");
    setShowAbortModal(false);

    let queueIds: string[] = [];
    if (priorityVideoIdRef.current) {
      const prioId = priorityVideoIdRef.current;
      priorityVideoIdRef.current = null;
      const targetVideo = videoFilesRef.current.find(v => v.id === prioId);
      const grpId = targetVideo?.groupId || targetGroupId;
      if (grpId) {
        // Strictly stay within this video's job/group - never spill over into other groups
        const jobVideos = videoFilesRef.current.filter(v => v.groupId === grpId);
        queueIds = [prioId, ...jobVideos.filter(v => v.id !== prioId).map(v => v.id)];
      } else {
        queueIds = [prioId];
      }
    } else if (priorityGroupIdRef.current || targetGroupId) {
      const prioGrp = priorityGroupIdRef.current || targetGroupId!;
      priorityGroupIdRef.current = null;
      // Strictly stay within this group/job - do NOT proceed into other groups/jobs
      queueIds = videoFilesRef.current.filter(v => v.groupId === prioGrp).map(v => v.id);
    } else {
      // Fallback: stay within the active or first pending group
      const currentActiveId = activeJobGroupIdRef.current;
      const defaultGroup = currentActiveId 
        ? videoFilesRef.current.find(v => v.groupId === currentActiveId)?.groupId 
        : videoFilesRef.current.find(v => v.status === ProcessingStatus.PENDING)?.groupId;
      if (defaultGroup) {
        queueIds = videoFilesRef.current.filter(v => v.groupId === defaultGroup).map(v => v.id);
      } else {
        queueIds = videoFilesRef.current.map(v => v.id);
      }
    }
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

          if (currentVideo.groupId) {
            setActiveJobGroupId(currentVideo.groupId);
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
                updateStatus(ProcessingStatus.EXTRACTING, { error: undefined });
                
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
              updateStatus(ProcessingStatus.ANALYZING, { error: undefined }); 
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // --- STEP 3: ANALYZE ---
            setStatusMessage(retryCount > 0 
                ? `Retry ${retryCount}: Analyzing ${videoName}...`
                : `Analyzing ${videoName}...`
            );
            updateStatus(ProcessingStatus.ANALYZING, { error: undefined });
            
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
              error: undefined,
            });
            isVideoComplete = true; 

            // Auto-rename group by evaluating consensus across ALL generated descriptions in this group
            // Once renamed by the user, it is permanently locked and never overridden
            if (currentVideo.groupId) {
              const gid = currentVideo.groupId;
              const customNames = loadCustomGroupNames();
              const isManuallyLocked = 
                Boolean(currentVideo.isUserRenamed) ||
                Boolean(customNames[gid]) ||
                videoFilesRef.current.some(v => v.groupId === gid && v.isUserRenamed) ||
                (groupLocationScoreRef.current[gid] || 0) >= 9999;

              if (!isManuallyLocked) {
                const groupAnalyses = videoFilesRef.current
                  .filter(v => v.groupId === gid)
                  .map(v => (v.id === currentVideo.id ? analysis : v.analysisResult))
                  .filter((text): text is string => Boolean(text && text.trim()));

                const consensus = determineConsensusGroupLocation(groupAnalyses, promptRef.current);
                if (consensus) {
                  groupLocationScoreRef.current[gid] = consensus.confidence;
                  setVideoFiles(prev => {
                    const next = prev.map(v => (v.groupId === gid && !v.isUserRenamed ? { ...v, parentFolderName: consensus.location } : v));
                    videoFilesRef.current = next;
                    return next;
                  });
                }
              }
            } 

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
            const isExplicitDailyQuota = isResourceExhausted && (
              errorMessage.toLowerCase().includes('per day') ||
              errorMessage.toLowerCase().includes('daily')
            );
            const isServiceUnavailable = errorMessage.includes('503') || 
                                         errorMessage.includes('UNAVAILABLE') || 
                                         errorMessage.includes('high demand') ||
                                         errorMessage.includes('overloaded');
            const isRateLimit = errorMessage.includes('429') || 
                                errorMessage.includes('quota') || 
                                isResourceExhausted;

            const shouldRetry = (isRateLimit && !isExplicitDailyQuota) || isServiceUnavailable;
            const effectiveMaxRetries = isExplicitDailyQuota ? 0 : MAX_RETRIES;

            if (shouldRetry && retryCount < effectiveMaxRetries) {
                retryCount++;
                const delayMs = isServiceUnavailable 
                  ? 4000 * retryCount // 4s, 8s, 12s for temporary 503 high-demand spikes
                  : 60000 * Math.pow(2, retryCount - 1);
                lastApiCallTime = Date.now(); 

                for (let s = Math.ceil(delayMs / 1000); s > 0; s--) {
                    if (shouldStopRef.current) break;
                    setStatusMessage(isServiceUnavailable
                      ? `Google high demand (503). Retrying in ${s}s (Attempt ${retryCount}/${MAX_RETRIES})...`
                      : `Quota hit (429). Retrying in ${s}s...`
                    );
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
        const finishMsg = shouldStopRef.current ? "Stopped by user." : "Job analysis finished.";
        setStatusMessage(finishMsg);
        setTimeout(() => {
          setStatusMessage(prev => prev === finishMsg ? "" : prev);
        }, 4000);
    }
  }, []);

  processQueueRef.current = processQueue;

  const handleResumeSession = async () => {
    const handles = Object.values(directoryHandlesRef.current || {});
    const primaryHandle = currentDirHandleRef.current || dirHandle;
    const allHandles = handles.length > 0 ? handles : (primaryHandle ? [primaryHandle] : []);

    const isPending = pendingCount > 0;

    if (allHandles.length > 0) {
      let allGranted = true;
      for (const h of allHandles) {
        const granted = await requestDirectoryPermission(h);
        if (!granted) allGranted = false;
      }
      if (allGranted) {
        setNeedsPermission(false);
        if (isPending) {
          setStatusMessage("Permission granted. Resuming analysis...");
          processQueue();
        } else {
          setStatusMessage("Permission granted. Folder access re-authorized.");
        }
      } else {
        await showAlert("Permission Notice", "Permission was not granted for all folders. You can still add folders as needed.");
      }
    } else {
      setNeedsPermission(false);
      if (isPending) {
        processQueue();
      }
    }
  };

  const handleRetryVideo = useCallback(async (video: VideoFile) => {
    if (video.groupId) {
      setActiveJobGroupId(video.groupId);
    }
    priorityVideoIdRef.current = video.id;

    // Reset video status to PENDING and clear previous error & analysis
    setVideoFiles(prev => {
      const next = prev.map(v => v.id === video.id ? { 
        ...v, 
        status: ProcessingStatus.PENDING, 
        error: undefined, 
        analysisResult: undefined 
      } : v);
      videoFilesRef.current = next;
      return next;
    });

    if (!isProcessingRef.current) {
      setTimeout(() => processQueue(video.groupId), 50);
    }
  }, [processQueue]);

  const handleRetryGroup = useCallback(async (groupId: string, groupVideos: VideoFile[]) => {
    if (isProcessingRef.current) return;

    setActiveJobGroupId(groupId);
    priorityGroupIdRef.current = groupId;

    // Reset all videos in this group to PENDING and clear previous errors & analysis
    setVideoFiles(prev => {
      const next = prev.map(v => v.groupId === groupId ? { 
        ...v, 
        status: ProcessingStatus.PENDING, 
        error: undefined, 
        analysisResult: undefined 
      } : v);
      videoFilesRef.current = next;
      return next;
    });

    setTimeout(() => processQueue(groupId), 50);
  }, [processQueue]);

  const handleDeleteGroup = useCallback(async (groupId: string, groupDisplayName: string, groupVideos: VideoFile[]) => {
    if (isProcessingRef.current) {
      await showAlert("Analysis in Progress", "Please stop the current analysis before deleting a group.");
      return;
    }

    const confirmed = await showConfirm(
      "Delete Folder Group",
      `Are you sure you want to delete the group "${groupDisplayName}" and remove all ${groupVideos.length} videos from the queue?`,
      { confirmText: "Delete Group", isDestructive: true }
    );
    if (!confirmed) return;

    // Delete by video IDs of all videos in this group - guarantees 100% deletion even if groupId is undefined or different
    const idsToDelete = new Set(groupVideos.map(v => v.id));
    const remainingVideos = videoFilesRef.current.filter(v => !idsToDelete.has(v.id) && v.groupId !== groupId);
    setVideoFiles(remainingVideos);
    videoFilesRef.current = remainingVideos;
    setActiveJobGroupId(prev => prev === groupId ? null : prev);

    // Clean up collapsedFolders and custom names
    removeCustomGroupName(groupId);
    removeCustomGroupName(groupDisplayName);
    setCollapsedFolders(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(groupId) || k.includes(groupDisplayName)) delete next[k];
      });
      return next;
    });

    setStatusMessage(`Deleted group "${groupDisplayName}".`);
    setTimeout(() => setStatusMessage(prev => prev === `Deleted group "${groupDisplayName}".` ? "" : prev), 3500);
  }, [showAlert, showConfirm]);

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
        if (savedSession.directoryHandles) {
          directoryHandlesRef.current = savedSession.directoryHandles;
        }

        // Revert any video interrupted mid-operation back to PENDING, and clear error on completed items
        const sanitizedVideos = savedSession.videoFiles.map((v, idx) => {
          let assignedGroupId = v.groupId;
          if (!assignedGroupId) {
            assignedGroupId = `grp-restored-${v.createdAt || 'legacy'}-${idx}`;
          }

          let status = v.status;
          if (
            status === ProcessingStatus.EXTRACTING || 
            status === ProcessingStatus.SAVING || 
            status === ProcessingStatus.ANALYZING
          ) {
            status = ProcessingStatus.PENDING;
          }

          return { 
            ...v, 
            groupId: assignedGroupId,
            status, 
            error: status === ProcessingStatus.COMPLETED ? undefined : v.error 
          };
        });

        // Calculate consensus group location across ALL completed descriptions in each group
        const groupAnalysesMap: Record<string, string[]> = {};
        sanitizedVideos.forEach(v => {
          if (v.groupId && v.analysisResult) {
            if (!groupAnalysesMap[v.groupId]) groupAnalysesMap[v.groupId] = [];
            groupAnalysesMap[v.groupId].push(v.analysisResult);
          }
        });

        const customNames = loadCustomGroupNames();

        const groupConsensusNames: Record<string, string> = {};
        Object.entries(groupAnalysesMap).forEach(([gid, analyses]) => {
          // If this group was renamed by user, lock it and do NOT calculate consensus
          if (customNames[gid] || sanitizedVideos.some(v => v.groupId === gid && v.isUserRenamed)) {
            groupLocationScoreRef.current[gid] = 9999;
            return;
          }
          const consensus = determineConsensusGroupLocation(analyses);
          if (consensus) {
            groupConsensusNames[gid] = consensus.location;
            groupLocationScoreRef.current[gid] = consensus.confidence;
          }
        });

        const upgradedVideos = sanitizedVideos.map(v => {
          const gid = v.groupId || '';
          if (gid && customNames[gid]) {
            return { ...v, parentFolderName: customNames[gid], isUserRenamed: true };
          }
          if (v.isUserRenamed) {
            return v;
          }
          if (gid && groupConsensusNames[gid]) {
            return { ...v, parentFolderName: groupConsensusNames[gid] };
          }
          return v;
        });

        setVideoFiles(upgradedVideos);
        videoFilesRef.current = upgradedVideos;

        // Check directory permissions for native handle
        if (savedSession.dirHandle) {
          const hasPerm = await verifyDirectoryPermission(savedSession.dirHandle);
          if (hasPerm) {
            setNeedsPermission(false);
            if (savedSession.isProcessing) {
              setStatusMessage("Resuming analysis after refresh...");
              setTimeout(() => {
                if (!isCancelled && processQueueRef.current) processQueueRef.current();
              }, 300);
            } else {
              setStatusMessage("Saved session restored.");
              setTimeout(() => {
                if (!isCancelled) {
                  setStatusMessage(prev => prev === "Saved session restored." ? "" : prev);
                }
              }, 3500);
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
  }, []);

  const pendingCount = videoFiles.filter(v => v.status === ProcessingStatus.PENDING).length;
  const completedCount = videoFiles.filter(v => v.status === ProcessingStatus.COMPLETED).length;
  const errorCount = videoFiles.filter(v => v.status === ProcessingStatus.ERROR).length;
  const totalCount = videoFiles.length;

  const batchTotalTokens = videoFiles.reduce((sum, v) => sum + (v.usage?.totalTokens || 0), 0);
  const modelSpec = getModelSpec(settings.model);
  const timeUntilReset = getTimeUntilPacificMidnight();

  // Folder Grouping State & Memo (persisted in localStorage)
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('frame_analyzer_collapsed_folders');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('frame_analyzer_collapsed_folders', JSON.stringify(collapsedFolders));
    } catch {
      // ignore
    }
  }, [collapsedFolders]);

  const toggleFolderCollapse = (folderPath: string) => {
    setCollapsedFolders(prev => ({
      ...prev,
      [folderPath]: !prev[folderPath],
    }));
  };

  interface VideoFolderGroup {
    groupKey: string;
    groupId: string;
    folderPath: string;
    folderName: string;
    parentFolderName: string | null;
    displayName: string;
    videos: VideoFile[];
    createdAt?: number;
    total: number;
    completed: number;
    pending: number;
    errors: number;
  }

  const folderGroups = useMemo(() => {
    const groupsMap = new Map<string, { videos: VideoFile[]; parentFolderName?: string }>();

    videoFiles.forEach((video) => {
      let folder = directoryName || 'Root Folder';
      if (video.path) {
        const normalized = video.path.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash !== -1) {
          folder = normalized.substring(0, lastSlash);
        } else if (video.parentFolderName) {
          folder = video.parentFolderName;
        }
      }

      // Unique group key per folder addition batch so identically named folders never collide
      const groupKey = video.groupId ? `${video.groupId}::${folder}` : folder;

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, { videos: [], parentFolderName: video.parentFolderName });
      }
      const entry = groupsMap.get(groupKey)!;
      entry.videos.push(video);
      if (video.parentFolderName && (!entry.parentFolderName || video.isUserRenamed)) {
        entry.parentFolderName = video.parentFolderName;
      }
    });

    const customNames = loadCustomGroupNames();
    const result: VideoFolderGroup[] = [];
    groupsMap.forEach(({ videos, parentFolderName }, groupKey) => {
      const parts = groupKey.split('::');
      const groupId = parts.length > 1 ? parts[0] : groupKey;
      const folderPath = parts.length > 1 ? parts[1] : groupKey;

      const segments = folderPath.split('/').filter(Boolean);
      let folderName = folderPath;
      let parentName: string | null = (groupId && customNames[groupId]) ? customNames[groupId] : (parentFolderName || null);

      if (!parentName) {
        if (segments.length >= 2) {
          folderName = segments[segments.length - 1];
          parentName = segments[segments.length - 2];
        } else if (segments.length === 1) {
          folderName = segments[0];
          if (directoryName && directoryName !== folderName && !directoryName.includes(',')) {
            parentName = directoryName;
          }
        } else {
          folderName = directoryName || 'Root Folder';
        }
      } else if (segments.length > 0) {
        folderName = segments[segments.length - 1];
      }

      const displayName = parentName ? `${parentName} / ${folderName}` : folderName;
      const completed = videos.filter(v => v.status === ProcessingStatus.COMPLETED).length;
      const errors = videos.filter(v => v.status === ProcessingStatus.ERROR).length;
      const pending = videos.filter(v => v.status === ProcessingStatus.PENDING).length;

      // Extract or compute createdAt timestamp
      let groupCreatedAt: number | undefined = undefined;
      for (const v of videos) {
        if (v.createdAt) {
          groupCreatedAt = v.createdAt;
          break;
        }
        const match = (v.groupId || '').match(/^grp-(\d+)/);
        if (match) {
          groupCreatedAt = parseInt(match[1], 10);
          break;
        }
        const matchId = v.id.match(/^vid-(\d+)/);
        if (matchId) {
          groupCreatedAt = parseInt(matchId[1], 10);
          break;
        }
      }

      result.push({
        groupKey,
        groupId,
        folderPath,
        folderName,
        parentFolderName: parentName,
        displayName,
        videos,
        createdAt: groupCreatedAt,
        total: videos.length,
        completed,
        pending,
        errors,
      });
    });

    // Ensure new groups appear at the top of the list
    result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return result;
  }, [videoFiles, directoryName]);

  // Active / Last Job Group: tracks the latest uploaded or active folder group
  const lastJobGroup = useMemo(() => {
    if (folderGroups.length === 0) return null;
    if (activeJobGroupId) {
      const found = folderGroups.find(g => g.groupId === activeJobGroupId);
      if (found) return found;
    }
    return folderGroups[0];
  }, [folderGroups, activeJobGroupId]);

  // Metrics specifically for the last upload / active job (non-compounded)
  const jobFoundCount = lastJobGroup ? lastJobGroup.total : totalCount;
  const jobCompletedCount = lastJobGroup ? lastJobGroup.completed : completedCount;
  const jobErrorCount = lastJobGroup ? lastJobGroup.errors : errorCount;
  const jobPendingCount = lastJobGroup ? lastJobGroup.pending : pendingCount;

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

      <input 
        type="file" 
        ref={filesInputRef} 
        onChange={handleFallbackFilesInputChange}
        className="hidden"
        multiple
        accept="video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v,.wmv" 
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
                  {pendingCount > 0 ? "Session Restored: Re-authorization Required" : "Folder Access: Re-authorization Required"}
                </h3>
                <p className="text-sm text-amber-300/80">
                  {pendingCount > 0 ? (
                    <>
                      Restored <strong>{videoFiles.length} videos</strong> ({completedCount} completed, {pendingCount} pending) in folder <code className="bg-amber-900/40 px-1.5 py-0.5 rounded text-amber-200 font-mono text-xs">{directoryName}</code>.
                      Browser security requires permission to read and write to this folder.
                    </>
                  ) : (
                    <>
                      Restored <strong>{videoFiles.length} videos</strong> (all {completedCount} completed) in folder <code className="bg-amber-900/40 px-1.5 py-0.5 rounded text-amber-200 font-mono text-xs">{directoryName}</code>.
                      Browser security requires re-authorization to retry analysis or modify files in this folder.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
              {pendingCount > 0 ? (
                <button
                  onClick={handleResumeSession}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-semibold rounded-xl shadow-lg shadow-amber-900/40 transition-all active:scale-95 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Resume Analysis
                </button>
              ) : (
                <button
                  onClick={handleResumeSession}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-200 border border-amber-500/40 hover:border-amber-400/70 font-semibold rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  <Folder className="w-4 h-4 text-amber-400" />
                  Re-authorize Access
                </button>
              )}
              <button
                onClick={() => setNeedsPermission(false)}
                className="p-2.5 text-amber-400/60 hover:text-amber-200 hover:bg-amber-900/30 rounded-xl transition-colors cursor-pointer shrink-0"
                title="Dismiss banner"
                aria-label="Dismiss banner"
              >
                <X className="w-5 h-5" />
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
                   <span className="text-xs px-2.5 py-1 rounded bg-slate-900/60 border border-slate-700/60 text-slate-400 font-mono truncate max-w-[280px]" title={directoryName}>
                     📁 {folderGroups.length > 1 ? `${folderGroups.length} Folders (${totalCount} videos)` : directoryName}
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
                   {videoFiles.length > 0 ? 'Add Folder' : 'Select Folder'}
                 </button>

                 <button
                   onClick={handleSelectFiles}
                   disabled={isProcessing}
                   className="flex items-center gap-2 px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                   title="Select individual video files"
                 >
                   <FileVideo className="w-5 h-5 text-blue-400" />
                   {videoFiles.length > 0 ? 'Add Files' : 'Select Files'}
                 </button>

                  {!isProcessing ? (
                    <button
                      onClick={() => processQueue(lastJobGroup?.groupId)}
                      disabled={jobPendingCount === 0 && jobErrorCount === 0}
                      className={`flex items-center gap-2.5 px-6 py-3 rounded-lg font-semibold transition-all shadow-lg ${
                        (jobPendingCount > 0 || jobErrorCount > 0)
                          ? 'bg-blue-600 hover:bg-blue-500 text-white border-2 border-blue-400 hover:border-blue-300 shadow-blue-500/25 active:scale-95 cursor-pointer' 
                          : 'bg-slate-800 text-slate-500 border-2 border-slate-700 cursor-not-allowed'
                      }`}
                    >
                      <Play className={`w-5 h-5 ${(jobPendingCount > 0 || jobErrorCount > 0) ? 'fill-white text-white' : 'text-slate-500 fill-slate-500'}`} />
                      {jobErrorCount > 0 && jobPendingCount === 0 ? 'Retry Errors' : `Start Analysis (${jobPendingCount})`}
                    </button>
                  ) : (
                    <button
                      onClick={stopProcessing}
                      className="flex items-center gap-2.5 px-6 py-3 rounded-lg font-semibold transition-all shadow-lg bg-red-600 hover:bg-red-500 text-white border-2 border-red-400 hover:border-red-300 shadow-red-500/25 active:scale-95 cursor-pointer"
                    >
                      <Square className="w-4 h-4 fill-white text-white" />
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
                 <div className="h-6 flex items-center">
                    {statusMessage && (
                      <div className={`flex items-center gap-2 text-xs ${
                        statusMessage.includes('Aborted') 
                          ? 'text-red-400 font-bold' 
                          : isProcessing || isExporting
                            ? 'text-purple-300 animate-pulse'
                            : statusMessage.includes('Permission') || statusMessage.includes('Re-authorization')
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                      }`}>
                        {statusMessage.includes('Aborted') ? (
                          <Ban className="w-3.5 h-3.5 text-red-400" />
                        ) : isProcessing || isExporting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        ) : statusMessage.includes('Permission') || statusMessage.includes('Re-authorization') ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        {statusMessage}
                      </div>
                    )}
                 </div>
                
                 {/* Stats: Found, Done, Errors, and Requests for Last Upload / Active Job */}
                 <div className="flex flex-col gap-1.5 mt-auto">
                   {folderGroups.length > 0 && (
                     <div className="flex items-center justify-between text-[11px] px-1 text-slate-400">
                       <div className="flex items-center gap-1.5 truncate">
                         <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">Job:</span>
                         <span className="font-bold text-purple-300 truncate max-w-[200px]" title={lastJobGroup?.displayName || 'Current'}>
                           {lastJobGroup ? (lastJobGroup.displayName || lastJobGroup.folderName) : 'Current'}
                         </span>
                       </div>
                       {folderGroups.length > 1 && (
                         <span className="text-slate-500 font-mono text-[10px]" title="Total across all folder groups in queue">
                           Total Queue: {completedCount}/{totalCount}
                         </span>
                       )}
                     </div>
                   )}

                   <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                      <div className="bg-slate-900/60 p-3 sm:p-3.5 rounded-xl border border-slate-700/60 text-center flex flex-col items-center justify-center min-h-[74px] shadow-sm">
                        <div className="text-2xl sm:text-3xl font-extrabold text-slate-100 leading-none">{jobFoundCount}</div>
                        <div className="text-[11px] font-semibold text-slate-400 mt-1 uppercase tracking-normal whitespace-nowrap">Found</div>
                      </div>
                      <div className="bg-slate-900/60 p-3 sm:p-3.5 rounded-xl border border-slate-700/60 text-center flex flex-col items-center justify-center min-h-[74px] shadow-sm">
                        <div className="text-2xl sm:text-3xl font-extrabold text-green-400 leading-none">{jobCompletedCount}</div>
                        <div className="text-[11px] font-semibold text-green-500/80 mt-1 uppercase tracking-normal whitespace-nowrap">Done</div>
                      </div>
                      <div className="bg-slate-900/60 p-3 sm:p-3.5 rounded-xl border border-slate-700/60 text-center flex flex-col items-center justify-center min-h-[74px] shadow-sm">
                        <div className="text-2xl sm:text-3xl font-extrabold text-red-400 leading-none">{jobErrorCount}</div>
                        <div className="text-[11px] font-semibold text-red-400/80 mt-1 uppercase tracking-normal whitespace-nowrap">Errors</div>
                      </div>
                      <button
                        onClick={() => setShowQuotaModal(true)}
                        className="bg-slate-900/60 hover:bg-purple-950/40 p-3 sm:p-3.5 rounded-xl border border-purple-700/50 hover:border-purple-500/80 text-center transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[74px] shadow-sm hover:shadow-purple-950/30 active:scale-95"
                        title={`Processed ${quotaData.requestsToday} API requests today (${batchTotalTokens > 0 ? `${(batchTotalTokens / 1000).toFixed(1)}k tokens` : '0 tokens'}). Click for detailed Quota & Token breakdown.`}
                      >
                        <div className="text-2xl sm:text-3xl font-extrabold text-purple-400 group-hover:text-purple-300 leading-none">
                          {quotaData.requestsToday}
                        </div>
                        <div className="text-[11px] font-semibold text-purple-300/90 group-hover:text-purple-200 mt-1 tracking-normal whitespace-nowrap">
                          Requests
                        </div>
                      </button>
                   </div>
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

        {/* Video List Grouped per Folder */}
        <div className="space-y-6">
          {videoFiles.length === 0 ? (
            <div className="text-center py-20 text-slate-600 border-2 border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-4">
              <FolderOpen className="w-16 h-16 opacity-20" />
              <p className="text-lg">Select a folder or video files to begin analysis.</p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
                <button
                  onClick={handleSelectDirectory}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" />
                  Select Folder
                </button>
                <button
                  onClick={handleSelectFiles}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors cursor-pointer"
                >
                  <FileVideo className="w-4 h-4" />
                  Select Video Files
                </button>
              </div>
            </div>
          ) : (
            folderGroups.map((group) => {
              const isCollapsed = collapsedFolders[group.groupKey];
              return (
                <div 
                  key={group.groupKey} 
                  className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-5 space-y-4 backdrop-blur-sm shadow-lg transition-all"
                >
                  <div 
                    onClick={() => {
                      setActiveJobGroupId(group.groupId);
                      toggleFolderCollapse(group.groupKey);
                    }}
                    className="flex flex-col md:flex-row md:items-center justify-between gap-3.5 pb-3 border-b border-slate-700/50 cursor-pointer select-none group"
                  >
                    <div className="flex items-center gap-3 overflow-hidden min-w-0">
                      <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl shrink-0 group-hover:bg-blue-500/20 transition-colors">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-base text-slate-100 flex items-center gap-1.5 truncate">
                          {group.parentFolderName && (
                            <>
                              <span className="text-slate-400 font-medium group-hover:text-slate-300 transition-colors truncate">
                                {group.parentFolderName}
                              </span>
                              <span className="text-slate-600 font-normal">/</span>
                            </>
                          )}
                          <span className="text-white group-hover:text-blue-300 transition-colors truncate">
                            {group.folderName}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameParentFolder(
                                group.groupId, 
                                group.parentFolderName || "", 
                                group.folderPath, 
                                group.folderName, 
                                group.videos
                              );
                            }}
                            className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700/60 transition-colors ml-1 cursor-pointer"
                            title="Rename group"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
                          <span>{group.total} {group.total === 1 ? 'video' : 'videos'}</span>
                          {group.createdAt && (
                            <span 
                              className="inline-flex items-center gap-1.5 text-slate-300 bg-slate-900/70 px-2 py-0.5 rounded-md border border-slate-700/60 text-[11px] font-medium"
                              title={`Added: ${new Date(group.createdAt).toLocaleString()}`}
                            >
                              <Calendar className="w-3 h-3 text-purple-400 shrink-0" />
                              <span>
                                {new Date(group.createdAt).toLocaleDateString(undefined, { 
                                  month: 'short', 
                                  day: 'numeric', 
                                  year: 'numeric' 
                                })}
                              </span>
                              <span className="text-slate-600">•</span>
                              <Clock className="w-3 h-3 text-purple-400 shrink-0" />
                              <span>
                                {new Date(group.createdAt).toLocaleTimeString(undefined, { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </span>
                            </span>
                          )}
                          {group.folderPath && group.folderPath !== group.displayName && (
                            <span className="text-slate-500 hidden sm:inline truncate font-mono text-[11px]" title={group.folderPath}>
                              • {group.folderPath}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                      {/* Previews of first 3 videos */}
                      <FolderPreviewThumbnails videos={group.videos} />

                      {/* Status Counts */}
                      <div className="flex items-center gap-2 text-xs font-medium">
                        {group.completed > 0 && (
                          <span className="px-2.5 py-1 rounded-full bg-green-950/60 border border-green-700/50 text-green-300 flex items-center gap-1.5 font-mono">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                            {group.completed} Done
                          </span>
                        )}
                        {group.pending > 0 && (
                          <span className="px-2.5 py-1 rounded-full bg-amber-950/50 border border-amber-700/50 text-amber-300 font-mono">
                            {group.pending} Pending
                          </span>
                        )}
                        {group.errors > 0 && (
                          <span className="px-2.5 py-1 rounded-full bg-red-950/60 border border-red-700/50 text-red-300 font-mono">
                            {group.errors} Errors
                          </span>
                        )}
                      </div>

                      {/* Run / Retry Group Button */}
                      {(() => {
                        const isGroupDoneOrFailed = group.completed > 0 || group.errors > 0;
                        const isGroupActive = isProcessing && group.videos.some(v => 
                          v.status === ProcessingStatus.EXTRACTING || 
                          v.status === ProcessingStatus.SAVING || 
                          v.status === ProcessingStatus.ANALYZING
                        );

                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetryGroup(group.groupId, group.videos);
                            }}
                            disabled={isProcessing}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-950/60 hover:bg-purple-900/80 border border-purple-700/60 text-purple-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={
                              isGroupActive 
                                ? "Processing videos in this group..." 
                                : isGroupDoneOrFailed 
                                ? "Retry analysis for all videos in this group" 
                                : "Run analysis for all videos in this group"
                            }
                          >
                            {isGroupActive ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                                <span className="hidden sm:inline">Running</span>
                              </>
                            ) : isGroupDoneOrFailed ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
                                <span className="hidden sm:inline">Retry Group</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current text-purple-400" />
                                <span className="hidden sm:inline">Run Group</span>
                              </>
                            )}
                          </button>
                        );
                      })()}

                      {/* Delete Group Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteGroup(group.groupId, group.displayName, group.videos);
                        }}
                        disabled={isProcessing}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/50 border border-transparent hover:border-red-800/60 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Delete this group and its videos from the queue"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>

                      {/* Collapse/Expand Toggle */}
                      <div className="p-1 rounded-lg text-slate-400 group-hover:text-white group-hover:bg-slate-700 transition-all">
                        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="space-y-3 pt-1">
                      {group.videos.map((video) => (
                        <VideoCard 
                          key={video.id} 
                          video={video} 
                          onSave={handleManualSave}
                          onRetry={handleRetryVideo}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
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

      {/* Matching UI Modal for Alert, Confirm, and Prompt */}
      <ModalDialog config={modalDialogConfig} />
    </div>
  );
};

export default App;