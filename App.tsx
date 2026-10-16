
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, User, Post, Comment, UserNotification, Announcement, Story, GlobalSound } from './types.ts';
import Header from './components/Header.tsx';
import Navbar from './components/Navbar.tsx';
import Feed from './components/Feed.tsx';
import PostCreator from './components/PostCreator.tsx';
import Leaderboard from './components/Leaderboard.tsx';
import Chat from './components/Chat.tsx';
import Profile from './components/Profile.tsx';
import Notifications from './components/Notifications.tsx';
import Reels from './components/Reels.tsx';
import AuthScreen from './components/AuthScreen.tsx';
import AdminPanel from './components/AdminPanel.tsx';
import Shop from './components/Shop.tsx';
import SinglePostView from './components/SinglePostView.tsx';
import { auth, db } from './firebase.ts';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, onValue, set, update, push, remove, query, limitToLast, get, onDisconnect, serverTimestamp, Unsubscribe as DBUnsubscribe } from 'firebase/database';
import { useLanguage } from './LanguageContext.tsx';
import CallingOverlay, { ActiveCall } from './components/CallingOverlay.tsx';
import { HeadsUpNotification, IncomingMessagePayload, playChatNotificationSound } from './components/HeadsUpNotification.tsx';
import { initialPosts, initialUsers } from './services/mockData.ts';
import { INITIAL_GLOBAL_SOUNDS, extractYouTubeId } from './services/youtubeMusic.ts';

// List Admin King
const ADMIN_EMAILS = ['nwaystore68@gmail.com', 'nwaystore78@gmail.com', 'nocteos609@gmail.com', 'hasbullahbeloh27@gmail.com'];

export default function App() {
  const { t } = useLanguage();
  const [currentView, setCurrentView] = useState<View>(View.FEED);
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem('vimos_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [loadingPosts, setLoadingPosts] = useState<boolean>(true);
  const [isSyncingFirebase, setIsSyncingFirebase] = useState<boolean>(false);
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const stored = localStorage.getItem('vimos_users');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [userStatuses, setUserStatuses] = useState<Record<string, { state: 'online' | 'offline'; last_changed?: number }>>({});
  const [posts, setPosts] = useState<Post[]>([]);
  const [globalSounds, setGlobalSounds] = useState<GlobalSound[]>(() => {
    try {
      const stored = localStorage.getItem('vimos_sounds');
      return stored ? JSON.parse(stored) : INITIAL_GLOBAL_SOUNDS;
    } catch { return INITIAL_GLOBAL_SOUNDS; }
  });
  const [stories, setStories] = useState<Story[]>(() => {
    try {
      const stored = localStorage.getItem('vimos_stories');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>(() => {
    try {
      const stored = localStorage.getItem('vimos_announcements');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('post') || null;
    } catch {
      return null;
    }
  });
  const [bannedMessage, setBannedMessage] = useState<string | null>(null);
  const [targetChatUserId, setTargetChatUserId] = useState<string | null>(null);
  const [targetChatGroupId, setTargetChatGroupId] = useState<string | null>(null);
  const [initialChatMessage, setInitialChatMessage] = useState<string | null>(null);

  // Real-time Heads-Up & Audio Chat Notification States
  const [incomingChatPayload, setIncomingChatPayload] = useState<IncomingMessagePayload | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  const seenChatMsgIdsRef = useRef<Set<string>>(new Set());
  const mountTimeRef = useRef<number>(Date.now());

  const requestNotifPermission = () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then(perm => {
        setNotifPermission(perm);
        if (perm === 'granted') {
          playChatNotificationSound();
        }
      });
    }
  };

  // Post Deletion Confirmation Modal State
  const [postToDelete, setPostToDelete] = useState<Post | null>(null);

  // Back Button Navigation & Exit Confirmation States
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const [isAppExited, setIsAppExited] = useState(false);

  // Active Chat Subview / Conversation State (Hides bottom Navbar & top Header when chatting)
  const [isChatConversationActive, setIsChatConversationActive] = useState<boolean>(false);
  const isChatConversationActiveRef = useRef<boolean>(false);
  useEffect(() => { isChatConversationActiveRef.current = isChatConversationActive; }, [isChatConversationActive]);
  const chatBackHandlerRef = useRef<(() => boolean) | null>(null);

  // Shop Keep-Alive state for instant 0ms transitions
  const [hasVisitedShop, setHasVisitedShop] = useState<boolean>(false);
  useEffect(() => {
    if (currentView === View.SHOP && !hasVisitedShop) {
      setHasVisitedShop(true);
    }
  }, [currentView, hasVisitedShop]);

  const currentViewRef = useRef<View>(currentView);
  useEffect(() => { currentViewRef.current = currentView; }, [currentView]);

  const selectedPostIdRef = useRef<string | null>(selectedPostId);
  useEffect(() => { selectedPostIdRef.current = selectedPostId; }, [selectedPostId]);

  const selectedProfileIdRef = useRef<string | null>(selectedProfileId);
  useEffect(() => { selectedProfileIdRef.current = selectedProfileId; }, [selectedProfileId]);

  const currentCallRef = useRef<ActiveCall | null>(currentCall);
  useEffect(() => { currentCallRef.current = currentCall; }, [currentCall]);

  const isExitConfirmOpenRef = useRef<boolean>(isExitConfirmOpen);
  useEffect(() => { isExitConfirmOpenRef.current = isExitConfirmOpen; }, [isExitConfirmOpen]);

  const currentUserRef = useRef<User | null>(currentUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  const userUnsubscribeRef = useRef<DBUnsubscribe | null>(null);

  const isEmailAdmin = (email?: string | null) => {
    if (!email) return false;
    return ADMIN_EMAILS.some(e => e.toLowerCase() === email.toLowerCase());
  };

  useEffect(() => {
    // Fast safety timer so user isn't stuck on loading screen
    const safetyTimer = setTimeout(() => {
      setAuthLoading(false);
    }, 50);

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (userUnsubscribeRef.current) {
        userUnsubscribeRef.current();
        userUnsubscribeRef.current = null;
      }

      if (user) {
        const isMasterEmailAdmin = isEmailAdmin(user.email);
        const fallbackAccountName = user.displayName || (user.email ? user.email.split('@')[0] : 'Member');
        
        // Optimistically set currentUser to avoid loading screen
        setCurrentUser(prev => {
          const updated = prev || {
            id: user.uid,
            name: fallbackAccountName,
            email: user.email || '',
            bio: 'A wandering soul in Vimos.',
            photoURL: user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.uid}&backgroundColor=000000`,
            followers: [],
            following: [],
            recentCaptures: [],
            totalLikes: 0,
            isAdmin: isMasterEmailAdmin
          };
          try { localStorage.setItem('vimos_user', JSON.stringify(updated)); } catch {}
          return updated;
        });
        setAuthLoading(false);

        const userRef = ref(db, `users/${user.uid}`);
        
        userUnsubscribeRef.current = onValue(userRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (data.isBanned) {
              setBannedMessage(t('banned_msg'));
              signOut(auth);
              try { localStorage.removeItem('vimos_user'); } catch {}
              return;
            }
            
            const effectiveIsAdmin = Boolean(
              isMasterEmailAdmin || 
              data.isAdmin === true || 
              data.role === 'Admin' || 
              data.role === 'Super Admin' || 
              data.role === 'Co-Admin'
            );

            if (isMasterEmailAdmin && !data.isAdmin) {
              update(userRef, { isAdmin: true });
            }

            const cleanName = (!data.name || data.name === 'Anonymous Shadow' || data.name === 'Anonymous Orbit' || data.name === 'Anonymous' || data.name === 'Member') 
              ? fallbackAccountName 
              : data.name;

            if (cleanName !== data.name) {
              update(userRef, { name: cleanName });
            }

            if (user.photoURL && (!data.photoURL || data.photoURL.includes('dicebear'))) {
              update(userRef, { photoURL: user.photoURL });
            }

            const accountCreatedAt = data.createdAt || (user.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : Date.now());
            if (!data.createdAt) {
              update(userRef, { createdAt: accountCreatedAt });
            }

            const activeUserData = { 
              id: user.uid, 
              ...data,
              createdAt: accountCreatedAt,
              name: cleanName,
              isAdmin: effectiveIsAdmin,
              followers: data.followers ? Object.keys(data.followers) : [],
              following: data.following ? Object.keys(data.following) : [],
              recentCaptures: data.recentCaptures ? Object.values(data.recentCaptures) : []
            };
            setCurrentUser(activeUserData);
            try { localStorage.setItem('vimos_user', JSON.stringify(activeUserData)); } catch {}
          } else {
            const initialCreatedAt = user.metadata.creationTime ? new Date(user.metadata.creationTime).getTime() : Date.now();
            const newUser = {
              name: fallbackAccountName,
              email: user.email || '',
              bio: 'A wandering soul in Vimos.',
              photoURL: user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.uid}&backgroundColor=000000`,
              followers: {},
              following: {},
              recentCaptures: {},
              totalLikes: 0,
              isAdmin: isMasterEmailAdmin,
              createdAt: initialCreatedAt,
              lastSeen: Date.now()
            };
            set(userRef, newUser);
            const formattedUser = {
              id: user.uid,
              ...newUser,
              followers: [],
              following: [],
              recentCaptures: []
            };
            setCurrentUser(formattedUser);
            try { localStorage.setItem('vimos_user', JSON.stringify(formattedUser)); } catch {}
          }
        }, (err) => console.warn('User listener error:', err));
      } else {
        setCurrentUser(null);
        setCurrentView(View.FEED);
        setSelectedProfileId(null);
        setAuthLoading(false);
        try { localStorage.removeItem('vimos_user'); } catch {}
      }
    });

    return () => {
      clearTimeout(safetyTimer);
      unsubscribeAuth();
      if (userUnsubscribeRef.current) userUnsubscribeRef.current();
    };
  }, []);

  const triggerAllDataRefresh = () => {
    const postsQuery = query(ref(db, 'posts'), limitToLast(100));
    const storiesQuery = query(ref(db, 'stories'), limitToLast(40));
    const usersQuery = ref(db, 'users');
    const annQuery = query(ref(db, 'announcements'), limitToLast(15));

    get(postsQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data && Object.keys(data).length > 0) {
        const postList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          likes: val.likes ? Object.keys(val.likes) : [],
          dislikes: val.dislikes ? Object.keys(val.dislikes) : [],
          comments: val.comments ? Object.entries(val.comments).map(([cid, cval]: [string, any]) => ({ id: cid, ...cval })) : []
        }));
        const sorted = postList.sort((a, b) => b.timestamp - a.timestamp);
        setPosts(sorted);
      }
    }).catch(() => {});

    get(usersQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const userList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          followers: val.followers ? Object.keys(val.followers) : [],
          following: val.following ? Object.keys(val.following) : [],
          recentCaptures: val.recentCaptures ? Object.values(val.recentCaptures) : [],
          isAdmin: isEmailAdmin(val.email)
        }));
        setUsers(userList);
        usersRef.current = userList;
      }
    }).catch(() => {});

    get(storiesQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const storyList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        }));
        setStories(storyList.sort((a, b) => b.createdAt - a.createdAt));
      }
    }).catch(() => {});

    get(annQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const annList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        }));
        setAnnouncements(annList.sort((a, b) => b.timestamp - a.timestamp));
      }
    }).catch(() => {});

    if (currentUser?.id) {
      const notifQuery = query(ref(db, `notifications/${currentUser.id}`), limitToLast(40));
      get(notifQuery).then((snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.entries(data).map(([id, val]: [string, any]) => ({
            id,
            ...val
          })).sort((a, b) => b.timestamp - a.timestamp);
          setNotifications(list);
        }
      }).catch(() => {});
    }

    performAutomatedDatabaseCleanup();
  };

  // Automated Database Maintenance & Cleanup (30-day inactive user purge & 30-day non-shop post purge)
  const performAutomatedDatabaseCleanup = async () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      // 0. Purge legacy mock/template posts and mock users from Firebase
      remove(ref(db, 'posts/p1')).catch(() => {});
      remove(ref(db, 'posts/p2')).catch(() => {});
      remove(ref(db, 'posts/p3')).catch(() => {});
      remove(ref(db, 'users/u1')).catch(() => {});
      remove(ref(db, 'users/u2')).catch(() => {});
      remove(ref(db, 'users/u3')).catch(() => {});

      // 1. Purge posts older than 30 days EXCEPT shop posts
      const postsSnap = await get(ref(db, 'posts'));
      if (postsSnap.exists()) {
        const postsData = postsSnap.val();
        Object.entries(postsData).forEach(([postId, postVal]: [string, any]) => {
          const postTime = Number(postVal?.timestamp || postVal?.createdAt || 0);
          const isShopPost = Boolean(
            postVal?.isShop === true || 
            postVal?.isStore === true || 
            postVal?.type === 'shop' || 
            postVal?.type === 'product' || 
            postVal?.isProduct === true ||
            postVal?.price !== undefined
          );
          if (postTime > 0 && (now - postTime) > THIRTY_DAYS_MS && !isShopPost) {
            remove(ref(db, `posts/${postId}`)).catch(() => {});
          }
        });
      }

      // 2. Purge inactive user accounts (not online for 30 days) from Firebase
      const usersSnap = await get(ref(db, 'users'));
      const statusSnap = await get(ref(db, 'status'));
      const statusData = statusSnap.exists() ? statusSnap.val() : {};

      if (usersSnap.exists()) {
        const usersData = usersSnap.val();
        Object.entries(usersData).forEach(([userId, userVal]: [string, any]) => {
          // Do NOT purge master admin email accounts
          if (userVal?.email && ADMIN_EMAILS.some(e => e.toLowerCase() === userVal.email.toLowerCase())) {
            return;
          }

          const userStatus = statusData[userId];
          const statusLastChanged = Number(userStatus?.last_changed || 0);
          const userLastSeen = Number(userVal?.lastSeen || 0);
          const userCreatedAt = Number(userVal?.createdAt || userVal?.timestamp || 0);

          const lastActive = Math.max(statusLastChanged, userLastSeen, userCreatedAt);

          if (lastActive > 0 && (now - lastActive) > THIRTY_DAYS_MS) {
            // Remove user account node, presence status, and notifications from Firebase
            remove(ref(db, `users/${userId}`)).catch(() => {});
            remove(ref(db, `status/${userId}`)).catch(() => {});
            remove(ref(db, `notifications/${userId}`)).catch(() => {});

            // If current logged-in user is purged due to 30 days inactivity
            if (currentUserRef.current?.id === userId) {
              signOut(auth).catch(() => {});
              try { localStorage.removeItem('vimos_user'); } catch {}
              setCurrentUser(null);
            }
          }
        });
      }
    } catch (err) {
      console.warn('Automated DB cleanup error:', err);
    }
  };

  // Run automated database cleanup on mount and periodically every 5 minutes
  useEffect(() => {
    performAutomatedDatabaseCleanup();
    const cleanupInterval = setInterval(() => {
      performAutomatedDatabaseCleanup();
    }, 5 * 60 * 1000);
    return () => clearInterval(cleanupInterval);
  }, []);

  // Realtime Presence / Online-Offline Status Management for currentUser
  useEffect(() => {
    if (!currentUser?.id) return;
    const uid = currentUser.id;
    const userStatusDatabaseRef = ref(db, `status/${uid}`);
    const connectedRef = ref(db, '.info/connected');

    const markOnline = () => {
      set(userStatusDatabaseRef, {
        state: 'online',
        last_changed: serverTimestamp()
      }).catch(() => {});
      update(ref(db, `users/${uid}`), {
        lastSeen: Date.now()
      }).catch(() => {});
    };

    const markOffline = () => {
      set(userStatusDatabaseRef, {
        state: 'offline',
        last_changed: serverTimestamp()
      }).catch(() => {});
    };

    const unsubConnected = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        onDisconnect(userStatusDatabaseRef)
          .set({
            state: 'offline',
            last_changed: serverTimestamp()
          })
          .then(() => {
            if (document.visibilityState === 'visible') {
              markOnline();
              triggerAllDataRefresh();
            } else {
              markOffline();
            }
          })
          .catch(() => {});
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markOnline();
        triggerAllDataRefresh();
      } else {
        markOffline();
      }
    };

    const handleFocus = () => {
      markOnline();
      triggerAllDataRefresh();
    };

    const handlePageHide = () => {
      markOffline();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    // High-speed Automated Background refresh loop (every 10 seconds)
    const backgroundRefreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        triggerAllDataRefresh();
      }
    }, 10000);

    return () => {
      unsubConnected();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      clearInterval(backgroundRefreshInterval);
      markOffline();
    };
  }, [currentUser?.id]);

  // Sync global users presence status from Firebase
  useEffect(() => {
    const statusRef = ref(db, 'status');
    const unsubStatus = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setUserStatuses(data);
      } else {
        setUserStatuses({});
      }
    }, (err) => console.warn('User status sync error:', err));

    return () => unsubStatus();
  }, []);

  const usersRef = useRef<User[]>(users);
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  // Smart Back-Button Navigation Controller
  useEffect(() => {
    // Ensure initial state exists in history
    try {
      if (!window.history.state || !window.history.state.orbit_app) {
        window.history.replaceState({ orbit_app: true, layer: 0 }, '');
        window.history.pushState({ orbit_app: true, layer: 1 }, '');
      }
    } catch {}

    const handlePopState = () => {
      // 0. If in active chat conversation or subview, hardware Back button returns to chat inbox first
      if (currentViewRef.current === View.CHAT && isChatConversationActiveRef.current) {
        if (chatBackHandlerRef.current && chatBackHandlerRef.current()) {
          try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
          return;
        }
      }

      // 1. If Exit Confirmation Modal is already showing, pressing back closes the modal
      if (isExitConfirmOpenRef.current) {
        setIsExitConfirmOpen(false);
        try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
        return;
      }

      // 2. If Single Post Deep Link / Modal is open, close it back to feed
      if (selectedPostIdRef.current) {
        setSelectedPostId(null);
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete('post');
          window.history.replaceState({ orbit_app: true, layer: 1 }, '', url.toString());
          window.history.pushState({ orbit_app: true, layer: 1 }, '', url.toString());
        } catch {
          try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
        }
        return;
      }

      // 3. If viewing someone else's profile, return to Home (Feed)
      if (selectedProfileIdRef.current && currentUserRef.current && selectedProfileIdRef.current !== currentUserRef.current.id) {
        setSelectedProfileId(null);
        setCurrentView(View.FEED);
        try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
        return;
      }

      // 4. If on any tab other than Home (Feed) (e.g. Reels, Shop, Chat, Notifications, Profile, Admin, Leaderboard, Post)
      if (currentViewRef.current !== View.FEED) {
        setCurrentView(View.FEED);
        setSelectedProfileId(null);
        setTargetChatUserId(null);
        setTargetChatGroupId(null);
        setSearchTerm('');
        try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
        return;
      }

      // 5. If ALREADY on Home (Feed) with no subviews/modals -> Prompt confirmation to exit
      setIsExitConfirmOpen(true);
      try { window.history.pushState({ orbit_app: true, layer: 1 }, ''); } catch {}
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    const postsQuery = query(ref(db, 'posts'), limitToLast(100));
    const storiesQuery = query(ref(db, 'stories'), limitToLast(40));
    const usersQuery = ref(db, 'users');
    const annQuery = query(ref(db, 'announcements'), limitToLast(15));

    // Fast direct fetch for immediate first paint without waiting for full stream handshake
    get(postsQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data && Object.keys(data).length > 0) {
        const postList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          likes: val.likes ? Object.keys(val.likes) : [],
          dislikes: val.dislikes ? Object.keys(val.dislikes) : [],
          comments: val.comments ? Object.entries(val.comments).map(([cid, cval]: [string, any]) => ({ id: cid, ...cval })) : []
        }));
        const sorted = postList.sort((a, b) => b.timestamp - a.timestamp);
        setPosts(sorted);
        try { localStorage.setItem('vimos_posts', JSON.stringify(sorted.slice(0, 20))); } catch {}
        setLoadingPosts(false);
      }
    }).catch(() => {});

    get(usersQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const userList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          followers: val.followers ? Object.keys(val.followers) : [],
          following: val.following ? Object.keys(val.following) : [],
          recentCaptures: val.recentCaptures ? Object.values(val.recentCaptures) : [],
          isAdmin: isEmailAdmin(val.email)
        }));
        setUsers(userList);
        usersRef.current = userList;
        try { localStorage.setItem('vimos_users', JSON.stringify(userList.slice(0, 30))); } catch {}
      }
    }).catch(() => {});

    const postLoadingTimer = setTimeout(() => {
      setLoadingPosts(false);
    }, 600);

    const unsubscribePosts = onValue(postsQuery, (snapshot) => {
      const data = snapshot.val();
      if (data && Object.keys(data).length > 0) {
        const postList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          likes: val.likes ? Object.keys(val.likes) : [],
          dislikes: val.dislikes ? Object.keys(val.dislikes) : [],
          comments: val.comments ? Object.entries(val.comments).map(([cid, cval]: [string, any]) => ({ id: cid, ...cval })) : []
        }));
        
        setPosts(prev => {
          const uniqueMap = new Map();
          // Insert Firebase snapshot posts
          postList.forEach(p => uniqueMap.set(p.id, p));
          // Preserve any local optimistic posts that are still pending sync
          prev.forEach(p => {
            if (!uniqueMap.has(p.id)) {
              uniqueMap.set(p.id, p);
            }
          });
          const sorted = Array.from(uniqueMap.values()).sort((a, b) => b.timestamp - a.timestamp);
          try { localStorage.setItem('vimos_posts', JSON.stringify(sorted.slice(0, 25))); } catch {}
          return sorted;
        });
        setLoadingPosts(false);
      } else {
        setPosts([]);
        try { localStorage.removeItem('vimos_posts'); } catch {}
      }
      setLoadingPosts(false);
    }, (err) => {
      console.warn('Posts listener error:', err);
      setLoadingPosts(false);
    });

    const unsubscribeStories = onValue(storiesQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const validStories: Story[] = [];
        
        Object.entries(data).forEach(([id, val]: [string, any]) => {
          const created = val.createdAt || (val.timestamp || now);
          if (now - created < twentyFourHours) {
            validStories.push({ 
              id, 
              ...val, 
              createdAt: created, 
              expiresAt: val.expiresAt || (created + twentyFourHours) 
            });
          } else {
            remove(ref(db, `stories/${id}`)).catch(() => {});
          }
        });
        const sorted = validStories.sort((a, b) => b.createdAt - a.createdAt);
        setStories(sorted);
        try { localStorage.setItem('vimos_stories', JSON.stringify(sorted)); } catch {}
      } else {
        setStories([]);
      }
    }, (err) => console.warn('Stories listener error:', err));

    const unsubscribeUsers = onValue(usersQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const userList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          followers: val.followers ? Object.keys(val.followers) : [],
          following: val.following ? Object.keys(val.following) : [],
          recentCaptures: val.recentCaptures ? Object.values(val.recentCaptures) : [],
          isAdmin: isEmailAdmin(val.email)
        }));
        setUsers(userList);
        usersRef.current = userList;
        try { localStorage.setItem('vimos_users', JSON.stringify(userList.slice(0, 30))); } catch {}
      }
    }, (err) => console.warn('Users listener error:', err));

    const unsubscribeAnn = onValue(annQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const annList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        }));
        const sorted = annList.sort((a, b) => b.timestamp - a.timestamp);
        setAnnouncements(sorted);
        try { localStorage.setItem('vimos_announcements', JSON.stringify(sorted)); } catch {}
      } else {
        setAnnouncements([]);
      }
    }, (err) => console.warn('Announcements listener error:', err));

    const soundsQuery = query(ref(db, 'sounds'), limitToLast(60));
    const unsubscribeSounds = onValue(soundsQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const soundList: GlobalSound[] = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        }));
        // Sort sounds by use count and added date
        const sortedSounds = soundList.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        setGlobalSounds(sortedSounds);
        try { localStorage.setItem('vimos_sounds', JSON.stringify(sortedSounds)); } catch {}
      } else {
        // Initialize Firebase sounds collection with initial sounds
        INITIAL_GLOBAL_SOUNDS.forEach((snd) => {
          set(ref(db, `sounds/${snd.id}`), {
            id: snd.id,
            title: snd.title,
            author: snd.author,
            url: snd.url,
            thumbnailUrl: snd.thumbnailUrl,
            duration: snd.duration,
            sourceType: snd.sourceType,
            youtubeId: (snd as any).youtubeId || null,
            startTime: snd.startTime || 0,
            endTime: snd.endTime || (snd.startTime ? snd.startTime + 30 : 30),
            useCount: snd.useCount || 1,
            addedByUserName: snd.addedByUserName || 'Vimos Sound Lab',
            createdAt: snd.createdAt || Date.now()
          });
        });
      }
    }, (err) => console.warn('Sounds listener error:', err));

    return () => {
      clearTimeout(postLoadingTimer);
      unsubscribePosts();
      unsubscribeStories();
      unsubscribeUsers();
      unsubscribeAnn();
      unsubscribeSounds();
    };
  }, []);

  const refreshFirebasePosts = async () => {
    setIsSyncingFirebase(true);
    try {
      const snapshot = await get(query(ref(db, 'posts'), limitToLast(30)));
      const data = snapshot.val();
      if (data && Object.keys(data).length > 0) {
        const postList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          likes: val.likes ? Object.keys(val.likes) : [],
          dislikes: val.dislikes ? Object.keys(val.dislikes) : [],
          comments: val.comments ? Object.entries(val.comments).map(([cid, cval]: [string, any]) => ({ id: cid, ...cval })) : []
        }));
        const sorted = postList.sort((a, b) => b.timestamp - a.timestamp);
        setPosts(sorted);
        try { localStorage.setItem('vimos_posts', JSON.stringify(sorted.slice(0, 20))); } catch {}
      } else {
        setPosts([]);
      }
    } catch (err) {
      console.warn('Manual Firebase fetch error:', err);
    } finally {
      setIsSyncingFirebase(false);
      setLoadingPosts(false);
    }
  };

  useEffect(() => {
    const callsQuery = query(ref(db, 'calls'), limitToLast(20));
    const unsubscribeCalls = onValue(callsQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
          activeParticipants: val.activeParticipants || {}
        })) as ActiveCall[];
        setActiveCalls(list);

        if (currentUser) {
          const incomingPrivateCall = list.find(c => 
            c.type === 'private' && 
            c.receiverId === currentUser.id && 
            c.status !== 'ended'
          );

          const outgoingCall = list.find(c => 
            c.callerId === currentUser.id && 
            c.status !== 'ended'
          );

          const manuallyJoinedCall = list.find(c => 
            c.status !== 'ended' && 
            c.activeParticipants?.[currentUser.id] === true
          );

          if (incomingPrivateCall) {
            setCurrentCall(incomingPrivateCall);
          } else if (outgoingCall) {
            setCurrentCall(outgoingCall);
          } else if (manuallyJoinedCall) {
            setCurrentCall(manuallyJoinedCall);
          } else {
            setCurrentCall(null);
          }
        } else {
          setCurrentCall(null);
        }
      } else {
        setActiveCalls([]);
        setCurrentCall(null);
      }
    });

    return () => unsubscribeCalls();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      return;
    }
    const notifQuery = query(ref(db, `notifications/${currentUser.id}`), limitToLast(40));
    
    // Fast direct fetch for immediate paint of notifications
    get(notifQuery).then((snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => b.timestamp - a.timestamp);
        setNotifications(list);
      }
    }).catch(() => {});

    const unsubscribeNotifs = onValue(notifQuery, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val
        })).sort((a, b) => b.timestamp - a.timestamp);
        setNotifications(list);

        // Check for new group invite
        const latestInvite = list.find(n => 
          n.type === 'group_invite' && 
          !n.read && 
          n.timestamp > mountTimeRef.current - 5000 && 
          !seenChatMsgIdsRef.current.has(n.id)
        );
        if (latestInvite) {
          seenChatMsgIdsRef.current.add(latestInvite.id);
          playChatNotificationSound();
          setIncomingChatPayload({
            id: latestInvite.id,
            senderId: latestInvite.senderId,
            senderName: latestInvite.senderName,
            senderPhoto: latestInvite.senderPhoto,
            text: `✉️ Mengundang Anda bergabung ke grup "${latestInvite.groupName || 'Collective'}". Klik notifikasi untuk menerima!`,
            timestamp: latestInvite.timestamp,
            chatType: 'group',
            targetId: latestInvite.groupId || '',
            groupName: latestInvite.groupName || 'Collective'
          });
        }
      } else {
        setNotifications([]);
      }
    });
    return () => unsubscribeNotifs();
  }, [currentUser?.id]);

  // Global Realtime Chat Notification Listener
  useEffect(() => {
    if (!currentUser) return;

    // 1. Listen to Direct Chats & Shop Chats for current user
    const chatsRef = ref(db, 'chats');
    const unsubscribeChats = onValue(chatsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      Object.entries(data).forEach(([chatId, chatVal]: [string, any]) => {
        if (!chatId.includes(currentUser.id)) return;
        const messagesObj = chatVal?.messages;
        if (!messagesObj) return;

        Object.entries(messagesObj).forEach(([msgId, msgVal]: [string, any]) => {
          if (
            msgVal.senderId &&
            msgVal.senderId !== currentUser.id &&
            msgVal.timestamp &&
            msgVal.timestamp > mountTimeRef.current - 5000 &&
            !seenChatMsgIdsRef.current.has(msgId)
          ) {
            seenChatMsgIdsRef.current.add(msgId);
            const senderUser = usersRef.current.find(u => u.id === msgVal.senderId);
            const senderName = senderUser?.name || 'Pengirim Vimos';
            const senderPhoto = senderUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${msgVal.senderId}`;

            const messageText = msgVal.text 
              ? (msgVal.photoURL || msgVal.mediaType === 'image' ? `📷 [Foto] ${msgVal.text}` : (msgVal.videoURL || msgVal.mediaType === 'video' ? `🎥 [Video] ${msgVal.text}` : msgVal.text))
              : (msgVal.photoURL || msgVal.mediaType === 'image' ? '📷 Mengirim sebuah foto' : (msgVal.videoURL || msgVal.mediaType === 'video' ? '🎥 Mengirim sebuah video' : 'Mengirim pesan baru'));

            setIncomingChatPayload({
              id: msgId,
              senderId: msgVal.senderId,
              senderName,
              senderPhoto,
              text: messageText,
              timestamp: msgVal.timestamp,
              chatType: 'user',
              targetId: msgVal.senderId
            });
          } else {
            if (msgId) seenChatMsgIdsRef.current.add(msgId);
          }
        });
      });
    });

    // 2. Listen to Collectives / Groups for current user
    const groupsRef = ref(db, 'groups');
    const unsubscribeGroups = onValue(groupsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      Object.entries(data).forEach(([groupId, groupVal]: [string, any]) => {
        const participants = groupVal.participants ? Object.keys(groupVal.participants) : [];
        if (!participants.includes(currentUser.id)) return;

        const messagesObj = groupVal.messages;
        if (!messagesObj) return;

        Object.entries(messagesObj).forEach(([msgId, msgVal]: [string, any]) => {
          if (
            msgVal.senderId &&
            msgVal.senderId !== currentUser.id &&
            msgVal.timestamp &&
            msgVal.timestamp > mountTimeRef.current - 5000 &&
            !seenChatMsgIdsRef.current.has(msgId)
          ) {
            seenChatMsgIdsRef.current.add(msgId);
            const senderUser = usersRef.current.find(u => u.id === msgVal.senderId);
            const senderName = senderUser?.name || 'Anggota Grup';
            const senderPhoto = senderUser?.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${msgVal.senderId}`;

            const messageText = msgVal.text 
              ? (msgVal.photoURL || msgVal.mediaType === 'image' ? `📷 [Foto] ${msgVal.text}` : (msgVal.videoURL || msgVal.mediaType === 'video' ? `🎥 [Video] ${msgVal.text}` : msgVal.text))
              : (msgVal.photoURL || msgVal.mediaType === 'image' ? '📷 Mengirim sebuah foto' : (msgVal.videoURL || msgVal.mediaType === 'video' ? '🎥 Mengirim sebuah video' : 'Pesan grup baru'));

            setIncomingChatPayload({
              id: msgId,
              senderId: msgVal.senderId,
              senderName,
              senderPhoto,
              text: messageText,
              timestamp: msgVal.timestamp,
              chatType: 'group',
              targetId: groupId,
              groupName: groupVal.name || 'Collective'
            });
          } else {
            if (msgId) seenChatMsgIdsRef.current.add(msgId);
          }
        });
      });
    });

    return () => {
      unsubscribeChats();
      unsubscribeGroups();
    };
  }, [currentUser?.id]);

  const toggleFollow = (targetId: string) => {
    if (!currentUser || currentUser.id === targetId) return;
    const isFollowing = (currentUser.following || []).includes(targetId);
    
    // Optimistic state update for instant UI feedback
    const updatedFollowing = isFollowing 
      ? (currentUser.following || []).filter(id => id !== targetId)
      : [...(currentUser.following || []), targetId];
    
    const updatedUser = { ...currentUser, following: updatedFollowing };
    setCurrentUser(updatedUser);
    try { localStorage.setItem('vimos_user', JSON.stringify(updatedUser)); } catch {}

    setUsers(prev => prev.map(u => {
      if (u.id === targetId) {
        const updatedFollowers = isFollowing
          ? (u.followers || []).filter(id => id !== currentUser.id)
          : [...(u.followers || []), currentUser.id];
        return { ...u, followers: updatedFollowers };
      }
      return u;
    }));

    const myFollowingRef = ref(db, `users/${currentUser.id}/following/${targetId}`);
    const theirFollowersRef = ref(db, `users/${targetId}/followers/${currentUser.id}`);
    if (isFollowing) {
      set(myFollowingRef, null);
      set(theirFollowersRef, null);
    } else {
      set(myFollowingRef, true);
      set(theirFollowersRef, true);
      push(ref(db, `notifications/${targetId}`), {
        senderId: currentUser.id,
        senderName: currentUser.name || 'Orbit',
        senderPhoto: currentUser.photoURL,
        type: 'follow',
        timestamp: Date.now(),
        read: false
      });
    }
  };

  const handleToggleAdmin = async (targetUserId: string, currentStatus: boolean) => {
    const newAdminStatus = !currentStatus;
    const targetUser = users.find(u => u.id === targetUserId);
    if (!targetUser) return;
    
    try {
      await update(ref(db, `users/${targetUserId}`), {
        isAdmin: newAdminStatus,
        role: newAdminStatus ? (targetUser.role || 'Admin') : (targetUser.role === 'Admin' ? 'Member' : targetUser.role),
        roleColor: newAdminStatus ? (targetUser.roleColor || '#F59E0B') : (targetUser.role === 'Admin' ? '#000000' : targetUser.roleColor)
      });
      
      // Send real-time notification to the target user
      const notifRef = push(ref(db, `notifications/${targetUserId}`));
      await set(notifRef, {
        id: notifRef.key,
        senderId: currentUser?.id || 'admin_system',
        senderName: currentUser?.name || 'Vimos Super Admin',
        senderPhoto: currentUser?.photoURL || 'https://api.dicebear.com/7.x/bottts/svg?seed=vimos_admin',
        type: 'comment',
        commentText: newAdminStatus 
          ? `👑 Selamat! Anda telah diangkat menjadi Admin Vimos oleh ${currentUser?.name || 'Admin'}. Anda sekarang memiliki akses ke Command Center & wewenang admin!`
          : `Akses Admin Vimos untuk akun Anda telah dicabut oleh ${currentUser?.name || 'Admin'}.`,
        timestamp: Date.now(),
        read: false
      });
    } catch (err) {
      console.error('Error toggling admin privilege:', err);
    }
  };

  const handleAcceptGroupInvite = async (notif: UserNotification) => {
    if (!currentUser || !notif.groupId) return;
    try {
      // 1. Add currentUser to group participants
      await set(ref(db, `groups/${notif.groupId}/participants/${currentUser.id}`), true);
      // 2. Remove currentUser from group pendingInvites
      await set(ref(db, `groups/${notif.groupId}/pendingInvites/${currentUser.id}`), null);
      // 3. Mark notification as accepted & read
      await update(ref(db, `notifications/${currentUser.id}/${notif.id}`), {
        status: 'accepted',
        read: true
      });
      // 4. Send notification to inviter that user accepted
      const notifRef = push(ref(db, `notifications/${notif.senderId}`));
      set(notifRef, {
        id: notifRef.key,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderPhoto: currentUser.photoURL,
        type: 'group_accepted',
        groupId: notif.groupId,
        groupName: notif.groupName || 'Collective',
        timestamp: serverTimestamp(),
        read: false
      });
      // 5. System announcement in group
      const sysMsgRef = push(ref(db, `groups/${notif.groupId}/messages`));
      set(sysMsgRef, {
        senderId: 'system',
        text: `🎉 ${currentUser.name} telah menerima undangan dan bergabung ke dalam grup!`,
        timestamp: serverTimestamp(),
        read: true
      });
      // 6. Navigate directly to Chat with target group selected
      setTargetChatGroupId(notif.groupId);
      setCurrentView(View.CHAT);
    } catch (err) {
      console.error('Error accepting group invite:', err);
    }
  };

  const handleDeclineGroupInvite = async (notif: UserNotification) => {
    if (!currentUser || !notif.groupId) return;
    try {
      // Remove from pending invites
      await set(ref(db, `groups/${notif.groupId}/pendingInvites/${currentUser.id}`), null);
      // Mark notification as declined & read
      await update(ref(db, `notifications/${currentUser.id}/${notif.id}`), {
        status: 'declined',
        read: true
      });
    } catch (err) {
      console.error('Error declining group invite:', err);
    }
  };

  const handleOpenGroupChat = (groupId: string) => {
    setTargetChatGroupId(groupId);
    setCurrentView(View.CHAT);
  };

  const toggleLike = (postId: string) => {
    if (!currentUser) return;
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const hasLiked = (post.likes || []).includes(currentUser.id);

    // Optimistic UI update: instant like feedback and clear dislike
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        const updatedLikes = hasLiked 
          ? (p.likes || []).filter(id => id !== currentUser.id)
          : [...(p.likes || []), currentUser.id];
        const updatedDislikes = (p.dislikes || []).filter(id => id !== currentUser.id);
        return { ...p, likes: updatedLikes, dislikes: updatedDislikes };
      }
      return p;
    }));

    const likeRef = ref(db, `posts/${postId}/likes/${currentUser.id}`);
    const dislikeRef = ref(db, `posts/${postId}/dislikes/${currentUser.id}`);
    
    if (hasLiked) {
      set(likeRef, null);
    } else {
      set(likeRef, true);
      set(dislikeRef, null); // Automatically cancel dislike when like is pressed

      if (post.userId !== currentUser.id) {
        push(ref(db, `notifications/${post.userId}`), {
          senderId: currentUser.id,
          senderName: currentUser.name || 'Orbit',
          senderPhoto: currentUser.photoURL || '',
          type: 'like',
          postId: post.id,
          postText: post.text ? (post.text.length > 50 ? post.text.slice(0, 50) + '...' : post.text) : '',
          timestamp: Date.now(),
          read: false
        });
      }
    }
  };

  const toggleDislike = (postId: string) => {
    if (!currentUser) return;
    const post = posts.find(p => p.id === postId);
    if (!post) return;
    const hasDisliked = (post.dislikes || []).includes(currentUser.id);

    // Optimistic UI update: instant dislike feedback and clear like
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        const updatedDislikes = hasDisliked 
          ? (p.dislikes || []).filter(id => id !== currentUser.id)
          : [...(p.dislikes || []), currentUser.id];
        const updatedLikes = (p.likes || []).filter(id => id !== currentUser.id);
        return { ...p, dislikes: updatedDislikes, likes: updatedLikes };
      }
      return p;
    }));

    const dislikeRef = ref(db, `posts/${postId}/dislikes/${currentUser.id}`);
    const likeRef = ref(db, `posts/${postId}/likes/${currentUser.id}`);
    
    if (hasDisliked) {
      set(dislikeRef, null);
    } else {
      set(dislikeRef, true);
      set(likeRef, null); // Automatically cancel like when dislike is pressed
    }
  };

  const addComment = (
    postId: string, 
    text: string, 
    replyTo?: { commentId?: string; userName?: string; userId?: string }
  ) => {
    if (!currentUser || !text.trim()) return;
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    const commentRef = push(ref(db, `posts/${postId}/comments`));
    const commentId = commentRef.key || `cid_${Date.now()}`;

    // Optimistic UI update for comments
    const newComment: Comment = {
      id: commentId,
      userId: currentUser.id,
      userName: currentUser.name || 'Member',
      userPhoto: currentUser.photoURL || '',
      text: text.trim(),
      timestamp: Date.now(),
      replyToId: replyTo?.commentId,
      replyToUserName: replyTo?.userName,
      replyToUserId: replyTo?.userId,
    };

    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        const existingComments = p.comments || [];
        const filteredComments = existingComments.filter(c => c.id !== commentId);
        return { ...p, comments: [...filteredComments, newComment] };
      }
      return p;
    }));

    set(commentRef, {
      userId: currentUser.id,
      userName: currentUser.name || 'Member',
      userPhoto: currentUser.photoURL || '',
      text: text.trim(),
      timestamp: Date.now(),
      ...(replyTo?.commentId ? { replyToId: replyTo.commentId } : {}),
      ...(replyTo?.userName ? { replyToUserName: replyTo.userName } : {}),
      ...(replyTo?.userId ? { replyToUserId: replyTo.userId } : {}),
    });

    // Notify original comment author if replying
    if (replyTo?.userId && replyTo.userId !== currentUser.id) {
      push(ref(db, `notifications/${replyTo.userId}`), {
        senderId: currentUser.id,
        senderName: currentUser.name || 'Orbit',
        senderPhoto: currentUser.photoURL || '',
        type: 'reply',
        postId: post.id,
        postText: post.text ? (post.text.length > 50 ? post.text.slice(0, 50) + '...' : post.text) : '',
        commentText: text.trim().length > 60 ? text.trim().slice(0, 60) + '...' : text.trim(),
        timestamp: Date.now(),
        read: false
      });
    } else if (post.userId !== currentUser.id) {
      // Notify post owner
      push(ref(db, `notifications/${post.userId}`), {
        senderId: currentUser.id,
        senderName: currentUser.name || 'Orbit',
        senderPhoto: currentUser.photoURL || '',
        type: 'comment',
        postId: post.id,
        postText: post.text ? (post.text.length > 50 ? post.text.slice(0, 50) + '...' : post.text) : '',
        commentText: text.trim().length > 60 ? text.trim().slice(0, 60) + '...' : text.trim(),
        timestamp: Date.now(),
        read: false
      });
    }

    // Mention notifications (@username)
    const mentionMatches = text.match(/@([\w.-]+)/g);
    if (mentionMatches && mentionMatches.length > 0) {
      const cleanedMentions = mentionMatches.map(m => m.slice(1).toLowerCase().replace(/_/g, ''));
      users.forEach(u => {
        if (u.id !== currentUser.id && u.id !== post.userId && u.id !== replyTo?.userId) {
          const uClean = (u.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanedMentions.some(m => uClean === m || uClean.includes(m) || m.includes(uClean))) {
            push(ref(db, `notifications/${u.id}`), {
              senderId: currentUser.id,
              senderName: currentUser.name || 'Orbit',
              senderPhoto: currentUser.photoURL || '',
              type: 'mention',
              postId: post.id,
              postText: post.text ? (post.text.length > 50 ? post.text.slice(0, 50) + '...' : post.text) : '',
              commentText: text.trim().length > 60 ? text.trim().slice(0, 60) + '...' : text.trim(),
              timestamp: Date.now(),
              read: false
            });
          }
        }
      });
    }
  };

  const addStory = (text: string, photoURL?: string, videoURL?: string, mediaType?: 'image' | 'video') => {
    if (!currentUser) return;
    const now = Date.now();
    const resolvedType = mediaType || (videoURL ? 'video' : photoURL ? 'image' : undefined);
    const storyRef = push(ref(db, 'stories'));
    const storyId = storyRef.key || `story_${now}`;

    const newStory: Story = {
      id: storyId,
      userId: currentUser.id,
      userName: currentUser.name || 'Member',
      userPhoto: currentUser.photoURL || '',
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      text: text.trim(),
      photoURL: photoURL || undefined,
      videoURL: videoURL || undefined,
      mediaType: resolvedType || undefined
    };

    setStories(prev => [newStory, ...prev.filter(s => s.id !== storyId)]);

    set(storyRef, {
      userId: currentUser.id,
      userName: currentUser.name || 'Member',
      userPhoto: currentUser.photoURL || '',
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      text: text.trim(),
      photoURL: photoURL || null,
      videoURL: videoURL || null,
      mediaType: resolvedType || null
    });
  };

  const deleteStory = (storyId: string) => {
    if (!currentUser) return;
    remove(ref(db, `stories/${storyId}`)).catch(() => {});
    setStories(prev => prev.filter(s => s.id !== storyId));
  };

  const startCall = (type: 'private' | 'collective', mediaType: 'audio' | 'video', targetId: string, name?: string) => {
    if (!currentUser) return;
    const callId = type === 'private' ? `private_${[currentUser.id, targetId].sort().join('_')}` : `group_${targetId}`;
    const callRef = ref(db, `calls/${callId}`);
    const newCall: any = {
      type,
      mediaType,
      callerId: currentUser.id,
      callerName: currentUser.name || 'Anonymous Orbit',
      callerPhoto: currentUser.photoURL || '',
      status: 'calling',
      timestamp: Date.now(),
      activeParticipants: { [currentUser.id]: true }
    };
    if (type === 'private') {
      newCall.receiverId = targetId;
    } else {
      newCall.groupId = targetId;
      newCall.groupName = name || 'Collective';
    }
    set(callRef, newCall);
  };

  const acceptCall = () => {
    if (!currentCall || !currentUser) return;
    const callRef = ref(db, `calls/${currentCall.id}`);
    update(callRef, {
      status: 'connected',
      [`activeParticipants/${currentUser.id}`]: true
    });
  };

  const declineCall = () => {
    if (!currentCall) return;
    const callRef = ref(db, `calls/${currentCall.id}`);
    update(callRef, { status: 'ended' });
  };

  const endCall = () => {
    if (!currentCall || !currentUser) return;
    const callRef = ref(db, `calls/${currentCall.id}`);
    
    if (currentCall.type === 'private') {
      update(callRef, { status: 'ended' });
    } else {
      const participants = { ...currentCall.activeParticipants };
      delete participants[currentUser.id];
      
      if (Object.keys(participants).length === 0) {
        update(callRef, { status: 'ended' });
      } else {
        set(ref(db, `calls/${currentCall.id}/activeParticipants/${currentUser.id}`), null);
      }
    }
  };

  const joinCall = (callId: string) => {
    if (!currentUser) return;
    set(ref(db, `calls/${callId}/activeParticipants/${currentUser.id}`), true);
  };

  const createPost = (data: { 
    text: string; 
    photoURL?: string; 
    videoURL?: string; 
    musicURL?: string;
    musicTitle?: string;
    musicAuthor?: string;
    musicThumbnail?: string;
    musicStart?: number;
    musicEnd?: number;
  }) => {
    if (!currentUser) return;
    const now = Date.now();
    const postsRef = ref(db, 'posts');
    const newPostRef = push(postsRef);
    const postId = newPostRef.key || `post_${now}_${Math.random().toString(36).substring(2, 6)}`;
    const currentAuthorName = currentUser.name || 'Member';
    const currentAuthorPhoto = currentUser.photoURL || '';

    const newPost: Post = {
      id: postId,
      userId: currentUser.id,
      userName: currentAuthorName,
      userPhoto: currentAuthorPhoto,
      timestamp: now,
      text: data.text,
      photoURL: data.photoURL || undefined,
      videoURL: data.videoURL || undefined,
      musicURL: data.musicURL || undefined,
      musicTitle: data.musicTitle || undefined,
      musicAuthor: data.musicAuthor || undefined,
      musicThumbnail: data.musicThumbnail || undefined,
      musicStart: data.musicStart !== undefined ? data.musicStart : undefined,
      musicEnd: data.musicEnd !== undefined ? data.musicEnd : undefined,
      likes: [],
      dislikes: [],
      comments: []
    };

    // 1. Instant local state update for zero latency
    setPosts(prev => {
      const filtered = prev.filter(p => p.id !== postId);
      return [newPost, ...filtered];
    });
    setLoadingPosts(false);

    // 2. Write to local storage cache immediately
    try {
      const storedPosts = JSON.parse(localStorage.getItem('vimos_posts') || '[]');
      const filteredStored = storedPosts.filter((p: any) => p.id !== postId);
      localStorage.setItem('vimos_posts', JSON.stringify([newPost, ...filteredStored].slice(0, 25)));
    } catch {}

    // 3. Save to Firebase RTDB asynchronously
    set(newPostRef, {
      userId: currentUser.id,
      userName: currentAuthorName,
      userPhoto: currentAuthorPhoto,
      timestamp: now,
      text: data.text,
      photoURL: data.photoURL || null,
      videoURL: data.videoURL || null,
      musicURL: data.musicURL || null,
      musicTitle: data.musicTitle || null,
      musicAuthor: data.musicAuthor || null,
      musicThumbnail: data.musicThumbnail || null,
      musicStart: data.musicStart !== undefined ? data.musicStart : null,
      musicEnd: data.musicEnd !== undefined ? data.musicEnd : null,
      likes: {},
      dislikes: {},
      comments: {}
    });

    // Automatically add or increment sound in Global Sound Library so others can search & reuse it
    if (data.musicURL) {
      const ytId = extractYouTubeId(data.musicURL);
      const soundKey = ytId ? `yt_${ytId}` : `snd_${Date.now()}`;
      const soundTitle = data.musicTitle || (ytId ? 'YouTube Sound Track' : 'Vimos Sound Track');
      const soundAuthor = data.musicAuthor || currentUser.name || 'Vimos Creator';
      const soundThumb = data.musicThumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : '');
      const startTime = data.musicStart || 0;
      const endTime = data.musicEnd || (startTime + 30);

      const soundRef = ref(db, `sounds/${soundKey}`);
      get(soundRef).then(snap => {
        if (snap.exists()) {
          const prevData = snap.val();
          update(soundRef, {
            useCount: (prevData.useCount || 1) + 1,
            lastUsedAt: Date.now()
          });
        } else {
          set(soundRef, {
            id: soundKey,
            title: soundTitle,
            author: soundAuthor,
            url: data.musicURL,
            thumbnailUrl: soundThumb,
            duration: endTime - startTime,
            sourceType: ytId ? 'youtube' : 'upload',
            youtubeId: ytId || null,
            startTime: startTime,
            endTime: endTime,
            useCount: 1,
            addedBy: currentUser.id,
            addedByName: currentUser.name || 'Anonymous',
            addedAt: Date.now()
          });
        }
      }).catch(err => {
        console.warn('Error syncing sound to global library:', err);
      });
    }

    setCurrentView(View.FEED);
    setSelectedPostId(null);
    setSelectedProfileId(null);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const addAnnouncement = (text: string) => {
    if (!currentUser?.isAdmin) return;
    push(ref(db, 'announcements'), {
      text,
      timestamp: Date.now(),
      authorId: currentUser.id
    });
  };

  const updateAnnouncement = (id: string, text: string) => {
    if (!currentUser?.isAdmin) return;
    update(ref(db, `announcements/${id}`), { text });
  };

  const deleteAnnouncement = (id: string) => {
    if (!currentUser?.isAdmin) return;
    remove(ref(db, `announcements/${id}`));
  };

  const requestDeletePost = (id: string) => {
    if (!currentUser) return;
    const post = posts.find(p => p.id === id);
    if (!post) return;
    if (post.userId === currentUser.id || currentUser.isAdmin) {
      setPostToDelete(post);
    }
  };

  const confirmDeletePost = () => {
    if (!postToDelete || !currentUser) return;
    const id = postToDelete.id;
    // Optimistic delete
    setPosts(prev => prev.filter(p => p.id !== id));
    remove(ref(db, `posts/${id}`));
    
    if (selectedPostId === id) {
      setSelectedPostId(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('post');
        window.history.pushState({}, '', url.toString());
      } catch {}
    }
    setPostToDelete(null);
  };

  const handleLogout = () => signOut(auth);

  const filteredPosts = useMemo(() => {
    const term = (searchTerm || '').toLowerCase();
    return posts
      .filter(p => !p.isTakenDown || currentUser?.isAdmin)
      .filter(p => 
        (p.text || '').toLowerCase().includes(term) ||
        (p.userName || '').toLowerCase().includes(term)
      );
  }, [posts, searchTerm, currentUser]);

  // Filter stories: 24h expiration & only visible to followers/following (or author/admin)
  const visibleStories = useMemo(() => {
    if (!currentUser) return [];
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    
    return stories.filter(story => {
      // 1. Enforce strict 24-hour expiration
      const createdAt = story.createdAt || (story.expiresAt ? story.expiresAt - twentyFourHours : now);
      if (now - createdAt >= twentyFourHours) {
        return false;
      }

      // 2. Author always sees their own story
      if (story.userId === currentUser.id) {
        return true;
      }

      // 3. Admin can view for moderation and support
      if (currentUser.isAdmin) {
        return true;
      }

      // 4. Followers & Following visibility:
      // Visible if current user follows story creator OR story creator follows current user
      const creator = users.find(u => u.id === story.userId);
      const myFollowing = currentUser.following || [];
      const myFollowers = currentUser.followers || [];
      const creatorFollowing = creator?.following || [];
      const creatorFollowers = creator?.followers || [];

      const isFollowingCreator = myFollowing.includes(story.userId) || creatorFollowers.includes(currentUser.id);
      const isFollowedByCreator = myFollowers.includes(story.userId) || creatorFollowing.includes(currentUser.id);

      return isFollowingCreator || isFollowedByCreator;
    });
  }, [stories, currentUser, users]);

  // Periodic cleanup interval for stories older than 24 hours
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;
      stories.forEach(story => {
        const createdAt = story.createdAt || now;
        if (now - createdAt >= twentyFourHours) {
          remove(ref(db, `stories/${story.id}`)).catch(() => {});
        }
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [stories]);

  const usersWithPresence = useMemo(() => {
    return users.map(u => ({
      ...u,
      isOnline: userStatuses[u.id]?.state === 'online',
      lastSeen: userStatuses[u.id]?.last_changed
    }));
  }, [users, userStatuses]);

  const profileToDisplay = useMemo(() => {
    if (selectedProfileId) {
      const foundInUsers = usersWithPresence.find(u => u.id === selectedProfileId);
      if (foundInUsers) {
        if (currentUser && currentUser.id === selectedProfileId) {
          return { ...currentUser, ...foundInUsers, isOnline: userStatuses[currentUser.id]?.state === 'online' };
        }
        return foundInUsers;
      }
      if (currentUser && currentUser.id === selectedProfileId) {
        return { ...currentUser, isOnline: userStatuses[currentUser.id]?.state === 'online' };
      }
      return null;
    }
    return currentUser ? { ...currentUser, isOnline: userStatuses[currentUser.id]?.state === 'online' } : null;
  }, [selectedProfileId, usersWithPresence, currentUser, userStatuses]);

  const handleConfirmExit = () => {
    setIsExitConfirmOpen(false);
    setIsAppExited(true);
    try {
      window.close();
    } catch {}
  };

  if (isAppExited) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-white p-6 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-4 text-white shadow-lg">
          <i className="fas fa-arrow-right-from-bracket text-2xl"></i>
        </div>
        <h2 className="text-xl font-black tracking-tight mb-1.5">Sesi Orbit Ditutup</h2>
        <p className="text-xs text-neutral-400 max-w-xs mb-6 leading-relaxed">
          Kamu telah keluar dari aplikasi Orbit. Silakan tutup tab browser kamu atau tekan tombol di bawah untuk kembali.
        </p>
        <button
          onClick={() => {
            setIsAppExited(false);
            setCurrentView(View.FEED);
            try {
              window.history.pushState({ orbit_app: true, layer: 1 }, '');
            } catch {}
          }}
          className="bg-white text-black text-xs font-bold px-6 py-3 rounded-full hover:bg-neutral-200 transition-all shadow-md active:scale-95 flex items-center space-x-2"
        >
          <i className="fas fa-rotate-left text-xs"></i>
          <span>Buka Kembali Orbit</span>
        </button>
      </div>
    );
  }

  if (!currentUser) return <AuthScreen bannedMessage={bannedMessage} />;

  const shouldHideHeader = currentView === View.CHAT && isChatConversationActive;
  const shouldHideNavbar = currentView === View.CHAT && isChatConversationActive;

  return (
    <div className="flex flex-col min-h-screen bg-white max-w-xl mx-auto border-x border-gray-100 shadow-sm relative overflow-hidden">
      {!shouldHideHeader && (
        <Header 
          onSearch={setSearchTerm} 
          users={usersWithPresence} 
          onUserClick={(id) => { 
            setSelectedPostId(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('post');
              window.history.pushState({}, '', url.toString());
            } catch {}
            setSelectedProfileId(id); 
            setCurrentView(View.PROFILE); 
          }} 
          onLeaderboardClick={() => {
            setSelectedPostId(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('post');
              window.history.pushState({}, '', url.toString());
            } catch {}
            setCurrentView(View.LEADERBOARD);
          }}
          onShopClick={() => {
            setSelectedPostId(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('post');
              window.history.pushState({}, '', url.toString());
            } catch {}
            setCurrentView(View.SHOP);
          }}
          userCoins={currentUser.coins ?? 500}
          isAdmin={currentUser.isAdmin}
          onAdminClick={() => {
            setSelectedPostId(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('post');
              window.history.pushState({}, '', url.toString());
            } catch {}
            setCurrentView(View.ADMIN);
          }}
        />
      )}

      <main className={shouldHideNavbar ? "flex-1 overflow-hidden h-[100dvh] flex flex-col" : "flex-1 pb-24 overflow-y-auto scroll-smooth"}>
        {selectedPostId ? (
          <SinglePostView
            postId={selectedPostId}
            posts={posts}
            onBackToFeed={() => {
              setSelectedPostId(null);
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('post');
                window.history.pushState({}, '', url.toString());
              } catch {}
            }}
            onLike={toggleLike}
            onDislike={toggleDislike}
            onComment={addComment}
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); setSelectedPostId(null); }}
            currentUser={currentUser}
            onFollow={toggleFollow}
            onTakeDownPost={(id) => {
              const post = posts.find(p => p.id === id);
              update(ref(db, `posts/${id}`), { isTakenDown: !post?.isTakenDown });
            }}
            onDeletePost={requestDeletePost}
            users={usersWithPresence}
            isLoading={loadingPosts}
          />
        ) : currentView === View.FEED ? (
          <Feed 
            posts={filteredPosts} 
            stories={visibleStories}
            onAddStory={addStory}
            onDeleteStory={deleteStory}
            announcements={announcements}
            onLike={toggleLike} 
            onDislike={toggleDislike}
            onComment={addComment}
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }}
            currentUser={currentUser}
            onFollow={toggleFollow}
            onTakeDownPost={(id) => {
              const post = posts.find(p => p.id === id);
              update(ref(db, `posts/${id}`), { isTakenDown: !post?.isTakenDown });
            }}
            onDeletePost={requestDeletePost}
            users={usersWithPresence}
            isLoading={loadingPosts}
            isSyncing={isSyncingFirebase}
            onRefresh={refreshFirebasePosts}
            onCreatePostClick={() => setCurrentView(View.POST)}
          />
        ) : null}
        {currentView === View.REELS && (
          <Reels 
            posts={posts.filter(p => p.videoURL && (!p.isTakenDown || currentUser?.isAdmin))} 
            onLike={toggleLike} 
            onComment={addComment} 
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }} 
            currentUser={currentUser}
            onTakeDownPost={(id) => {
              const post = posts.find(p => p.id === id);
              update(ref(db, `posts/${id}`), { isTakenDown: !post?.isTakenDown });
            }}
            onDeletePost={requestDeletePost}
            users={usersWithPresence}
          />
        )}
        {currentView === View.POST && <PostCreator onPost={createPost} globalSounds={globalSounds} />}
        {currentView === View.LEADERBOARD && (
          <Leaderboard 
            users={usersWithPresence} 
            posts={posts} 
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }} 
          />
        )}
        {currentView === View.NOTIFICATIONS && (
          <Notifications 
            notifications={notifications} 
            currentUser={currentUser} 
            onFollow={toggleFollow}
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }}
            onPostClick={(postId) => {
              setSelectedPostId(postId);
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('post', postId);
                window.history.pushState({}, '', url.toString());
              } catch {}
            }}
            onClearAll={() => {
              const updates: any = {};
              notifications.forEach(n => updates[`notifications/${currentUser.id}/${n.id}/read`] = true);
              update(ref(db), updates);
            }}
            users={usersWithPresence}
            onAcceptGroupInvite={handleAcceptGroupInvite}
            onDeclineGroupInvite={handleDeclineGroupInvite}
            onOpenGroupChat={handleOpenGroupChat}
          />
        )}
        {currentView === View.CHAT && (
          <Chat 
            users={usersWithPresence} 
            currentUser={currentUser} 
            userStatuses={userStatuses}
            activeCalls={activeCalls}
            onStartCall={startCall}
            onJoinCall={joinCall}
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }} 
            onFollow={toggleFollow}
            targetUserId={targetChatUserId}
            targetGroupId={targetChatGroupId}
            initialChatMessage={initialChatMessage}
            onClearInitialChat={() => {
              setTargetChatUserId(null);
              setTargetChatGroupId(null);
              setInitialChatMessage(null);
            }}
            permissionStatus={notifPermission}
            onRequestPermission={requestNotifPermission}
            onActiveConversationChange={setIsChatConversationActive}
            onBackToChatListRef={chatBackHandlerRef}
          />
        )}
        {currentView === View.PROFILE && (
          profileToDisplay ? (
            <Profile 
              user={profileToDisplay} 
              users={usersWithPresence}
              posts={posts}
              currentUser={currentUser}
              onToggleFollow={toggleFollow}
              onLike={toggleLike}
              onDislike={toggleDislike}
              onComment={addComment}
              onTakeDownPost={(id) => {
                const post = posts.find(p => p.id === id);
                update(ref(db, `posts/${id}`), { isTakenDown: !post?.isTakenDown });
              }}
              onDeletePost={requestDeletePost}
              onUpdateProfile={(data) => {
                if (currentUser) {
                  update(ref(db, `users/${currentUser.id}`), data);
                }
              }}
              onAddCapture={(url) => {
                if (currentUser) {
                  push(ref(db, `users/${currentUser.id}/recentCaptures`), url);
                }
              }}
              onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }}
              onLogout={handleLogout}
              onNavigateToChat={(id) => {
                setTargetChatUserId(id);
                setCurrentView(View.CHAT);
              }}
              onBanUser={(id) => {
                const user = users.find(u => u.id === id);
                update(ref(db, `users/${id}`), { isBanned: !user?.isBanned });
              }}
              onSetRole={(id, role, color) => update(ref(db, `users/${id}`), { role, roleColor: color })}
              onToggleAdmin={handleToggleAdmin}
            />
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mb-4 text-neutral-400 shadow-inner">
                <i className="fas fa-user text-2xl"></i>
              </div>
              <h3 className="text-base font-black text-neutral-900 tracking-tight mb-1">Memuat Profil Pengguna...</h3>
              <p className="text-xs text-neutral-500 max-w-xs mb-6 leading-relaxed">
                Menghubungkan data profil Anda dari server.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedProfileId(currentUser?.id || null);
                }}
                className="px-6 py-2.5 bg-black text-white text-xs font-black rounded-full hover:bg-neutral-800 transition-all active:scale-95 cursor-pointer shadow-md"
              >
                Buka Profil Saya
              </button>
            </div>
          )
        )}
        {(currentView === View.SHOP || hasVisitedShop) && (
          <div className={currentView === View.SHOP ? 'block' : 'hidden'}>
            <Shop 
              currentUser={currentUser}
              onUpdateUser={(updatedData) => {
                setCurrentUser(prev => prev ? { ...prev, ...updatedData } : null);
              }}
              onNavigateToChat={(targetUserId, initialMessage) => {
                setTargetChatUserId(targetUserId);
                setInitialChatMessage(initialMessage || null);
                setCurrentView(View.CHAT);
              }}
            />
          </div>
        )}
        {currentView === View.ADMIN && currentUser.isAdmin && (
          <AdminPanel 
            users={usersWithPresence} 
            announcements={announcements}
            onAddAnnouncement={addAnnouncement}
            onUpdateAnnouncement={updateAnnouncement}
            onDeleteAnnouncement={deleteAnnouncement}
            onSetRole={(id, role, color) => update(ref(db, `users/${id}`), { role, roleColor: color })} 
            onBanUser={(id) => {
              const user = users.find(u => u.id === id);
              update(ref(db, `users/${id}`), { isBanned: !user?.isBanned });
            }}
            onUserClick={(id) => { setSelectedProfileId(id); setCurrentView(View.PROFILE); }}
            onToggleAdmin={handleToggleAdmin}
          />
        )}
      </main>

      {!shouldHideNavbar && (
        <Navbar 
          activeView={selectedPostId ? '' : currentView} 
          onViewChange={(view) => {
            setIsChatConversationActive(false);
            setSelectedPostId(null);
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('post');
              window.history.pushState({}, '', url.toString());
            } catch {}
            if (view === View.PROFILE) {
              setSelectedProfileId(currentUser?.id || null);
            }
            setCurrentView(view);
            setSearchTerm('');
          }} 
          unreadCount={notifications.filter(n => !n.read).length}
        />
      )}

      {currentCall && currentUser && (
        <CallingOverlay
          activeCall={currentCall}
          currentUser={currentUser}
          users={users}
          onAccept={acceptCall}
          onDecline={declineCall}
          onEnd={endCall}
        />
      )}

      {/* POPUP KONFIRMASI HAPUS POSTINGAN */}
      {postToDelete && (
        <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border-2 border-black text-center animate-scale-up">
            <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-3.5 text-red-600 shadow-xs">
              <i className="fas fa-trash-can text-xl"></i>
            </div>
            <h3 className="text-base font-black text-neutral-900 tracking-tight">Hapus Postingan Ini?</h3>
            <p className="text-xs text-neutral-500 mt-1 mb-4 leading-relaxed">
              Apakah kamu yakin ingin menghapus postingan ini? Foto, video, komentar, dan suka di dalamnya akan dihapus secara permanen.
            </p>
            
            {postToDelete.text && (
              <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3 mb-5 text-left text-xs text-neutral-700 italic line-clamp-3">
                "{postToDelete.text}"
              </div>
            )}

            <div className="flex space-x-2.5">
              <button
                type="button"
                onClick={() => setPostToDelete(null)}
                className="flex-1 py-3 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition-all active:scale-95 border border-neutral-200/60 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDeletePost}
                className="flex-1 py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-wider transition-all active:scale-95 shadow-md flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                <i className="fas fa-trash-can text-[11px]"></i>
                <span>Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADS-UP POPUP CHAT NOTIFICATION */}
      <HeadsUpNotification
        payload={incomingChatPayload}
        onClose={() => setIncomingChatPayload(null)}
        onOpenChat={(targetId, type) => {
          if (type === 'group') {
            setTargetChatGroupId(targetId);
            setTargetChatUserId(null);
          } else {
            setTargetChatUserId(targetId);
            setTargetChatGroupId(null);
          }
          setCurrentView(View.CHAT);
        }}
        permissionStatus={notifPermission}
        onRequestPermission={requestNotifPermission}
      />

      {/* EXIT CONFIRMATION DIALOG (YAKIN KELUAR?) */}
      {isExitConfirmOpen && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl border border-neutral-100 text-center animate-scale-up">
            <div className="w-14 h-14 rounded-full bg-neutral-100 border border-neutral-200/80 flex items-center justify-center mx-auto mb-3.5 text-neutral-900 shadow-2xs">
              <i className="fas fa-arrow-right-from-bracket text-xl"></i>
            </div>
            <h3 className="text-base font-black text-neutral-900 tracking-tight">Yakin keluar?</h3>
            <p className="text-xs text-neutral-500 mt-1 mb-6 leading-relaxed">
              Apakah kamu yakin ingin meninggalkan dan keluar dari aplikasi Orbit?
            </p>
            <div className="flex space-x-2.5">
              <button
                type="button"
                onClick={() => setIsExitConfirmOpen(false)}
                className="flex-1 py-2.5 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition-all active:scale-95 border border-neutral-200/60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                className="flex-1 py-2.5 px-4 rounded-2xl bg-black hover:bg-neutral-800 text-white text-xs font-bold transition-all active:scale-95 shadow-xs flex items-center justify-center space-x-1.5"
              >
                <i className="fas fa-check text-[11px]"></i>
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
