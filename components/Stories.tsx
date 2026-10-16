import React, { useState, useRef, useEffect } from 'react';
import { Story, User } from '../types.ts';
import { useLanguage } from '../LanguageContext.tsx';

interface StoriesProps {
  stories: Story[];
  currentUser: User;
  onAddStory: (text: string, photoURL?: string, videoURL?: string, mediaType?: 'image' | 'video') => void;
  onDeleteStory?: (storyId: string) => void;
  users: User[];
}

const getRemainingTimeFormatted = (createdAt: number) => {
  const now = Date.now();
  const twentyFourHours = 24 * 60 * 60 * 1000;
  const diff = (createdAt + twentyFourHours) - now;
  if (diff <= 0) return 'Kedaluwarsa';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `${hours}j ${minutes}m`;
  }
  return `${Math.max(1, minutes)}m`;
};

const Stories: React.FC<StoriesProps> = ({ 
  stories, 
  currentUser, 
  onAddStory, 
  onDeleteStory,
  users
}) => {
  const { t } = useLanguage();
  const [isAdding, setIsAdding] = useState(false);
  const [text, setText] = useState('');
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeStory = activeStoryIndex !== null && activeStoryIndex < stories.length ? stories[activeStoryIndex] : null;
  const isCurrentStoryVideo = !!(activeStory?.videoURL || activeStory?.mediaType === 'video');

  // Auto advance story viewer (for photos/text with 6s duration, or fallback for video)
  useEffect(() => {
    if (activeStoryIndex === null || isPaused || stories.length === 0) {
      setProgress(0);
      return;
    }

    // If active story is a video, progress is driven by video timeUpdate/onEnded
    if (isCurrentStoryVideo) {
      return;
    }

    const duration = 6000; // 6 seconds for images/text
    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          if (activeStoryIndex < stories.length - 1) {
            setActiveStoryIndex(activeStoryIndex + 1);
            return 0;
          } else {
            setActiveStoryIndex(null);
            return 0;
          }
        }
        return prev + step;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [activeStoryIndex, isPaused, stories.length, isCurrentStoryVideo]);

  // Handle video element play/pause when user holds screen or story changes
  useEffect(() => {
    if (videoRef.current) {
      if (isPaused) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [isPaused, activeStoryIndex]);

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isVideo = file.type.startsWith('video/');
      const reader = new FileReader();
      reader.onloadend = () => {
        setMediaPreview({
          url: reader.result as string,
          type: isVideo ? 'video' : 'image'
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdd = () => {
    if (text.trim() || mediaPreview) {
      const photoURL = mediaPreview?.type === 'image' ? mediaPreview.url : undefined;
      const videoURL = mediaPreview?.type === 'video' ? mediaPreview.url : undefined;
      const mediaType = mediaPreview?.type;

      onAddStory(text, photoURL, videoURL, mediaType);
      setText('');
      setMediaPreview(null);
      setIsAdding(false);
    }
  };

  const handleDelete = (storyId: string) => {
    if (onDeleteStory) {
      onDeleteStory(storyId);
    }
    setConfirmDeleteId(null);
    if (stories.length <= 1) {
      setActiveStoryIndex(null);
    } else if (activeStoryIndex !== null && activeStoryIndex >= stories.length - 1) {
      setActiveStoryIndex(stories.length - 2);
    }
  };

  const nextStory = () => {
    if (activeStoryIndex !== null && activeStoryIndex < stories.length - 1) {
      setActiveStoryIndex(activeStoryIndex + 1);
      setProgress(0);
    } else {
      setActiveStoryIndex(null);
      setProgress(0);
    }
  };

  const prevStory = () => {
    if (activeStoryIndex !== null && activeStoryIndex > 0) {
      setActiveStoryIndex(activeStoryIndex - 1);
      setProgress(0);
    }
  };

  // Check if current user already posted an active story
  const myActiveStory = stories.find(s => s.userId === currentUser.id);

  return (
    <div className="w-full mb-6">
      <div className="flex space-x-4 overflow-x-auto pb-4 px-4 hide-scrollbar items-center">
        {/* Add / View My Story Button */}
        <div 
          className="flex flex-col items-center space-y-1.5 flex-shrink-0 cursor-pointer group" 
          onClick={() => {
            if (myActiveStory) {
              const myIdx = stories.findIndex(s => s.id === myActiveStory.id);
              if (myIdx !== -1) {
                setActiveStoryIndex(myIdx);
                setProgress(0);
                return;
              }
            }
            setIsAdding(true);
          }}
        >
          <div className="relative">
            <div className={`w-14 h-14 rounded-full p-0.5 transition-all overflow-hidden bg-neutral-100 flex items-center justify-center ${
              myActiveStory ? 'border-2 border-emerald-500 ring-2 ring-emerald-500/20' : 'border-2 border-dashed border-neutral-300 group-hover:border-black'
            }`}>
              <img 
                src={currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(currentUser.name || 'Orbit')}&backgroundColor=000000`} 
                alt="My Story" 
                className="w-full h-full rounded-full object-cover" 
              />
            </div>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsAdding(true);
              }}
              title="Buat Story Baru (Foto / Video)"
              className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-black text-white rounded-full flex items-center justify-center border-2 border-white shadow-xs group-hover:scale-110 transition-transform"
            >
              <i className="fas fa-plus text-[8px] font-black"></i>
            </button>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[11px] font-semibold text-neutral-800 truncate w-16 text-center">
              {myActiveStory ? 'Story Saya' : t('add_story')}
            </span>
            {myActiveStory && (
              <span className="text-[9px] font-bold text-emerald-600 truncate">
                {getRemainingTimeFormatted(myActiveStory.createdAt)}
              </span>
            )}
          </div>
        </div>

        {/* Story List (Followers & Following only) */}
        {stories
          .filter(s => s.userId !== currentUser.id)
          .map((story) => {
            const user = users.find(u => u.id === story.userId) || { name: story.userName, photoURL: story.userPhoto };
            const originalIndex = stories.findIndex(s => s.id === story.id);
            const remaining = getRemainingTimeFormatted(story.createdAt);
            const hasVideo = !!(story.videoURL || story.mediaType === 'video');

            return (
              <div 
                key={story.id} 
                className="flex flex-col items-center space-y-1.5 flex-shrink-0 cursor-pointer group animate-fade-in" 
                onClick={() => {
                  setActiveStoryIndex(originalIndex !== -1 ? originalIndex : 0);
                  setProgress(0);
                }}
              >
                <div className="relative">
                  <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-tr from-neutral-900 via-neutral-600 to-neutral-300 group-hover:scale-105 transition-transform shadow-xs">
                    <div className="w-full h-full rounded-full p-[1.5px] bg-white">
                      <img 
                        src={user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}&backgroundColor=000000`} 
                        alt={user.name} 
                        className="w-full h-full rounded-full object-cover" 
                      />
                    </div>
                  </div>
                  {/* Badge: Video / Mutual Follower */}
                  <div className="absolute -bottom-1 -right-0.5 bg-neutral-900 text-white rounded-full w-4 h-4 flex items-center justify-center text-[7px] border border-white shadow-xs" title={hasVideo ? "Video Story" : "Pengikut / Diikuti"}>
                    <i className={hasVideo ? "fas fa-video text-[6px]" : "fas fa-user-group text-[6px]"}></i>
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[11px] font-medium text-neutral-800 truncate w-16 text-center">{user.name.split(' ')[0]}</span>
                  <span className="text-[9px] text-neutral-400 font-semibold">{remaining}</span>
                </div>
              </div>
            );
          })}
      </div>

      {/* Add Story Modal (Supports Photo & Video) */}
      {isAdding && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 relative shadow-2xl border border-neutral-100 animate-scale-up">
            <button 
              onClick={() => {
                setIsAdding(false);
                setMediaPreview(null);
                setText('');
              }} 
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 flex items-center justify-center transition-colors"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
            
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center text-xs">
                <i className="fas fa-camera"></i>
              </div>
              <h3 className="text-lg font-black text-neutral-900 tracking-tight">Buat Story (Foto / Video)</h3>
            </div>
            
            {/* Story Privacy & Expiration Rules Notice */}
            <div className="bg-neutral-50 border border-neutral-200/70 rounded-2xl p-3 mb-4 space-y-1 text-xs text-neutral-600">
              <div className="flex items-center justify-between text-neutral-900 font-bold">
                <div className="flex items-center space-x-1.5">
                  <i className="fas fa-lock text-[10px] text-neutral-700"></i>
                  <span>Hanya Followers & Following</span>
                </div>
                <span className="text-[10px] text-neutral-500 font-medium flex items-center space-x-1">
                  <i className="fas fa-clock text-[9px]"></i>
                  <span>24 Jam</span>
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Kamu dapat mengunggah <strong>foto</strong>, <strong>video</strong> pendek, ataupun pesan teks.
              </p>
            </div>
            
            <textarea
              className="w-full bg-neutral-50 border border-neutral-200/60 rounded-2xl p-3.5 mb-3 outline-none resize-none h-20 text-sm focus:border-black transition-colors placeholder:text-neutral-400"
              placeholder="Tulis caption atau pesan story kamu..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            {/* Media Preview (Photo or Video) */}
            {mediaPreview && (
              <div className="relative mb-4 rounded-2xl overflow-hidden aspect-video bg-neutral-950 border border-neutral-200 shadow-inner flex items-center justify-center">
                {mediaPreview.type === 'video' ? (
                  <video 
                    src={mediaPreview.url} 
                    className="w-full h-full object-cover" 
                    autoPlay 
                    loop 
                    muted 
                    playsInline 
                  />
                ) : (
                  <img 
                    src={mediaPreview.url} 
                    alt="Upload preview" 
                    className="w-full h-full object-cover" 
                  />
                )}
                
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] text-white font-bold flex items-center space-x-1 border border-white/10">
                  <i className={mediaPreview.type === 'video' ? 'fas fa-video text-amber-400' : 'fas fa-image text-cyan-400'}></i>
                  <span>{mediaPreview.type === 'video' ? 'Video Terpilih' : 'Foto Terpilih'}</span>
                </div>

                <button 
                  onClick={() => setMediaPreview(null)} 
                  className="absolute top-2 right-2 w-7 h-7 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center backdrop-blur-xs transition-colors shadow-md"
                  title="Hapus Media"
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center space-x-1.5">
                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()} 
                  className="px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition-all flex items-center space-x-1.5 active:scale-95 border border-neutral-200/60"
                  title="Pilih Foto atau Video"
                >
                  <i className="fas fa-photo-film text-neutral-700"></i>
                  <span>{mediaPreview ? 'Ganti Media' : 'Foto / Video'}</span>
                </button>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleMediaUpload} 
                accept="image/*,video/*" 
                className="hidden" 
              />
              
              <button 
                type="button"
                onClick={handleAdd}
                disabled={!text.trim() && !mediaPreview}
                className="bg-black text-white px-5 py-2.5 rounded-full font-bold text-xs hover:bg-neutral-800 disabled:opacity-40 transition-all shadow-xs flex items-center space-x-1.5 active:scale-95"
              >
                <i className="fas fa-paper-plane text-[10px]"></i>
                <span>Bagikan Story</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Story Modal */}
      {activeStory && (
        <div 
          className="fixed inset-0 z-[150] bg-black flex items-center justify-center p-0 select-none animate-fade-in"
          onMouseDown={() => setIsPaused(true)}
          onMouseUp={() => setIsPaused(false)}
          onTouchStart={() => setIsPaused(true)}
          onTouchEnd={() => setIsPaused(false)}
        >
          {/* Progress Bars */}
          <div className="absolute top-3 left-4 right-4 flex space-x-1.5 z-30">
            {stories.map((s, i) => (
              <div key={s.id} className="h-1 flex-1 bg-white/25 rounded-full overflow-hidden backdrop-blur-xs">
                <div 
                  className={`h-full bg-white transition-all duration-75 ${
                    i === activeStoryIndex 
                      ? 'rounded-full' 
                      : i < activeStoryIndex! 
                        ? 'w-full' 
                        : 'w-0'
                  }`}
                  style={{
                    width: i === activeStoryIndex ? `${progress}%` : undefined
                  }}
                ></div>
              </div>
            ))}
          </div>

          {/* Close, Author, Mute & 24h Expiry Header */}
          <div className="absolute top-8 left-4 right-4 flex items-center justify-between z-30">
            <div className="flex items-center space-x-2.5 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
              <img 
                src={activeStory.userPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${activeStory.userName}`} 
                alt={activeStory.userName} 
                className="w-8 h-8 rounded-full border border-white/30 object-cover" 
              />
              <div className="flex flex-col">
                <div className="flex items-center space-x-1.5">
                  <p className="text-white font-bold text-xs truncate max-w-[110px]">{activeStory.userName}</p>
                  {isCurrentStoryVideo ? (
                    <span className="bg-amber-500/30 text-amber-300 text-[8px] font-bold px-1.5 py-0.2 rounded-full flex items-center space-x-1 border border-amber-500/40">
                      <i className="fas fa-video text-[6px]"></i>
                      <span>Video</span>
                    </span>
                  ) : (
                    <span className="bg-white/20 text-white text-[8px] font-semibold px-1.5 py-0.2 rounded-full flex items-center space-x-1">
                      <i className="fas fa-lock text-[6px]"></i>
                      <span>Followers</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-1.5 text-[10px] text-white/70">
                  <span>{new Date(activeStory.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>•</span>
                  <span className="text-emerald-300 font-semibold flex items-center space-x-1">
                    <i className="fas fa-clock text-[8px]"></i>
                    <span>{getRemainingTimeFormatted(activeStory.createdAt)}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Mute / Unmute Button for Video Stories */}
              {isCurrentStoryVideo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMuted(!isMuted);
                  }}
                  className="text-white w-9 h-9 flex items-center justify-center bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full border border-white/10 transition-colors"
                  title={isMuted ? 'Suara Dinonaktifkan' : 'Suara Aktif'}
                >
                  <i className={`fas ${isMuted ? 'fa-volume-xmark text-neutral-400' : 'fa-volume-high text-white'} text-xs`}></i>
                </button>
              )}

              {/* Delete Story Button (For Owner or Admin) */}
              {(activeStory.userId === currentUser.id || currentUser.isAdmin) && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(activeStory.id);
                  }} 
                  title="Hapus Story"
                  className="text-white/80 hover:text-red-400 w-9 h-9 flex items-center justify-center bg-black/40 hover:bg-red-500/20 backdrop-blur-md rounded-full border border-white/10 transition-colors"
                >
                  <i className="fas fa-trash-can text-xs"></i>
                </button>
              )}

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveStoryIndex(null);
                }} 
                className="text-white w-9 h-9 flex items-center justify-center bg-black/40 hover:bg-white/20 backdrop-blur-md rounded-full border border-white/10 transition-colors"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>
          </div>

          {/* Navigation Click Areas (Left: Prev, Right: Next) */}
          <div 
            className="absolute top-0 bottom-0 left-0 w-1/3 z-20 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              prevStory();
            }}
          ></div>
          <div 
            className="absolute top-0 bottom-0 right-0 w-1/3 z-20 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              nextStory();
            }}
          ></div>

          {/* Story Visual Container (Photo, Video, or Text) */}
          <div className="w-full max-w-sm h-[85vh] max-h-[720px] relative bg-neutral-950 flex flex-col items-center justify-center rounded-3xl overflow-hidden shadow-2xl border border-white/10 mx-4">
            {isCurrentStoryVideo ? (
              <video 
                ref={videoRef}
                src={activeStory.videoURL || activeStory.photoURL} 
                className="absolute inset-0 w-full h-full object-cover" 
                autoPlay 
                playsInline 
                muted={isMuted}
                onTimeUpdate={() => {
                  if (videoRef.current && videoRef.current.duration) {
                    const currentPct = (videoRef.current.currentTime / videoRef.current.duration) * 100;
                    setProgress(currentPct);
                  }
                }}
                onEnded={() => {
                  nextStory();
                }}
              />
            ) : activeStory.photoURL ? (
              <img 
                src={activeStory.photoURL} 
                alt="Story content" 
                className="absolute inset-0 w-full h-full object-cover" 
              />
            ) : null}
            
            {/* Text / Caption Overlay */}
            {activeStory.text && (
              <div className="relative z-10 p-6 max-w-xs text-center">
                <p className={`text-white font-bold leading-relaxed ${
                  activeStory.photoURL || isCurrentStoryVideo
                    ? 'bg-black/60 p-4 rounded-2xl backdrop-blur-md text-sm border border-white/10 shadow-lg' 
                    : 'text-xl drop-shadow-md'
                }`}>
                  {activeStory.text}
                </p>
              </div>
            )}

            {/* Bottom 24-Hour & Media Pill */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 text-[10px] text-white/80 flex items-center space-x-1.5 shadow-sm">
              <i className="fas fa-hourglass-half text-[9px] text-amber-400"></i>
              <span>Otomatis terhapus dalam 24 jam</span>
            </div>
          </div>

          {/* Confirmation Dialog for Story Deletion */}
          {confirmDeleteId && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl border border-neutral-100 animate-scale-up">
                <div className="w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-3">
                  <i className="fas fa-trash-can text-lg"></i>
                </div>
                <h4 className="text-base font-black text-neutral-900 mb-1">Hapus Story?</h4>
                <p className="text-xs text-neutral-500 mb-5 leading-relaxed">
                  Story ini akan langsung dihapus dari Orbit dan tidak dapat dikembalikan.
                </p>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="flex-1 py-2.5 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition-all active:scale-95"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(confirmDeleteId)}
                    className="flex-1 py-2.5 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all active:scale-95 shadow-xs"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Stories;

