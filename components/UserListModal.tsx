
import React, { useState } from 'react';
import { User } from '../types.ts';

interface UserListModalProps {
  title: string;
  users: User[];
  currentUser: User;
  onClose: () => void;
  onToggleFollow: (id: string) => void;
  onUserClick: (userId: string) => void;
}

export default function UserListModal({ 
  title, 
  users, 
  currentUser, 
  onClose, 
  onToggleFollow, 
  onUserClick 
}: UserListModalProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u => 
    !searchQuery || 
    (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl border-2 border-black flex flex-col max-h-[75vh]">
        <div className="p-4 sm:p-5 border-b-2 border-black bg-white sticky top-0 z-10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-black uppercase tracking-[0.2em] text-sm">{title}</h3>
            <button 
              onClick={onClose} 
              className="w-9 h-9 flex items-center justify-center border-2 border-black rounded-full hover:bg-black hover:text-white transition-all active:scale-90"
              title="Tutup"
            >
              <i className="fas fa-times text-xs"></i>
            </button>
          </div>
          
          {/* Search User Input Bar */}
          <div className="relative">
            <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input 
              type="text"
              placeholder="Cari user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 pl-9 pr-8 py-2 rounded-2xl text-xs font-bold focus:outline-none focus:border-black transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black text-xs"
              >
                <i className="fas fa-times-circle"></i>
              </button>
            )}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredUsers.length === 0 ? (
            <div className="py-16 text-center flex flex-col items-center space-y-3 opacity-40">
              <i className="fas fa-users-slash text-3xl"></i>
              <p className="text-[10px] uppercase font-bold tracking-widest">
                {searchQuery ? 'User tidak ditemukan' : 'Tidak ada user'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredUsers.map((u) => {
                const isFollowing = (currentUser.following || []).includes(u.id);
                const isMe = u.id === currentUser.id;
                
                return (
                  <div key={u.id} className="flex items-center p-3 hover:bg-gray-50 rounded-2xl transition-all group">
                    <div className="relative shrink-0 mr-3.5">
                      <img 
                        src={u.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${u.name}&backgroundColor=000000`} 
                        alt={u.name} 
                        className="w-11 h-11 rounded-full object-cover border border-black/10 bg-gray-100 cursor-pointer group-hover:border-black transition-all" 
                        onClick={() => onUserClick(u.id)}
                      />
                      {u.isOnline ? (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse" title="Online"></span>
                      ) : (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onUserClick(u.id)}>
                      <div className="flex items-center space-x-1.5">
                        <p className="font-black text-xs sm:text-sm uppercase tracking-tight truncate">{u.name}</p>
                        {u.isOnline && (
                          <span className="px-1.5 py-0.2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[8px] font-bold">
                            Online
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] text-gray-400 truncate uppercase font-bold tracking-widest mt-0.5">
                        {(u.followers || []).length} Followers
                      </p>
                    </div>

                    {!isMe && (
                      <button 
                        onClick={() => onToggleFollow(u.id)}
                        className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all border-2 ml-2 shrink-0 ${
                          isFollowing 
                            ? 'bg-white text-gray-400 border-gray-100 hover:border-red-500 hover:text-red-500' 
                            : 'bg-black text-white border-black hover:opacity-80'
                        }`}
                      >
                        {isFollowing ? 'Unfollow' : 'Follow'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
