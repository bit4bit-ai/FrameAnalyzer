import { FrameData, VideoFile, ProcessingStatus } from "../types";
import { SUPPORTED_VIDEO_EXTENSIONS } from "../constants";
import JSZip from 'jszip';

// Helper to check extension
const isVideoFile = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? SUPPORTED_VIDEO_EXTENSIONS.includes(ext) : false;
};

/**
 * Format a path to display at most 3 levels (e.g. ".../FolderA/FolderB/video.mp4" or "FolderA/FolderB/video.mp4")
 */
export const formatThreeLevelPath = (fullPath: string): string => {
  if (!fullPath) return '';
  const normalized = fullPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length <= 3) {
    return segments.join('/');
  }

  return '.../' + segments.slice(-3).join('/');
};

/**
 * Extract the common directory path across a list of file paths
 */
export const getCommonDirectoryPath = (paths: string[], fallbackName: string = ''): string => {
  if (!paths || paths.length === 0) return fallbackName;

  const dirPaths = paths.map(p => {
    const normalized = p.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash !== -1 ? normalized.substring(0, lastSlash) : '';
  }).filter(Boolean);

  if (dirPaths.length === 0) return fallbackName;
  if (dirPaths.length === 1) return dirPaths[0];

  const splitDirs = dirPaths.map(d => d.split('/').filter(Boolean));
  let common = splitDirs[0];

  for (let i = 1; i < splitDirs.length; i++) {
    const current = splitDirs[i];
    let j = 0;
    while (j < common.length && j < current.length && common[j] === current[j]) {
      j++;
    }
    common = common.slice(0, j);
    if (common.length === 0) break;
  }

  return common.length ? common.join('/') : fallbackName;
};

// Singletons to prevent memory leaks and decoder exhaustion
let sharedVideo: HTMLVideoElement | null = null;
let sharedCanvas: HTMLCanvasElement | null = null;

const getSharedVideo = () => {
  if (!sharedVideo) {
    sharedVideo = document.createElement('video');
    sharedVideo.muted = true;
    sharedVideo.playsInline = true;
    sharedVideo.preload = 'auto';
    sharedVideo.style.display = 'none';
    document.body.appendChild(sharedVideo);
  }
  return sharedVideo;
};

const getSharedCanvas = () => {
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
  }
  return sharedCanvas;
};

// Recursive directory scanner
export const scanDirectoryForVideos = async (
  dirHandle: FileSystemDirectoryHandle,
  path: string = ''
): Promise<{ fileHandle: FileSystemFileHandle; parentHandle: FileSystemDirectoryHandle; path: string }[]> => {
  const videos: { fileHandle: FileSystemFileHandle; parentHandle: FileSystemDirectoryHandle; path: string }[] = [];
  try {
    for await (const [name, entry] of dirHandle.entries()) {
      try {
        if (entry.kind === 'file') {
          if (isVideoFile(name)) {
            videos.push({
              fileHandle: entry as FileSystemFileHandle,
              parentHandle: dirHandle,
              path: path ? `${path}/${name}` : name
            });
          }
        } else if (entry.kind === 'directory') {
          const subDirVideos = await scanDirectoryForVideos(entry as FileSystemDirectoryHandle, path ? `${path}/${name}` : name);
          videos.push(...subDirVideos);
        }
      } catch (innerErr) {
        console.warn(`Error processing entry ${name}:`, innerErr);
      }
    }
  } catch (err) {
    console.warn(`Access denied or error scanning directory ${path || 'root'}:`, err);
  }
  return videos;
};

export const scanFilesFromInput = (files: FileList): Array<{ file: File; path: string }> => {
  const videos: Array<{ file: File; path: string }> = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isVideoFile(file.name)) {
      videos.push({ file, path: file.webkitRelativePath || file.name });
    }
  }
  return videos;
};

// Optimized Frame extraction using singletons
export const extractFramesFromVideo = async (file: File): Promise<FrameData[]> => {
  const video = getSharedVideo();
  const objectUrl = URL.createObjectURL(file);
  
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.pause();
      video.removeAttribute('src'); 
      video.load(); // Force reset internal state
      URL.revokeObjectURL(objectUrl);
    };

    const handleLoadedData = async () => {
      video.onloadeddata = null;
      video.onerror = null;
      
      try {
        const duration = video.duration;
        const validDuration = Number.isFinite(duration) ? duration : 0;
        
        // Use safer time points to avoid stalls at EOF
        const safeEnd = Math.max(0.1, validDuration - 0.5);
        const timePoints = [0.1, validDuration / 2, safeEnd];
        
        const frames: FrameData[] = [];

        for (const time of timePoints) {
          try {
            if (validDuration > 0.5) {
              await seekToTime(video, time);
            }
          } catch (seekErr) {
            console.warn(`Seek to ${time}s timed out for ${file.name}. Continuing...`);
          }
          frames.push(captureFrame(video));
        }
        
        cleanup();
        // Add a small delay to allow browser to breathe before next video
        setTimeout(() => resolve(frames), 200);
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    video.onerror = () => {
      video.onloadeddata = null;
      video.onerror = null;
      cleanup();
      reject(new Error(`Failed to load: ${file.name}`));
    };

    video.onloadeddata = handleLoadedData;
    video.src = objectUrl;
  });
};

const seekToTime = (video: HTMLVideoElement, time: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      video.onseeked = null;
      reject(new Error(`Seek timeout`));
    }, 3000);

    video.onseeked = () => {
      clearTimeout(timeoutId);
      video.onseeked = null;
      resolve();
    };

    video.currentTime = time;
  });
};

const captureFrame = (video: HTMLVideoElement): FrameData => {
  const canvas = getSharedCanvas();
  
  // Resolution Capping: 1024px
  const MAX_DIM = 1024;
  let width = video.videoWidth || 640;
  let height = video.videoHeight || 360;

  if (width > MAX_DIM || height > MAX_DIM) {
    const ratio = width / height;
    if (width > height) {
      width = MAX_DIM;
      height = MAX_DIM / ratio;
    } else {
      height = MAX_DIM;
      width = MAX_DIM * ratio;
    }
  }

  canvas.width = width;
  canvas.height = height;
  
  const ctx = canvas.getContext('2d', { alpha: false }); // Disable alpha for perf
  if (!ctx) throw new Error("Canvas context failed");
  
  if (video.videoWidth > 0) {
    ctx.drawImage(video, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
  }
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const blob = base64ToBlob(dataUrl);

  // Clear canvas memory immediately
  canvas.width = 0;
  canvas.height = 0;

  return { blob, dataUrl };
};

const base64ToBlob = (dataUrl: string): Blob => {
  const parts = dataUrl.split(',');
  const byteString = atob(parts[1]);
  const mimeString = parts[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
};

export const saveFramesToDisk = async (
  parentHandle: FileSystemDirectoryHandle | undefined,
  originalFileName: string,
  frames: FrameData[]
) => {
  if (!parentHandle) return;
  const folderName = originalFileName.replace(/\.[^/.]+$/, "");
  const framesDir = await parentHandle.getDirectoryHandle(folderName, { create: true });
  const names = ['first_frame.jpg', 'middle_frame.jpg', 'last_frame.jpg'];
  for (let i = 0; i < frames.length; i++) {
    const fileHandle = await framesDir.getFileHandle(names[i], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(frames[i].blob);
    await writable.close();
  }
};

export const saveAnalysisToDisk = async (
  parentHandle: FileSystemDirectoryHandle | undefined,
  originalFileName: string,
  base64Screenshots: string[],
  analysisText: string
) => {
  if (!parentHandle) throw new Error("Read-only mode.");
  const folderName = originalFileName.replace(/\.[^/.]+$/, "");
  const targetDir = await parentHandle.getDirectoryHandle(folderName, { create: true });
  const names = ['first_frame.jpg', 'middle_frame.jpg', 'last_frame.jpg'];
  for (let i = 0; i < base64Screenshots.length; i++) {
    const blob = base64ToBlob(base64Screenshots[i]);
    const fileHandle = await targetDir.getFileHandle(names[i], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
  if (analysisText) {
    const textFileHandle = await targetDir.getFileHandle("analysis.txt", { create: true });
    const textWritable = await textFileHandle.createWritable();
    await textWritable.write(analysisText);
    await textWritable.close();
  }
};

export const packageAllVideosZip = async (videos: VideoFile[]) => {
  const zip = new JSZip();
  const completedVideos = videos.filter(v => v.status === ProcessingStatus.COMPLETED && v.analysisResult);
  if (completedVideos.length === 0) throw new Error("No completed videos to export.");

  for (const video of completedVideos) {
    const folderName = video.name.replace(/\.[^/.]+$/, "");
    const folder = zip.folder(folderName);
    if (folder) {
      if (video.analysisResult) folder.file("analysis.txt", video.analysisResult);
      const names = ['first_frame.jpg', 'middle_frame.jpg', 'last_frame.jpg'];
      video.screenshots.forEach((dataUrl, i) => {
        const cleanData = dataUrl.split(',')[1];
        if (cleanData) folder.file(names[i] || `frame_${i}.jpg`, cleanData, { base64: true });
      });
    }
  }

  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Batch_Analysis_${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
};

/**
 * Extract a quick, lightweight first frame thumbnail from a video file
 */
export const extractFirstFrameThumbnail = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);

    let isDone = false;
    const cleanup = () => {
      if (isDone) return;
      isDone = true;
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.onseeked = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Thumbnail timeout'));
    }, 6000);

    const tryCapture = () => {
      try {
        const canvas = document.createElement('canvas');
        const MAX_W = 160;
        const width = video.videoWidth || 160;
        const height = video.videoHeight || 90;
        const ratio = width / height;
        canvas.width = MAX_W;
        canvas.height = Math.max(20, Math.round(MAX_W / ratio));
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          clearTimeout(timeout);
          cleanup();
          resolve(dataUrl);
          return;
        }
      } catch (err) {
        // Fall through
      }
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Thumbnail render failed'));
    };

    let seekTriggered = false;
    const handleReady = () => {
      if (seekTriggered) return;
      seekTriggered = true;
      const duration = video.duration;
      // Seek slightly into video to avoid blank/black opening frames
      const seekTarget = (duration && Number.isFinite(duration) && duration > 0.5)
        ? Math.min(0.5, duration * 0.05)
        : 0.1;
      
      video.onseeked = () => {
        tryCapture();
      };

      try {
        video.currentTime = seekTarget;
      } catch (err) {
        tryCapture();
      }
    };

    video.onloadedmetadata = handleReady;
    video.onloadeddata = handleReady;

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error('Video load error'));
    };

    video.src = objectUrl;
  });
};