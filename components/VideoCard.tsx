import React, { useState } from 'react';
import { VideoFile, ProcessingStatus } from '../types';
import { formatThreeLevelPath } from '../services/fileSystem';
import { Loader2, CheckCircle, AlertCircle, FileVideo, Image as ImageIcon, BrainCircuit, Save, Ban } from 'lucide-react';

interface VideoCardProps {
  video: VideoFile;
  onSave?: (video: VideoFile) => Promise<void>;
}

const statusColors = {
  [ProcessingStatus.PENDING]: 'bg-slate-700 border-slate-600 text-slate-400',
  [ProcessingStatus.EXTRACTING]: 'bg-blue-900/20 border-blue-700/50 text-blue-400',
  [ProcessingStatus.SAVING]: 'bg-indigo-900/20 border-indigo-700/50 text-indigo-400',
  [ProcessingStatus.ANALYZING]: 'bg-purple-900/20 border-purple-700/50 text-purple-400',
  [ProcessingStatus.COMPLETED]: 'bg-green-900/20 border-green-700/50 text-green-400',
  [ProcessingStatus.ERROR]: 'bg-red-900/20 border-red-700/50 text-red-400',
};

const statusIcons = {
  [ProcessingStatus.PENDING]: FileVideo,
  [ProcessingStatus.EXTRACTING]: ImageIcon,
  [ProcessingStatus.SAVING]: Loader2,
  [ProcessingStatus.ANALYZING]: BrainCircuit,
  [ProcessingStatus.COMPLETED]: CheckCircle,
  [ProcessingStatus.ERROR]: AlertCircle,
};

const VideoCard: React.FC<VideoCardProps> = ({ video, onSave }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const StatusIcon = statusIcons[video.status];
  const isProcessing = [
    ProcessingStatus.EXTRACTING,
    ProcessingStatus.SAVING,
    ProcessingStatus.ANALYZING
  ].includes(video.status);

  const handleSaveClick = async () => {
    if (!onSave) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await onSave(video);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error(e);
      // Optional: Handle error UI
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`p-4 rounded-xl border transition-all duration-300 ${statusColors[video.status]} flex flex-col gap-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className={`p-2 rounded-lg bg-black/20 ${video.status === ProcessingStatus.COMPLETED ? 'text-green-400' : 'text-slate-300'}`}>
            <StatusIcon className={`w-5 h-5 ${isProcessing ? 'animate-spin' : ''}`} />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="font-semibold text-sm truncate text-slate-100" title={video.name}>{video.name}</h3>
            <span className="text-xs text-slate-400 truncate font-mono" title={video.path}>
              {formatThreeLevelPath(video.path)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
            {video.usage && video.status === ProcessingStatus.COMPLETED && (
              <div 
                className="text-[11px] font-mono px-2 py-0.5 rounded bg-purple-950/50 border border-purple-700/50 text-purple-300 flex items-center gap-1 cursor-help"
                title={`Input: ${video.usage.promptTokens.toLocaleString()} tokens (3 frames + prompt)\nOutput: ${video.usage.candidateTokens.toLocaleString()} tokens (analysis)`}
              >
                <span className="text-purple-400">⚡</span>
                {video.usage.totalTokens.toLocaleString()} tok
              </div>
            )}
            <div className="text-xs font-mono px-2 py-1 rounded bg-black/30 uppercase tracking-wider">
              {video.status}
            </div>
        </div>
      </div>

      {/* Extracted Frames Preview */}
      {video.screenshots.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {video.screenshots.map((src, idx) => {
            // Label logic: Start, Middle, End
            let label = 'Middle';
            if (idx === 0) label = 'Start';
            if (idx === video.screenshots.length - 1) label = 'End';

            return (
              <div key={idx} className="aspect-video relative rounded-lg overflow-hidden bg-black/50 border border-white/5">
                <img src={src} alt={`${label} Frame`} className="w-full h-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] text-white/80">
                  {label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Analysis Result */}
      {video.analysisResult && (
        <div className="flex flex-col gap-3">
          <div className="bg-black/20 rounded-lg p-3 text-sm text-slate-200 border border-white/5">
            <div className="flex items-center gap-2 mb-2 text-purple-400 text-xs uppercase font-bold tracking-wider">
              <BrainCircuit className="w-3 h-3" />
              Gemini Analysis
            </div>
            <p className="leading-relaxed whitespace-pre-wrap">{video.analysisResult}</p>
          </div>
          
          {/* Action Area */}
          <div className="flex justify-end gap-2">
            {onSave ? (
              // Save to Disk Mode
              <button
                onClick={handleSaveClick}
                disabled={isSaving || saveSuccess}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  saveSuccess 
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                    : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-600'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    Saved to Disk
                  </>
                ) : (
                  <>
                    <Save className="w-3 h-3" />
                    Save Text & Images
                  </>
                )}
              </button>
            ) : (
               // Read Only Mode - Actions are now bulk only
               video.status === ProcessingStatus.COMPLETED && (
                 <div className="flex items-center gap-1.5 text-[10px] text-slate-500 opacity-60 cursor-help" title="Use the 'Export All' button at the top to save data.">
                    <Ban className="w-3 h-3" />
                    Single Save disabled (Use Bulk Export)
                 </div>
               )
            )}
          </div>
        </div>
      )}

      {/* Error Message */}
      {video.error && (
        <div className="bg-red-500/10 text-red-300 p-3 rounded-lg text-sm border border-red-500/20">
          <span className="font-bold">Error:</span> {video.error}
        </div>
      )}
    </div>
  );
};

export default VideoCard;