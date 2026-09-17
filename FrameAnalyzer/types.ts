export interface VideoFile {
  id: string;
  name: string;
  path: string; // Relative path for display
  groupId?: string; // Unique group identifier per folder addition
  parentFolderName?: string; // Custom or detected parent folder name
  isUserRenamed?: boolean; // Flag indicating the user manually renamed this group/folder
  createdAt?: number; // Timestamp when group/video was added
  fileHandle?: FileSystemFileHandle;
  parentHandle?: FileSystemDirectoryHandle;
  file?: File; // Direct file object for fallback mode
  status: ProcessingStatus;
  screenshots: string[]; // Base64 strings for UI
  analysisResult?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    candidateTokens: number;
    totalTokens: number;
  };
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
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; id?: string; startIn?: string }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: {
      multiple?: boolean;
      excludeAcceptAllOption?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }): Promise<FileSystemFileHandle[]>;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterable<[string, FileSystemHandle]>;
  }
}