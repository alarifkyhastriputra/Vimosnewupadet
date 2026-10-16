
import React, { useState, useEffect } from 'react';
import { Post, User, Announcement, Story } from '../types.ts';
import PostCard from './PostCard.tsx';
import Stories from './Stories.tsx';
import { useLanguage } from '../LanguageContext.tsx';

interface FeedProps {
  posts: Post[];
  stories?: Story[];
  onAddStory?: (text: string, photoURL?: string, videoURL?: string, mediaType?: 'image' | 'video') => void;
  onDeleteStory?: (storyId: string) => void;
  announcements?: Announcement[];
  onLike: (postId: string) => void;
  onDislike: (postId: string) => void;
  onComment: (postId: string, text: string, replyTo?: { commentId?: string; userName?: string; userId?: string }) => void;
  onUserClick: (userId: string) => void;
  currentUser: User;
  onFollow: (userId: string) => void;
  onTakeDownPost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  users: User[];
  isLoading?: boolean;
  isSyncing?: boolean;
  onRefresh?: () => void;
  onCreatePostClick?: () => void;
}

const PostCardSkeleton: React.FC = () => {
  return (
    <div className="border border-black/5 rounded-3xl p-5 bg-white space-y-4 shadow-sm relative overflow-hidden">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-full bg-neutral-100 animate-pulse"></div>
        <div className="flex-1 space-y-2 py-1">
          <div className="h-3.5 bg-neutral-100 rounded-lg w-1/3 animate-pulse"></div>
          <div className="h-2.5 bg-neutral-100 rounded-lg w-1/4 animate-pulse"></div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3.5 bg-neutral-100 rounded-lg animate-pulse"></div>
        <div className="h-3.5 bg-neutral-100 rounded-lg w-5/6 animate-pulse"></div>
      </div>
      <div className="h-44 bg-neutral-50 rounded-2xl w-full flex flex-col items-center justify-center border border-neutral-100/60">
        <div className="w-9 h-9 border-3 border-neutral-200 border-t-black rounded-full animate-spin"></div>
        <span className="text-[11px] font-bold text-neutral-400 mt-2.5">Memuat Konten...</span>
      </div>
      <div className="flex justify-between items-center pt-2">
        <div className="h-7 bg-neutral-100 rounded-full w-16 animate-pulse"></div>
        <div className="h-7 bg-neutral-100 rounded-full w-16 animate-pulse"></div>
        <div className="h-7 bg-neutral-100 rounded-full w-16 animate-pulse"></div>
      </div>
    </div>
  );
};

const StoriesSkeleton: React.FC = () => {
  return (
    <div className="flex space-x-4 overflow-x-auto pb-4 px-4 hide-scrollbar">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex flex-col items-center space-y-2 flex-shrink-0">
          <div className="w-14 h-14 rounded-full bg-neutral-100 border-2 border-neutral-200 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-neutral-300 border-t-black rounded-full animate-spin"></div>
          </div>
          <div className="h-2.5 bg-neutral-100 rounded w-10 animate-pulse"></div>
        </div>
      ))}
    </div>
  );
};

const SpinningFeedLoader: React.FC<{ message?: string; subMessage?: string }> = ({ 
  message = 'Memuat Postingan Web...', 
  subMessage = 'Menyinkronkan postingan terbaru Orbit' 
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 bg-white border border-black/5 rounded-3xl shadow-sm text-center animate-fade-in">
      <div className="relative mb-3.5 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-neutral-100 border-t-black animate-spin"></div>
        <i className="fas fa-satellite text-neutral-800 text-xs absolute animate-pulse"></i>
      </div>
      <p className="text-sm font-black text-neutral-900 tracking-tight">{message}</p>
      <p className="text-xs text-neutral-400 mt-1">{subMessage}</p>
    </div>
  );
};

const Feed: React.FC<FeedProps> = ({ 
  posts, 
  stories = [], 
  onAddStory, 
  onDeleteStory,
  announcements = [], 
  onLike, 
  onDislike, 
  onComment, 
  onUserClick, 
  currentUser, 
  onFollow, 
  onTakeDownPost, 
  onDeletePost, 
  users, 
  isLoading = false,
  isSyncing = false,
  onRefresh,
  onCreatePostClick
}) => {
  const { t } = useLanguage();
  const [pullStart, setPullStart] = useState<number | null>(null);
  const [pullDistance, setPullDistance] = useState<number>(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState<boolean>(false);

  useEffect(() => {
    if (!isSyncing) {
      setIsPullRefreshing(false);
      setPullDistance(0);
    }
  }, [isSyncing]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (window.scrollY === 0 && !isPullRefreshing && !isLoading && !isSyncing) {
      setPullStart(e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStart === null || isPullRefreshing || isLoading || isSyncing) return;
    
    const currentY = e.touches[0].clientY;
    const diff = currentY - pullStart;

    if (diff > 0) {
      const resistance = 0.45;
      const pull = Math.min(diff * resistance, 80);
      setPullDistance(pull);
      
      if (diff > 10 && e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullStart === null || isPullRefreshing || isLoading || isSyncing) return;
    
    if (pullDistance >= 55 && onRefresh) {
      setIsPullRefreshing(true);
      setPullDistance(55);
      onRefresh();
    } else {
      setPullDistance(0);
    }
    setPullStart(null);
  };

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="p-4 flex flex-col space-y-6 max-w-2xl mx-auto select-none touch-pan-y"
    >
      {/* Pull To Refresh Visual Indicator */}
      <div 
        style={{ 
          height: `${pullDistance}px`, 
          opacity: pullDistance > 0 ? 1 : 0,
          transition: pullStart === null ? 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' : 'none'
        }}
        className="overflow-hidden flex items-center justify-center w-full transition-all"
      >
        <div className="flex items-center space-x-2 bg-neutral-900 border border-neutral-800 text-white px-4 py-2 rounded-full shadow-lg text-[11px] font-black uppercase tracking-wider">
          {isPullRefreshing || isSyncing ? (
            <div className="w-3.5 h-3.5 border-2 border-neutral-700 border-t-white rounded-full animate-spin"></div>
          ) : (
            <i 
              style={{ transform: `rotate(${Math.min(pullDistance * 4.5, 360)}deg)` }}
              className="fas fa-arrow-down text-white transition-transform"
            ></i>
          )}
          <span>
            {isPullRefreshing || isSyncing 
              ? 'Memperbarui...' 
              : pullDistance >= 50 
                ? 'Lepas untuk memperbarui' 
                : 'Tarik untuk memperbarui'}
          </span>
        </div>
      </div>
      {/* Stories Section */}
      {onAddStory && (
        <Stories 
          stories={stories} 
          currentUser={currentUser} 
          onAddStory={onAddStory} 
          onDeleteStory={onDeleteStory}
          users={users}
        />
      )}

      {/* King's Proclamation Section */}
      {announcements.length > 0 && (
        <div className="space-y-3 mb-1">
          {announcements.map((ann) => (
            <div 
              key={ann.id} 
              className="bg-neutral-950 border border-neutral-800 rounded-2xl p-4 shadow-sm relative overflow-hidden group animate-fade-in"
            >
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <i className="fas fa-crown text-3xl text-white"></i>
              </div>
              <div className="flex items-center space-x-2 mb-2">
                <span className="bg-yellow-400 text-black text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex items-center shadow-xs">
                  <i className="fas fa-crown text-[6px] mr-1"></i>
                  King's Broadcast
                </span>
                <span className="text-[9px] text-neutral-400 font-bold uppercase tracking-wider">
                  {new Date(ann.timestamp).toLocaleDateString()}
                </span>
              </div>
              <p className="text-white text-sm font-semibold leading-relaxed">
                {ann.text}
              </p>
            </div>
          ))}
        </div>
      )}

      {isLoading && posts.length > 0 && (
        <div className="flex items-center justify-center space-x-2.5 py-3 px-5 bg-neutral-900 border border-neutral-800 rounded-2xl text-xs font-bold text-white animate-fade-in w-full max-w-sm mx-auto shadow-md">
          <div className="w-3.5 h-3.5 border-2 border-neutral-700 border-t-white rounded-full animate-spin"></div>
          <span>Sinkronisasi Vimos sedang berjalan...</span>
        </div>
      )}

      {isSyncing && posts.length > 0 && !isLoading && (
        <div className="flex items-center justify-center space-x-2 py-2 px-4 bg-neutral-100 border border-neutral-200 rounded-full text-xs font-semibold text-neutral-600 animate-fade-in w-fit mx-auto shadow-2xs">
          <div className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-black rounded-full animate-spin"></div>
          <span>Menyinkronkan postingan terbaru...</span>
        </div>
      )}

      {isLoading ? (
        <div className="py-8">
          <SpinningFeedLoader 
            message="Memuat Postingan Vimos..." 
            subMessage="Menyinkronkan feed terbaru dari server" 
          />
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center bg-white border border-neutral-200/80 rounded-3xl shadow-xs animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center mb-3 shadow-2xs">
            <i className="fas fa-camera-retro text-2xl text-neutral-400"></i>
          </div>
          <h3 className="font-black text-sm text-neutral-900 uppercase tracking-tight mb-1">Belum Ada Postingan</h3>
          <p className="text-xs text-neutral-400 mb-6 max-w-xs leading-relaxed">Belum ada memori yang diunggah. Jadilah yang pertama membagikan momen di Vimos!</p>
          
          <div className="flex flex-wrap items-center justify-center gap-3">
            {onRefresh && (
              <button 
                onClick={onRefresh}
                className="bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold px-4 py-2.5 rounded-full transition-all flex items-center space-x-2 active:scale-95 border border-neutral-200 cursor-pointer"
              >
                <i className={`fas fa-rotate text-[11px] text-neutral-600 ${isSyncing ? 'animate-spin' : ''}`}></i>
                <span>{isSyncing ? 'Menyinkronkan...' : 'Refresh'}</span>
              </button>
            )}
            {onCreatePostClick && (
              <button 
                onClick={onCreatePostClick}
                className="bg-black text-white text-xs font-black uppercase tracking-wider px-6 py-2.5 rounded-full hover:bg-neutral-800 transition-all shadow-md flex items-center space-x-1.5 active:scale-95 cursor-pointer"
              >
                <i className="fas fa-plus text-[10px]"></i>
                <span>{t('create_post')}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        posts.map((post, index) => (
          <React.Fragment key={post.id}>
            <PostCard 
              post={post} 
              onLike={onLike} 
              onDislike={onDislike}
              onComment={onComment}
              onUserClick={onUserClick}
              currentUser={currentUser}
              onFollow={onFollow}
              onTakeDownPost={onTakeDownPost}
              onDeletePost={onDeletePost}
              users={users}
            />
          </React.Fragment>
        ))
      )}
    </div>
  );
};

export default React.memo(Feed);
