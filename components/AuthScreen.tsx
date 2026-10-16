import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase.ts';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';
import { ref, get, set, update } from 'firebase/database';
import { useLanguage, Language } from '../LanguageContext.tsx';

interface AuthScreenProps {
  bannedMessage?: string | null;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ bannedMessage }) => {
  const { language, setLanguage, t } = useLanguage();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  const languages: { code: Language; label: string; flag: string }[] = [
    { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
    { code: 'ja', label: '日本語', flag: '🇯🇵' },
    { code: 'zh', label: '中文', flag: '🇨🇳' },
  ];

  const currentLangObj = languages.find(l => l.code === language) || languages[0];

  // Check for redirect result if redirect mode was utilized
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (userCredential) => {
        if (userCredential?.user) {
          const user = userCredential.user;
          const userRef = ref(db, `users/${user.uid}`);
          const snap = await get(userRef);
          const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Member');
          const photoURL = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.uid}&backgroundColor=000000`;

          if (!snap.exists()) {
            await set(userRef, {
              name: displayName,
              email: user.email || '',
              bio: 'A wandering soul in Vimos.',
              photoURL,
              followers: {},
              following: {},
              recentCaptures: {},
              totalLikes: 0,
              isAdmin: false,
              createdAt: Date.now(),
              lastSeen: Date.now()
            });
          } else {
            await update(userRef, {
              lastSeen: Date.now(),
              ...(user.photoURL ? { photoURL: user.photoURL } : {})
            });
          }
        }
      })
      .catch((err) => {
        if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
          console.warn('Redirect sign-in notice:', err?.message || err);
        }
      });
  }, []);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let userCredential;
      try {
        userCredential = await signInWithPopup(auth, provider);
      } catch (popupErr: any) {
        if (popupErr?.code === 'auth/popup-closed-by-user' || popupErr?.code === 'auth/cancelled-popup-request') {
          // User deliberately dismissed the popup window, handle smoothly
          setLoading(false);
          return;
        }

        if (popupErr?.code === 'auth/popup-blocked') {
          // Fallback to redirect if popup is blocked by browser
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupErr;
      }

      const user = userCredential.user;
      if (user) {
        // Ensure user node exists in Realtime Database
        const userRef = ref(db, `users/${user.uid}`);
        const snap = await get(userRef);

        const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Member');
        const photoURL = user.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${user.uid}&backgroundColor=000000`;

        if (!snap.exists()) {
          await set(userRef, {
            name: displayName,
            email: user.email || '',
            bio: 'A wandering soul in Vimos.',
            photoURL,
            followers: {},
            following: {},
            recentCaptures: {},
            totalLikes: 0,
            isAdmin: false,
            createdAt: Date.now(),
            lastSeen: Date.now()
          });
        } else {
          // Update lastSeen and photoURL if available
          await update(userRef, {
            lastSeen: Date.now(),
            ...(user.photoURL ? { photoURL: user.photoURL } : {})
          });
        }
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        // User voluntarily closed the window - graceful return
        setError('');
        setLoading(false);
        return;
      }

      console.warn('Google Sign-In Notice:', err?.code, err?.message);
      if (err?.code === 'auth/unauthorized-domain') {
        setError(
          'Domain aplikasi ini belum diizinkan di Firebase Console. ' +
          'Buka Firebase Console > Authentication > Settings > Authorized domains, dan tambahkan domain web ini.'
        );
      } else if (err?.code === 'auth/network-request-failed') {
        setError('Koneksi internet bermasalah. Silakan periksa jaringan Anda.');
      } else {
        setError(err?.message || 'Gagal masuk dengan Akun Google. Silakan coba kembali.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen p-6 bg-white max-w-xl mx-auto border-x border-gray-100">
      {/* Top Language Switcher Bar */}
      <div className="absolute top-5 right-5 z-20">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full border border-black/10 hover:border-black/30 bg-neutral-50 hover:bg-neutral-100 text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <span>{currentLangObj.flag}</span>
            <span className="uppercase text-[11px] tracking-wider">{currentLangObj.code}</span>
            <i className={`fas fa-chevron-down text-[9px] text-neutral-400 transition-transform ${showLangMenu ? 'rotate-180' : ''}`}></i>
          </button>

          {showLangMenu && (
            <>
              <div 
                className="fixed inset-0 z-30" 
                onClick={() => setShowLangMenu(false)}
              />
              <div className="absolute right-0 mt-2 w-44 bg-white border border-neutral-200 rounded-2xl shadow-xl z-40 py-1 overflow-hidden animate-fade-in">
                <div className="px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-widest text-neutral-400 border-b border-neutral-100">
                  {t('auth_change_language')}
                </div>
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => {
                      setLanguage(lang.code);
                      setShowLangMenu(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs font-bold flex items-center justify-between transition-colors cursor-pointer ${
                      language === lang.code 
                        ? 'bg-neutral-900 text-white' 
                        : 'text-neutral-700 hover:bg-neutral-100'
                    }`}
                  >
                    <span className="flex items-center space-x-2">
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </span>
                    {language === lang.code && (
                      <i className="fas fa-check text-[10px]"></i>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="text-center mb-8">
        <h1 className="text-6xl font-black tracking-tighter mb-2 text-black">VIMOS</h1>
        <p className="text-xs uppercase tracking-[0.35em] font-extrabold text-neutral-400">
          Monochrome Social Network
        </p>
      </div>

      {/* Quick Language Pills below title */}
      <div className="flex items-center justify-center space-x-1.5 mb-8 p-1 bg-neutral-100 rounded-full border border-black/5">
        {languages.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => setLanguage(lang.code)}
            className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all flex items-center space-x-1 cursor-pointer ${
              language === lang.code
                ? 'bg-black text-white shadow-xs'
                : 'text-neutral-500 hover:text-black hover:bg-neutral-200/60'
            }`}
          >
            <span>{lang.flag}</span>
            <span>{lang.code.toUpperCase()}</span>
          </button>
        ))}
      </div>

      {/* Main Google Login Card */}
      <div className="w-full max-w-md bg-neutral-50/70 border border-neutral-200 rounded-3xl p-6 sm:p-8 text-center shadow-xs">
        <div className="w-14 h-14 rounded-2xl bg-white border border-neutral-200 flex items-center justify-center mx-auto mb-4 shadow-2xs">
          <svg className="w-7 h-7" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.27-2.09 3.66-5.17 3.66-9.12z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.13C3.27 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.58H1.26C.46 8.18 0 9.99 0 12s.46 3.82 1.26 5.42l4.02-3.13z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.27 2.64 1.26 6.58l4.02 3.13c.95-2.83 3.6-4.96 6.72-4.96z"
            />
          </svg>
        </div>

        <h2 className="text-lg font-black uppercase tracking-tight text-neutral-900 mb-1.5">
          Masuk dengan Akun Google
        </h2>
        <p className="text-xs text-neutral-500 font-medium leading-relaxed mb-6">
          Akses seluruh fitur Vimos secara instan, aman, dan tanpa perlu repot mengetik kata sandi.
        </p>

        {bannedMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-500 text-xs font-bold uppercase text-center text-red-600 animate-pulse rounded-xl">
            {bannedMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-xs font-bold text-center text-red-600 rounded-xl leading-relaxed">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-black hover:bg-neutral-800 text-white p-4 rounded-2xl font-black uppercase text-xs tracking-wider transition-all flex items-center justify-center space-x-3 shadow-md active:scale-98 disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <div className="flex items-center space-x-2">
              <i className="fas fa-circle-notch fa-spin text-sm"></i>
              <span>Menghubungkan ke Google...</span>
            </div>
          ) : (
            <>
              <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center p-0.5 shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.27-2.09 3.66-5.17 3.66-9.12z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.13C3.27 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.58H1.26C.46 8.18 0 9.99 0 12s.46 3.82 1.26 5.42l4.02-3.13z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.27 2.64 1.26 6.58l4.02 3.13c.95-2.83 3.6-4.96 6.72-4.96z"
                  />
                </svg>
              </div>
              <span>Lanjutkan dengan Akun Google</span>
            </>
          )}
        </button>

        <div className="mt-6 flex items-center justify-center space-x-2 text-[11px] text-neutral-400 font-semibold">
          <i className="fas fa-shield-halved text-green-600"></i>
          <span>Autentikasi Resmi & Terproteksi Google Identity</span>
        </div>
      </div>

      <div className="mt-8 text-center text-[10px] text-neutral-400 uppercase tracking-widest font-bold">
        Vimos &copy; 2026 • Single Sign-On via Google
      </div>
    </div>
  );
};

export default AuthScreen;
