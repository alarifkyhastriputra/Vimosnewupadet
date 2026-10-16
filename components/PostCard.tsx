
import React, { useState, useRef, useEffect } from 'react';
import { Post, User, Comment } from '../types';
import { 
  getYouTubeIdFromMusicURL, 
  fetchYouTubeMetadata, 
  parseYouTubeMusicUrl, 
  formatSecondsToTime 
} from '../services/youtubeMusic.ts';

interface PostCardProps {
  post: Post;
  onLike: (postId: string) => void;
  onDislike: (postId: string) => void;
  onComment: (postId: string, text: string, replyTo?: { commentId?: string; userName?: string; userId?: string }) => void;
  onUserClick: (userId: string) => void;
  currentUser: User;
  onFollow: (userId: string) => void;
  onTakeDownPost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  users: User[];
}

const PostCard: React.FC<PostCardProps> = ({ 
  post, onLike, onDislike, onComment, onUserClick, currentUser, onFollow, onTakeDownPost, onDeletePost, users 
}) => {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{ commentId: string; userName: string; userId: string } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [ytMeta, setYtMeta] = useState<{ title: string; author: string; thumbnailUrl: string } | null>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ytIframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const hasUserManuallyToggled = useRef<boolean>(false);
  const isVisibleRef = useRef<boolean>(false);
  
  const youtubeId = getYouTubeIdFromMusicURL(post.musicURL);
  const isYouTubeAudio = !!youtubeId;
  const parsedYt = post.musicURL ? parseYouTubeMusicUrl(post.musicURL) : null;
  const effectiveStart = post.musicStart ?? parsedYt?.start ?? 0;
  const effectiveEnd = post.musicEnd ?? parsedYt?.end ?? (effectiveStart > 0 ? effectiveStart + 30 : 30);

  // Play music with zero latency
  const playAudio = () => {
    setIsPlayingMusic(true);
    if (!isYouTubeAudio && audioRef.current) {
      if (audioRef.current.currentTime < effectiveStart || audioRef.current.currentTime >= effectiveEnd) {
        audioRef.current.currentTime = effectiveStart;
      }
      audioRef.current.muted = false;
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay policy fallback: unlock and start immediately upon screen interaction
          const unlock = () => {
            if (audioRef.current && isVisibleRef.current && !hasUserManuallyToggled.current) {
              audioRef.current.play().catch(() => {});
            }
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('scroll', unlock);
          };
          window.addEventListener('pointerdown', unlock, { once: true });
          window.addEventListener('touchstart', unlock, { once: true });
          window.addEventListener('scroll', unlock, { once: true });
        });
      }
    } else if (isYouTubeAudio && ytIframeRef.current?.contentWindow) {
      try {
        ytIframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'seekTo', args: [effectiveStart, true] }),
          '*'
        );
        ytIframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
          '*'
        );
      } catch {}
    }
  };

  // Pause music
  const pauseAudio = () => {
    setIsPlayingMusic(false);
    if (!isYouTubeAudio && audioRef.current) {
      audioRef.current.pause();
    } else if (isYouTubeAudio && ytIframeRef.current?.contentWindow) {
      try {
        ytIframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
          '*'
        );
      } catch {}
    }
  };

  // Toggle user manual control
  const toggleMusic = () => {
    if (isPlayingMusic) {
      hasUserManuallyToggled.current = true;
      pauseAudio();
    } else {
      hasUserManuallyToggled.current = false;
      playAudio();
    }
  };

  // Autoplay music when post enters viewport (and pause when scrolled past)
  useEffect(() => {
    if (!post.musicURL) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            isVisibleRef.current = true;
            if (!hasUserManuallyToggled.current) {
              playAudio();
            }
          } else if (!entry.isIntersecting || entry.intersectionRatio < 0.15) {
            isVisibleRef.current = false;
            pauseAudio();
          }
        });
      },
      {
        threshold: [0, 0.15, 0.35, 0.6, 0.9],
        rootMargin: '0px 0px -5% 0px'
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseAudio();
      } else if (isVisibleRef.current && !hasUserManuallyToggled.current) {
        playAudio();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pauseAudio();
    };
  }, [post.musicURL, isYouTubeAudio, effectiveStart, effectiveEnd]);

  // Audio loop handling between trimmed start & end with zero gap
  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      if (audioRef.current.currentTime >= effectiveEnd) {
        audioRef.current.currentTime = effectiveStart;
      }
    }
  };

  // Fetch YouTube metadata if post contains a YouTube audio track
  useEffect(() => {
    if (youtubeId) {
      fetchYouTubeMetadata(youtubeId).then(meta => {
        setYtMeta(meta);
      });
    }
  }, [youtubeId]);
  
  const postUser = users.find(u => u.id === post.userId);
  const isFollowing = (currentUser.following || []).includes(post.userId);
  const isMe = currentUser.id === post.userId;
  const hasLiked = (post.likes || []).includes(currentUser.id);
  const hasDisliked = (post.dislikes || []).includes(currentUser.id);

  const fallbackPhoto = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(post.userName || 'Member')}&backgroundColor=000000&fontFamily=Inter&fontWeight=700`;

  const displayAuthorName = isMe 
    ? (currentUser.name || postUser?.name || post.userName || 'Member')
    : (postUser?.name || post.userName || 'Member');

  const displayAuthorPhoto = isMe
    ? (currentUser.photoURL || postUser?.photoURL || post.userPhoto || fallbackPhoto)
    : (postUser?.photoURL || post.userPhoto || fallbackPhoto);
  const isAdmin = currentUser.isAdmin;

  const formattedDate = new Date(post.timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCommentText(val);

    const selectionPos = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, selectionPos);
    const match = textBeforeCursor.match(/@([\w.-]*)$/);

    if (match) {
      setMentionQuery(match[1]);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSelectMention = (user: User) => {
    const safeName = (user.name || 'User').replace(/\s+/g, '_');
    if (commentInputRef.current) {
      const cursorPos = commentInputRef.current.selectionStart || commentText.length;
      const textBefore = commentText.slice(0, cursorPos);
      const textAfter = commentText.slice(cursorPos);
      const replacedBefore = textBefore.replace(/@([\w.-]*)$/, `@${safeName} `);
      const newText = replacedBefore + textAfter;
      setCommentText(newText);
      setMentionQuery(null);
      setTimeout(() => {
        if (commentInputRef.current) {
          commentInputRef.current.focus();
          commentInputRef.current.setSelectionRange(replacedBefore.length, replacedBefore.length);
        }
      }, 10);
    } else {
      setCommentText(prev => prev + `@${safeName} `);
      setMentionQuery(null);
    }
  };

  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (commentText.trim()) {
      onComment(post.id, commentText.trim(), replyingTo || undefined);
      setCommentText('');
      setReplyingTo(null);
      setMentionQuery(null);
    }
  };

  const handleStartReply = (comment: Comment) => {
    setReplyingTo({
      commentId: comment.id,
      userName: comment.userName || 'Anonymous',
      userId: comment.userId
    });
    setShowComments(true);
    setTimeout(() => {
      if (commentInputRef.current) {
        commentInputRef.current.focus();
      }
    }, 50);
  };

  const filteredMentionUsers = mentionQuery !== null 
    ? users.filter(u => {
        const query = mentionQuery.toLowerCase();
        const name = (u.name || '').toLowerCase();
        const safeName = name.replace(/\s+/g, '_');
        return name.includes(query) || safeName.includes(query);
      }).slice(0, 5)
    : [];

  const renderCommentText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(@[\w.-]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('@')) {
        const mentionHandle = part.slice(1);
        const matchedUser = users.find(u => {
          const uClean = (u.name || '').replace(/\s+/g, '_').toLowerCase();
          const uSimple = (u.name || '').toLowerCase();
          const handle = mentionHandle.toLowerCase();
          return uClean === handle || uSimple === handle || u.id === mentionHandle;
        });

        return (
          <span
            key={idx}
            onClick={(e) => {
              e.stopPropagation();
              if (matchedUser) {
                onUserClick(matchedUser.id);
              }
            }}
            className={`font-black text-[11px] px-1.5 py-0.5 mx-0.5 rounded-md transition-all inline-flex items-center space-x-0.5 ${
              matchedUser 
                ? 'bg-neutral-100 hover:bg-black hover:text-white text-neutral-900 cursor-pointer shadow-xs border border-neutral-200/80' 
                : 'text-neutral-800 font-bold bg-neutral-100/60'
            }`}
            title={matchedUser ? `Buka profil @${matchedUser.name}` : undefined}
          >
            <span className="text-neutral-400 font-normal mr-0.5">@</span>
            <span>{matchedUser ? matchedUser.name : mentionHandle}</span>
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <article 
      ref={containerRef}
      className={`post-card border rounded-2xl overflow-hidden transition-all duration-300 transform hover:scale-[1.015] shadow-sm ${
      post.isTakenDown 
        ? 'opacity-70 grayscale border-red-500/30 bg-red-50/20' 
        : 'bg-white border-black/10 hover:border-black/30 hover:shadow-md'
    }`}>
      {isZoomed && post.photoURL && (
        <div 
          className="fixed inset-0 z-[110] bg-black/90 flex items-center justify-center cursor-zoom-out backdrop-blur-md"
          onClick={() => setIsZoomed(false)}
        >
          <img src={post.photoURL} alt="Zoomed" className="max-w-[95vw] max-h-[95vh] object-contain select-none" />
          <button 
            onClick={() => setIsZoomed(false)}
            className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-all"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      {/* Zero Delay Audio Element for Regular Audio Files */}
      {post.musicURL && !isYouTubeAudio && (
        <audio 
          ref={audioRef}
          src={post.musicURL} 
          preload="auto"
          onTimeUpdate={handleAudioTimeUpdate}
          onLoadedMetadata={() => {
            if (audioRef.current && effectiveStart > 0) {
              audioRef.current.currentTime = effectiveStart;
            }
          }}
          className="hidden"
        />
      )}

      {/* Hidden YouTube Audio IFrame player loaded eager with enablejsapi for zero lag */}
      {post.musicURL && isYouTubeAudio && youtubeId && (
        <div className="sr-only pointer-events-none opacity-0 w-0 h-0 overflow-hidden" aria-hidden="true">
          <iframe
            ref={ytIframeRef}
            key={`postcard_yt_${post.id}_${effectiveStart}_${effectiveEnd}`}
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?enablejsapi=1&autoplay=${isPlayingMusic ? '1' : '0'}&start=${effectiveStart}&end=${effectiveEnd}&loop=1&playlist=${youtubeId}&controls=0&playsinline=1&modestbranding=1&rel=0`}
            title="YouTube Audio Stream"
            loading="eager"
            allow="autoplay; encrypted-media"
            className="w-1 h-1"
          />
        </div>
      )}

      <div className="p-4 flex items-center space-x-3">
        <div className="relative">
          <img 
            src={displayAuthorPhoto} 
            alt={displayAuthorName} 
            loading="lazy"
            decoding="async"
            className="w-10 h-10 rounded-full object-cover cursor-pointer border border-gray-100"
            onClick={() => onUserClick(post.userId)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h3 className="font-bold text-sm cursor-pointer hover:underline truncate flex items-center" onClick={() => onUserClick(post.userId)}>
              <span>{displayAuthorName}</span>
              {(postUser?.isVerifiedSeller === true || postUser?.sellerStatus === 'approved') && (
                <i className="fas fa-circle-check text-blue-500 text-xs ml-1.5" title="Verified Merchant"></i>
              )}
            </h3>
            
            {/* Custom Role Badge with color */}
            {postUser?.role && !postUser?.isAdmin && (
               <span 
                className="text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1"
                style={{ backgroundColor: postUser.roleColor || '#000000' }}
               >
                <i className="fas fa-star text-[6px]"></i>
                <span>{postUser.role}</span>
              </span>
            )}

            {postUser?.isAdmin && (
               <span className="bg-black text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1">
                 <i className="fas fa-crown text-[6px] text-yellow-400"></i>
                 <span>Admin King</span>
               </span>
            )}
            
            {post.isTakenDown && (
              <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1">
                <i className="fas fa-shield-halved"></i>
                <span>Moderated</span>
              </span>
            )}

            {!isMe && (
              <button 
                onClick={() => onFollow(post.userId)}
                className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border transition-all shrink-0 ${
                  isFollowing ? 'border-gray-200 text-gray-400' : 'border-black text-black hover:bg-black hover:text-white'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{formattedDate}</p>
        </div>
        
        {post.musicURL && (
          <button 
            onClick={toggleMusic}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all border shrink-0 ${
              isPlayingMusic 
                ? isYouTubeAudio 
                  ? 'text-white border-red-600 bg-red-600 animate-pulse shadow-xs' 
                  : 'text-white border-black bg-black animate-pulse shadow-xs' 
                : 'text-black border-black/10 bg-gray-50 hover:bg-gray-100'
            }`}
            title={isPlayingMusic ? "Hentikan Musik (Mute)" : isYouTubeAudio ? "Putar YouTube Audio" : "Putar Musik"}
          >
            <i className={`fas ${isPlayingMusic ? 'fa-volume-high' : 'fa-volume-xmark'} text-[11px]`}></i>
          </button>
        )}

        {isAdmin && (
          <button 
            onClick={() => onTakeDownPost && onTakeDownPost(post.id)}
            className={`w-8 h-8 flex items-center justify-center rounded-full transition-all border shrink-0 ${
              post.isTakenDown 
                ? 'text-green-600 border-green-200 bg-green-50 hover:bg-green-100' 
                : 'text-red-500 border-red-100 bg-red-50 hover:bg-red-100'
            }`}
            title={post.isTakenDown ? "Restore Memory" : "Take Down Memory"}
          >
            <i className={`fas ${post.isTakenDown ? 'fa-shield-heart' : 'fa-shield-slash'} text-[10px]`}></i>
          </button>
        )}
        
        {(isMe || currentUser?.isAdmin) && onDeletePost && (
          <button 
            onClick={() => onDeletePost(post.id)}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all border shrink-0 text-gray-500 border-gray-200 bg-gray-50 hover:bg-red-50 hover:text-red-500 hover:border-red-200 cursor-pointer"
            title="Hapus Postingan"
          >
            <i className="fas fa-trash text-[10px]"></i>
          </button>
        )}
      </div>

      <div className="px-4 pb-3">
        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${post.isTakenDown ? 'text-gray-500 italic' : 'text-gray-800'}`}>
          {post.text}
        </p>

        {/* Attached Audio/Music Banner */}
        {post.musicURL && (
          <div className="mt-3 flex items-center justify-between p-2.5 rounded-2xl bg-neutral-900 text-white border border-neutral-800 shadow-sm">
            <div className="flex items-center space-x-2.5 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-xs ${
                isYouTubeAudio ? 'bg-red-600' : 'bg-neutral-800'
              }`}>
                <i className={`fas ${isPlayingMusic ? 'fa-music animate-bounce-subtle' : isYouTubeAudio ? 'fab fa-youtube' : 'fa-music'} text-sm`}></i>
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-1.5 mb-0.5">
                  <span className={`text-[8px] font-black px-1.5 py-0.2 rounded uppercase tracking-tighter ${
                    isYouTubeAudio ? 'bg-red-600 text-white' : 'bg-neutral-800 text-neutral-300'
                  }`}>
                    {isYouTubeAudio ? 'YouTube Sound' : 'Vimos Sound'}
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold">
                    {formatSecondsToTime(effectiveStart)} - {formatSecondsToTime(effectiveEnd)} ({effectiveEnd - effectiveStart}s)
                  </span>
                </div>
                <p className="text-xs font-bold text-white truncate">
                  {post.musicTitle || (isYouTubeAudio ? (ytMeta?.title || 'YouTube Audio Track') : 'Audio Soundtrack')}
                </p>
                <p className="text-[10px] text-neutral-400 truncate flex items-center space-x-1.5">
                  <span>{post.musicAuthor || (isYouTubeAudio ? (ytMeta?.author || 'YouTube') : 'Vimos Artist')}</span>
                  {isPlayingMusic && (
                    <span className="text-emerald-400 font-bold flex items-center space-x-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                      <span>Sedang Memutar Otomatis</span>
                    </span>
                  )}
                </p>
              </div>
            </div>

            <button
              onClick={toggleMusic}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center space-x-1.5 shrink-0 ml-2 shadow-xs ${
                isPlayingMusic 
                  ? 'bg-neutral-800 text-white hover:bg-neutral-700' 
                  : isYouTubeAudio 
                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                    : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              <i className={`fas ${isPlayingMusic ? 'fa-pause' : 'fa-play'} text-[10px]`}></i>
              <span>{isPlayingMusic ? 'Jeda' : 'Putar'}</span>
            </button>
          </div>
        )}
      </div>

      {(post.photoURL || post.videoURL) && (
        <div className={`relative bg-neutral-900 border-y border-black/5 overflow-hidden flex items-center justify-center min-h-[200px] ${post.isTakenDown ? 'opacity-30' : ''}`}>
          {isMediaLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/70 z-10 space-y-2">
              <div className="w-8 h-8 rounded-full border-2 border-neutral-600 border-t-white animate-spin"></div>
              <span className="text-[10px] font-semibold text-neutral-300">Memuat media...</span>
            </div>
          )}
          {post.photoURL && (
            <img 
              src={post.photoURL} 
              alt="Content" 
              loading="lazy"
              decoding="async"
              onLoad={() => setIsMediaLoading(false)}
              onError={() => setIsMediaLoading(false)}
              className="w-full h-auto max-h-[80vh] object-contain cursor-zoom-in animate-fade-in" 
              onClick={() => setIsZoomed(true)}
            />
          )}
          {post.videoURL && (
            <video 
              src={post.videoURL} 
              preload="metadata"
              onLoadedData={() => setIsMediaLoading(false)}
              onError={() => setIsMediaLoading(false)}
              className="w-full h-auto max-h-[80vh] object-contain" 
              controls={!post.isTakenDown} 
              playsInline 
              muted 
            />
          )}
        </div>
      )}

      <div className="p-4 flex items-center space-x-6 border-t border-black/5">
        <button 
          onClick={() => !post.isTakenDown && onLike(post.id)}
          disabled={post.isTakenDown}
          className={`flex items-center space-x-1.5 transition-colors ${
            post.isTakenDown ? 'text-gray-200 pointer-events-none' : hasLiked ? 'text-red-500' : 'text-gray-500 hover:text-black'
          }`}
        >
          <i className={`${hasLiked ? 'fas fa-heart' : 'far fa-heart'}`}></i>
          <span className="text-xs font-bold">{(post.likes || []).length}</span>
        </button>

        <button 
          onClick={() => !post.isTakenDown && onDislike(post.id)}
          disabled={post.isTakenDown}
          className={`flex items-center space-x-1.5 transition-colors ${
            post.isTakenDown ? 'text-gray-200 pointer-events-none' : hasDisliked ? 'text-gray-900' : 'text-gray-400 hover:text-black'
          }`}
        >
          <i className={`${hasDisliked ? 'fas fa-thumbs-down' : 'far fa-thumbs-down'}`}></i>
          <span className="text-xs font-bold">{(post.dislikes || []).length}</span>
        </button>

        <button 
          onClick={() => setShowComments(!showComments)}
          className={`flex items-center space-x-1.5 transition-colors ${
            showComments ? 'text-black' : 'text-gray-500 hover:text-black'
          }`}
        >
          <i className="far fa-comment"></i>
          <span className="text-xs font-bold">{(post.comments || []).length}</span>
        </button>

        <div className="ml-auto flex items-center space-x-2">
          {!post.isTakenDown && (
            <button 
              onClick={() => {
                const currentUrl = new URL(window.location.href);
                currentUrl.searchParams.set('post', post.id);
                const url = currentUrl.toString();

                if (navigator.share) {
                  navigator.share({
                    title: `Postingan Vimos oleh ${post.userName}`,
                    text: post.text || 'Lihat postingan ini di Vimos!',
                    url: url
                  }).catch(() => {});
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(url).then(() => {
                    alert("Tautan postingan berhasil disalin ke papan klip!");
                  }).catch(() => {
                    prompt("Salin tautan postingan ini:", url);
                  });
                } else {
                  prompt("Salin tautan postingan ini:", url);
                }
              }}
              title="Bagikan Postingan"
              className="flex items-center space-x-1.5 text-gray-500 hover:text-black transition-colors px-2 py-1 rounded-full hover:bg-black/5"
            >
              <i className="far fa-paper-plane text-sm"></i>
            </button>
          )}
        </div>
      </div>

      {showComments && (
        <div className="border-t border-black/5 bg-neutral-50/60 transition-all">
          <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto">
            {(post.comments || []).length === 0 ? (
              <div className="text-center py-6">
                <i className="far fa-comments text-2xl text-neutral-300 mb-1"></i>
                <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Belum ada komentar. Jadilah yang pertama!</p>
              </div>
            ) : (
              (post.comments || []).map((comment) => {
                const commentUser = users.find(u => u.id === comment.userId);
                const commentAvatar = comment.userPhoto || commentUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${comment.userName}&backgroundColor=000000&fontFamily=Inter&fontWeight=700`;

                return (
                  <div 
                    key={comment.id} 
                    className="bg-white p-3 rounded-2xl border border-black/5 shadow-xs transition-all hover:border-black/15 group"
                  >
                    <div className="flex items-start justify-between space-x-2">
                      <div className="flex items-start space-x-2.5 flex-1 min-w-0">
                        <img 
                          src={commentAvatar} 
                          alt={comment.userName}
                          className="w-7 h-7 rounded-full object-cover shrink-0 cursor-pointer border border-neutral-100 mt-0.5"
                          onClick={() => onUserClick(comment.userId)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-1.5 flex-wrap">
                            <span 
                              onClick={() => onUserClick(comment.userId)}
                              className="font-extrabold text-[11px] hover:underline cursor-pointer text-neutral-900"
                            >
                              {comment.userName}
                            </span>

                            {commentUser?.isAdmin && (
                              <span className="bg-black text-white text-[6px] font-black px-1 py-0.2 rounded uppercase">
                                Admin
                              </span>
                            )}

                            {comment.replyToUserName && (
                              <span className="text-[10px] text-neutral-400 font-medium inline-flex items-center space-x-1">
                                <i className="fas fa-reply text-[8px]"></i>
                                <span>membalas</span>
                                <span className="font-bold text-neutral-700">@{comment.replyToUserName}</span>
                              </span>
                            )}

                            <span className="text-[9px] text-neutral-400 font-medium ml-auto">
                              {new Date(comment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="text-xs text-neutral-800 mt-1 leading-relaxed break-words">
                            {renderCommentText(comment.text)}
                          </div>
                        </div>
                      </div>

                      {/* Reply button */}
                      {!post.isTakenDown && (
                        <button
                          type="button"
                          onClick={() => handleStartReply(comment)}
                          className="text-[10px] font-bold text-neutral-400 hover:text-black px-2 py-1 rounded-full hover:bg-neutral-100 transition-all shrink-0 flex items-center space-x-1"
                          title="Balas komentar ini"
                        >
                          <i className="fas fa-reply text-[9px]"></i>
                          <span className="hidden sm:inline">Balas</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          
          {!post.isTakenDown && (
            <div className="relative bg-white border-t border-black/5">
              {/* Replying indicator banner */}
              {replyingTo && (
                <div className="flex items-center justify-between px-4 py-1.5 bg-neutral-100 text-xs text-neutral-700 border-b border-neutral-200/80 animate-fade-in">
                  <div className="flex items-center space-x-1.5 truncate">
                    <i className="fas fa-reply text-[10px] text-neutral-500"></i>
                    <span className="text-[11px]">Membalas <strong className="font-bold text-neutral-900">@{replyingTo.userName}</strong></span>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setReplyingTo(null)}
                    className="text-neutral-400 hover:text-neutral-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full hover:bg-neutral-200 transition-all flex items-center space-x-1"
                  >
                    <i className="fas fa-times text-[10px]"></i>
                    <span>Batal</span>
                  </button>
                </div>
              )}

              {/* Tag / Mention suggestions popup */}
              {mentionQuery !== null && filteredMentionUsers.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-neutral-200 rounded-2xl shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto animate-fade-in">
                  <div className="px-3 py-1.5 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">Tag Teman (@)</span>
                    <span className="text-[9px] text-neutral-400">Pilih untuk menyebutkan</span>
                  </div>
                  {filteredMentionUsers.map(u => {
                    const uPhoto = u.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${u.name}&backgroundColor=000000`;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleSelectMention(u)}
                        className="w-full px-3 py-2 flex items-center space-x-2.5 hover:bg-neutral-100 text-left transition-colors border-b border-neutral-50 last:border-0"
                      >
                        <img src={uPhoto} alt={u.name} className="w-6 h-6 rounded-full object-cover border border-neutral-200" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-neutral-900 truncate">@{u.name}</p>
                          {u.bio && <p className="text-[9px] text-neutral-400 truncate">{u.bio}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handleCommentSubmit} className="p-2.5 flex items-center space-x-2">
                {/* Quick mention button */}
                <button
                  type="button"
                  onClick={() => {
                    if (commentInputRef.current) {
                      setCommentText(prev => prev + '@');
                      setMentionQuery('');
                      commentInputRef.current.focus();
                    }
                  }}
                  className="w-8 h-8 rounded-full border border-neutral-200 text-neutral-600 hover:text-black hover:border-black flex items-center justify-center text-xs font-black transition-all shrink-0 hover:bg-neutral-50"
                  title="Tag teman (@)"
                >
                  @
                </button>

                <input 
                  ref={commentInputRef}
                  type="text" 
                  value={commentText}
                  onChange={handleInputChange}
                  placeholder={replyingTo ? `Balas @${replyingTo.userName}...` : "Tulis komentar... gunakan @ untuk tag teman"}
                  className="flex-1 bg-neutral-50 border border-neutral-200 rounded-full px-4 py-2 text-xs focus:outline-none focus:border-black focus:bg-white transition-all placeholder:text-neutral-400"
                />
                <button 
                  type="submit" 
                  disabled={!commentText.trim()}
                  className="w-8 h-8 bg-black text-white rounded-full flex items-center justify-center disabled:opacity-20 hover:scale-105 active:scale-95 transition-all shrink-0 shadow-xs"
                >
                  <i className="fas fa-arrow-up text-[10px]"></i>
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </article>
  );
};

export default React.memo(PostCard);
