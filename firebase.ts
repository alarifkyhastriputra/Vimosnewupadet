
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  initializeAuth, 
  browserLocalPersistence, 
  indexedDBLocalPersistence, 
  browserSessionPersistence, 
  browserPopupRedirectResolver,
  getAuth 
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getAnalytics, isSupported } from 'firebase/analytics';

export const firebaseConfig = {
  apiKey: "AIzaSyA3SVbGNE34805jokZxFz6kWlY7do4i4qc",
  authDomain: "chiutchiyu.firebaseapp.com",
  databaseURL: "https://chiutchiyu-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chiutchiyu",
  storageBucket: "chiutchiyu.firebasestorage.app",
  messagingSenderId: "685811847893",
  appId: "1:685811847893:web:76f1173a63cb8de427085c",
  measurementId: "G-GN6PGS2L7R"
};

// Initialize Firebase
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export { browserPopupRedirectResolver };
export const db = getDatabase(app);

// Initialize Firebase Analytics if supported in the browser environment
export let analytics: any = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Graceful fallback if analytics is blocked or unsupported in context
  });
}


