
import React, { useState, useEffect } from 'react';
import { User, Post } from '../types.ts';
import UserListModal from './UserListModal.tsx';
import PostCard from './PostCard.tsx';
import { useLanguage } from '../LanguageContext.tsx';
import { SHOP_ITEMS } from './Shop.tsx';
import { compressImage } from '../services/imageCompressor.ts';

interface ProfileProps {
  user: User;
  users: User[];
  posts?: Post[];
  currentUser?: User | null;
  onToggleFollow: (id: string) => void;
  onUpdateProfile: (data: Partial<User>) => void;
  onAddCapture: (url: string) => void;
  onUserClick: (userId: string) => void;
  onLogout: () => void;
  onNavigateToChat?: (userId: string) => void;
  onBanUser?: (userId: string) => void;
  onSetRole?: (userId: string, role: string, color?: string) => void;
  onToggleAdmin?: (userId: string, currentStatus: boolean) => void;
  onLike?: (id: string) => void;
  onDislike?: (id: string) => void;
  onComment?: (postId: string, text: string) => void;
  onTakeDownPost?: (id: string) => void;
  onDeletePost?: (id: string) => void;
}

const Profile = ({ 
  user, 
  users = [], 
  posts = [],
  currentUser, 
  onToggleFollow, 
  onUpdateProfile, 
  onAddCapture, 
  onUserClick, 
  onLogout,
  onNavigateToChat,
  onBanUser,
  onSetRole,
  onToggleAdmin,
  onLike,
  onDislike,
  onComment,
  onTakeDownPost,
  onDeletePost
}: ProfileProps) => {
  const { t, language, setLanguage } = useLanguage();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [modalType, setModalType] = useState<'followers' | 'following' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [activeProfileTab, setActiveProfileTab] = useState<'posts' | 'likes'>('posts');
  const [editData, setEditData] = useState({ 
    name: user?.name || '', 
    bio: user?.bio || '' 
  });

  useEffect(() => {
    if (user) {
      setEditData({
        name: user.name || '',
        bio: user.bio || ''
      });
    }
  }, [user?.id, user?.name, user?.bio]);

  const isMe = Boolean(currentUser && user && user.id === currentUser.id);
  const isFollowing = Boolean(currentUser?.following && user?.id && currentUser.following.includes(user.id));
  const isAdminViewing = Boolean(currentUser?.isAdmin);
  const isTargetAdmin = Boolean(user?.isAdmin);
  const isBanned = Boolean(user?.isBanned);

  const followersList = users.filter(u => (user?.followers || []).includes(u.id));
  const followingList = users.filter(u => (user?.following || []).includes(u.id));

  // Fallback data
  const displayName = user?.name && user.name.trim() !== '' ? user.name : 'Unknown Orbit';
  const displayBio = user?.bio && user.bio.trim() !== '' ? user.bio : 'No bio shared yet.';
  const displayPhoto = user?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(displayName)}&backgroundColor=000000&fontFamily=Inter&fontWeight=700`;

  const handleSave = () => {
    onUpdateProfile({
      name: editData.name.trim(),
      bio: editData.bio.trim()
    });
    setIsEditing(false);
  };

  const handleCaptureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const compressed = await compressImage(file, 1080, 1080, 0.82);
        onAddCapture(compressed);
      } catch {
        const reader = new FileReader();
        reader.onloadend = () => {
          onAddCapture(reader.result as string);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleSetRole = () => {
    // Note: To keep Profile simple, we'll use a prompt for role name, 
    // but the actual color selection is primarily in AdminPanel.
    // However, if onSetRole is called from here, it will use current color.
    const role = prompt("Assign a special role to this member (e.g., Visionary, Elite, Curator):", user.role || "");
    if (role !== null && onSetRole) {
      onSetRole(user.id, role, user.roleColor);
    }
  };

  const userPosts = posts.filter(p => p.userId === user.id && (p.photoURL || p.videoURL));
  const totalCaptures = userPosts.length + (user.recentCaptures || []).length;

  const equippedFrameItem = SHOP_ITEMS.find(i => i.id === user.equippedFrame);
  const frameClass = equippedFrameItem?.frameClass || '';

  const accountCreatedTimestamp = user.createdAt || user.lastSeen || (currentUser?.id === user.id ? Date.now() : 0);

  const formatAccountCreation = (timestamp?: number) => {
    if (!timestamp) return 'Waktu tidak tersedia';
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'Tanggal tidak valid';
    }
  };

  const getAccountAgeText = (timestamp?: number) => {
    if (!timestamp) return 'Baru bergabung';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 0) return 'Baru saja';
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffMinutes < 60) return `${diffMinutes || 1} menit`;
    if (diffHours < 24) return `${diffHours} jam`;
    if (diffDays < 30) return `${diffDays} hari`;
    if (diffMonths < 12) return `${diffMonths} bulan (${diffDays} hari)`;
    return `${diffYears} tahun (${diffDays} hari)`;
  };

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const lastActiveTimestamp = Math.max(user.lastSeen || 0, user.createdAt || 0, 0);

  const getAutoPurgeCountdown = () => {
    if (user.isAdmin) {
      return {
        isProtected: true,
        text: 'Terlindungi (Admin)',
        subtext: 'Akun Admin kebal dari pembersihan otomatis',
        daysLeft: 30,
        percentage: 100,
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-300',
        alertLevel: 'safe'
      };
    }

    if (user.isOnline) {
      return {
        isProtected: false,
        text: 'Aman (Sedang Online)',
        subtext: 'Masa aktif reset penuh 30 hari',
        daysLeft: 30,
        percentage: 100,
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300',
        alertLevel: 'safe'
      };
    }

    if (!lastActiveTimestamp) {
      return {
        isProtected: false,
        text: '30 hari tersisa',
        subtext: 'Masa aktif normal 30 hari',
        daysLeft: 30,
        percentage: 100,
        badgeClass: 'bg-neutral-100 text-neutral-800 border-neutral-300',
        alertLevel: 'safe'
      };
    }

    const elapsed = Date.now() - lastActiveTimestamp;
    const remainingMs = Math.max(0, THIRTY_DAYS_MS - elapsed);
    const daysLeft = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const hoursLeft = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const percentage = Math.max(0, Math.min(100, Math.round((remainingMs / THIRTY_DAYS_MS) * 100)));

    let alertLevel: 'safe' | 'warning' | 'danger' = 'safe';
    let badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-300';

    if (daysLeft <= 3) {
      alertLevel = 'danger';
      badgeClass = 'bg-red-50 text-red-700 border-red-300 animate-pulse';
    } else if (daysLeft <= 10) {
      alertLevel = 'warning';
      badgeClass = 'bg-amber-50 text-amber-800 border-amber-300';
    }

    const countdownText = daysLeft > 0 
      ? `${daysLeft} hari ${hoursLeft} jam lagi`
      : `${hoursLeft} jam lagi (Segera Dihapus)`;

    return {
      isProtected: false,
      text: countdownText,
      subtext: `Dihapus jika tidak login/online dalam ${daysLeft} hari`,
      daysLeft,
      hoursLeft,
      percentage,
      badgeClass,
      alertLevel
    };
  };

  const autoPurgeInfo = getAutoPurgeCountdown();

  return (
    <div className={`p-6 pb-24 relative transition-all duration-500 ${isBanned ? 'bg-red-50/30' : ''}`}>
      {/* Banned Investigation Banner */}
      {isBanned && (
        <div className="absolute top-0 left-0 right-0 z-50 animate-pulse">
          <div className="bg-red-600 text-white py-2 px-4 flex items-center justify-center space-x-2 shadow-lg">
            <i className="fas fa-triangle-exclamation text-xs"></i>
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Hati-hati, akun ini sedang dalam penyelidikan</span>
          </div>
        </div>
      )}

      {/* Admin King Label */}
      {isTargetAdmin && (
        <div className={`absolute top-6 right-6 z-10 ${isBanned ? 'mt-8' : ''}`}>
          <div className="bg-black text-white px-3 py-1.5 rounded-xl border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] flex items-center space-x-2 animate-bounce-subtle">
            <i className="fas fa-crown text-[10px] text-yellow-400"></i>
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Admin King</span>
          </div>
        </div>
      )}

      {/* Custom Role Badge with color */}
      {user.role && !isTargetAdmin && (
        <div className={`absolute top-6 right-6 z-10 ${isBanned ? 'mt-8' : ''}`}>
          <div 
            className="text-white px-3 py-1.5 rounded-xl border-2 border-black/10 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] flex items-center space-x-2"
            style={{ backgroundColor: user.roleColor || '#000000' }}
          >
            <i className="fas fa-star text-[10px]"></i>
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">{user.role}</span>
          </div>
        </div>
      )}

      <div className={`flex flex-col items-center mb-8 ${isBanned ? 'pt-12' : ''}`}>
        <div className="relative group mb-4">
          <div className={`w-32 h-32 rounded-full border-4 overflow-hidden shadow-xl transition-all duration-500 ${isBanned ? 'border-red-600 grayscale' : 'border-black bg-gray-100'} ${frameClass}`}>
            <img 
              src={displayPhoto} 
              alt={displayName} 
              className="w-full h-full object-cover" 
            />
          </div>
          {isMe && !isBanned && (
            <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
              <label className="cursor-pointer flex items-center justify-center w-full h-full">
                <i className="fas fa-camera text-white text-xl"></i>
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      const compressed = await compressImage(file, 400, 400, 0.85);
                      onUpdateProfile({ photoURL: compressed });
                    } catch {
                      const reader = new FileReader();
                      reader.onloadend = () => onUpdateProfile({ photoURL: reader.result as string });
                      reader.readAsDataURL(file);
                    }
                  }
                }} />
              </label>
            </div>
          )}
        </div>
        
        {isEditing ? (
          <div className="w-full space-y-4 animate-fade-in">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest ml-1 opacity-50">Identity</label>
              <input 
                type="text" 
                value={editData.name} 
                onChange={e => setEditData({...editData, name: e.target.value})}
                className="w-full border-2 border-black p-3 rounded-xl text-center font-bold focus:outline-none"
                placeholder="Name"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest ml-1 opacity-50">Vibe</label>
              <textarea 
                value={editData.bio} 
                onChange={e => setEditData({...editData, bio: e.target.value})}
                className="w-full border-2 border-black p-3 rounded-xl text-sm text-center resize-none h-24 focus:outline-none"
                placeholder="Bio"
              />
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setIsEditing(false)} className="flex-1 border-2 border-black p-3 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} className="flex-1 bg-black text-white p-3 rounded-xl font-black uppercase text-xs tracking-widest shadow-lg active:scale-95 transition-all">Save Changes</button>
            </div>
          </div>
        ) : (
          <div className="text-center w-full">
            <h2 
              className={`text-3xl font-black uppercase tracking-tighter mb-2 flex items-center justify-center space-x-1.5 ${isBanned ? 'text-red-600' : ''}`}
              style={user.roleColor ? { color: user.roleColor } : undefined}
            >
              <span>{displayName}</span>
              {(user.isVerifiedSeller === true || user.sellerStatus === 'approved') && (
                <i className="fas fa-circle-check text-blue-500 text-lg ml-1" title="Verified Merchant"></i>
              )}
              {user.equippedBadge && <span className="text-xl ml-1">{user.equippedBadge}</span>}
            </h2>

            {/* Online / Offline Presence Badge */}
            <div className="flex items-center justify-center space-x-2 mb-2">
              {user.isOnline ? (
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] font-bold text-emerald-600 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>{t('status_online_active')}</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1.5 px-3 py-1 bg-neutral-100 border border-neutral-200 rounded-full text-[10px] font-medium text-neutral-500 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-neutral-400"></span>
                  <span>{t('status_offline')}</span>
                </span>
              )}
            </div>
            
            {/* Admin-only Email View */}
            {isAdminViewing && (
              <div className="flex items-center justify-center space-x-1.5 mb-2 group">
                <i className={`fas fa-envelope text-[10px] group-hover:text-black transition-colors ${isBanned ? 'text-red-400' : 'text-gray-400'}`}></i>
                <span className={`text-[10px] font-black uppercase tracking-widest group-hover:text-black transition-colors ${isBanned ? 'text-red-400' : 'text-gray-400'}`}>
                  {user.email || 'No email data'}
                </span>
                <i className="fas fa-shield-halved text-[8px] text-red-500 opacity-50" title="Visible only to Admin King"></i>
              </div>
            )}

            <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto italic font-medium">"{displayBio}"</p>
            <div className="flex flex-col items-center space-y-3">
              <div className="flex flex-wrap justify-center gap-2">
                {isMe ? (
                  <>
                    {!isBanned && (
                      <button 
                        onClick={() => setIsEditing(true)}
                        className="px-8 py-2 border-2 border-black rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-black hover:text-white transition-all shadow-md active:scale-95"
                      >
                        {t('edit_profile')}
                      </button>
                    )}
                    <button 
                      onClick={() => setIsSettingsOpen(true)}
                      className="w-10 h-10 flex items-center justify-center border-2 border-black text-black rounded-full hover:bg-black hover:text-white transition-all shadow-md active:scale-90"
                      title={t('settings')}
                    >
                      <i className="fas fa-cog"></i>
                    </button>
                  </>
                ) : (
                  <>
                    {!isBanned && (
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => onToggleFollow(user.id)}
                          className={`px-8 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] transition-all border-2 shadow-md active:scale-95 cursor-pointer ${
                            isFollowing 
                              ? 'border-black/10 text-gray-400 bg-white hover:border-red-500 hover:text-red-500' 
                              : 'border-black bg-black text-white hover:opacity-80'
                          }`}
                        >
                          {isFollowing ? t('unfollow') : t('follow_soul')}
                        </button>
                        {onNavigateToChat && (() => {
                          const isMutual = Boolean(
                            isFollowing && (
                              (Array.isArray(user.following) ? user.following.includes(currentUser.id) : Boolean((user.following as any)?.[currentUser.id])) ||
                              (Array.isArray(currentUser.followers) ? currentUser.followers.includes(user.id) : Boolean((currentUser.followers as any)?.[user.id]))
                            )
                          );

                          const isChatRestricted = Boolean(user.onlyMutualChat || currentUser?.onlyMutualChat);
                          const canChatWithTarget = Boolean(currentUser?.isAdmin || user.isAdmin || !isChatRestricted || isMutual);

                          return (
                            <button
                              onClick={() => {
                                if (!canChatWithTarget) {
                                  alert(`${user.onlyMutualChat ? `${user.name} membatasi pesan hanya untuk yang saling mengikuti.` : 'Anda mengaktifkan batasan obrolan hanya untuk mutual follow.'} Ikuti akun ini dan tunggu saling mengikuti untuk mulai berkirim pesan!`);
                                }
                                onNavigateToChat(user.id);
                              }}
                              className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border-2 transition-all shadow-md active:scale-95 flex items-center space-x-1.5 cursor-pointer ${
                                canChatWithTarget 
                                  ? 'bg-neutral-900 hover:bg-black text-white border-neutral-900' 
                                  : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-300'
                              }`}
                              title={canChatWithTarget ? "Kirim Pesan" : "Pengguna membatasi obrolan hanya untuk akun yang saling mengikuti"}
                            >
                              <i className={`fas ${canChatWithTarget ? 'fa-paper-plane text-amber-400' : 'fa-lock text-neutral-400'} text-[9px]`}></i>
                              <span>Chat</span>
                            </button>
                          );
                        })()}
                      </div>
                    )}
                    
                    {isAdminViewing && (
                      <>
                        <button 
                          onClick={() => onToggleAdmin && onToggleAdmin(user.id, Boolean(user.isAdmin))}
                          className={`w-10 h-10 flex items-center justify-center border-2 rounded-full transition-all shadow-md active:scale-90 ${
                            user.isAdmin 
                              ? 'border-amber-500 bg-amber-400 text-black hover:bg-amber-500' 
                              : 'border-amber-500 text-amber-600 hover:bg-amber-500 hover:text-white'
                          }`}
                          title={user.isAdmin ? 'Cabut Akses Admin Vimos' : 'Beri Akses Admin Vimos'}
                        >
                          <i className={`fas ${user.isAdmin ? 'fa-shield-minus' : 'fa-crown'} text-sm`}></i>
                        </button>
                        <button 
                          onClick={handleSetRole}
                          className="w-10 h-10 flex items-center justify-center border-2 border-blue-600 text-blue-600 rounded-full hover:bg-blue-600 hover:text-white transition-all shadow-md active:scale-90"
                          title={t('assign_role')}
                        >
                          <i className="fas fa-id-badge text-sm"></i>
                        </button>
                        <button 
                          onClick={() => onBanUser && onBanUser(user.id)}
                          className={`w-10 h-10 flex items-center justify-center border-2 rounded-full transition-all shadow-md active:scale-90 ${isBanned ? 'border-green-600 text-green-600 hover:bg-green-600 hover:text-white' : 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'}`}
                          title={isBanned ? t('restore_user') : t('ban_user')}
                        >
                          <i className={`fas ${isBanned ? 'fa-user-check' : 'fa-user-slash'} text-sm`}></i>
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Waktu Akun & Informasi Usia Pengguna */}
      <div className={`w-full max-w-sm mx-auto mb-6 p-4 rounded-2xl border transition-all shadow-xs ${
        isBanned 
          ? 'bg-red-50/50 border-red-200' 
          : 'bg-neutral-50/90 border-neutral-200/90'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-xl bg-black text-white flex items-center justify-center text-xs shadow-xs">
              <i className="fas fa-clock"></i>
            </div>
            <div>
              <h4 className="text-[11px] font-black uppercase tracking-wider text-neutral-900 leading-tight">
                Waktu Akun
              </h4>
              <p className="text-[9px] text-neutral-400 font-bold uppercase tracking-wider">
                Riwayat & Usia Akun
              </p>
            </div>
          </div>

          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-black text-white shadow-2xs">
            {getAccountAgeText(accountCreatedTimestamp)}
          </span>
        </div>

        <div className="space-y-2 pt-1 border-t border-neutral-200/70 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500 font-medium text-[11px]">Waktu Terdaftar:</span>
            <span className="font-extrabold text-neutral-900 text-[11px]">
              {formatAccountCreation(accountCreatedTimestamp)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 font-medium text-[11px]">Usia Bergabung:</span>
            <span className="font-extrabold text-neutral-900 text-[11px]">
              {getAccountAgeText(accountCreatedTimestamp)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-neutral-500 font-medium text-[11px]">Status Akun:</span>
            {user.isOnline ? (
              <span className="inline-flex items-center space-x-1 text-emerald-600 font-bold text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Aktif Sekarang</span>
              </span>
            ) : (
              <span className="text-neutral-500 font-semibold text-[11px]">
                {user.lastSeen 
                  ? new Date(user.lastSeen).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'Offline'}
              </span>
            )}
          </div>

          {/* Batas Waktu Hapus Otomatis (30 Hari Inaktif) */}
          <div className="pt-2 border-t border-neutral-200/70 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 font-medium text-[11px] flex items-center space-x-1">
                <i className={`fas ${autoPurgeInfo.isProtected ? 'fa-shield-halved text-amber-500' : 'fa-hourglass-half text-neutral-400'}`}></i>
                <span>Waktu Hapus Akun:</span>
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${autoPurgeInfo.badgeClass}`}>
                {autoPurgeInfo.text}
              </span>
            </div>

            {/* Progress Bar remaining time */}
            {!autoPurgeInfo.isProtected && (
              <div className="space-y-1">
                <div className="w-full bg-neutral-200/80 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      autoPurgeInfo.alertLevel === 'danger'
                        ? 'bg-red-500'
                        : autoPurgeInfo.alertLevel === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${autoPurgeInfo.percentage}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[9px] text-neutral-400 font-semibold">
                  <span>Masa Aktif 30 Hari</span>
                  <span>{autoPurgeInfo.subtext}</span>
                </div>
              </div>
            )}

            {/* Danger alert if less than 3 days */}
            {autoPurgeInfo.alertLevel === 'danger' && (
              <div className="p-2 bg-red-100/80 border border-red-300 rounded-xl text-[10px] text-red-700 font-bold leading-tight flex items-center space-x-1.5">
                <i className="fas fa-triangle-exclamation text-red-600 shrink-0"></i>
                <span>Perhatian: Akun ini dalam status kritis dan akan dihapus otomatis dari Firebase jika tidak segera online!</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-3 gap-4 border-y-2 py-8 mb-10 rounded-2xl transition-colors ${isBanned ? 'border-red-600 bg-red-100/30' : 'border-black bg-gray-50/30'}`}>
        <div className="text-center">
          <p className={`text-2xl font-black ${isBanned ? 'text-red-600' : ''}`}>{totalCaptures}</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('captures')}</p>
        </div>
        <button onClick={() => setModalType('followers')} className={`text-center group border-x ${isBanned ? 'border-red-200' : 'border-black/5'}`}>
          <p className={`text-2xl font-black group-hover:scale-110 transition-transform ${isBanned ? 'text-red-600' : ''}`}>{(user.followers || []).length}</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('followers')}</p>
        </button>
        <button onClick={() => setModalType('following')} className="text-center group">
          <p className={`text-2xl font-black group-hover:scale-110 transition-transform ${isBanned ? 'text-red-600' : ''}`}>{(user.following || []).length}</p>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t('following')}</p>
        </button>
      </div>

      {/* Profile Content Tabs */}
      <div className="space-y-6">
        <div className={`flex items-center justify-between border-b-2 pb-2 ${isBanned ? 'border-red-600' : 'border-black'}`}>
          <div className="flex items-center space-x-4 sm:space-x-6">
            <button
              onClick={() => setActiveProfileTab('posts')}
              className={`flex items-center space-x-2 py-1 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeProfileTab === 'posts' 
                  ? 'text-black border-b-2 border-black -mb-[10px] pb-2' 
                  : 'text-neutral-400 hover:text-black'
              }`}
            >
              <i className="fas fa-camera text-xs"></i>
              <span>Postingan ({totalCaptures})</span>
            </button>

            <button
              onClick={() => setActiveProfileTab('likes')}
              className={`flex items-center space-x-2 py-1 text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeProfileTab === 'likes' 
                  ? 'text-black border-b-2 border-black -mb-[10px] pb-2' 
                  : 'text-neutral-400 hover:text-black'
              }`}
            >
              <i className={`fas fa-heart text-xs ${activeProfileTab === 'likes' ? 'text-red-500' : ''}`}></i>
              <span>Disukai ({posts.filter(p => (p.likes || []).includes(user.id)).length})</span>
            </button>
          </div>

          {activeProfileTab === 'posts' && isMe && !isBanned && (
            <label className="cursor-pointer group flex items-center space-x-1.5 bg-black text-white px-3 py-1 rounded-full hover:bg-neutral-800 transition-colors shadow-xs">
              <i className="fas fa-plus text-[10px]"></i>
              <span className="text-[10px] font-black uppercase tracking-wider">Tambah</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleCaptureUpload} />
            </label>
          )}

          {activeProfileTab === 'likes' && isMe && posts.filter(p => (p.likes || []).includes(user.id)).length > 0 && onLike && (
            <button
              onClick={() => {
                const myLiked = posts.filter(p => (p.likes || []).includes(user.id));
                if (window.confirm(`Hapus semua riwayat suka (${myLiked.length} postingan)?`)) {
                  myLiked.forEach(p => onLike(p.id));
                }
              }}
              className="text-[10px] font-black uppercase text-red-500 hover:text-red-700 transition-colors flex items-center space-x-1 cursor-pointer bg-red-50 px-2.5 py-1 rounded-full border border-red-200 shadow-2xs"
              title="Hapus semua riwayat like"
            >
              <i className="fas fa-trash-can text-[9px]"></i>
              <span>Hapus Semua</span>
            </button>
          )}
        </div>
        
        {activeProfileTab === 'posts' && (
          totalCaptures === 0 ? (
            <div className="py-20 text-center flex flex-col items-center opacity-30">
              <i className={`fas fa-camera text-4xl mb-4 ${isBanned ? 'text-red-600' : ''}`}></i>
              <p className="italic text-xs uppercase font-bold tracking-widest">Belum ada foto/video dibagikan</p>
            </div>
          ) : (
            <div className={`grid grid-cols-3 gap-2.5 sm:gap-3.5 ${isBanned ? 'opacity-30' : ''}`}>
              {userPosts.map((post) => (
                <div 
                  key={post.id} 
                  onClick={() => setSelectedPostId(post.id)}
                  className={`aspect-square bg-neutral-100 border rounded-2xl overflow-hidden hover:scale-[1.03] hover:z-10 transition-all cursor-pointer shadow-xs group relative ${isBanned ? 'border-red-200' : 'border-black/5'}`}
                >
                  {post.photoURL ? (
                    <img src={post.photoURL} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" alt="Post Capture" />
                  ) : post.videoURL ? (
                    <video src={post.videoURL} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                  ) : null}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="absolute top-2 right-2 text-white opacity-0 group-hover:opacity-100 drop-shadow-md text-xs">
                     {post.videoURL ? <i className="fas fa-video"></i> : <i className="fas fa-image"></i>}
                  </div>
                </div>
              ))}
              {(user.recentCaptures || []).map((url, i) => (
                <div key={`legacy_${i}`} className={`aspect-square bg-neutral-100 border rounded-2xl overflow-hidden hover:scale-[1.03] hover:z-10 transition-all cursor-pointer shadow-xs group relative ${isBanned ? 'border-red-200' : 'border-black/5'}`}>
                  <img src={url} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" alt={`Capture ${i}`} />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold px-2 py-0.5 bg-black/50 rounded-full">Legacy</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {activeProfileTab === 'likes' && (
          <div>
            {posts.filter(p => (p.likes || []).includes(user.id)).length === 0 ? (
              <div className="py-20 text-center flex flex-col items-center opacity-40 space-y-2">
                <i className="fas fa-heart-crack text-4xl text-neutral-400 mb-2"></i>
                <p className="text-xs uppercase font-bold tracking-wider text-neutral-800">Belum Ada Postingan yang Disukai</p>
                <p className="text-[11px] text-neutral-500 max-w-xs">
                  {isMe ? 'Sukai postingan di Beranda atau Reels untuk menyimpannya di riwayat Anda.' : 'Pengguna ini belum menyukai postingan apa pun.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.filter(p => (p.likes || []).includes(user.id)).map((likedPost) => {
                  const author = users.find(u => u.id === likedPost.userId);
                  const authorPhoto = author?.photoURL || likedPost.userPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${likedPost.userName}&backgroundColor=000000`;
                  const authorName = author?.name || likedPost.userName || 'Member';

                  return (
                    <div 
                      key={likedPost.id}
                      onClick={() => setSelectedPostId(likedPost.id)}
                      className="border border-neutral-200/90 hover:border-black/40 rounded-2xl p-3 sm:p-4 bg-white shadow-xs hover:shadow-sm transition-all cursor-pointer flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        {/* Thumbnail / Media Icon */}
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200/70 shrink-0 relative flex items-center justify-center">
                          {likedPost.photoURL ? (
                            <img src={likedPost.photoURL} className="w-full h-full object-cover group-hover:scale-105 transition-transform" alt="Thumbnail" />
                          ) : likedPost.videoURL ? (
                            <div className="w-full h-full relative bg-neutral-900 flex items-center justify-center text-white">
                              <video src={likedPost.videoURL} className="w-full h-full object-cover opacity-70" />
                              <i className="fas fa-play absolute text-xs"></i>
                            </div>
                          ) : (
                            <div className="p-2 text-center text-[9px] font-bold text-neutral-600 line-clamp-2">
                              {likedPost.text || 'Postingan'}
                            </div>
                          )}
                        </div>

                        {/* Text and Author Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5 mb-1">
                            <img src={authorPhoto} className="w-4 h-4 rounded-full object-cover border border-black/10" alt={authorName} />
                            <span className="text-[11px] font-extrabold uppercase text-neutral-900 truncate">{authorName}</span>
                          </div>
                          <p className="text-xs text-neutral-700 font-medium line-clamp-1 group-hover:text-black">
                            {likedPost.text || '(Media visual)'}
                          </p>
                          <div className="flex items-center space-x-3 mt-1.5 text-[10px] text-neutral-400 font-semibold">
                            <span className="flex items-center space-x-1 text-red-500 font-bold">
                              <i className="fas fa-heart text-[9px]"></i>
                              <span>{(likedPost.likes || []).length} Suka</span>
                            </span>
                            <span>•</span>
                            <span>{(likedPost.comments || []).length} Komentar</span>
                          </div>
                        </div>
                      </div>

                      {/* Unlike / Remove from History Button */}
                      {onLike && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onLike(likedPost.id);
                          }}
                          className="px-3 py-2 bg-red-50 hover:bg-red-500 hover:text-white text-red-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border border-red-200/80 shrink-0 flex items-center space-x-1.5 cursor-pointer active:scale-95 shadow-2xs"
                          title="Hapus dari riwayat like (Batal Suka)"
                        >
                          <i className="fas fa-heart-crack text-xs"></i>
                          <span className="hidden sm:inline">Hapus Like</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {modalType && (
        <UserListModal 
          title={modalType === 'followers' ? 'Souls Following' : 'Souls Followed'}
          users={modalType === 'followers' ? followersList : followingList}
          currentUser={currentUser}
          onClose={() => setModalType(null)}
          onToggleFollow={onToggleFollow}
          onUserClick={(uid) => {
            setModalType(null);
            onUserClick(uid);
          }}
        />
      )}

      {selectedPostId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setSelectedPostId(null)}></div>
          <div className="relative w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <button 
              onClick={() => setSelectedPostId(null)}
              className="absolute top-4 right-4 z-50 w-8 h-8 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black transition-colors"
            >
              <i className="fas fa-times"></i>
            </button>
            <div className="overflow-y-auto hide-scrollbar">
              {posts.find(p => p.id === selectedPostId) && (
                <PostCard 
                  post={posts.find(p => p.id === selectedPostId)!}
                  onLike={onLike!}
                  onDislike={onDislike!}
                  onComment={onComment!}
                  onUserClick={(uid) => {
                    setSelectedPostId(null);
                    onUserClick(uid);
                  }}
                  currentUser={currentUser}
                  onFollow={onToggleFollow}
                  onTakeDownPost={onTakeDownPost}
                  onDeletePost={onDeletePost}
                  users={users}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="absolute inset-0" onClick={() => setIsSettingsOpen(false)}></div>
          <div className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl z-10">
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center bg-gray-100 text-black rounded-full hover:bg-black hover:text-white transition-colors"
            >
              <i className="fas fa-times"></i>
            </button>
            
            <h3 className="text-xl font-black uppercase tracking-tighter mb-6 flex items-center">
              <i className="fas fa-cog mr-2"></i>
              {t('settings')}
            </h3>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  {t('language')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setLanguage('id')}
                    className={`p-3 rounded-2xl border-2 font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                      language === 'id' 
                        ? 'border-black bg-black text-white shadow-md' 
                        : 'border-gray-200 hover:border-black text-gray-600'
                    }`}
                  >
                    <span>🇮🇩</span>
                    <span>{t('indonesian')}</span>
                  </button>
                  <button
                    onClick={() => setLanguage('en')}
                    className={`p-3 rounded-2xl border-2 font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                      language === 'en' 
                        ? 'border-black bg-black text-white shadow-md' 
                        : 'border-gray-200 hover:border-black text-gray-600'
                    }`}
                  >
                    <span>🇺🇸</span>
                    <span>{t('english')}</span>
                  </button>
                  <button
                    onClick={() => setLanguage('ja')}
                    className={`p-3 rounded-2xl border-2 font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                      language === 'ja' 
                        ? 'border-black bg-black text-white shadow-md' 
                        : 'border-gray-200 hover:border-black text-gray-600'
                    }`}
                  >
                    <span>🇯🇵</span>
                    <span>{t('japanese')}</span>
                  </button>
                  <button
                    onClick={() => setLanguage('zh')}
                    className={`p-3 rounded-2xl border-2 font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                      language === 'zh' 
                        ? 'border-black bg-black text-white shadow-md' 
                        : 'border-gray-200 hover:border-black text-gray-600'
                    }`}
                  >
                    <span>🇨🇳</span>
                    <span>{t('chinese')}</span>
                  </button>
                </div>
              </div>

              {/* Pengaturan Privasi Obrolan / Direct Chat */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 flex items-center space-x-1.5">
                    <i className="fas fa-shield-halved text-neutral-500"></i>
                    <span>Privasi Pesan & Panggilan</span>
                  </label>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                    user.onlyMutualChat 
                      ? 'bg-amber-50 text-amber-800 border-amber-300' 
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  }`}>
                    {user.onlyMutualChat ? 'Hanya Mutual Follow' : 'Semua Orang'}
                  </span>
                </div>

                <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-neutral-900">
                        Batasi Chat Hanya Teman Follow
                      </p>
                      <p className="text-[10px] text-neutral-500 mt-0.5 leading-relaxed pr-2">
                        {user.onlyMutualChat 
                          ? 'Aktif: Hanya orang yang saling follow yang bisa mengirim pesan dan menelepon Anda.'
                          : 'Nonaktif: Semua orang dapat mengirim pesan kepada Anda secara bebas.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onUpdateProfile({ onlyMutualChat: !user.onlyMutualChat })}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        user.onlyMutualChat ? 'bg-black' : 'bg-neutral-300'
                      }`}
                      role="switch"
                      aria-checked={Boolean(user.onlyMutualChat)}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          user.onlyMutualChat ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Detail Waktu & Keamanan Akun */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                  Waktu & Informasi Akun
                </label>
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-2xl space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 font-medium">Tanggal Dibuat:</span>
                    <span className="font-extrabold text-neutral-900 text-right">
                      {formatAccountCreation(accountCreatedTimestamp)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 font-medium">Usia Akun:</span>
                    <span className="font-extrabold text-neutral-900">
                      {getAccountAgeText(accountCreatedTimestamp)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 font-medium">Waktu Hapus Akun:</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${autoPurgeInfo.badgeClass}`}>
                      {autoPurgeInfo.text}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-500 font-medium">ID Pengguna:</span>
                    <span className="font-mono text-[10px] text-neutral-600 bg-white px-1.5 py-0.5 rounded border border-neutral-200">
                      {user.id}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4 flex flex-col space-y-2">
                <button
                  onClick={() => {
                    setIsSettingsOpen(false);
                    onLogout();
                  }}
                  className="w-full py-3 bg-red-50 hover:bg-red-100 text-red-500 rounded-2xl font-black uppercase tracking-wider text-xs transition-colors flex items-center justify-center space-x-2"
                >
                  <i className="fas fa-sign-out-alt"></i>
                  <span>{t('logout')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(Profile);
