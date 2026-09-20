import { VideoFile, ProcessingStatus } from "../types";

const DB_NAME = 'FrameAnalyzerSessionDB';
const DB_VERSION = 1;
const STORE_NAME = 'session_store';
const SESSION_KEY = 'active_session';

export interface SavedJobSession {
  directoryName: string | null;
  dirHandle?: FileSystemDirectoryHandle;
  directoryHandles?: Record<string, FileSystemDirectoryHandle>;
  isFallbackMode: boolean;
  videoFiles: VideoFile[];
  isProcessing: boolean;
  timestamp: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Save current job session to IndexedDB
 */
export const saveJobSession = async (session: SavedJobSession): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      
      // Sanitize videoFiles to ensure cloneable data
      const sanitizedVideos = session.videoFiles.map(v => ({
        id: v.id,
        name: v.name,
        path: v.path,
        groupId: v.groupId,
        parentFolderName: v.parentFolderName,
        isUserRenamed: v.isUserRenamed,
        createdAt: v.createdAt,
        status: v.status,
        screenshots: v.screenshots || [],
        analysisResult: v.analysisResult,
        error: v.error,
        modelUsed: v.modelUsed,
        fileHandle: v.fileHandle,
        parentHandle: v.parentHandle,
        usage: v.usage,
      }));

      // Also mirror video models map directly into localStorage for fast fallback & inspection
      try {
        const raw = localStorage.getItem('frame_analyzer_video_models');
        const map = raw ? JSON.parse(raw) : {};
        session.videoFiles.forEach(v => {
          if (v.modelUsed) map[v.id] = v.modelUsed;
        });
        localStorage.setItem('frame_analyzer_video_models', JSON.stringify(map));
      } catch {}

      const payload: SavedJobSession = {
        directoryName: session.directoryName,
        dirHandle: session.dirHandle,
        directoryHandles: session.directoryHandles,
        isFallbackMode: session.isFallbackMode,
        videoFiles: sanitizedVideos,
        isProcessing: session.isProcessing,
        timestamp: Date.now(),
      };

      const putReq = store.put(payload, SESSION_KEY);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
  } catch (err) {
    console.warn("Failed to save job session to IndexedDB:", err);
  }
};

/**
 * Load saved job session from IndexedDB
 */
export const loadJobSession = async (): Promise<SavedJobSession | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(SESSION_KEY);

      getReq.onsuccess = () => {
        const res: SavedJobSession | null = getReq.result || null;
        if (res && res.videoFiles) {
          // Backfill modelUsed from localStorage if missing
          try {
            const raw = localStorage.getItem('frame_analyzer_video_models');
            if (raw) {
              const map = JSON.parse(raw);
              res.videoFiles = res.videoFiles.map(v => ({
                ...v,
                modelUsed: v.modelUsed || map[v.id] || undefined,
              }));
            }
          } catch {}
        }
        resolve(res);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn("Failed to load job session from IndexedDB:", err);
    return null;
  }
};

/**
 * Directly persist a single video's used model into localStorage
 */
export const saveVideoModelUsed = (videoId: string, modelUsed: string): void => {
  try {
    const raw = localStorage.getItem('frame_analyzer_video_models');
    const map = raw ? JSON.parse(raw) : {};
    map[videoId] = modelUsed;
    localStorage.setItem('frame_analyzer_video_models', JSON.stringify(map));
    localStorage.setItem('frame_analyzer_last_model_used', modelUsed);
  } catch (e) {
    console.warn("Failed to persist video model to localStorage:", e);
  }
};

/**
 * Clear job session from IndexedDB
 */
export const clearJobSession = async (): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const delReq = store.delete(SESSION_KEY);
      delReq.onsuccess = () => {
        try {
          localStorage.removeItem('frame_analyzer_video_models');
        } catch {}
        resolve();
      };
      delReq.onerror = () => reject(delReq.error);
    });
  } catch (err) {
    console.warn("Failed to clear job session from IndexedDB:", err);
  }
};

/**
 * Check if directory permission is currently granted
 */
export const verifyDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  readWrite: boolean = true
): Promise<boolean> => {
  if (!handle || typeof (handle as any).queryPermission !== 'function') return false;
  try {
    const status = await (handle as any).queryPermission({
      mode: readWrite ? 'readwrite' : 'read'
    });
    return status === 'granted';
  } catch {
    return false;
  }
};

/**
 * Request directory permission (must be triggered by user gesture)
 */
export const requestDirectoryPermission = async (
  handle: FileSystemDirectoryHandle,
  readWrite: boolean = true
): Promise<boolean> => {
  if (!handle || typeof (handle as any).requestPermission !== 'function') return false;
  try {
    const status = await (handle as any).requestPermission({
      mode: readWrite ? 'readwrite' : 'read'
    });
    return status === 'granted';
  } catch (err) {
    console.warn("Permission request rejected or cancelled:", err);
    return false;
  }
};
