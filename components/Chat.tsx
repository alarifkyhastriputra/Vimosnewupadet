import React, { useState, useEffect, useRef } from 'react';
import { User, ChatMessage, Group } from '../types.ts';
import { db } from '../firebase.ts';
import { ref, onValue, push, serverTimestamp, set, update, remove, get, query, limitToLast } from 'firebase/database';
import { ActiveCall } from './CallingOverlay.tsx';
import { useLanguage } from '../LanguageContext.tsx';
import { compressImage } from '../services/imageCompressor.ts';

interface ChatProps {
  users: User[];
  currentUser: User | null;
  userStatuses?: Record<string, { state: 'online' | 'offline'; last_changed?: number }>;
  onUserClick: (userId: string) => void;
  activeCalls?: ActiveCall[];
  onStartCall?: (type: 'private' | 'collective', mediaType: 'audio' | 'video', targetId: string, name?: string) => void;
  onJoinCall?: (callId: string) => void;
  onFollow?: (userId: string) => void;
  targetUserId?: string | null;
  targetGroupId?: string | null;
  initialChatMessage?: string | null;
  onClearInitialChat?: () => void;
  permissionStatus?: NotificationPermission | 'unsupported';
  onRequestPermission?: () => void;
  onActiveConversationChange?: (isActive: boolean) => void;
  onBackToChatListRef?: React.MutableRefObject<(() => boolean) | null>;
}

const Chat: React.FC<ChatProps> = ({ 
  users, 
  currentUser, 
  userStatuses,
  onUserClick, 
  activeCalls = [], 
  onStartCall, 
  onJoinCall,
  onFollow,
  targetUserId,
  targetGroupId,
  initialChatMessage,
  onClearInitialChat,
  permissionStatus,
  onRequestPermission,
  onActiveConversationChange,
  onBackToChatListRef
}) => {
  const { t } = useLanguage();
  const [liveStatuses, setLiveStatuses] = useState<Record<string, { state: 'online' | 'offline'; last_changed?: number }>>(userStatuses || {});

  useEffect(() => {
    if (userStatuses) setLiveStatuses(userStatuses);
  }, [userStatuses]);

  useEffect(() => {
    const statusRef = ref(db, 'status');
    const unsub = onValue(statusRef, (snap) => {
      const val = snap.val();
      if (val) setLiveStatuses(val);
    });
    return () => unsub();
  }, []);

  const isUserOnline = (userId?: string) => {
    if (!userId) return false;
    if (currentUser && userId === currentUser.id) return true;
    return liveStatuses[userId]?.state === 'online';
  };

  const getUserLastSeenText = (userId?: string) => {
    if (!userId) return t('status_offline');
    if (isUserOnline(userId)) return t('status_online_active');
    const status = liveStatuses[userId];
    const timestamp = status?.last_changed;
    if (!timestamp) return t('status_offline');

    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return `${t('status_offline')} • ${t('just_now')}`;
    if (diff < 60 * 60 * 1000) {
      const mins = Math.max(1, Math.floor(diff / (60 * 1000)));
      return `${t('status_offline')} • ${mins} mnt lalu`;
    }
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = new Date().toDateString() === date.toDateString();
    if (isToday) return `${t('status_offline')} • Hari ini ${timeStr}`;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.toDateString() === date.toDateString()) {
      return `${t('status_offline')} • Kemarin ${timeStr}`;
    }
    return `${t('status_offline')} • ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${timeStr}`;
  };
  const [selectedRecipient, setSelectedRecipient] = useState<{ type: 'user' | 'group', data: User | Group } | null>(null);
  const [msg, setMsg] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isViewingGroupSettings, setIsViewingGroupSettings] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedForGroup, setSelectedForGroup] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'direct' | 'shop' | 'groups' | 'anonymous'>('direct');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [shopSearchQuery, setShopSearchQuery] = useState('');
  const [collectiveSearchQuery, setCollectiveSearchQuery] = useState('');
  const [groupMemberSearchQuery, setGroupMemberSearchQuery] = useState('');
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [activeMenuMsgId, setActiveMenuMsgId] = useState<string | null>(null);
  // Fullscreen view toggle state - defaults to true so chat and group chat are immersive edge-to-edge full screen
  const [isFullScreen, setIsFullScreen] = useState(true);

  // Cache for user profiles fetched directly by UID
  const [fetchedUsersMap, setFetchedUsersMap] = useState<Record<string, User>>({});

  // Custom Confirmation Modal Pop-Up State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
  } | null>(null);

  // Chat Conversation Thread Interface
  interface ChatThread {
    chatId: string;
    otherUser: User;
    lastMessage: string;
    lastMessageSenderId: string;
    timestamp: number;
    unreadCount: number;
    isShop?: boolean;
    mediaSummary?: string;
  }
  const [directChatThreads, setDirectChatThreads] = useState<ChatThread[]>([]);
  const [shopChatThreads, setShopChatThreads] = useState<ChatThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState<boolean>(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);

  // Anonymous Chat States
  const [isSearchingAnon, setIsSearchingAnon] = useState(false);
  const [activeAnonRoomId, setActiveAnonRoomId] = useState<string | null>(null);
  const [activeAnonRoom, setActiveAnonRoom] = useState<any | null>(null);
  const [anonMessages, setAnonMessages] = useState<{ id: string; senderId: string; text: string; timestamp: number }[]>([]);
  const [anonInputMsg, setAnonInputMsg] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const isCurrentlyTypingRef = useRef<boolean>(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Media Attachment States for Photos & Videos in Chat
  const [selectedMedia, setSelectedMedia] = useState<{
    url: string;
    type: 'image' | 'video';
    name?: string;
    size?: string;
  } | null>(null);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [fullscreenMedia, setFullscreenMedia] = useState<{
    url: string;
    type: 'image' | 'video';
    caption?: string;
    senderName?: string;
    timestamp?: number;
  } | null>(null);

  // Track if any active subscreen / conversation is open to hide navbar & header
  const isAnySubscreenOpen = Boolean(
    selectedRecipient || isCreatingGroup || isViewingGroupSettings || (activeAnonRoomId && activeAnonRoom)
  );

  useEffect(() => {
    if (onActiveConversationChange) {
      onActiveConversationChange(isAnySubscreenOpen);
    }
  }, [isAnySubscreenOpen, onActiveConversationChange]);

  // Wire up back button handler so pressing Android back button closes active conversation back to chat list
  useEffect(() => {
    if (onBackToChatListRef) {
      onBackToChatListRef.current = () => {
        if (confirmModal) {
          setConfirmModal(null);
          return true;
        }
        if (fullscreenMedia) {
          setFullscreenMedia(null);
          return true;
        }
        if (isViewingGroupSettings) {
          setIsViewingGroupSettings(false);
          return true;
        }
        if (isCreatingGroup) {
          setIsCreatingGroup(false);
          return true;
        }
        if (activeAnonRoomId) {
          handleLeaveAnonRoom();
          return true;
        }
        if (selectedRecipient) {
          setSelectedRecipient(null);
          return true;
        }
        return false;
      };
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const anonTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize chat textarea when message changes or is cleared
  useEffect(() => {
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
      chatTextareaRef.current.style.height = `${Math.min(chatTextareaRef.current.scrollHeight, 120)}px`;
    }
  }, [msg]);

  // Listen for typing indicator
  useEffect(() => {
    if (!currentUser || !selectedRecipient) {
      setTypingUsers({});
      return;
    }

    let typingPath = '';
    if (selectedRecipient.type === 'user') {
      const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
      typingPath = `chats/${chatId}/typing`;
    } else {
      typingPath = `groups/${(selectedRecipient.data as Group).id}/typing`;
    }

    const typingRef = ref(db, typingPath);
    const unsubscribe = onValue(typingRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const typingMap: Record<string, boolean> = {};
        Object.entries(data).forEach(([uid, isTyping]) => {
          if (uid !== currentUser.id && isTyping) {
            typingMap[uid] = true;
          }
        });
        setTypingUsers(typingMap);
      } else {
        setTypingUsers({});
      }
    });

    return () => {
      unsubscribe();
      try {
        const myTypingRef = ref(db, `${typingPath}/${currentUser.id}`);
        set(myTypingRef, null).catch(() => {});
      } catch {}
      isCurrentlyTypingRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [selectedRecipient, currentUser]);

  const handleInputChange = (text: string) => {
    setMsg(text);

    if (!currentUser || !selectedRecipient) return;

    let typingPath = '';
    if (selectedRecipient.type === 'user') {
      const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
      typingPath = `chats/${chatId}/typing/${currentUser.id}`;
    } else {
      typingPath = `groups/${(selectedRecipient.data as Group).id}/typing/${currentUser.id}`;
    }

    if (!isCurrentlyTypingRef.current) {
      isCurrentlyTypingRef.current = true;
      set(ref(db, typingPath), true).catch(() => {});
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      isCurrentlyTypingRef.current = false;
      set(ref(db, typingPath), null).catch(() => {});
    }, 2000);
  };

  useEffect(() => {
    if (anonTextareaRef.current) {
      anonTextareaRef.current.style.height = 'auto';
      anonTextareaRef.current.style.height = `${Math.min(anonTextareaRef.current.scrollHeight, 100)}px`;
    }
  }, [anonInputMsg]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, forcedType?: 'image' | 'video') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = forcedType === 'video' || file.type.startsWith('video/');
    const isImage = forcedType === 'image' || file.type.startsWith('image/');

    if (!isImage && !isVideo) {
      setConfirmModal({
        isOpen: true,
        title: 'Format File Tidak Didukung',
        message: 'Hanya file gambar (JPG, PNG, WEBP, GIF) dan video (MP4, WEBM, MOV) yang dapat dikirim ke obrolan.',
        confirmText: 'Mengerti',
        onConfirm: () => setConfirmModal(null)
      });
      if (e.target) e.target.value = '';
      return;
    }

    const sizeInMB = file.size / (1024 * 1024);
    if (isVideo && sizeInMB > 30) {
      setConfirmModal({
        isOpen: true,
        title: 'Ukuran Video Terlalu Besar',
        message: `Ukuran video adalah ${sizeInMB.toFixed(1)} MB. Maksimum ukuran video yang disarankan adalah 30 MB agar pengiriman cepat dan lancar.`,
        confirmText: 'Pilih Video Lain',
        onConfirm: () => setConfirmModal(null)
      });
      if (e.target) e.target.value = '';
      return;
    }

    const formattedSize = sizeInMB >= 1 ? `${sizeInMB.toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;

    setIsProcessingMedia(true);
    try {
      if (isImage) {
        // High quality smooth image compression for quick transmission and crisp viewing
        const optimized = await compressImage(file, 1280, 1280, 0.85);
        setSelectedMedia({
          url: optimized,
          type: 'image',
          name: file.name,
          size: formattedSize
        });
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedMedia({
            url: reader.result as string,
            type: 'video',
            name: file.name,
            size: formattedSize
          });
          setIsProcessingMedia(false);
        };
        reader.onerror = () => {
          setIsProcessingMedia(false);
        };
        reader.readAsDataURL(file);
        return;
      }
    } catch (err) {
      console.error('Error processing chat media:', err);
    } finally {
      setIsProcessingMedia(false);
      if (e.target) e.target.value = '';
    }
  };

  const getChatId = (uid1: string, uid2: string) => {
    return [uid1, uid2].sort().join('_');
  };

  // Logic to identify MUTUAL FOLLOWERS (Saling Follow Balik)
  const isMutual = (uid: string) => {
    if (!currentUser) return false;
    const latestMe = users.find(u => u.id === currentUser.id);
    const following = latestMe ? (latestMe.following || []) : (currentUser.following || []);
    const followers = latestMe ? (latestMe.followers || []) : (currentUser.followers || []);
    
    const targetUser = users.find(u => u.id === uid);
    const targetFollowers = targetUser ? (targetUser.followers || []) : [];
    
    const iFollowThem = Array.isArray(following) ? following.includes(uid) : Boolean((following as any)?.[uid]);
    const theyFollowMe = (Array.isArray(followers) ? followers.includes(uid) : Boolean((followers as any)?.[uid])) || 
                         (Array.isArray(targetFollowers) ? targetFollowers.includes(currentUser.id) : Boolean((targetFollowers as any)?.[currentUser.id]));
    return iFollowThem && theyFollowMe;
  };

  const isFollowingOrFollowed = (uid: string) => {
    if (!currentUser) return false;
    const latestMe = users.find(u => u.id === currentUser.id);
    const following = latestMe ? (latestMe.following || []) : (currentUser.following || []);
    const followers = latestMe ? (latestMe.followers || []) : (currentUser.followers || []);
    
    const targetUser = users.find(u => u.id === uid);
    const targetFollowing = targetUser ? (targetUser.following || []) : [];
    const targetFollowers = targetUser ? (targetUser.followers || []) : [];

    const iFollowThem = Array.isArray(following) ? following.includes(uid) : Boolean((following as any)?.[uid]);
    const theyFollowMe = (Array.isArray(followers) ? followers.includes(uid) : Boolean((followers as any)?.[uid])) || 
                         (Array.isArray(targetFollowers) ? targetFollowers.includes(currentUser.id) : Boolean((targetFollowers as any)?.[currentUser.id])) ||
                         (Array.isArray(targetFollowing) ? targetFollowing.includes(currentUser.id) : Boolean((targetFollowing as any)?.[currentUser.id]));
    return iFollowThem || theyFollowMe;
  };

  const mutualFollowers = users.filter(u => u.id !== currentUser?.id && isMutual(u.id));

  // Format timestamp nicely for chat threads
  const formatChatTimestamp = (timestamp: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.toDateString() === date.toDateString()) {
      return 'Kemarin';
    }
    return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  // Target User Auto-Selection with instant RTDB fallback
  useEffect(() => {
    if (targetUserId) {
      const targetUser = users.find(u => u.id === targetUserId);
      if (targetUser) {
        setSelectedRecipient({ type: 'user', data: targetUser });
        if (initialChatMessage) {
          setMsg(initialChatMessage);
        }
        if (onClearInitialChat) {
          onClearInitialChat();
        }
      } else {
        // Fetch user directly from RTDB if users list is still loading
        get(ref(db, `users/${targetUserId}`)).then((snap) => {
          if (snap.exists()) {
            const val = snap.val();
            const fallbackUser: User = {
              id: targetUserId,
              name: val.name || 'Pengguna Vimos',
              email: val.email || '',
              bio: val.bio || '',
              photoURL: val.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${targetUserId}&backgroundColor=000000`,
              followers: val.followers ? Object.keys(val.followers) : [],
              following: val.following ? Object.keys(val.following) : [],
              recentCaptures: [],
              totalLikes: val.totalLikes || 0
            };
            setSelectedRecipient({ type: 'user', data: fallbackUser });
            if (initialChatMessage) {
              setMsg(initialChatMessage);
            }
            if (onClearInitialChat) {
              onClearInitialChat();
            }
          }
        }).catch(() => {});
      }
    }
  }, [targetUserId, users, initialChatMessage]);

  // Target Group Auto-Selection
  useEffect(() => {
    if (targetGroupId && groups.length > 0) {
      const targetGroup = groups.find(g => g.id === targetGroupId);
      if (targetGroup) {
        setSelectedRecipient({ type: 'group', data: targetGroup });
        setActiveTab('groups');
        if (onClearInitialChat) {
          onClearInitialChat();
        }
      } else {
        get(ref(db, `groups/${targetGroupId}`)).then((snap) => {
          if (snap.exists()) {
            const val = snap.val();
            const gObj: Group = {
              id: targetGroupId,
              ...val,
              participants: val.participants ? Object.keys(val.participants) : [],
              admins: val.admins ? Object.keys(val.admins) : [],
              pendingInvites: val.pendingInvites || {}
            };
            setSelectedRecipient({ type: 'group', data: gObj });
            setActiveTab('groups');
            if (onClearInitialChat) onClearInitialChat();
          }
        }).catch(() => {});
      }
    }
  }, [targetGroupId, groups]);

  // Sync groups user is part of
  useEffect(() => {
    if (!currentUser) return;
    const groupsRef = ref(db, 'groups');
    const unsubscribe = onValue(groupsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const userGroups = Object.entries(data)
          .map(([id, val]: [string, any]) => ({ 
            id, 
            ...val, 
            participants: val.participants ? Object.keys(val.participants) : [],
            admins: val.admins ? Object.keys(val.admins) : [],
            pendingInvites: val.pendingInvites || {}
          }))
          .filter((g: Group) => g.participants.includes(currentUser.id))
          .sort((a: any, b: any) => {
            const timeA = Math.max(Number(a.lastTimestamp) || 0, Number(a.timestamp) || 0);
            const timeB = Math.max(Number(b.lastTimestamp) || 0, Number(b.timestamp) || 0);
            return timeB - timeA;
          });
        setGroups(userGroups);
        
        if (selectedRecipient?.type === 'group') {
          const updated = userGroups.find(g => g.id === (selectedRecipient.data as Group).id);
          if (updated) setSelectedRecipient({ type: 'group', data: updated });
          else setSelectedRecipient(null);
        }
      } else {
        setGroups([]);
      }
    });
    return () => unsubscribe();
  }, [currentUser, selectedRecipient?.type]);

  // Helper to sanitize Firebase path keys and check deletion status
  const getSafeKey = (id: string) => id.replace(/[.#$\[\]]/g, '_');

  const isMsgDeletedForUser = (deletedForObj: any, uid?: string) => {
    if (!deletedForObj || !uid) return false;
    if (typeof deletedForObj !== 'object') return false;
    const safeId = getSafeKey(uid);
    return Boolean(deletedForObj[uid] || deletedForObj[safeId]);
  };

  const getTimestampNum = (ts: any): number => {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      const parsed = Number(ts);
      if (!isNaN(parsed) && parsed > 0) return parsed;
      const d = Date.parse(ts);
      if (!isNaN(d) && d > 0) return d;
      return 0;
    }
    if (typeof ts === 'object' && ts !== null) {
      // serverTimestamp placeholder on optimistic write
      return Date.now();
    }
    return 0;
  };

  // Sync active Direct Chats and Shop Chats from Firebase RTDB (Full sync without arbitrary limit)
  useEffect(() => {
    if (!currentUser) return;

    const chatsRef = ref(db, 'chats');
    const safeUserId = getSafeKey(currentUser.id);

    const parseChatsSnapshot = (data: any) => {
      if (!data) {
        setDirectChatThreads([]);
        setShopChatThreads([]);
        setLoadingThreads(false);
        return;
      }

      const directThreads: ChatThread[] = [];
      const shopThreads: ChatThread[] = [];

      Object.entries(data).forEach(([chatId, chatVal]: [string, any]) => {
        if (!chatId.includes(currentUser.id)) return;
        
        let otherUserId = '';
        if (chatId.startsWith(currentUser.id + '_')) {
          otherUserId = chatId.slice(currentUser.id.length + 1);
        } else if (chatId.endsWith('_' + currentUser.id)) {
          otherUserId = chatId.slice(0, -(currentUser.id.length + 1));
        } else {
          const parts = chatId.split('_');
          otherUserId = parts.find(id => id !== currentUser.id) || '';
        }
        if (!otherUserId) return;

        let otherUser = users.find(u => u.id === otherUserId) || fetchedUsersMap[otherUserId];
        if (!otherUser) {
          otherUser = {
            id: otherUserId,
            name: chatVal?.userName || 'Pengguna Vimos',
            email: '',
            bio: '',
            photoURL: chatVal?.userPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${otherUserId}&backgroundColor=000000`,
            followers: [],
            following: [],
            recentCaptures: [],
            totalLikes: 0
          };
          // Fetch from RTDB in background so real name & avatar display
          get(ref(db, `users/${otherUserId}`)).then(snap => {
            if (snap.exists()) {
              const val = snap.val();
              setFetchedUsersMap(prev => ({
                ...prev,
                [otherUserId]: {
                  id: otherUserId,
                  name: val.name || 'Pengguna Vimos',
                  email: val.email || '',
                  bio: val.bio || '',
                  photoURL: val.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${otherUserId}&backgroundColor=000000`,
                  followers: val.followers ? Object.keys(val.followers) : [],
                  following: val.following ? Object.keys(val.following) : [],
                  recentCaptures: [],
                  totalLikes: val.totalLikes || 0
                }
              }));
            }
          }).catch(() => {});
        }

        const messagesObj = chatVal?.messages;
        let msgList: any[] = [];
        if (messagesObj && typeof messagesObj === 'object') {
          msgList = Object.entries(messagesObj)
            .map(([mId, mVal]: [string, any]) => ({
              id: mId,
              ...mVal
            }))
            .filter((m: any) => !isMsgDeletedForUser(m.deletedFor, currentUser.id))
            .sort((a: any, b: any) => {
              const tA = Math.max(getTimestampNum(a.timestamp), getTimestampNum(a.createdAt), getTimestampNum(a.lastUpdated), 0);
              const tB = Math.max(getTimestampNum(b.timestamp), getTimestampNum(b.createdAt), getTimestampNum(b.lastUpdated), 0);
              const diff = tA - tB;
              if (diff !== 0) return diff;
              return (a.id || '').localeCompare(b.id || '');
            });
        }

        // If no undeleted messages and no lastMessage text, ignore
        if (msgList.length === 0 && !chatVal?.lastMessage) return;

        let maxMessageTime = 0;
        let latestMsgObj: any = null;
        for (const m of msgList) {
          const t = Math.max(
            getTimestampNum(m.timestamp),
            getTimestampNum(m.createdAt),
            getTimestampNum(m.lastUpdated),
            getTimestampNum(m.time),
            0
          );
          if (t >= maxMessageTime) {
            maxMessageTime = t;
            latestMsgObj = m;
          }
        }

        const lastMsg = latestMsgObj || (msgList.length > 0 ? msgList[msgList.length - 1] : null);
        const mediaSummary = lastMsg?.photoURL || lastMsg?.mediaType === 'image' 
          ? '📷 Foto' 
          : (lastMsg?.videoURL || lastMsg?.mediaType === 'video' ? '🎥 Video' : '');
        const lastMessageText = lastMsg?.text || mediaSummary || chatVal?.lastMessage || 'Pesan';
        const lastMessageSenderId = lastMsg?.senderId || chatVal?.lastSenderId || '';
        
        // Accurate thread timestamp calculation: takes the latest of message timestamp, lastUpdated, lastTimestamp, or chat creation timestamp
        const threadTimestamp = Math.max(
          maxMessageTime,
          getTimestampNum(lastMsg?.timestamp),
          getTimestampNum(chatVal?.lastUpdated),
          getTimestampNum(chatVal?.lastTimestamp),
          getTimestampNum(chatVal?.timestamp),
          0
        );

        const unreadCount = msgList.filter((m: any) => 
          m.senderId !== currentUser.id && 
          !m.read && 
          (!m.readBy || !m.readBy[safeUserId])
        ).length;

        const isShopThread = chatVal?.isShopChat === true || msgList.some((m: any) => 
          m.isShop === true ||
          (m.text && (
            m.text.includes('tertarik untuk membeli') || 
            m.text.includes('membeli produk') || 
            m.text.includes('dari toko Anda') ||
            m.text.includes('Harga:')
          ))
        );

        const threadItem: ChatThread = {
          chatId,
          otherUser,
          lastMessage: lastMessageText,
          lastMessageSenderId,
          timestamp: threadTimestamp,
          unreadCount,
          isShop: isShopThread,
          mediaSummary
        };

        // Every chat thread where currentUser is part of appears in direct threads
        directThreads.push(threadItem);

        // Shop threads specifically for Shop tab
        if (isShopThread) {
          shopThreads.push(threadItem);
        }
      });

      // Sort: newest activity ALWAYS at the top!
      directThreads.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return (b.chatId || '').localeCompare(a.chatId || '');
      });
      shopThreads.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return (b.chatId || '').localeCompare(a.chatId || '');
      });

      setDirectChatThreads(directThreads);
      setShopChatThreads(shopThreads);
      setLoadingThreads(false);
    };

    // Instant initial get for zero-delay first render
    get(chatsRef).then((snapshot) => {
      parseChatsSnapshot(snapshot.val());
    }).catch(() => {
      setLoadingThreads(false);
    });

    const unsubscribe = onValue(chatsRef, (snapshot) => {
      parseChatsSnapshot(snapshot.val());
    });

    return () => unsubscribe();
  }, [currentUser, users]);

  // Sync messages for selectedRecipient (direct / group)
  useEffect(() => {
    if (!currentUser || !selectedRecipient) {
      setMessages([]);
      setIsLoadingMessages(false);
      return;
    }

    setIsLoadingMessages(true);
    let chatPath = '';
    if (selectedRecipient.type === 'user') {
      const otherUser = selectedRecipient.data as User;
      const chatId = getChatId(currentUser.id, otherUser.id);
      chatPath = `chats/${chatId}/messages`;
    } else {
      chatPath = `groups/${(selectedRecipient.data as Group).id}/messages`;
    }

    const chatRef = ref(db, chatPath);

    // Instant direct fetch for selected chat messages
    get(chatRef).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data)
          .map(([id, val]: [string, any]) => ({
            id,
            ...val
          }))
          .filter((m: any) => !isMsgDeletedForUser(m.deletedFor, currentUser.id))
          .sort((a, b) => getTimestampNum(a.timestamp) - getTimestampNum(b.timestamp));
        setMessages(list);
      } else {
        setMessages([]);
      }
      setIsLoadingMessages(false);
    }).catch(() => {
      setIsLoadingMessages(false);
    });

    const unsubscribe = onValue(chatRef, (snapshot) => {
      setIsLoadingMessages(false);
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data)
          .map(([id, val]: [string, any]) => ({
            id,
            ...val
          }))
          .filter((m: any) => !isMsgDeletedForUser(m.deletedFor, currentUser.id))
          .sort((a, b) => getTimestampNum(a.timestamp) - getTimestampNum(b.timestamp));
        setMessages(list);

        // Auto mark incoming unread messages as read when user is actively in this chat
        const safeUserId = getSafeKey(currentUser.id);
        if (selectedRecipient.type === 'user') {
          const otherUserId = (selectedRecipient.data as User).id;
          const otherUserSafeId = getSafeKey(otherUserId);
          const unreadMsgs = list.filter((m: any) => m.senderId === otherUserId && (!m.read || !m.readBy || !m.readBy[safeUserId]));
          if (unreadMsgs.length > 0) {
            const chatId = getChatId(currentUser.id, otherUserId);
            const updates: Record<string, any> = {};
            unreadMsgs.forEach((m: any) => {
              updates[`chats/${chatId}/messages/${m.id}/read`] = true;
              updates[`chats/${chatId}/messages/${m.id}/readAt`] = Date.now();
              updates[`chats/${chatId}/messages/${m.id}/readBy/${safeUserId}`] = true;
            });
            update(ref(db), updates).catch(err => console.error('Failed to mark read:', err));
          }
        } else if (selectedRecipient.type === 'group') {
          const groupId = (selectedRecipient.data as Group).id;
          const unreadGroupMsgs = list.filter((m: any) => m.senderId !== currentUser.id && (!m.readBy || !m.readBy[safeUserId]));
          if (unreadGroupMsgs.length > 0) {
            const updates: Record<string, any> = {};
            unreadGroupMsgs.forEach((m: any) => {
              updates[`groups/${groupId}/messages/${m.id}/readBy/${safeUserId}`] = true;
            });
            update(ref(db), updates).catch(err => console.error('Failed to mark group read:', err));
          }
        }
      } else {
        setMessages([]);
      }
    });

    return () => unsubscribe();
  }, [selectedRecipient, currentUser]);

  // Message Deletion Handlers
  const handleDeleteMessageForMe = async (msgId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!currentUser || !selectedRecipient) return;

    setActiveMenuMsgId(null);
    setMessages(prev => prev.filter(m => m.id !== msgId));

    try {
      let msgPath = '';
      if (selectedRecipient.type === 'user') {
        const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
        msgPath = `chats/${chatId}/messages/${msgId}`;
      } else {
        msgPath = `groups/${(selectedRecipient.data as Group).id}/messages/${msgId}`;
      }
      
      const safeUserId = getSafeKey(currentUser.id);
      await set(ref(db, `${msgPath}/deletedFor/${safeUserId}`), true);
    } catch (err) {
      console.error('Failed to delete message for me:', err);
    }
  };

  const handleDeleteMessageForEveryone = (msgId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!currentUser || !selectedRecipient) return;
    setActiveMenuMsgId(null);

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Pesan untuk Semua?',
      message: 'Apakah Anda yakin ingin menghapus pesan ini secara permanen untuk semua orang?',
      confirmText: 'Ya, Hapus untuk Semua',
      onConfirm: async () => {
        setConfirmModal(null);
        setMessages(prev => prev.filter(m => m.id !== msgId));
        try {
          let msgPath = '';
          if (selectedRecipient.type === 'user') {
            const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
            msgPath = `chats/${chatId}/messages/${msgId}`;
          } else {
            msgPath = `groups/${(selectedRecipient.data as Group).id}/messages/${msgId}`;
          }
          await remove(ref(db, msgPath));
        } catch (err) {
          console.error('Failed to delete message for everyone:', err);
        }
      }
    });
  };

  const handleClearChatForMe = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!currentUser || !selectedRecipient) return;

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Obrolan Ini?',
      message: 'Apakah Anda yakin ingin menghapus seluruh obrolan ini dari tampilan Anda?',
      confirmText: 'Ya, Hapus Obrolan',
      onConfirm: async () => {
        setConfirmModal(null);
        setMessages([]);
        try {
          let chatPath = '';
          if (selectedRecipient.type === 'user') {
            const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
            chatPath = `chats/${chatId}/messages`;
          } else {
            chatPath = `groups/${(selectedRecipient.data as Group).id}/messages`;
          }

          const snapshot = await get(ref(db, chatPath));
          const data = snapshot.val();
          if (data) {
            const safeUserId = getSafeKey(currentUser.id);
            const updates: Record<string, any> = {};
            Object.keys(data).forEach((mId) => {
              updates[`${chatPath}/${mId}/deletedFor/${safeUserId}`] = true;
            });
            await update(ref(db), updates);
          }
        } catch (err) {
          console.error('Failed to clear chat:', err);
        }
      }
    });
  };

  const handleDeleteShopChatThread = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!currentUser) return;

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Obrolan Toko?',
      message: 'Apakah Anda yakin ingin menghapus obrolan toko ini dari daftar Anda?',
      confirmText: 'Ya, Hapus Obrolan Toko',
      onConfirm: async () => {
        setConfirmModal(null);
        setShopChatThreads(prev => prev.filter(t => t.chatId !== chatId));
        try {
          const chatMessagesRef = ref(db, `chats/${chatId}/messages`);
          const snapshot = await get(chatMessagesRef);
          const data = snapshot.val();
          if (data) {
            const safeUserId = getSafeKey(currentUser.id);
            const updates: Record<string, any> = {};
            Object.keys(data).forEach((mId) => {
              updates[`chats/${chatId}/messages/${mId}/deletedFor/${safeUserId}`] = true;
            });
            await update(ref(db), updates);
          }
        } catch (err) {
          console.error('Failed to delete shop chat thread:', err);
        }
      }
    });
  };

  const handleClearDirectUserChat = (targetUserId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!currentUser) return;

    setConfirmModal({
      isOpen: true,
      title: 'Hapus Riwayat Obrolan?',
      message: 'Apakah Anda yakin ingin menghapus seluruh riwayat obrolan dengan pengguna ini?',
      confirmText: 'Ya, Hapus Riwayat',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const chatId = getChatId(currentUser.id, targetUserId);
          const chatPath = `chats/${chatId}/messages`;
          const snapshot = await get(ref(db, chatPath));
          const data = snapshot.val();
          if (data) {
            const safeUserId = getSafeKey(currentUser.id);
            const updates: Record<string, any> = {};
            Object.keys(data).forEach((mId) => {
              updates[`${chatPath}/${mId}/deletedFor/${safeUserId}`] = true;
            });
            await update(ref(db), updates);
          }
          if (selectedRecipient?.type === 'user' && (selectedRecipient.data as User).id === targetUserId) {
            setMessages([]);
          }
        } catch (err) {
          console.error('Failed to clear direct user chat:', err);
        }
      }
    });
  };

  const handleDeleteAnonMessageForMe = async (msgId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!currentUser || !activeAnonRoomId) return;

    setAnonMessages(prev => prev.filter(m => m.id !== msgId));

    try {
      const safeUserId = getSafeKey(currentUser.id);
      await set(ref(db, `anonymous_rooms/${activeAnonRoomId}/messages/${msgId}/deletedFor/${safeUserId}`), true);
    } catch (err) {
      console.error('Failed to delete anon message:', err);
    }
  };

  // Sync Anonymous Rooms & Matches
  useEffect(() => {
    if (!currentUser) return;

    const roomsRef = ref(db, 'anonymous_rooms');
    const unsubscribe = onValue(roomsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const foundEntry = Object.entries(data).find(([id, roomVal]: [string, any]) => {
          return (
            roomVal &&
            roomVal.status === 'active' &&
            roomVal.participants &&
            roomVal.participants[currentUser.id] === true
          );
        });

        if (foundEntry) {
          const [roomId, roomVal] = foundEntry;
          setActiveAnonRoomId(roomId);
          setActiveAnonRoom({ id: roomId, ...(roomVal as Record<string, any>) });
          setIsSearchingAnon(false);
          remove(ref(db, `anonymous_queue/${currentUser.id}`));
        } else {
          setActiveAnonRoomId(null);
          setActiveAnonRoom(null);
        }
      } else {
        setActiveAnonRoomId(null);
        setActiveAnonRoom(null);
      }
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Sync Anonymous Messages
  useEffect(() => {
    if (!activeAnonRoomId) {
      setAnonMessages([]);
      return;
    }

    const messagesRef = ref(db, `anonymous_rooms/${activeAnonRoomId}/messages`);
    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgList = Object.entries(data)
          .map(([id, val]: [string, any]) => ({
            id,
            ...val
          }))
          .filter((m: any) => !m.deletedFor || !m.deletedFor[currentUser?.id || ''])
          .sort((a, b) => getTimestampNum(a.timestamp) - getTimestampNum(b.timestamp));
        setAnonMessages(msgList);
      } else {
        setAnonMessages([]);
      }
    });

    return () => unsubscribe();
  }, [activeAnonRoomId]);

  // Auto scroll to bottom when new messages arrive or typing status changes
  useEffect(() => {
    if (messages.length > 0 || Object.keys(typingUsers).length > 0) {
      setTimeout(() => {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages.length, typingUsers]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!msg.trim() && !selectedMedia) || !currentUser || !selectedRecipient) return;

    // Instantly clear typing status in Firebase upon sending
    try {
      let typingNodePath = '';
      if (selectedRecipient.type === 'user') {
        const chatId = getChatId(currentUser.id, (selectedRecipient.data as User).id);
        typingNodePath = `chats/${chatId}/typing/${currentUser.id}`;
      } else {
        typingNodePath = `groups/${(selectedRecipient.data as Group).id}/typing/${currentUser.id}`;
      }
      set(ref(db, typingNodePath), null).catch(() => {});
      isCurrentlyTypingRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    } catch {}

    const trimmedMsg = msg.trim();
    const mediaToSend = selectedMedia;
    const lastSummary = trimmedMsg || (mediaToSend?.type === 'image' ? '📷 Foto' : (mediaToSend?.type === 'video' ? '🎥 Video' : 'Pesan'));
    const now = Date.now();

    let chatPath = '';
    if (selectedRecipient.type === 'user') {
      const otherUser = selectedRecipient.data as User;
      const isShop = activeTab === 'shop' || (selectedRecipient.data as any).isShop;
      const isChatRestricted = Boolean(otherUser.onlyMutualChat || currentUser.onlyMutualChat);
      const isMutualUser = isMutual(otherUser.id);
      const canChat = Boolean(currentUser.isAdmin || otherUser.isAdmin || isShop || !isChatRestricted || isMutualUser);

      if (!canChat) {
        alert(otherUser.onlyMutualChat 
          ? `${otherUser.name} membatasi pesan hanya untuk pengguna yang saling mengikuti (mutual follow).` 
          : 'Anda mengaktifkan batasan pesan hanya untuk pengguna yang saling mengikuti.');
        return;
      }

      const chatId = getChatId(currentUser.id, otherUser.id);
      chatPath = `chats/${chatId}/messages`;

      // Optimistically push this conversation to the top immediately!
      setDirectChatThreads(prev => {
        const existing = prev.find(t => t.chatId === chatId);
        const updatedThread: ChatThread = {
          chatId,
          otherUser: existing?.otherUser || otherUser,
          lastMessage: lastSummary,
          lastMessageSenderId: currentUser.id,
          timestamp: now,
          unreadCount: 0,
          isShop,
          mediaSummary: mediaToSend?.type === 'image' ? '📷 Foto' : (mediaToSend?.type === 'video' ? '🎥 Video' : '')
        };
        return [updatedThread, ...prev.filter(t => t.chatId !== chatId)];
      });

      if (isShop) {
        setShopChatThreads(prev => {
          const existing = prev.find(t => t.chatId === chatId);
          const updatedThread: ChatThread = {
            chatId,
            otherUser: existing?.otherUser || otherUser,
            lastMessage: lastSummary,
            lastMessageSenderId: currentUser.id,
            timestamp: now,
            unreadCount: 0,
            isShop: true,
            mediaSummary: mediaToSend?.type === 'image' ? '📷 Foto' : (mediaToSend?.type === 'video' ? '🎥 Video' : '')
          };
          return [updatedThread, ...prev.filter(t => t.chatId !== chatId)];
        });
      }

      update(ref(db, `chats/${chatId}`), {
        ...(isShop ? { isShopChat: true } : {}),
        lastMessage: lastSummary,
        lastUpdated: now,
        lastTimestamp: now,
        lastSenderId: currentUser.id
      });
    } else {
      chatPath = `groups/${(selectedRecipient.data as Group).id}/messages`;
      update(ref(db, `groups/${(selectedRecipient.data as Group).id}`), {
        lastMessage: lastSummary,
        lastTimestamp: now,
        lastUpdated: now,
        lastSenderId: currentUser.id
      });

      setGroups(prev => {
        const gId = (selectedRecipient.data as Group).id;
        const targetG = prev.find(g => g.id === gId);
        if (!targetG) return prev;
        const updatedG = { ...targetG, lastMessage: lastSummary, lastTimestamp: now, lastUpdated: now };
        return [updatedG, ...prev.filter(g => g.id !== gId)];
      });
    }

    // Optimistically append sent message for instant feedback
    const optimisticId = `local_${Date.now()}`;
    setMessages(prev => [
      ...prev,
      {
        id: optimisticId,
        senderId: currentUser.id,
        text: trimmedMsg,
        timestamp: now,
        read: false,
        ...(mediaToSend ? {
          photoURL: mediaToSend.type === 'image' ? mediaToSend.url : undefined,
          videoURL: mediaToSend.type === 'video' ? mediaToSend.url : undefined,
          mediaType: mediaToSend.type,
          mediaURL: mediaToSend.url,
          fileName: mediaToSend.name,
          fileSize: mediaToSend.size
        } : {})
      }
    ]);

    const safeUserId = getSafeKey(currentUser.id);
    const messagePayload: any = {
      senderId: currentUser.id,
      text: trimmedMsg,
      timestamp: now,
      lastUpdated: now,
      read: false,
      readBy: {
        [safeUserId]: true
      },
      ...(activeTab === 'shop' ? { isShop: true } : {})
    };

    if (mediaToSend) {
      if (mediaToSend.type === 'image') {
        messagePayload.photoURL = mediaToSend.url;
        messagePayload.mediaType = 'image';
        messagePayload.mediaURL = mediaToSend.url;
      } else if (mediaToSend.type === 'video') {
        messagePayload.videoURL = mediaToSend.url;
        messagePayload.mediaType = 'video';
        messagePayload.mediaURL = mediaToSend.url;
      }
      if (mediaToSend.name) messagePayload.fileName = mediaToSend.name;
      if (mediaToSend.size) messagePayload.fileSize = mediaToSend.size;
    }

    const chatRef = ref(db, chatPath);
    push(chatRef, messagePayload);
    
    setMsg('');
    setSelectedMedia(null);

    // Scroll to bottom immediately
    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const handleCreateGroup = async () => {
    if (!currentUser || !groupName.trim() || selectedForGroup.length === 0) return;
    
    const groupsRef = ref(db, 'groups');
    const newGroupRef = push(groupsRef);
    const newGroupId = newGroupRef.key;
    if (!newGroupId) return;
    
    // Creator is the only direct active participant & admin initially
    const participants: Record<string, boolean> = { [currentUser.id]: true };
    const admins: Record<string, boolean> = { [currentUser.id]: true };
    
    // Selected friends receive pending invitations
    const pendingInvites: Record<string, any> = {};
    selectedForGroup.forEach(id => {
      pendingInvites[id] = {
        userId: id,
        inviterId: currentUser.id,
        inviterName: currentUser.name,
        inviterPhoto: currentUser.photoURL,
        timestamp: Date.now()
      };
    });

    const createdGroupObj: Group = {
      id: newGroupId,
      name: groupName.trim(),
      bio: 'New collective space.',
      creatorId: currentUser.id,
      participants: Object.keys(participants),
      admins: Object.keys(admins),
      pendingInvites,
      timestamp: Date.now()
    };

    await set(newGroupRef, {
      name: groupName.trim(),
      bio: 'New collective space.',
      creatorId: currentUser.id,
      participants,
      admins,
      pendingInvites,
      timestamp: serverTimestamp()
    });

    // Send notifications to each invited member
    selectedForGroup.forEach(invitedUserId => {
      const notifRef = push(ref(db, `notifications/${invitedUserId}`));
      set(notifRef, {
        id: notifRef.key,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderPhoto: currentUser.photoURL,
        type: 'group_invite',
        groupId: newGroupId,
        groupName: groupName.trim(),
        status: 'pending',
        timestamp: serverTimestamp(),
        read: false
      });
    });

    // Initial system announcement in group
    const initMsgRef = push(ref(db, `groups/${newGroupId}/messages`));
    set(initMsgRef, {
      senderId: 'system',
      text: `${currentUser.name} membuat grup "${groupName.trim()}". Undangan telah dikirim ke ${selectedForGroup.length} anggota orbit.`,
      timestamp: serverTimestamp(),
      read: true
    });

    setGroupName('');
    setSelectedForGroup([]);
    setGroupMemberSearchQuery('');
    setIsCreatingGroup(false);
    setSelectedRecipient({ type: 'group', data: createdGroupObj });
    setActiveTab('groups');
  };

  const updateGroupInfo = (groupId: string, data: any) => {
    update(ref(db, `groups/${groupId}`), data);
  };

  const handleInviteMember = async (groupId: string, userId: string, gName?: string, gPhoto?: string) => {
    if (!currentUser) return;
    const userToInvite = users.find(u => u.id === userId);

    // Add to pending invites in Firebase
    await set(ref(db, `groups/${groupId}/pendingInvites/${userId}`), {
      userId,
      inviterId: currentUser.id,
      inviterName: currentUser.name,
      inviterPhoto: currentUser.photoURL,
      timestamp: Date.now()
    });

    // Send notification
    const notifRef = push(ref(db, `notifications/${userId}`));
    await set(notifRef, {
      id: notifRef.key,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderPhoto: currentUser.photoURL,
      type: 'group_invite',
      groupId: groupId,
      groupName: gName || (selectedRecipient?.data as Group)?.name || 'Collective',
      groupPhoto: gPhoto || (selectedRecipient?.data as Group)?.photoURL || null,
      status: 'pending',
      timestamp: serverTimestamp(),
      read: false
    });

    setConfirmModal({
      isOpen: true,
      title: 'Undangan Terkirim! ✉️',
      message: `Undangan bergabung ke grup telah dikirimkan ke notifikasi ${userToInvite?.name || 'pengguna'}. Mereka akan masuk ke grup setelah menekan tombol Terima.`,
      confirmText: 'Mengerti',
      onConfirm: () => setConfirmModal(null)
    });
  };

  const handleCancelInvite = async (groupId: string, userId: string) => {
    await set(ref(db, `groups/${groupId}/pendingInvites/${userId}`), null);
  };

  const handleRemoveMember = (groupId: string, userId: string) => {
    const memberObj = users.find(u => u.id === userId);
    setConfirmModal({
      isOpen: true,
      title: 'Keluarkan Anggota?',
      message: `Apakah Anda yakin ingin mengeluarkan ${memberObj?.name || 'pengguna ini'} dari grup?`,
      confirmText: 'Keluarkan',
      onConfirm: async () => {
        setConfirmModal(null);
        await set(ref(db, `groups/${groupId}/participants/${userId}`), null);
        await set(ref(db, `groups/${groupId}/admins/${userId}`), null);
      }
    });
  };

  const handleLeaveGroup = (groupId: string) => {
    if (!currentUser) return;
    setConfirmModal({
      isOpen: true,
      title: 'Keluar dari Grup?',
      message: 'Apakah Anda yakin ingin keluar dari obrolan grup ini?',
      confirmText: 'Keluar Grup',
      onConfirm: async () => {
        setConfirmModal(null);
        await set(ref(db, `groups/${groupId}/participants/${currentUser.id}`), null);
        await set(ref(db, `groups/${groupId}/admins/${currentUser.id}`), null);
        setSelectedRecipient(null);
        setIsViewingGroupSettings(false);
      }
    });
  };

  const handleGroupPhotoChange = (groupId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateGroupInfo(groupId, { photoURL: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleParticipantSelection = (uid: string) => {
    setSelectedForGroup(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  // Anonymous Handlers
  const handleFindAnonMatch = async () => {
    if (!currentUser) return;
    setIsSearchingAnon(true);

    try {
      const queueRef = ref(db, 'anonymous_queue');
      const snapshot = await get(queueRef);
      const queueData = snapshot.val();

      let matchedUserId: string | null = null;
      if (queueData) {
        const candidateKeys = Object.keys(queueData).filter((uid) => uid !== currentUser.id);
        if (candidateKeys.length > 0) {
          matchedUserId = candidateKeys[0];
        }
      }

      if (matchedUserId) {
        const newRoomRef = push(ref(db, 'anonymous_rooms'));
        const newRoomId = newRoomRef.key;
        if (newRoomId) {
          await set(newRoomRef, {
            id: newRoomId,
            status: 'active',
            createdAt: Date.now(),
            participants: {
              [currentUser.id]: true,
              [matchedUserId]: true
            },
            revealed: {
              [currentUser.id]: false,
              [matchedUserId]: false
            }
          });

          await remove(ref(db, `anonymous_queue/${matchedUserId}`));
          await remove(ref(db, `anonymous_queue/${currentUser.id}`));

          setActiveAnonRoomId(newRoomId);
          setIsSearchingAnon(false);
        }
      } else {
        await set(ref(db, `anonymous_queue/${currentUser.id}`), {
          uid: currentUser.id,
          joinedAt: Date.now()
        });
      }
    } catch (err) {
      console.error("Error finding match:", err);
      setIsSearchingAnon(false);
    }
  };

  const handleCancelSearch = async () => {
    if (!currentUser) return;
    setIsSearchingAnon(false);
    await remove(ref(db, `anonymous_queue/${currentUser.id}`));
  };

  const handleSendAnonMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!anonInputMsg.trim() || !activeAnonRoomId || !currentUser) return;

    const messagesRef = ref(db, `anonymous_rooms/${activeAnonRoomId}/messages`);
    await push(messagesRef, {
      senderId: currentUser.id,
      text: anonInputMsg.trim(),
      timestamp: Date.now()
    });

    setAnonInputMsg('');
  };

  const handleLeaveAnonRoom = async () => {
    if (!activeAnonRoomId) return;
    await update(ref(db, `anonymous_rooms/${activeAnonRoomId}`), {
      status: 'ended'
    });
    setActiveAnonRoomId(null);
    setActiveAnonRoom(null);
  };

  const handleNextMatch = async () => {
    await handleLeaveAnonRoom();
    await handleFindAnonMatch();
  };

  const handleFollowAndReveal = async (partnerId: string) => {
    if (!currentUser || !activeAnonRoomId) return;

    if (onFollow) {
      onFollow(partnerId);
    }

    await update(ref(db, `anonymous_rooms/${activeAnonRoomId}/revealed`), {
      [currentUser.id]: true
    });
  };

  // Helper to render custom confirmation modal for all view states
  const renderConfirmModal = () => {
    if (!confirmModal || !confirmModal.isOpen) return null;
    return (
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-gray-100 text-center space-y-4 animate-scale-up">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-xl shadow-inner">
            <i className="fas fa-trash-can"></i>
          </div>
          <div>
            <h3 className="font-extrabold text-lg text-gray-900">{confirmModal.title}</h3>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{confirmModal.message}</p>
          </div>
          <div className="flex space-x-2 pt-2">
            <button
              onClick={() => setConfirmModal(null)}
              className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-2xl transition-colors"
            >
              Batal
            </button>
            <button
              onClick={() => {
                confirmModal.onConfirm();
              }}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-2xl shadow-lg transition-all active:scale-95"
            >
              {confirmModal.confirmText || 'Hapus'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // If currently inside an active Anonymous Room
  if (activeAnonRoomId && activeAnonRoom) {
    const partnerUid = Object.keys(activeAnonRoom.participants || {}).find(id => id !== currentUser?.id);
    const partnerUser = partnerUid ? users.find(u => u.id === partnerUid) : null;

    const isSelfRevealed = activeAnonRoom.revealed?.[currentUser?.id || ''] === true;
    const isPartnerSelfRevealed = partnerUid ? activeAnonRoom.revealed?.[partnerUid] === true : false;
    const isFollowingPartner = currentUser?.following?.includes(partnerUid || '');

    const isPartnerRevealed = isSelfRevealed || isPartnerSelfRevealed || isFollowingPartner;

    const maskedAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${partnerUid || 'anon'}`;
    const displayName = isPartnerRevealed
      ? (partnerUser?.name || 'Partner')
      : `Pengguna Anonim #${partnerUid ? partnerUid.substring(0, 4).toUpperCase() : '????'}`;
    const displayPhoto = isPartnerRevealed
      ? (partnerUser?.photoURL || maskedAvatar)
      : maskedAvatar;

    return (
      <div className="fixed inset-0 z-[60] bg-zinc-950 text-white flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-xl mx-auto border-x border-zinc-800 shadow-2xl overflow-hidden select-text animate-fade-in">
        {/* Top Header */}
        <div className="p-3 sm:p-4 bg-zinc-900/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between shadow-md sticky top-0 z-20">
          <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
            <button
              onClick={handleLeaveAnonRoom}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors active:scale-95 shrink-0"
              title="Keluar Chat"
            >
              <i className="fas fa-arrow-left text-sm"></i>
            </button>
            <div 
              className={`relative shrink-0 ${isPartnerRevealed ? 'cursor-pointer' : ''}`}
              onClick={() => {
                if (isPartnerRevealed && partnerUid) {
                  onUserClick(partnerUid);
                }
              }}
            >
              <img
                src={displayPhoto}
                alt={displayName}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 border-red-600 object-cover shadow-lg"
              />
              {!isPartnerRevealed && (
                <div className="absolute -bottom-1 -right-1 bg-red-600 text-white rounded-full p-1 text-[8px]">
                  <i className="fas fa-user-ninja"></i>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <h3 
                className={`font-black text-sm uppercase tracking-tight truncate ${isPartnerRevealed ? 'hover:underline cursor-pointer text-white' : 'text-red-400'}`}
                onClick={() => {
                  if (isPartnerRevealed && partnerUid) {
                    onUserClick(partnerUid);
                  }
                }}
              >
                {displayName}
              </h3>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400 truncate">
                {isPartnerRevealed ? '🔓 Profil Terungkap' : '🕵️ Identitas Disembunyikan'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
            {!isPartnerRevealed && partnerUid && (
              <button
                onClick={() => handleFollowAndReveal(partnerUid)}
                className="bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-full shadow-lg flex items-center space-x-1.5 animate-pulse active:scale-95 transition-all"
              >
                <i className="fas fa-user-plus text-[9px]"></i>
                <span className="hidden sm:inline">Follow & Ungkap</span>
              </button>
            )}
            <button
              onClick={handleNextMatch}
              className="bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-black uppercase px-2.5 sm:px-3 py-1.5 rounded-full border border-white/10 transition-all flex items-center space-x-1 active:scale-95"
              title="Cari Partner Lain"
            >
              <i className="fas fa-rotate text-xs"></i>
              <span className="hidden sm:inline">Cari Lain</span>
            </button>
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center transition-colors text-xs"
              title={isFullScreen ? "Kecilkan Layar" : "Layar Penuh"}
            >
              <i className={`fas ${isFullScreen ? 'fa-compress' : 'fa-expand'}`}></i>
            </button>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 bg-zinc-950/90 scroll-smooth">
          <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col justify-end min-h-full space-y-4">
            <div className="text-center py-3 px-4 bg-zinc-900/80 border border-white/10 rounded-2xl text-[11px] font-bold text-zinc-400 max-w-sm mx-auto space-y-1 shadow-inner">
              <p className="text-red-400 uppercase font-black tracking-wider">🔒 Obrolan Anonim Aktif</p>
              <p>Saling berkirim pesan secara bebas! Tekan <span className="text-white font-black">Follow & Ungkap</span> jika Anda ingin saling melihat foto dan nama profil asli.</p>
            </div>

            {anonMessages.map((m) => {
              const isMe = m.senderId === currentUser?.id;
              return (
                <div key={m.id} className={`flex flex-col group relative ${isMe ? 'items-end' : 'items-start animate-fade-in'}`}>
                  <span className="text-[8px] font-black uppercase tracking-widest mb-1 px-1 text-zinc-500">
                    {isMe ? 'Anda' : displayName}
                  </span>
                  <div className="flex items-center space-x-1.5 max-w-[85%] sm:max-w-lg">
                    {isMe && (
                      <button
                        onClick={(e) => handleDeleteAnonMessageForMe(m.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-red-400 p-1 text-[11px]"
                        title="Hapus untuk Saya"
                      >
                        <i className="fas fa-trash-can"></i>
                      </button>
                    )}
                    <div className={`p-3.5 sm:p-4 rounded-3xl text-sm font-medium shadow-md whitespace-pre-wrap break-words leading-relaxed ${
                      isMe 
                        ? 'bg-red-600 text-white rounded-br-none' 
                        : 'bg-zinc-800 border border-white/10 text-white rounded-bl-none'
                    }`}>
                      {m.text}
                    </div>
                    {!isMe && (
                      <button
                        onClick={(e) => handleDeleteAnonMessageForMe(m.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-red-400 p-1 text-[11px]"
                        title="Hapus untuk Saya"
                      >
                        <i className="fas fa-trash-can"></i>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Input */}
        <div className="p-3 sm:p-4 bg-zinc-900 border-t border-white/10 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
          <form onSubmit={handleSendAnonMessage} className="max-w-4xl mx-auto w-full flex items-center space-x-2">
            <div className="flex-1 min-w-0 flex items-center bg-zinc-800 border border-white/10 rounded-2xl sm:rounded-3xl px-4 py-2 focus-within:border-red-500 transition-all">
              <textarea
                ref={anonTextareaRef}
                rows={1}
                value={anonInputMsg}
                onChange={(e) => setAnonInputMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                    e.preventDefault();
                    handleSendAnonMessage(e);
                  }
                }}
                placeholder="Tulis pesan rahasia anonim... (Shift+Enter baris baru)"
                className="w-full bg-transparent text-white text-xs sm:text-sm focus:outline-none resize-none leading-relaxed max-h-24 placeholder:text-zinc-500 py-1"
                style={{ minHeight: '28px' }}
              />
            </div>
            <button
              type="submit"
              disabled={!anonInputMsg.trim()}
              className="w-11 h-11 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center transition-all shadow-lg disabled:opacity-30 active:scale-95 shrink-0"
              title="Kirim Pesan Anonim"
            >
              <i className="fas fa-paper-plane text-xs"></i>
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (isCreatingGroup) {
    const followingUserIds = currentUser?.following || [];
    // User can invite mutual followers or anyone they follow
    const eligibleUsers = users.filter(u => 
      u.id !== currentUser?.id && 
      (followingUserIds.includes(u.id) || (currentUser?.followers || []).includes(u.id) || isMutual(u.id))
    );

    const filteredUsers = eligibleUsers.filter(u => {
      if (!groupMemberSearchQuery.trim()) return true;
      const q = groupMemberSearchQuery.toLowerCase();
      return u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q));
    });

    return (
      <div className="fixed inset-0 z-[60] bg-white flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-xl mx-auto border-x border-neutral-200/80 shadow-2xl overflow-y-auto p-4 sm:p-6 pb-24 animate-fade-in select-text">
        <div className="max-w-xl mx-auto w-full flex flex-col flex-1">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => {
                  setIsCreatingGroup(false);
                  setGroupMemberSearchQuery('');
                  setSelectedForGroup([]);
                }} 
                className="text-black w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
              >
                <i className="fas fa-arrow-left"></i>
              </button>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tighter">Buat Grup Baru</h2>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Ruang Grup Baru</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 mb-5">
            <label className="text-[10px] font-black uppercase tracking-widest ml-1 text-gray-700">Nama Grup</label>
            <input 
              type="text" 
              placeholder="Contoh: Orbit Squad, Diskusi Kreatif..." 
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              className="w-full p-4 border-2 border-black rounded-2xl font-bold focus:outline-none focus:ring-2 focus:ring-black/10 transition-all text-sm"
            />
          </div>

          {/* Search Box for Followed Members */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2 px-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-700">
                Pilih Anggota yang Di-follow ({selectedForGroup.length} Dipilih)
              </label>
              {selectedForGroup.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedForGroup([])}
                  className="text-[10px] font-black text-red-500 hover:underline uppercase"
                >
                  Batal Pilih Semua
                </button>
              )}
            </div>

            <div className="relative">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                placeholder="Cari nama teman yang sudah di-follow..."
                value={groupMemberSearchQuery}
                onChange={(e) => setGroupMemberSearchQuery(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 pl-9 pr-9 py-2.5 rounded-2xl text-xs font-bold focus:outline-none focus:border-black focus:bg-white transition-all shadow-xs"
              />
              {groupMemberSearchQuery && (
                <button
                  type="button"
                  onClick={() => setGroupMemberSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black text-xs"
                >
                  <i className="fas fa-xmark"></i>
                </button>
              )}
            </div>
          </div>

          {/* Invitation Notice / Approval Rule Info */}
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-2xl flex items-center space-x-3 text-purple-900">
            <div className="w-8 h-8 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center shrink-0 text-xs font-bold">
              <i className="fas fa-bell"></i>
            </div>
            <p className="text-[11px] font-medium leading-snug">
              <span className="font-extrabold">Sistem Undangan:</span> Anggota yang dipilih akan menerima notifikasi undangan di akun mereka dan baru akan bergabung secara resmi setelah menekan tombol <span className="font-bold">Terima</span>.
            </p>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1 min-h-[180px]">
            {filteredUsers.length === 0 ? (
              <div className="text-center py-10 text-gray-400 italic text-xs px-6">
                {groupMemberSearchQuery ? `Tidak ada teman yang cocok dengan "${groupMemberSearchQuery}".` : 'Belum ada teman yang di-follow untuk ditambahkan.'}
              </div>
            ) : (
              filteredUsers.map(u => {
                const isSelected = selectedForGroup.includes(u.id);
                const isUserOnlineNow = isUserOnline(u.id);
                return (
                  <div 
                    key={u.id} 
                    onClick={() => toggleParticipantSelection(u.id)}
                    className={`flex items-center p-3 rounded-2xl border transition-all cursor-pointer select-none ${
                      isSelected ? 'border-black bg-black text-white shadow-md' : 'border-black/5 bg-gray-50 hover:bg-gray-100/80 hover:border-black/20'
                    }`}
                  >
                    <div className="relative shrink-0 mr-3">
                      <img src={u.photoURL} className="w-10 h-10 rounded-full border border-black/10 object-cover" alt={u.name} />
                      {isUserOnlineNow ? (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse" title="Online"></span>
                      ) : (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-xs sm:text-sm uppercase truncate ${isSelected ? 'text-white' : 'text-gray-900'}`}>{u.name}</p>
                      <p className={`text-[10px] font-medium truncate ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                        {isUserOnlineNow ? 'Online • Aktif' : 'Offline'}
                      </p>
                    </div>
                    <div className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                      isSelected ? 'border-white bg-white text-black' : 'border-black/20 bg-white text-transparent'
                    }`}>
                      <i className="fas fa-check text-[11px]"></i>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <button 
            onClick={handleCreateGroup}
            disabled={!groupName.trim() || selectedForGroup.length === 0}
            className="w-full bg-black text-white p-4 rounded-2xl font-black uppercase tracking-widest disabled:opacity-20 hover:opacity-90 transition-all shadow-lg active:scale-95 flex items-center justify-center space-x-2"
          >
            <i className="fas fa-paper-plane text-xs"></i>
            <span>Buat Grup & Kirim Undangan ({selectedForGroup.length})</span>
          </button>
          {renderConfirmModal()}
        </div>
      </div>
    );
  }

  if (isViewingGroupSettings && selectedRecipient?.type === 'group') {
    const group = selectedRecipient.data as Group;
    const isAdmin = currentUser && group.admins.includes(currentUser.id);
    const followingUserIds = currentUser?.following || [];
    
    // Eligible friends that currentUser follows
    const eligibleFriends = users.filter(u => 
      u.id !== currentUser?.id && 
      (followingUserIds.includes(u.id) || (currentUser?.followers || []).includes(u.id) || isMutual(u.id))
    );

    const pendingUserIds = group.pendingInvites ? Object.keys(group.pendingInvites) : [];
    
    // Friends who can be invited (not yet a participant and not currently in pending invites)
    const inviteableNonMembers = eligibleFriends.filter(u => !group.participants.includes(u.id) && !pendingUserIds.includes(u.id));
    const filteredInviteables = inviteableNonMembers.filter(u => {
      if (!addMemberSearch.trim()) return true;
      const q = addMemberSearch.toLowerCase();
      return u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q));
    });

    return (
      <div className="fixed inset-0 z-[60] bg-white flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-xl mx-auto border-x border-neutral-200/80 shadow-2xl overflow-y-auto p-4 sm:p-6 pb-24 animate-fade-in select-text">
        <div className="max-w-xl mx-auto w-full">
          <div className="flex items-center mb-8">
            <button onClick={() => setIsViewingGroupSettings(false)} className="mr-4 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
              <i className="fas fa-arrow-left"></i>
            </button>
            <h2 className="text-xl font-black uppercase tracking-tighter">Manajemen Grup</h2>
          </div>

          <div className="flex flex-col items-center mb-10">
            <div className="relative group mb-6">
              {group.photoURL ? (
                <img src={group.photoURL} className="w-32 h-32 rounded-full border-4 border-black object-cover shadow-xl" alt={group.name} />
              ) : (
                <div className="w-32 h-32 rounded-full bg-black text-white flex items-center justify-center text-4xl font-black border-4 border-black shadow-xl">
                  {group.name.substring(0, 1).toUpperCase()}
                </div>
              )}
              {isAdmin && (
                <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-sm">
                  <i className="fas fa-camera text-white text-2xl"></i>
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleGroupPhotoChange(group.id, e)} />
                </label>
              )}
            </div>

            {isAdmin ? (
              <div className="w-full space-y-6 px-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 ml-1">Group Name</label>
                  <input 
                    type="text" 
                    defaultValue={group.name} 
                    onBlur={(e) => updateGroupInfo(group.id, { name: e.target.value })}
                    className="w-full p-4 border-2 border-black rounded-2xl font-bold uppercase text-center focus:outline-none focus:ring-1 focus:ring-black"
                  />
                </div>
              </div>
            ) : (
              <h3 className="text-2xl font-black uppercase tracking-tight">{group.name}</h3>
            )}
          </div>

        {/* Section: Anggota Aktif */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4 px-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50">
              Anggota Aktif ({group.participants.length})
            </h4>
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              {group.participants.filter(pid => isUserOnline(pid)).length} Online
            </span>
          </div>
          <div className="space-y-2">
            {group.participants.map(pid => {
              const u = users.find(user => user.id === pid);
              if (!u) return null;
              const isUserAdmin = group.admins.includes(u.id);
              const isMemberOnline = isUserOnline(u.id);

              return (
                <div key={u.id} className="flex items-center p-3 bg-gray-50 rounded-2xl border border-transparent hover:border-black transition-all">
                  <div className="relative shrink-0 mr-3">
                    <img src={u.photoURL} className="w-10 h-10 rounded-full border border-black/10 object-cover" alt={u.name} />
                    {isMemberOnline ? (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse" title="Online"></span>
                    ) : (
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <p className="font-bold text-xs uppercase truncate">{u.name}</p>
                      {isUserAdmin && <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Admin</span>}
                    </div>
                    <p className="text-[9px] text-neutral-400 font-medium truncate">
                      {isMemberOnline ? 'Online • Aktif' : 'Offline'}
                    </p>
                  </div>
                  {isAdmin && u.id !== currentUser?.id && (
                    <div className="flex space-x-1">
                      {!isUserAdmin && (
                        <button 
                          onClick={() => handleRemoveMember(group.id, u.id)} 
                          className="w-8 h-8 flex items-center justify-center text-red-500 hover:bg-red-50 bg-white border border-red-500/20 rounded-full transition-all active:scale-95"
                          title="Keluarkan dari Grup"
                        >
                          <i className="fas fa-user-xmark text-xs"></i>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Section: Undangan Menunggu Konfirmasi / Persetujuan */}
        {pendingUserIds.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4 px-2">
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-800">
                Undangan Menunggu Persetujuan ({pendingUserIds.length})
              </h4>
              <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
                Pending
              </span>
            </div>
            <div className="space-y-2">
              {pendingUserIds.map(pid => {
                const u = users.find(user => user.id === pid);
                if (!u) return null;
                const isMemberOnline = isUserOnline(u.id);

                return (
                  <div key={u.id} className="flex items-center p-3 bg-purple-50/40 rounded-2xl border border-purple-200/60 transition-all">
                    <div className="relative shrink-0 mr-3">
                      <img src={u.photoURL} className="w-10 h-10 rounded-full border border-purple-300 object-cover opacity-80" alt={u.name} />
                      {isMemberOnline ? (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400" title="Online"></span>
                      ) : (
                        <span className="absolute bottom-0 right-0 w-3 h-3 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-xs uppercase truncate text-neutral-800">{u.name}</p>
                      <span className="inline-flex items-center space-x-1 text-[8px] font-black uppercase tracking-wider text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md mt-0.5">
                        <i className="fas fa-clock text-[7px]"></i>
                        <span>Menunggu Konfirmasi</span>
                      </span>
                    </div>
                    {isAdmin && (
                      <button 
                        onClick={() => handleCancelInvite(group.id, u.id)} 
                        className="px-3 py-1.5 bg-white text-red-600 hover:bg-red-50 border border-red-200 rounded-xl text-[10px] font-bold uppercase transition-all active:scale-95 flex items-center space-x-1"
                        title="Batalkan Undangan"
                      >
                        <i className="fas fa-xmark text-xs"></i>
                        <span>Batal</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section: Tambah Anggota (Cari Teman yang Di-follow & Kirim Undangan) */}
        {isAdmin && (
          <div className="mb-10">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] opacity-50 mb-3 px-2">
              Undang Teman yang Di-follow
            </h4>

            {/* Search Input for non-member friends */}
            <div className="relative mb-3">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                placeholder="Cari teman yang sudah di-follow..."
                value={addMemberSearch}
                onChange={(e) => setAddMemberSearch(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 pl-9 pr-9 py-2 rounded-2xl text-xs font-bold focus:outline-none focus:border-black focus:bg-white shadow-xs"
              />
              {addMemberSearch && (
                <button
                  type="button"
                  onClick={() => setAddMemberSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black text-xs"
                >
                  <i className="fas fa-xmark"></i>
                </button>
              )}
            </div>

            {filteredInviteables.length === 0 ? (
              <p className="text-center text-[10px] text-gray-400 uppercase font-bold py-4">
                {addMemberSearch ? `Tidak ada hasil pencarian "${addMemberSearch}".` : 'Semua teman yang Anda follow sudah berada di dalam grup atau telah diundang.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {filteredInviteables.map(u => {
                  const isUserOnlineNow = isUserOnline(u.id);
                  return (
                    <div key={u.id} className="flex items-center p-3 bg-gray-50 rounded-2xl border border-transparent hover:border-black transition-all">
                      <div className="relative shrink-0 mr-3">
                        <img src={u.photoURL} className="w-9 h-9 rounded-full border border-black/10 object-cover" alt={u.name} />
                        {isUserOnlineNow && (
                          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse"></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold uppercase truncate">{u.name}</p>
                        <p className="text-[9px] text-gray-400 font-medium truncate">
                          {isUserOnlineNow ? 'Online • Aktif' : 'Offline'}
                        </p>
                      </div>
                      <button 
                        onClick={() => handleInviteMember(group.id, u.id, group.name, group.photoURL)} 
                        className="px-3.5 py-1.5 bg-black hover:bg-neutral-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center space-x-1.5 transition-all active:scale-95 shadow-xs"
                        title="Kirim Undangan"
                      >
                        <i className="fas fa-paper-plane text-[9px]"></i>
                        <span>Undang</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <button 
          onClick={() => handleLeaveGroup(group.id)}
          className="w-full py-4 border-2 border-red-500 text-red-500 rounded-2xl font-black uppercase tracking-[0.2em] hover:bg-red-500 hover:text-white transition-all shadow-md active:scale-95 mb-10"
        >
          Keluar dari Grup
        </button>
        {renderConfirmModal()}
        </div>
      </div>
    );
  }

  if (!selectedRecipient) {
    return (
      <div className="p-3 sm:p-4 pb-28 min-h-full flex flex-col animate-fade-in relative max-w-xl mx-auto w-full">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-neutral-900">Kotak Masuk</h2>
            <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Obrolan Langsung & Grup</p>
          </div>
          <button 
            onClick={() => setIsCreatingGroup(true)}
            className="px-3.5 py-2 flex items-center space-x-1.5 bg-neutral-950 hover:bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95 cursor-pointer shrink-0"
            title="Buat Grup Baru"
          >
            <i className="fas fa-plus text-[9px] text-amber-400"></i>
            <span>Grup Baru</span>
          </button>
        </div>

        {/* NOTIFICATION PERMISSION BANNER */}
        {permissionStatus === 'default' && onRequestPermission && (
          <div className="mb-5 p-3.5 bg-gradient-to-r from-black via-gray-900 to-black text-white rounded-2xl shadow-lg border border-white/10 flex items-center justify-between space-x-3">
            <div className="flex items-center space-x-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-yellow-400 text-sm flex-shrink-0 animate-bounce">
                <i className="fas fa-bell"></i>
              </div>
              <div className="min-w-0">
                <p className="font-extrabold text-xs text-white truncate">Aktifkan Notifikasi Pop-Up</p>
                <p className="text-[10px] text-gray-300 leading-tight">Dapatkan bunyi chime & pop-up saat pesan baru masuk.</p>
              </div>
            </div>
            <button
              onClick={onRequestPermission}
              className="px-3.5 py-2 bg-white text-black text-[10px] font-black rounded-xl hover:bg-gray-200 transition-all flex-shrink-0 active:scale-95 shadow-md"
            >
              Aktifkan
            </button>
          </div>
        )}
        {permissionStatus === 'granted' && (
          <div className="mb-4 px-3.5 py-2 bg-green-50 border border-green-200 text-green-700 text-[10px] font-extrabold rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <i className="fas fa-circle-check text-green-600 text-xs"></i>
              <span>Notifikasi Chat & Pop-Up Browser Aktif</span>
            </div>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-ping"></span>
          </div>
        )}

        {/* 4 Tabs: Direct, Obrolan Toko, Collectives, Anonymous Match */}
        <div className="flex border-b-2 border-black/5 mb-6 overflow-x-auto scrollbar-none">
          <button 
            onClick={() => setActiveTab('direct')}
            className={`flex-1 min-w-[70px] py-3 text-[10px] font-black uppercase tracking-[0.1em] transition-all border-b-2 ${
              activeTab === 'direct' ? 'border-black text-black' : 'border-transparent text-gray-400'
            }`}
          >
            Direct
          </button>

          <button 
            onClick={() => setActiveTab('shop')}
            className={`flex-1 min-w-[110px] py-3 text-[10px] font-black uppercase tracking-[0.1em] transition-all border-b-2 flex items-center justify-center space-x-1.5 ${
              activeTab === 'shop' ? 'border-yellow-500 text-yellow-600 font-extrabold' : 'border-transparent text-gray-400'
            }`}
          >
            <i className="fas fa-store text-yellow-500 text-xs"></i>
            <span>Obrolan Toko</span>
          </button>

          <button 
            onClick={() => setActiveTab('groups')}
            className={`flex-1 min-w-[85px] py-3 text-[10px] font-black uppercase tracking-[0.1em] transition-all border-b-2 ${
              activeTab === 'groups' ? 'border-black text-black' : 'border-transparent text-gray-400'
            }`}
          >
            Grup
          </button>

          <button 
            onClick={() => setActiveTab('anonymous')}
            className={`flex-1 min-w-[90px] py-3 text-[10px] font-black uppercase tracking-[0.1em] transition-all border-b-2 flex items-center justify-center space-x-1 ${
              activeTab === 'anonymous' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-400'
            }`}
          >
            <i className="fas fa-user-ninja text-xs"></i>
            <span>{t('anon_match')}</span>
          </button>
        </div>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1">
          {activeTab === 'direct' && (
            <div className="space-y-4">
              {/* SEARCH BAR FOR FINDING ANYONE ON VIMOS */}
              <div className="relative">
                <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
                <input
                  type="text"
                  placeholder="Cari orang / nama pengguna untuk mulai chat..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full bg-white border border-neutral-200 pl-9 pr-8 py-2.5 rounded-2xl text-xs font-bold focus:outline-none focus:border-black shadow-xs"
                />
                {userSearchQuery && (
                  <button
                    onClick={() => setUserSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black text-xs"
                  >
                    <i className="fas fa-xmark"></i>
                  </button>
                )}
              </div>

              {/* CASE A: USER IS SEARCHING FOR PEOPLE */}
              {userSearchQuery.trim() ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
                      Hasil Pencarian ({users.filter(u => u.id !== currentUser?.id && ((u.name || '').toLowerCase().includes(userSearchQuery.toLowerCase()) || (u.email || '').toLowerCase().includes(userSearchQuery.toLowerCase()))).length})
                    </span>
                  </div>

                  {users.filter(u => u.id !== currentUser?.id && ((u.name || '').toLowerCase().includes(userSearchQuery.toLowerCase()) || (u.email || '').toLowerCase().includes(userSearchQuery.toLowerCase()))).length === 0 ? (
                    <div className="text-center py-10 bg-white rounded-3xl border border-neutral-200/80 p-6 space-y-2">
                      <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-lg mx-auto">
                        <i className="fas fa-user-slash"></i>
                      </div>
                      <p className="text-xs font-bold text-neutral-800">Tidak ada pengguna ditemukan</p>
                      <p className="text-[10px] text-neutral-500">Coba cari dengan nama atau username lain.</p>
                    </div>
                  ) : (
                    users.filter(u => u.id !== currentUser?.id && ((u.name || '').toLowerCase().includes(userSearchQuery.toLowerCase()) || (u.email || '').toLowerCase().includes(userSearchQuery.toLowerCase()))).map(u => {
                      const uOnline = isUserOnline(u.id);
                      const isMutualUser = isMutual(u.id);
                      const isFollowed = (currentUser?.following || []).includes(u.id);

                      return (
                        <div key={u.id} className="flex items-center border border-neutral-200/90 rounded-2xl hover:border-black transition-all group p-3 bg-white shadow-xs">
                          <div className="relative shrink-0 mr-3">
                            <img 
                              src={u.photoURL} 
                              className="w-11 h-11 rounded-full border border-neutral-200 bg-neutral-100 cursor-pointer object-cover shadow-xs" 
                              alt={u.name} 
                              onClick={() => onUserClick(u.id)}
                            />
                            {uOnline ? (
                              <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse" title="Online"></span>
                            ) : (
                              <span className="absolute bottom-0 right-0 w-3 h-3 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                            )}
                          </div>
                          <div className="flex-1 text-left min-w-0 mr-2">
                            <div className="flex items-center space-x-1.5">
                              <p 
                                onClick={() => onUserClick(u.id)}
                                className="font-extrabold text-xs uppercase text-neutral-900 truncate hover:underline cursor-pointer"
                              >
                                {u.name}
                              </p>
                              {isMutualUser ? (
                                <span className="text-[8px] font-black uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-md shrink-0">
                                  Mutual Follow
                                </span>
                              ) : isFollowed ? (
                                <span className="text-[8px] font-bold bg-neutral-100 text-neutral-600 px-1.5 py-0.2 rounded-md shrink-0">
                                  Menunggu Follow Balik
                                </span>
                              ) : (
                                <span className="text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded-md shrink-0">
                                  Belum Saling Follow
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-neutral-400 font-semibold truncate mt-0.5">
                              {uOnline ? '🟢 Online Sekarang' : getUserLastSeenText(u.id)}
                            </p>
                          </div>

                          {(() => {
                            const isChatRestricted = Boolean(u.onlyMutualChat || currentUser?.onlyMutualChat);
                            const canChat = Boolean(isMutualUser || currentUser?.isAdmin || u.isAdmin || !isChatRestricted);

                            if (canChat) {
                              return (
                                <button 
                                  onClick={() => setSelectedRecipient({ type: 'user', data: u })}
                                  className="px-3.5 py-1.5 bg-neutral-950 hover:bg-black text-white text-[10px] font-black uppercase rounded-xl transition-all shadow-xs active:scale-95 flex items-center space-x-1.5 shrink-0 cursor-pointer"
                                >
                                  <i className="fas fa-paper-plane text-[9px] text-amber-400"></i>
                                  <span>Chat</span>
                                </button>
                              );
                            }

                            return (
                              <button 
                                onClick={() => onUserClick(u.id)}
                                className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[10px] font-black uppercase rounded-xl transition-all shadow-2xs flex items-center space-x-1.5 shrink-0 cursor-pointer border border-neutral-200"
                                title={u.onlyMutualChat ? `${u.name} membatasi chat hanya untuk yang saling mengikuti` : 'Anda membatasi chat hanya untuk saling mengikuti'}
                              >
                                <i className="fas fa-lock text-[9px] text-neutral-400"></i>
                                <span>Ikuti Akun</span>
                              </button>
                            );
                          })()}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                /* CASE B: NOT SEARCHING -> SHOW ACTIVE CONVERSATIONS & CONTACTS */
                <div className="space-y-4">
                  {/* SECTION 1: PERCAKAPAN AKTIF (CONVERSATION THREADS) */}
                  {loadingThreads ? (
                    <div className="py-8 text-center space-y-2">
                      <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="text-[11px] font-bold text-neutral-400">Memuat obrolan...</p>
                    </div>
                  ) : directChatThreads.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
                          Percakapan ({directChatThreads.length})
                        </span>
                      </div>

                      {directChatThreads.map((thread) => {
                        const otherOnline = isUserOnline(thread.otherUser.id);
                        const isMyLastMsg = thread.lastMessageSenderId === currentUser?.id;
                        return (
                          <div 
                            key={thread.chatId} 
                            onClick={() => setSelectedRecipient({ type: 'user', data: thread.otherUser })}
                            className="flex items-center border border-neutral-200/90 hover:border-black rounded-2xl transition-all group p-3.5 bg-white shadow-xs cursor-pointer select-none"
                          >
                            <div className="relative shrink-0 mr-3.5">
                              <img 
                                src={thread.otherUser.photoURL} 
                                className="w-12 h-12 rounded-full border border-neutral-200 bg-neutral-100 object-cover shadow-xs" 
                                alt={thread.otherUser.name} 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUserClick(thread.otherUser.id);
                                }}
                              />
                              {otherOnline ? (
                                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse shadow-xs" title="Online"></span>
                              ) : (
                                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                              )}
                            </div>

                            <div className="flex-1 text-left min-w-0 mr-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-1.5 truncate">
                                  <p className="font-extrabold text-xs sm:text-sm uppercase text-neutral-900 truncate">
                                    {thread.otherUser.name}
                                  </p>
                                  {thread.isShop && (
                                    <span className="bg-yellow-400 text-black text-[7px] font-black uppercase px-1.5 py-0.2 rounded-md shrink-0">
                                      Toko
                                    </span>
                                  )}
                                </div>
                                {thread.timestamp > 0 && (
                                  <span className="text-[9px] font-semibold text-neutral-400 ml-2 shrink-0">
                                    {formatChatTimestamp(thread.timestamp)}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center justify-between mt-1">
                                <p className={`text-[11px] truncate max-w-[220px] sm:max-w-xs ${
                                  thread.unreadCount > 0 ? 'font-bold text-neutral-900' : 'text-neutral-500 font-medium'
                                }`}>
                                  {isMyLastMsg ? (
                                    <span className="text-neutral-400 font-normal">Anda: </span>
                                  ) : null}
                                  {thread.lastMessage}
                                </p>

                                {thread.unreadCount > 0 && (
                                  <span className="px-2 py-0.5 bg-black text-white text-[9px] font-black rounded-full shrink-0 shadow-xs ml-2">
                                    {thread.unreadCount}
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={(e) => handleClearDirectUserChat(thread.otherUser.id, e)}
                              className="p-2 text-neutral-300 hover:text-red-600 hover:bg-red-50 rounded-full text-xs transition-colors shrink-0 cursor-pointer"
                              title="Hapus riwayat obrolan"
                            >
                              <i className="fas fa-trash-can"></i>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-16 bg-neutral-50 rounded-3xl border border-neutral-200/80 p-6 space-y-3">
                      <div className="w-12 h-12 rounded-full bg-neutral-200/70 text-neutral-600 flex items-center justify-center text-lg mx-auto shadow-inner">
                        <i className="fas fa-comments"></i>
                      </div>
                      <h4 className="font-black text-xs uppercase text-neutral-900">Belum Ada Obrolan</h4>
                      <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                        Ketik nama pengguna di kolom pencarian di atas untuk memulai percakapan.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'shop' && (
            <div className="space-y-4">
              {/* Banner Info Obrolan Toko */}
              <div className="bg-gradient-to-r from-amber-50 via-yellow-100 to-amber-100 border border-yellow-300 rounded-3xl p-4 shadow-sm flex items-center space-x-3">
                <div className="w-12 h-12 rounded-2xl bg-yellow-400 text-black flex items-center justify-center text-xl shrink-0 shadow-md">
                  <i className="fas fa-comments-dollar"></i>
                </div>
                <div>
                  <h3 className="font-black text-xs uppercase text-gray-900">Obrolan Toko & Jual Beli</h3>
                  <p className="text-[11px] text-gray-600 font-medium leading-tight mt-0.5">
                    Tanya jawab seputar barang, penawaran harga, & kesepakatan transaksi langsung dengan penjual atau pembeli!
                  </p>
                </div>
              </div>

              {/* Search Seller / Buyer */}
              <div className="relative">
                <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input
                  type="text"
                  placeholder="Cari penjual atau pembeli di Vimos..."
                  value={shopSearchQuery}
                  onChange={(e) => setShopSearchQuery(e.target.value)}
                  className="w-full bg-white border border-gray-200 pl-9 pr-4 py-2.5 rounded-2xl text-xs font-bold focus:outline-none focus:border-black shadow-sm"
                />
              </div>

              {/* List of Active Shop Chats */}
              <div className="space-y-2">
                {shopChatThreads.filter(thread => (
                  !shopSearchQuery || 
                  thread.otherUser.name.toLowerCase().includes(shopSearchQuery.toLowerCase()) || 
                  thread.lastMessage.toLowerCase().includes(shopSearchQuery.toLowerCase())
                )).length === 0 ? (
                  <div className="bg-white rounded-3xl border border-gray-200 p-8 text-center space-y-3 my-4">
                    <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-2xl mx-auto shadow-sm">
                      <i className="fas fa-store-slash"></i>
                    </div>
                    <h3 className="font-extrabold text-sm text-gray-900 uppercase">Belum Ada Obrolan Toko</h3>
                    <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                      Obrolan jual beli dengan penjual atau pembeli akan otomatis muncul di sini begitu Anda menanyakan atau membeli produk dari Toko Vimos.
                    </p>
                  </div>
                ) : (
                  shopChatThreads
                    .filter(thread => (
                      !shopSearchQuery || 
                      thread.otherUser.name.toLowerCase().includes(shopSearchQuery.toLowerCase()) || 
                      thread.lastMessage.toLowerCase().includes(shopSearchQuery.toLowerCase())
                    ))
                    .map(thread => {
                      const otherOnline = isUserOnline(thread.otherUser.id);
                      return (
                      <div 
                        key={thread.chatId} 
                        className="flex items-center border border-gray-200 rounded-2xl hover:border-black transition-all group p-3.5 bg-white shadow-sm cursor-pointer"
                        onClick={() => setSelectedRecipient({ type: 'user', data: thread.otherUser })}
                      >
                        <div className="relative shrink-0 mr-3.5">
                          <img 
                            src={thread.otherUser.photoURL} 
                            className="w-12 h-12 rounded-full border border-black/10 bg-gray-100 object-cover shadow-sm" 
                            alt={thread.otherUser.name} 
                            onClick={(e) => {
                              e.stopPropagation();
                              onUserClick(thread.otherUser.id);
                            }}
                          />
                          {otherOnline ? (
                            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white ring-1 ring-emerald-400 animate-pulse shadow-xs" title="Online"></span>
                          ) : (
                            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-neutral-300 rounded-full border-2 border-white" title="Offline"></span>
                          )}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5 truncate">
                              <p className="font-extrabold text-xs uppercase text-gray-900 truncate">{thread.otherUser.name}</p>
                              {otherOnline ? (
                                <span className="inline-flex items-center space-x-0.5 px-1.5 py-0.2 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[7px] font-extrabold shrink-0">
                                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                  <span>Online</span>
                                </span>
                              ) : (
                                <span className="bg-neutral-100 text-neutral-500 text-[7px] font-semibold uppercase px-1.5 py-0.2 rounded shrink-0">
                                  Offline
                                </span>
                              )}
                              <span className="bg-yellow-400 text-black text-[8px] font-black uppercase px-2 py-0.5 rounded-full shrink-0">
                                <i className="fas fa-store text-[8px] mr-1"></i>Toko
                              </span>
                            </div>
                            {thread.timestamp > 0 && (
                              <span className="text-[9px] text-gray-400 font-medium ml-2 shrink-0">
                                {new Date(thread.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-600 font-medium truncate mt-1">
                            {thread.lastMessageSenderId === currentUser?.id ? 'Anda: ' : ''}{thread.lastMessage}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRecipient({ type: 'user', data: thread.otherUser });
                          }}
                          className="bg-black hover:bg-gray-800 text-white text-[10px] font-black uppercase px-3 py-1.5 rounded-full shadow-sm ml-2 shrink-0 transition-all active:scale-95 flex items-center space-x-1"
                        >
                          <i className="fas fa-comment-dots text-[10px]"></i>
                          <span>Chat</span>
                        </button>
                        <button
                          onClick={(e) => handleDeleteShopChatThread(thread.chatId, e)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full text-xs transition-colors ml-1"
                          title="Hapus obrolan toko ini"
                        >
                          <i className="fas fa-trash-can"></i>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'groups' && (
            <div className="space-y-3">
              {groups.length > 0 && (
                <div className="relative">
                  <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
                  <input
                    type="text"
                    placeholder="Cari grup Anda..."
                    value={collectiveSearchQuery}
                    onChange={(e) => setCollectiveSearchQuery(e.target.value)}
                    className="w-full bg-white border border-neutral-200 pl-9 pr-8 py-2.5 rounded-2xl text-xs font-bold focus:outline-none focus:border-black shadow-xs"
                  />
                  {collectiveSearchQuery && (
                    <button
                      onClick={() => setCollectiveSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black text-xs"
                    >
                      <i className="fas fa-xmark"></i>
                    </button>
                  )}
                </div>
              )}

              {groups.length === 0 ? (
                <div className="text-center py-16 bg-neutral-50 rounded-3xl border border-neutral-200/80 p-6 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-neutral-200 text-neutral-600 flex items-center justify-center text-xl mx-auto shadow-inner">
                    <i className="fas fa-users-viewfinder"></i>
                  </div>
                  <h4 className="font-extrabold text-sm uppercase text-neutral-900">Belum Ada Grup</h4>
                  <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                    Buat grup obrolan baru bersama teman-teman yang Anda follow dengan menekan tombol plus di pojok kanan atas.
                  </p>
                  <button
                    onClick={() => setIsCreatingGroup(true)}
                    className="px-4 py-2.5 bg-neutral-950 hover:bg-black text-white text-xs font-black uppercase rounded-2xl shadow-md transition-all active:scale-95"
                  >
                    + Buat Grup Baru
                  </button>
                </div>
              ) : groups.filter(g => !collectiveSearchQuery || (g.name || '').toLowerCase().includes(collectiveSearchQuery.toLowerCase())).length === 0 ? (
                <div className="text-center py-10 bg-white rounded-3xl border border-neutral-200 p-6">
                  <p className="text-xs font-bold text-neutral-800">Grup "{collectiveSearchQuery}" tidak ditemukan</p>
                </div>
              ) : (
                groups
                  .filter(g => !collectiveSearchQuery || (g.name || '').toLowerCase().includes(collectiveSearchQuery.toLowerCase()))
                  .map(g => (
                    <div key={g.id} className="flex items-center border border-neutral-200/90 rounded-2xl hover:border-black transition-all group p-3.5 bg-white shadow-xs">
                      {g.photoURL ? (
                        <img src={g.photoURL} className="w-12 h-12 rounded-2xl mr-3.5 border border-neutral-200 object-cover shadow-xs" alt={g.name} />
                      ) : (
                        <div className="w-12 h-12 rounded-2xl mr-3.5 bg-neutral-950 text-white flex items-center justify-center text-base font-black border border-neutral-800 shadow-xs">
                          {g.name.substring(0, 1).toUpperCase()}
                        </div>
                      )}
                      <button 
                        onClick={() => setSelectedRecipient({ type: 'group', data: g })}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="font-extrabold text-xs sm:text-sm uppercase text-neutral-900 truncate">{g.name}</p>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase tracking-widest mt-0.5">
                          {g.participants.length} Anggota Orbit
                        </p>
                      </button>
                      <i className="fas fa-chevron-right text-neutral-300 group-hover:text-black transition-colors"></i>
                    </div>
                  ))
              )}
            </div>
          )}

          {activeTab === 'anonymous' && (
            <div className="flex flex-col items-center justify-center p-6 text-center space-y-6 my-auto">
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-red-600 via-zinc-900 to-black p-1 shadow-2xl flex items-center justify-center">
                  <div className="w-full h-full bg-zinc-950 rounded-full flex items-center justify-center text-4xl text-red-500 border border-red-500/30">
                    <i className={`fas ${isSearchingAnon ? 'fa-spinner fa-spin' : 'fa-user-ninja'}`}></i>
                  </div>
                </div>
                {isSearchingAnon && (
                  <span className="absolute inset-0 rounded-full border-2 border-red-500 animate-ping"></span>
                )}
              </div>

              <div className="space-y-2 max-w-sm">
                <h3 className="text-xl font-black uppercase tracking-tight text-black">
                  Obrolan Anonim Acak
                </h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  Cari teman bicara secara acak tanpa nampak foto maupun nama asli Anda. Jika Anda dan lawan bicara sama-sama tertarik, tekan tombol <span className="font-black text-red-600">Follow</span> untuk mengungkap profil masing-masing!
                </p>
              </div>

              {isSearchingAnon ? (
                <div className="space-y-4 w-full max-w-xs">
                  <div className="p-3 bg-red-50 border border-red-300 rounded-2xl text-xs font-black uppercase tracking-wider text-red-600 animate-pulse">
                    🔍 {t('anon_searching')}
                  </div>
                  <button
                    onClick={handleCancelSearch}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-black p-3.5 rounded-2xl font-black uppercase text-xs tracking-wider border border-black/10 transition-all active:scale-95"
                  >
                    {t('anon_cancel')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleFindAnonMatch}
                  className="w-full max-w-xs bg-red-600 hover:bg-red-700 text-white p-4 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl hover:shadow-2xl transition-all active:scale-95 flex items-center justify-center space-x-2"
                >
                  <i className="fas fa-dice text-base"></i>
                  <span>{t('anon_find')}</span>
                </button>
              )}
            </div>
          )}
        </div>
        {renderConfirmModal()}
      </div>
    );
  }

  const headerTitle = selectedRecipient.type === 'user' 
    ? (selectedRecipient.data as User).name 
    : (selectedRecipient.data as Group).name;

  const headerPhoto = selectedRecipient.type === 'user' 
    ? (selectedRecipient.data as User).photoURL 
    : (selectedRecipient.data as Group).photoURL;

  const activeGroupCall = selectedRecipient.type === 'group'
    ? activeCalls.find(c => 
        c.type === 'collective' && 
        c.status !== 'ended' && 
        c.groupId === selectedRecipient.data.id
      )
    : null;

  return (
    <div className="fixed inset-0 z-[60] bg-[#f8fafc] flex flex-col h-[100dvh] max-h-[100dvh] w-full max-w-xl mx-auto border-x border-neutral-200/80 shadow-2xl overflow-hidden select-text animate-fade-in">
      <div className="p-3 sm:p-4 border-b border-black/10 flex items-center justify-between space-x-3 bg-white/95 backdrop-blur-md sticky top-0 z-20 shadow-xs">
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
          <button 
            onClick={() => setSelectedRecipient(null)} 
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-800 transition-all active:scale-95 cursor-pointer shrink-0"
            title="Kembali ke Daftar Obrolan"
          >
            <i className="fas fa-arrow-left text-sm sm:text-base"></i>
          </button>
          
          <div className="relative shrink-0">
            {headerPhoto ? (
              <img 
                src={headerPhoto} 
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gray-100 cursor-pointer object-cover border border-black/10 shadow-xs ring-2 ring-black/5" 
                alt={headerTitle} 
                onClick={() => selectedRecipient.type === 'user' ? onUserClick((selectedRecipient.data as User).id) : setIsViewingGroupSettings(true)}
              />
            ) : (
              <div 
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black text-white flex items-center justify-center text-sm font-black cursor-pointer shadow-xs"
                onClick={() => setIsViewingGroupSettings(true)}
              >
                {headerTitle.substring(0, 1).toUpperCase()}
              </div>
            )}
            {selectedRecipient.type === 'user' ? (
              isUserOnline((selectedRecipient.data as User).id) ? (
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-white ring-2 ring-emerald-400 shadow-sm animate-pulse" title="Online"></span>
              ) : (
                <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-neutral-400 rounded-full border-2 border-white ring-1 ring-neutral-300" title="Offline"></span>
              )
            ) : (
              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-black text-white rounded-full flex items-center justify-center text-[8px] border border-white">
                <i className="fas fa-users"></i>
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1.5">
              <h3 
                className="font-black text-sm sm:text-base uppercase tracking-tight truncate cursor-pointer hover:underline text-neutral-900"
                onClick={() => selectedRecipient.type === 'user' ? onUserClick((selectedRecipient.data as User).id) : setIsViewingGroupSettings(true)}
              >
                {headerTitle}
              </h3>
              {selectedRecipient.type === 'group' && (
                <span className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded text-[9px] font-black text-neutral-600 uppercase shrink-0">
                  Grup
                </span>
              )}
            </div>
            <p className="text-[10px] sm:text-[11px] font-medium text-neutral-500 truncate flex items-center space-x-1">
              {selectedRecipient.type === 'group' ? (
                <span className="cursor-pointer hover:text-black font-semibold" onClick={() => setIsViewingGroupSettings(true)}>
                  {(selectedRecipient.data as Group).participants.length} Anggota • Klik info grup
                </span>
              ) : (
                isUserOnline((selectedRecipient.data as User).id) ? (
                  <span className="text-emerald-600 flex items-center space-x-1.5 font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    <span>{t('status_online_active')}</span>
                  </span>
                ) : (
                  <span className="text-neutral-500 flex items-center space-x-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full bg-neutral-400 inline-block"></span>
                    <span>{getUserLastSeenText((selectedRecipient.data as User).id)}</span>
                  </span>
                )
              )}
            </p>
          </div>
        </div>

        {/* Right Action Icons */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
          {selectedRecipient.type === 'user' ? (() => {
            const otherUser = selectedRecipient.data as User;
            const isShop = activeTab === 'shop' || (selectedRecipient.data as any).isShop;
            const isChatRestricted = Boolean(otherUser.onlyMutualChat || currentUser?.onlyMutualChat);
            const isMutualWithRecipient = isMutual(otherUser.id);
            const canCall = Boolean(currentUser?.isAdmin || otherUser.isAdmin || isShop || !isChatRestricted || isMutualWithRecipient);

            return (
              <>
                {onStartCall && (
                  <>
                    <button
                      onClick={() => {
                        if (!canCall) {
                          alert(otherUser.onlyMutualChat ? `${otherUser.name} membatasi panggilan hanya untuk akun yang saling mengikuti.` : 'Anda mengaktifkan batasan panggilan hanya untuk mutual follow.');
                          return;
                        }
                        onStartCall('private', 'audio', otherUser.id);
                      }}
                      className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-colors ${
                        canCall 
                          ? 'hover:bg-neutral-100 text-neutral-700 hover:text-black cursor-pointer' 
                          : 'text-neutral-300 hover:bg-neutral-50 cursor-pointer opacity-60'
                      }`}
                      title={canCall ? t('start_voice_call') : 'Panggilan dibatasi untuk mutual follow'}
                    >
                      <i className="fas fa-phone text-xs sm:text-sm"></i>
                    </button>
                    <button
                      onClick={() => {
                        if (!canCall) {
                          alert(otherUser.onlyMutualChat ? `${otherUser.name} membatasi panggilan hanya untuk akun yang saling mengikuti.` : 'Anda mengaktifkan batasan panggilan hanya untuk mutual follow.');
                          return;
                        }
                        onStartCall('private', 'video', otherUser.id);
                      }}
                      className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-colors ${
                        canCall 
                          ? 'hover:bg-neutral-100 text-neutral-700 hover:text-black cursor-pointer' 
                          : 'text-neutral-300 hover:bg-neutral-50 cursor-pointer opacity-60'
                      }`}
                      title={canCall ? t('start_video_call') : 'Panggilan dibatasi untuk mutual follow'}
                    >
                      <i className="fas fa-video text-xs sm:text-sm"></i>
                    </button>
                  </>
                )}
                <button
                  onClick={handleClearChatForMe}
                  className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-red-50 text-neutral-400 hover:text-red-600 transition-colors cursor-pointer"
                  title="Hapus Obrolan untuk Saya"
                >
                  <i className="fas fa-trash-can text-xs sm:text-sm"></i>
                </button>
              </>
            );
          })() : (
            <>
              {activeGroupCall ? (
                <button 
                  onClick={() => onJoinCall && onJoinCall(activeGroupCall.id)}
                  className="px-3 sm:px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-xs font-black uppercase tracking-wider flex items-center space-x-1.5 animate-pulse shadow-md"
                >
                  <i className="fas fa-phone text-[10px]"></i>
                  <span className="hidden sm:inline">{t('join_call')}</span>
                </button>
              ) : (
                onStartCall && (
                  <>
                    <button
                      onClick={() => onStartCall('collective', 'audio', (selectedRecipient.data as Group).id, (selectedRecipient.data as Group).name)}
                      className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-700 hover:text-black transition-colors"
                      title={t('start_voice_call')}
                    >
                      <i className="fas fa-phone text-xs sm:text-sm"></i>
                    </button>
                    <button
                      onClick={() => onStartCall('collective', 'video', (selectedRecipient.data as Group).id, (selectedRecipient.data as Group).name)}
                      className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-700 hover:text-black transition-colors"
                      title={t('start_video_call')}
                    >
                      <i className="fas fa-video text-xs sm:text-sm"></i>
                    </button>
                  </>
                )
              )}
              <button
                onClick={handleClearChatForMe}
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-red-50 text-neutral-400 hover:text-red-600 transition-colors"
                title="Hapus Obrolan untuk Saya"
              >
                <i className="fas fa-trash-can text-xs sm:text-sm"></i>
              </button>
              <button 
                onClick={() => setIsViewingGroupSettings(true)} 
                className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 text-neutral-700 hover:text-black transition-colors"
                title="Pengaturan Grup"
              >
                <i className="fas fa-ellipsis-vertical text-xs sm:text-sm"></i>
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Backdrop overlay for active message options menu */}
      {activeMenuMsgId && (
        <div 
          className="fixed inset-0 z-20 bg-transparent" 
          onClick={() => setActiveMenuMsgId(null)} 
        />
      )}

      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 bg-[#f1f3f7] overscroll-contain">
        <div className="w-full flex-1 flex flex-col min-h-full">
          <div className="flex-1 min-h-[10px]" />
          {isLoadingMessages ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3 my-auto">
            <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
            <span className="text-[11px] font-bold text-neutral-400">Memuat pesan...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-16 px-4 my-auto">
            <div className="w-16 h-16 rounded-full bg-neutral-200 flex items-center justify-center mx-auto mb-3 text-neutral-500 text-2xl shadow-inner">
              <i className={selectedRecipient.type === 'group' ? "fas fa-comments" : "fas fa-comment-dots"}></i>
            </div>
            <h4 className="font-black text-sm text-neutral-800 uppercase tracking-tight">
              {selectedRecipient.type === 'group' ? `Grup ${headerTitle}` : `Obrolan dengan ${headerTitle}`}
            </h4>
            <p className="text-xs text-neutral-400 mt-1 max-w-xs mx-auto">
              Belum ada pesan dalam obrolan ini. Tulis pesan atau kirim foto pertama di bawah!
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === currentUser?.id;
            const sender = users.find(u => u.id === m.senderId);
            const isMenuOpen = activeMenuMsgId === m.id;

            return (
              <div key={m.id} className={`flex flex-col group relative ${isMe ? 'items-end' : 'items-start animate-fade-in'}`}>
                {!isMe && selectedRecipient.type === 'group' && (
                  <span className="text-[8px] font-black uppercase tracking-widest mb-1 ml-1 opacity-40">{sender?.name || 'Orbit'}</span>
                )}
                
                <div className="flex items-center space-x-2 max-w-[85%] relative">
                  {/* Action menu button for sent messages */}
                  {isMe && (
                    <div className="relative shrink-0 z-30">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuMsgId(isMenuOpen ? null : m.id);
                        }}
                        className="opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-black p-1.5 text-xs rounded-full hover:bg-gray-200"
                        title="Opsi Pesan"
                      >
                        <i className="fas fa-ellipsis-v"></i>
                      </button>

                      {isMenuOpen && (
                        <div className="absolute right-0 bottom-full mb-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl py-1.5 px-2 z-30 min-w-[170px] space-y-1 text-left animate-fade-in">
                          <button
                            onClick={(e) => handleDeleteMessageForMe(m.id, e)}
                            className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors"
                          >
                            <i className="fas fa-trash-can text-xs"></i>
                            <span>Hapus untuk Saya</span>
                          </button>
                          <button
                            onClick={(e) => handleDeleteMessageForEveryone(m.id, e)}
                            className="w-full text-left px-3 py-2 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors"
                          >
                            <i className="fas fa-trash-arrow-up text-xs"></i>
                            <span>Hapus untuk Semua</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message Bubble - Tapping opens option menu */}
                  <div 
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuMsgId(isMenuOpen ? null : m.id);
                    }}
                    className={`p-3.5 sm:p-4 rounded-3xl text-sm font-medium shadow-sm transition-all cursor-pointer hover:scale-[1.01] max-w-full ${
                      isMe ? 'bg-black text-white rounded-br-none' : 'bg-white border border-black/5 text-black rounded-bl-none'
                    }`}
                  >
                    {/* Photo Attachment in Chat Bubble */}
                    {(m.photoURL || (m.mediaType === 'image' && m.mediaURL)) && (
                      <div 
                        className="relative group/media overflow-hidden rounded-2xl mb-2 cursor-pointer max-w-sm bg-zinc-900"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFullscreenMedia({
                            url: m.photoURL || m.mediaURL || '',
                            type: 'image',
                            caption: m.text,
                            senderName: sender?.name || (isMe ? currentUser?.name : 'Teman'),
                            timestamp: m.timestamp
                          });
                        }}
                      >
                        <img 
                          src={m.photoURL || m.mediaURL} 
                          alt="Foto Obrolan" 
                          className="w-full max-h-72 object-cover rounded-2xl transition-transform duration-300 group-hover/media:scale-105"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover/media:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover/media:opacity-100">
                          <span className="bg-black/75 text-white text-[10px] font-black px-3 py-1.5 rounded-full flex items-center space-x-1.5 backdrop-blur-sm shadow-md">
                            <i className="fas fa-expand"></i>
                            <span>Buka Foto</span>
                          </span>
                        </div>
                        {m.fileSize && (
                          <span className="absolute bottom-2 left-2 bg-black/60 text-white text-[9px] font-bold px-2 py-0.5 rounded-md backdrop-blur-sm">
                            {m.fileSize}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Video Attachment in Chat Bubble */}
                    {(m.videoURL || (m.mediaType === 'video' && m.mediaURL)) && (
                      <div 
                        className="relative rounded-2xl overflow-hidden mb-2 max-w-sm bg-black border border-white/10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <video 
                          src={m.videoURL || m.mediaURL} 
                          controls 
                          playsInline 
                          preload="metadata"
                          className="w-full max-h-72 rounded-t-2xl bg-black object-contain"
                        />
                        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 text-[10px] text-zinc-300">
                          <div className="flex items-center space-x-1.5 truncate">
                            <i className="fas fa-video text-red-500"></i>
                            <span className="font-bold truncate">{m.fileName || 'Video'}</span>
                          </div>
                          <button 
                            onClick={() => setFullscreenMedia({
                              url: m.videoURL || m.mediaURL || '',
                              type: 'video',
                              caption: m.text,
                              senderName: sender?.name || (isMe ? currentUser?.name : 'Teman'),
                              timestamp: m.timestamp
                            })}
                            className="text-white hover:text-red-400 text-xs px-2 py-0.5 rounded transition-colors shrink-0 ml-2"
                            title="Tonton Layar Penuh"
                          >
                            <i className="fas fa-expand mr-1"></i>Layar Penuh
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Text Message / Caption */}
                    {m.text && (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {m.text}
                      </p>
                    )}

                    {/* Timestamp & double check mark */}
                    <div className={`flex items-center justify-end space-x-1.5 mt-1 text-[9px] font-medium ${isMe ? 'text-zinc-400' : 'text-gray-400'}`}>
                      <span>
                        {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                      {isMe && (
                        (() => {
                          let isRead = false;
                          if (selectedRecipient.type === 'user') {
                            const otherUserId = (selectedRecipient.data as User).id;
                            const otherUserSafeId = getSafeKey(otherUserId);
                            isRead = Boolean(m.read === true || (m.readBy && m.readBy[otherUserSafeId]));
                          } else if (selectedRecipient.type === 'group') {
                            const safeMyId = getSafeKey(currentUser.id);
                            isRead = Boolean(m.readBy && Object.keys(m.readBy).some(k => k !== safeMyId));
                          }

                          return (
                            <span className="inline-flex items-center" title={isRead ? "Sudah dibaca (Read)" : "Terkirim (Sent)"}>
                              {isRead ? (
                                <i className="fas fa-check-double text-[9px] text-sky-400 font-bold"></i>
                              ) : (
                                <i className="fas fa-check-double text-[9px] text-zinc-400 opacity-60"></i>
                              )}
                            </span>
                          );
                        })()
                      )}
                    </div>
                  </div>

                  {/* Action menu button for received messages */}
                  {!isMe && (
                    <div className="relative shrink-0 z-30">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuMsgId(isMenuOpen ? null : m.id);
                        }}
                        className="opacity-60 sm:opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-black p-1.5 text-xs rounded-full hover:bg-gray-200"
                        title="Opsi Pesan"
                      >
                        <i className="fas fa-ellipsis-v"></i>
                      </button>

                      {isMenuOpen && (
                        <div className="absolute left-0 bottom-full mb-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl py-1.5 px-2 z-30 min-w-[170px] text-left animate-fade-in">
                          <button
                            onClick={(e) => handleDeleteMessageForMe(m.id, e)}
                            className="w-full text-left px-3 py-2 hover:bg-red-50 text-red-600 rounded-xl text-xs font-bold flex items-center space-x-2 transition-colors"
                          >
                            <i className="fas fa-trash-can text-xs"></i>
                            <span>Hapus untuk Saya</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Typing Indicator Bubble */}
        {Object.keys(typingUsers).length > 0 && (
          <div className="flex items-center space-x-2 mt-2 ml-1 animate-fade-in">
            <div className="flex space-x-2 items-center bg-white border border-neutral-200/80 rounded-2xl px-3.5 py-2.5 shadow-xs max-w-fit">
              <div className="flex space-x-1 shrink-0">
                <span className="w-1.5 h-1.5 bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-neutral-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-neutral-600 rounded-full animate-bounce"></span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-tight text-neutral-500 pl-1.5">
                {Object.keys(typingUsers)
                  .map(uid => users.find(u => u.id === uid)?.name || 'Seseorang')
                  .join(', ')}{' '}
                sedang mengetik...
              </span>
            </div>
          </div>
        )}
        </div>
        {/* Bottom anchor for auto scroll */}
        <div ref={chatBottomRef} className="h-1" />
      </div>

      {/* Bottom Input Area Container */}
      <div className="w-full bg-white/95 backdrop-blur-md border-t border-neutral-200/90 p-3 sm:p-4 sticky bottom-0 z-20 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
        <div className="max-w-4xl mx-auto w-full space-y-2.5">
          {/* Media Attachment Preview Bar if Photo or Video is selected */}
          {selectedMedia && (
            <div className="px-4 py-2.5 bg-zinc-950 text-white rounded-2xl border border-zinc-800 flex items-center justify-between space-x-3 animate-fade-in shadow-inner">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-black border border-white/20 shrink-0 shadow-md">
                  {selectedMedia.type === 'image' ? (
                    <img src={selectedMedia.url} alt="Pratinjau Foto" className="w-full h-full object-cover" />
                  ) : (
                    <video src={selectedMedia.url} className="w-full h-full object-cover" />
                  )}
                  <span className={`absolute top-0.5 right-0.5 text-[8px] font-black px-1.5 py-0.2 rounded-md uppercase text-white shadow-xs ${selectedMedia.type === 'image' ? 'bg-blue-600' : 'bg-red-600'}`}>
                    {selectedMedia.type === 'image' ? 'Foto' : 'Video'}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-1.5">
                    <i className={`fas ${selectedMedia.type === 'image' ? 'fa-image text-blue-400' : 'fa-video text-red-400'} text-xs`}></i>
                    <p className="text-xs font-black text-white truncate max-w-[180px] sm:max-w-xs">
                      {selectedMedia.name || (selectedMedia.type === 'image' ? 'Foto Terlampir' : 'Video Terlampir')}
                    </p>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">
                    {selectedMedia.size ? `Ukuran: ${selectedMedia.size}` : 'Siap dikirim'} • Tekan tombol kirim atau tambahkan pesan
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setSelectedMedia(null)}
                className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-red-600 text-zinc-300 hover:text-white flex items-center justify-center transition-all text-xs shrink-0 active:scale-90 cursor-pointer"
                title="Batalkan Lampiran"
              >
                <i className="fas fa-xmark"></i>
              </button>
            </div>
          )}

          {/* Processing Spinner Indicator */}
          {isProcessingMedia && (
            <div className="px-4 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200 rounded-2xl text-xs font-black flex items-center space-x-2 animate-pulse">
              <i className="fas fa-spinner fa-spin text-blue-600"></i>
              <span>Memproses foto / video berkualitas tinggi...</span>
            </div>
          )}

          {/* Check whether user is allowed to chat (must be mutual followers if restricted) */}
          {(() => {
            const isRecipientShop = activeTab === 'shop' || (selectedRecipient.data as any)?.isShop;
            const targetUserData = selectedRecipient.type === 'user' ? (selectedRecipient.data as User) : null;
            const isChatRestricted = targetUserData ? Boolean(targetUserData.onlyMutualChat || currentUser?.onlyMutualChat) : false;
            const isRecipientMutual = targetUserData ? isMutual(targetUserData.id) : true;
            const canChat = Boolean(
              selectedRecipient.type === 'group' ||
              currentUser?.isAdmin ||
              targetUserData?.isAdmin ||
              isRecipientShop ||
              !isChatRestricted ||
              isRecipientMutual
            );

            if (!canChat && targetUserData) {
              return (
                <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-3xl text-center space-y-2.5 shadow-xs animate-fade-in">
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto text-sm shadow-2xs">
                    <i className="fas fa-lock"></i>
                  </div>
                  <div>
                    <h4 className="font-black text-xs uppercase tracking-tight text-neutral-900">
                      Obrolan Dibatasi
                    </h4>
                    <p className="text-[11px] text-neutral-600 max-w-sm mx-auto mt-0.5 leading-relaxed">
                      {targetUserData.onlyMutualChat 
                        ? `${targetUserData.name} membatasi pesan hanya untuk akun yang saling mengikuti (mutual follow).` 
                        : 'Anda mengaktifkan batasan pesan hanya untuk akun yang saling mengikuti.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUserClick(targetUserData.id)}
                    className="px-5 py-2 bg-black hover:bg-neutral-800 text-white text-xs font-black uppercase tracking-wider rounded-2xl transition-all shadow-xs cursor-pointer active:scale-95 inline-flex items-center space-x-1.5"
                  >
                    <i className="fas fa-user-plus text-[10px] text-amber-400"></i>
                    <span>Kunjungi Profil & Ikuti {targetUserData.name}</span>
                  </button>
                </div>
              );
            }

            return (
              <form onSubmit={handleSend} className="flex items-center space-x-2 sm:space-x-3">
                {/* Hidden inputs for media upload */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  accept="image/*,video/*" 
                  onChange={(e) => handleFileSelect(e)} 
                  className="hidden" 
                />
                <input 
                  type="file" 
                  ref={cameraInputRef} 
                  accept="image/*" 
                  capture="environment" 
                  onChange={(e) => handleFileSelect(e, 'image')} 
                  className="hidden" 
                />

                {/* Attachment Button for Gallery / File */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-neutral-100 hover:bg-black hover:text-white text-neutral-700 flex items-center justify-center transition-all active:scale-95 shadow-xs shrink-0 cursor-pointer"
                  title="Kirim Foto atau Video"
                >
                  <i className="fas fa-photo-film text-sm"></i>
                </button>

                {/* Camera Snapshot Button */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-neutral-100 hover:bg-black hover:text-white text-neutral-700 flex items-center justify-center transition-all active:scale-95 shadow-xs shrink-0 cursor-pointer"
                  title="Ambil Foto dengan Kamera"
                >
                  <i className="fas fa-camera text-sm"></i>
                </button>

                {/* Multiline Text Input */}
                <div className="flex-1 min-w-0 flex items-center bg-neutral-100 border border-neutral-300 focus-within:border-black focus-within:bg-white rounded-2xl sm:rounded-3xl px-4 py-1.5 focus-within:ring-2 focus-within:ring-black/10 transition-all shadow-inner">
                  <textarea 
                    ref={chatTextareaRef}
                    rows={1}
                    value={msg}
                    onChange={e => handleInputChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        if (window.innerWidth >= 768 || e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          handleSend(e);
                        }
                      }
                    }}
                    placeholder={selectedMedia ? "Tambahkan keterangan / caption..." : "Ketik pesan..."}
                    className="w-full bg-transparent text-sm focus:outline-none resize-none leading-relaxed max-h-28 placeholder:text-neutral-400 py-1"
                    style={{ minHeight: '28px' }}
                  />
                </div>

                {/* Send Button */}
                <button 
                  type="submit" 
                  disabled={!msg.trim() && !selectedMedia}
                  className="w-10 h-10 sm:w-11 sm:h-11 bg-black text-white rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg disabled:opacity-20 shrink-0 cursor-pointer"
                  title="Kirim Pesan"
                >
                  <i className="fas fa-paper-plane text-xs sm:text-sm"></i>
                </button>
              </form>
            );
          })()}
        </div>
      </div>

      {/* FULLSCREEN LIGHTBOX / MEDIA VIEWER MODAL */}
      {fullscreenMedia && (
        <div 
          className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-fade-in"
          onClick={() => setFullscreenMedia(null)}
        >
          {/* Header */}
          <div className="w-full max-w-4xl flex items-center justify-between py-2 text-white z-10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${fullscreenMedia.type === 'image' ? 'bg-blue-600' : 'bg-red-600'}`}>
                <i className={`fas ${fullscreenMedia.type === 'image' ? 'fa-image' : 'fa-video'} text-sm`}></i>
              </div>
              <div>
                <p className="font-extrabold text-sm text-white">{fullscreenMedia.senderName || 'Media Obrolan'}</p>
                <p className="text-[10px] text-zinc-400">
                  {fullscreenMedia.timestamp ? new Date(fullscreenMedia.timestamp).toLocaleString() : 'Vimos Media'}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <a 
                href={fullscreenMedia.url} 
                download={`vimos_${fullscreenMedia.type}_${Date.now()}.${fullscreenMedia.type === 'image' ? 'jpg' : 'mp4'}`}
                className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-md"
                onClick={(e) => e.stopPropagation()}
                title="Unduh Media"
              >
                <i className="fas fa-download text-xs"></i>
                <span className="hidden sm:inline">Unduh</span>
              </a>
              <button 
                onClick={() => setFullscreenMedia(null)}
                className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-red-600 text-white flex items-center justify-center transition-colors text-base"
                title="Tutup"
              >
                <i className="fas fa-xmark"></i>
              </button>
            </div>
          </div>

          {/* Content Center */}
          <div className="flex-1 flex items-center justify-center max-w-4xl w-full my-auto overflow-hidden p-2" onClick={(e) => e.stopPropagation()}>
            {fullscreenMedia.type === 'image' ? (
              <img 
                src={fullscreenMedia.url} 
                alt="Layar Penuh" 
                className="max-h-[75vh] max-w-full object-contain rounded-2xl shadow-2xl ring-1 ring-white/10 animate-scale-up" 
              />
            ) : (
              <video 
                src={fullscreenMedia.url} 
                controls 
                autoPlay 
                playsInline 
                className="max-h-[75vh] max-w-full rounded-2xl shadow-2xl ring-1 ring-white/10 animate-scale-up bg-black"
              />
            )}
          </div>

          {/* Footer / Caption */}
          {fullscreenMedia.caption && (
            <div className="w-full max-w-2xl bg-zinc-900/90 text-white rounded-2xl p-4 border border-white/10 text-center text-xs font-medium z-10 animate-fade-in shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="whitespace-pre-wrap">{fullscreenMedia.caption}</p>
            </div>
          )}
        </div>
      )}

      {/* CUSTOM CONFIRMATION MODAL POP-UP FOR CHATS */}
      {renderConfirmModal()}
    </div>
  );
};

export default Chat;
