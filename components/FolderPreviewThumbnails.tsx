import React, { useState, useEffect } from 'react';
import { VideoFile } from '../types';
import { extractFirstFrameThumbnail } from '../services/fileSystem';
import { Film } from 'lucide-react';

const thumbnailCache = new Map<string, string>();

interface VideoThumbnailItemProps {
  video: VideoFile;
}

const VideoThumbnailItem: React.FC<VideoThumbnailItemProps> = ({ video }) => {
  const [thumb, setThumb] = useState<string | null>(() => {
    if (video.screenshots && video.screenshots.length > 0) {
      return video.screenshots[0];
    }
    return thumbnailCache.get(video.id) || null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(!thumb);

  useEffect(() => {
    // If video was analyzed and has screenshots, prioritize it
    if (video.screenshots && video.screenshots.length > 0) {
      setThumb(video.screenshots[0]);
      thumbnailCache.set(video.id, video.screenshots[0]);
      setIsLoading(false);
      return;
    }

    if (thumb) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    const loadThumb = async () => {
      try {
        let file = video.file;
        if (!file && video.fileHandle) {
          try {
            file = await video.fileHandle.getFile();
          } catch (err) {
            console.warn(`Could not read file for thumbnail ${video.name}:`, err);
          }
        }

        if (!file) {
          if (isMounted) setIsLoading(false);
          return;
        }

        const dataUrl = await extractFirstFrameThumbnail(file);
        thumbnailCache.set(video.id, dataUrl);
        if (isMounted) {
          setThumb(dataUrl);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) setIsLoading(false);
      }
    };

    loadThumb();

    return () => {
      isMounted = false;
    };
  }, [video.id, video.screenshots, video.file, video.fileHandle, video.name]);

  return (
    <div 
      className="relative w-14 h-9 sm:w-16 sm:h-10 rounded-md overflow-hidden bg-slate-900 border border-slate-700/80 shadow-inner shrink-0 group/thumb"
      title={video.name}
    >
      {thumb ? (
        <img 
          src={thumb} 
          alt={video.name} 
          className="w-full h-full object-cover transition-transform duration-200 group-hover/thumb:scale-110" 
        />
      ) : isLoading ? (
        <div className="w-full h-full flex items-center justify-center bg-slate-800/80 animate-pulse">
          <Film className="w-3.5 h-3.5 text-slate-500" />
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-800/60 text-slate-500">
          <Film className="w-3.5 h-3.5" />
        </div>
      )}
      <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors pointer-events-none" />
    </div>
  );
};

interface FolderPreviewThumbnailsProps {
  videos: VideoFile[];
}

const FolderPreviewThumbnails: React.FC<FolderPreviewThumbnailsProps> = ({ videos }) => {
  if (!videos || videos.length === 0) return null;

  const displayVideos = videos.slice(0, 3);

  return (
    <div 
      className="flex items-center gap-1.5 p-1 bg-slate-900/70 border border-slate-700/60 rounded-lg shrink-0 shadow-sm"
      title={`Preview of first ${displayVideos.length} ${displayVideos.length === 1 ? 'video' : 'videos'}`}
      onClick={(e) => {
        // Prevent toggling folder collapse when clicking thumbnail previews
        e.stopPropagation();
      }}
    >
      {displayVideos.map((vid) => (
        <VideoThumbnailItem key={vid.id} video={vid} />
      ))}
    </div>
  );
};

export default FolderPreviewThumbnails;
