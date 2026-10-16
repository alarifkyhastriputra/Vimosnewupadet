import React, { useState } from 'react';
import { Post, User } from '../types';
import PostCard from './PostCard';

interface SinglePostViewProps {
  postId: string;
  posts: Post[];
  onBackToFeed: () => void;
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
}

export const SinglePostView: React.FC<SinglePostViewProps> = ({
  postId,
  posts,
  onBackToFeed,
  onLike,
  onDislike,
  onComment,
  onUserClick,
  currentUser,
  onFollow,
  onTakeDownPost,
  onDeletePost,
  users,
  isLoading
}) => {
  const post = posts.find(p => p.id === postId);

  return (
    <div className="p-4 space-y-4 animate-fade-in max-w-xl mx-auto">
      {/* Top Bar with Back Button */}
      <div className="flex items-center justify-between pb-3 border-b border-black/10">
        <button
          onClick={onBackToFeed}
          className="flex items-center space-x-2 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-full text-xs font-bold transition-all active:scale-95 shadow-sm"
        >
          <i className="fas fa-arrow-left text-xs"></i>
          <span>Kembali ke Beranda</span>
        </button>
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-400 bg-neutral-50 px-2.5 py-1 rounded-full border border-neutral-200">
          Postingan Dibagikan
        </span>
      </div>

      {isLoading && !post ? (
        <div className="border border-black/5 rounded-3xl p-5 bg-white space-y-4 animate-pulse shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-gray-100"></div>
            <div className="flex-1 space-y-2 py-1">
              <div className="h-4 bg-gray-100 rounded-lg w-1/3"></div>
              <div className="h-3 bg-gray-100 rounded-lg w-1/4"></div>
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-100 rounded-lg"></div>
            <div className="h-4 bg-gray-100 rounded-lg w-5/6"></div>
          </div>
          <div className="h-56 bg-gray-50 rounded-2xl w-full"></div>
        </div>
      ) : !post ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-4 bg-neutral-50/60 rounded-3xl border border-dashed border-neutral-200">
          <div className="w-14 h-14 rounded-full bg-neutral-100 flex items-center justify-center mb-3 text-neutral-400">
            <i className="fas fa-file-circle-xmark text-2xl"></i>
          </div>
          <h3 className="text-sm font-black text-neutral-800 uppercase tracking-wide">Postingan Tidak Ditemukan</h3>
          <p className="text-xs text-neutral-500 mt-1 max-w-xs leading-relaxed">
            Postingan ini mungkin telah dihapus oleh pembuatnya atau sudah tidak tersedia.
          </p>
          <button
            onClick={onBackToFeed}
            className="mt-5 px-5 py-2 bg-black text-white text-xs font-bold rounded-full hover:bg-neutral-800 transition-all active:scale-95 shadow-md"
          >
            Lihat Postingan Lainnya
          </button>
        </div>
      ) : (
        <div className="space-y-4">
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
        </div>
      )}
    </div>
  );
};

export default SinglePostView;
