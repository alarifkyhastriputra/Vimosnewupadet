
import React, { useState, useRef, useEffect } from 'react';
import { Post, User } from '../types';

interface ReelsProps {
  posts: Post[];
  onLike: (postId: string) => void;
  onComment: (postId: string, text: string) => void;
  onUserClick: (userId: string) => void;
  currentUser: User;
  onTakeDownPost?: (postId: string) => void;
  onDeletePost?: (postId: string) => void;
  users: User[];
}

const ReelItem: React.FC<{
  post: Post;
  isActive: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onLike: (id: string) => void;
  onCommentClick: () => void;
  onUserClick: (id: string) => void;
  currentUser: User;
  isCommenting: boolean;
  onTakeDownPost?: (id: string) => void;
  onDeletePost?: (id: string) => void;
  users: User[];
}> = ({ post, isActive, isMuted, onToggleMute, onLike, onCommentClick, onUserClick, currentUser, isCommenting, onTakeDownPost, onDeletePost, users }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasLiked = (post.likes || []).includes(currentUser.id);
  const isAdmin = currentUser.isAdmin;
  const postUser = users.find(u => u.id === post.userId);
  const fallbackPhoto = `https://api.dicebear.com/7.x/initials/svg?seed=${post.userName}&backgroundColor=000000&fontFamily=Inter&fontWeight=700`;

  useEffect(() => {
    if (videoRef.current) {
      if (isActive) {
        videoRef.current.play().catch(e => console.log("Autoplay blocked or interrupted", e));
      } else {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isActive]);

  return (
    <div className={`relative w-full h-full snap-start flex flex-col justify-end overflow-hidden bg-black ${post.isTakenDown ? 'opacity-40 grayscale' : ''}`}>
      <video 
        ref={videoRef}
        src={post.videoURL} 
        preload={isActive ? "auto" : "metadata"}
        className="absolute inset-0 w-full h-full object-contain"
        loop
        muted={isMuted}
        playsInline
        onClick={onToggleMute}
      />
      
      {/* Overlay Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent pointer-events-none" />

      {/* Interaction Panel */}
      <div className="absolute right-4 bottom-24 flex flex-col space-y-6 items-center z-10">
        {isAdmin && (
          <button 
            onClick={() => onTakeDownPost && onTakeDownPost(post.id)}
            className="flex flex-col items-center group mb-2"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all ${post.isTakenDown ? 'bg-green-600' : 'bg-red-600'} text-white`}>
              <i className={`fas ${post.isTakenDown ? 'fa-shield-heart' : 'fa-shield-slash'} text-sm`}></i>
            </div>
            <span className={`text-[8px] font-black mt-1 uppercase tracking-tighter ${post.isTakenDown ? 'text-green-500' : 'text-red-500'}`}>
              {post.isTakenDown ? 'Restore' : 'Takedown'}
            </span>
          </button>
        )}

        {(post.userId === currentUser.id || currentUser.isAdmin) && onDeletePost && (
          <button 
            onClick={() => onDeletePost(post.id)}
            className="flex flex-col items-center group mb-2 cursor-pointer"
            title="Hapus Video Reel"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all bg-white text-red-600 hover:bg-red-50">
              <i className="fas fa-trash text-sm"></i>
            </div>
            <span className="text-[8px] font-black mt-1 uppercase tracking-tighter text-white">
              Hapus
            </span>
          </button>
        )}

        <button 
          onClick={() => !post.isTakenDown && onLike(post.id)}
          className={`flex flex-col items-center group ${post.isTakenDown ? 'opacity-20 pointer-events-none' : ''}`}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all bg-black/40 backdrop-blur-md border border-white/20 ${hasLiked ? 'text-red-500 scale-110 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'text-white'}`}>
            <i className={`fas fa-heart text-xl`}></i>
          </div>
          <span className="text-[10px] font-black text-white mt-1 drop-shadow-md">{(post.likes || []).length}</span>
        </button>

        <button 
          onClick={onCommentClick}
          className="flex flex-col items-center group"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-md border border-white/20 transition-all ${isCommenting ? 'bg-white text-black' : 'text-white'}`}>
            <i className="fas fa-comment text-xl"></i>
          </div>
          <span className="text-[10px] font-black text-white mt-1 drop-shadow-md">{(post.comments || []).length}</span>
        </button>

        <button 
          onClick={onToggleMute}
          className="flex flex-col items-center group"
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-md border border-white/20 text-white transition-all active:scale-90">
            <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'} text-lg`}></i>
          </div>
          <span className="text-[8px] font-black text-white mt-1 uppercase tracking-tighter opacity-60">{isMuted ? 'Muted' : 'Sound'}</span>
        </button>

        {!post.isTakenDown && (
          <button 
            className="flex flex-col items-center group active:scale-90 transition-all"
            onClick={() => {
              const url = window.location.origin + '?post=' + post.id;
              if (navigator.share) {
                navigator.share({
                  title: `Vimos Reel by ${post.userName}`,
                  text: post.text || 'Check out this reel on Vimos!',
                  url: url
                }).catch(() => {});
              } else {
                navigator.clipboard.writeText(url);
                alert("Link copied to clipboard!");
              }
            }}
          >
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/40 backdrop-blur-md border border-white/20 text-white group-hover:bg-white/20">
              <i className="fas fa-paper-plane text-xl"></i>
            </div>
            <span className="text-[8px] font-black text-white mt-1 uppercase tracking-tighter opacity-60">Share</span>
          </button>
        )}
      </div>

      {/* User Info */}
      <div className="relative p-6 pb-10 space-y-3 max-w-[80%] z-10">
        <div className="flex items-center space-x-3">
          <img 
            src={post.userPhoto || fallbackPhoto} 
            className="w-10 h-10 rounded-full border-2 border-white object-cover cursor-pointer shadow-lg" 
            onClick={() => onUserClick(post.userId)}
            alt={post.userName}
          />
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <h4 
                className="text-white font-black uppercase tracking-widest text-sm cursor-pointer drop-shadow-md"
                onClick={() => onUserClick(post.userId)}
              >
                {post.userName}
              </h4>
              
              {postUser?.role && !postUser?.isAdmin && (
                <span className="bg-white text-black text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1">
                  <i className="fas fa-star text-[6px]"></i>
                  <span>{postUser.role}</span>
                </span>
              )}

              {postUser?.isAdmin && (
                <span className="bg-yellow-400 text-black text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1">
                  <i className="fas fa-crown text-[6px]"></i>
                  <span>Admin King</span>
                </span>
              )}

              {post.isTakenDown && (
                <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter flex items-center space-x-1">
                  <i className="fas fa-shield-halved"></i>
                  <span>Moderated</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <p className={`text-sm font-medium drop-shadow-md line-clamp-2 ${post.isTakenDown ? 'text-red-200 italic' : 'text-white'}`}>
          {post.text}
        </p>
      </div>
    </div>
  );
};

const Reels: React.FC<ReelsProps> = ({ posts, onLike, onComment, onUserClick, currentUser, onTakeDownPost, onDeletePost, users }) => {
  const videoPosts = posts.filter(p => p.videoURL);
  const [isMuted, setIsMuted] = useState(true);
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const options = {
      root: containerRef.current,
      rootMargin: '0px',
      threshold: 0.7,
    };

    const callback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const index = parseInt(entry.target.getAttribute('data-index') || '0', 10);
          setActiveIndex(index);
        }
      });
    };

    const observer = new IntersectionObserver(callback, options);
    const children = containerRef.current?.children;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        observer.observe(children[i]);
      }
    }

    return () => observer.disconnect();
  }, [videoPosts.length]);

  if (videoPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-140px)] p-6 text-center opacity-40">
        <i className="fas fa-film text-5xl mb-4"></i>
        <h3 className="font-black uppercase tracking-widest">No Reels Recorded</h3>
        <p className="text-xs mt-2 uppercase">Create a post with a video to see it here.</p>
      </div>
    );
  }

  const handleCommentSubmit = (e: React.FormEvent, postId: string) => {
    e.preventDefault();
    if (commentText.trim()) {
      onComment(postId, commentText);
      setCommentText('');
    }
  };

  return (
    <div ref={containerRef} className="h-[calc(100vh-140px)] overflow-y-scroll snap-y snap-mandatory bg-black relative">
      {videoPosts.map((post, index) => {
        const isCommenting = activeCommentPostId === post.id;
        return (
          <div key={post.id} data-index={index} className="h-full w-full snap-start relative">
            <ReelItem 
              post={post}
              isActive={activeIndex === index}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(!isMuted)}
              onLike={onLike}
              onCommentClick={() => setActiveCommentPostId(isCommenting ? null : post.id)}
              onUserClick={onUserClick}
              currentUser={currentUser}
              isCommenting={isCommenting}
              onTakeDownPost={onTakeDownPost}
              onDeletePost={onDeletePost}
              users={users}
            />

            {/* Comment Drawer */}
            <div className={`absolute bottom-0 left-0 right-0 bg-black/95 backdrop-blur-2xl border-t border-white/10 z-20 transition-all duration-300 ease-out ${isCommenting ? 'h-[60%]' : 'h-0'}`}>
              {isCommenting && (
                <div className="flex flex-col h-full animate-fade-in">
                  <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">Vimos ({(post.comments || []).length})</span>
                    <button onClick={() => setActiveCommentPostId(null)} className="text-white opacity-60 hover:opacity-100">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {(post.comments || []).length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-30 text-white space-y-2">
                        <i className="fas fa-comment-slash text-2xl"></i>
                        <p className="text-[10px] uppercase font-bold tracking-widest">No thoughts yet</p>
                      </div>
                    ) : (
                      (post.comments || []).map((comment) => (
                        <div key={comment.id} className="flex flex-col space-y-1">
                          <span className="text-[10px] font-black text-white/50 uppercase tracking-tighter">{comment.userName}</span>
                          <p className="text-sm text-white/90 font-medium">{comment.text}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {!post.isTakenDown && (
                    <form 
                      onSubmit={(e) => handleCommentSubmit(e, post.id)}
                      className="p-4 border-t border-white/10 flex items-center space-x-2 bg-black"
                    >
                      <input 
                        type="text" 
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a whisper..."
                        className="flex-1 bg-white/10 border border-white/20 rounded-full px-4 py-2 text-white text-xs focus:outline-none focus:border-white transition-all"
                      />
                      <button 
                        type="submit" 
                        disabled={!commentText.trim()}
                        className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center disabled:opacity-30 transition-all active:scale-95"
                      >
                        <i className="fas fa-arrow-up text-xs"></i>
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(Reels);
