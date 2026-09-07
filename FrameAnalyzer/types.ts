export interface VideoFile {
  id: string;
  name: string;
  path: string; // Relative path for display
  fileHandle?: FileSystemFileHandle;
  parentHandle?: FileSystemDirectoryHandle;
  file?: File; // Direct file object for fallback mode
  status: ProcessingStatus;
  screenshots: string[]; // Base64 strings for UI
  analysisResult?: string;
  error?: string;
}

export enum ProcessingStatus {
  PENDING = 'PENDING',
  EXTRACTING = 'EXTRACTING',
  SAVING = 'SAVING',
  ANALYZING = 'ANALYZING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface FrameData {
  blob: Blob;
  dataUrl: string; // Base64 data URL
}

// Extending Window to support File System Access API types if not available globally in TS env
declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterable<[string, FileSystemHandle]>;
  }
}