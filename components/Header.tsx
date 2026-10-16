import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { useLanguage } from '../LanguageContext';

interface HeaderProps {
  onSearch: (term: string) => void;
  users: User[];
  onUserClick: (userId: string) => void;
  onLeaderboardClick: () => void;
  onShopClick?: () => void;
  isAdmin?: boolean;
  onAdminClick?: () => void;
  userCoins?: number;
}

const SEARCH_HISTORY_KEY = 'vimos_search_history_v1';

export const Header: React.FC<HeaderProps> = ({ 
  onSearch, 
  users, 
  onUserClick, 
  onLeaderboardClick, 
  onShopClick,
  isAdmin, 
  onAdminClick,
  userCoins = 500
}) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load search history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed);
        }
      }
    } catch {}
  }, []);

  const saveToHistory = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setSearchHistory(prev => {
      const filtered = prev.filter(item => item.toLowerCase() !== clean.toLowerCase());
      const updated = [clean, ...filtered].slice(0, 10);
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const removeHistoryItem = (term: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory(prev => {
      const updated = prev.filter(item => item !== term);
      try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const clearAllHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory([]);
    try {
      localStorage.removeItem(SEARCH_HISTORY_KEY);
    } catch {}
  };

  useEffect(() => {
    if (query.trim().length > 0) {
      const filtered = users.filter(u => 
        (u.name || '').toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6);
      setResults(filtered);
    } else {
      setResults([]);
    }
    onSearch(query);
  }, [query, users, onSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = (user: User) => {
    saveToHistory(user.name || 'User');
    onUserClick(user.id);
    setQuery('');
    setResults([]);
    setIsFocused(false);
  };

  const handleSelectHistoryItem = (term: string) => {
    setQuery(term);
    saveToHistory(term);
    onSearch(term);
    setIsFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (query.trim()) {
        saveToHistory(query);
        setIsFocused(false);
      }
    }
  };

  const showHistory = isFocused && query.trim().length === 0 && searchHistory.length > 0;
  const showResults = isFocused && query.trim().length > 0;

  return (
    <header className="sticky top-0 z-50 bg-white/95 border-b border-black/10 px-3.5 py-2.5 backdrop-blur-md shadow-xs">
      <div className="flex items-center w-full justify-between gap-2 max-w-4xl mx-auto">
        <div className="flex items-center shrink-0 cursor-pointer" onClick={() => onSearch('')}>
          <h1 className="text-lg font-black tracking-tighter text-black">VIMOS</h1>
        </div>

        <div className="flex-1 relative min-w-0" ref={dropdownRef}>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <i className="fas fa-search text-xs"></i>
          </span>
          <input
            type="search"
            value={query}
            placeholder={t('search')}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handleKeyDown}
            className="w-full bg-neutral-100/90 border border-transparent focus:border-black/20 focus:bg-white rounded-full pl-8 pr-8 py-1.5 text-xs text-black placeholder-neutral-400 focus:outline-none transition-all shadow-inner"
            onChange={(e) => setQuery(e.target.value)}
          />

          {query && (
            <button
              onClick={() => {
                setQuery('');
                onSearch('');
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black text-xs p-1"
              title="Hapus pencarian"
            >
              <i className="fas fa-times-circle"></i>
            </button>
          )}

          {/* Search History Dropdown */}
          {showHistory && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-black/10 rounded-2xl shadow-2xl overflow-hidden animate-fade-in z-50">
              <div className="p-2.5 px-3 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
                <div className="flex items-center space-x-1.5 text-[10px] font-black uppercase tracking-wider text-neutral-500">
                  <i className="fas fa-clock-rotate-left text-neutral-400"></i>
                  <span>Riwayat Pencarian</span>
                </div>
                <button
                  onClick={clearAllHistory}
                  className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:underline transition-colors uppercase tracking-tight cursor-pointer"
                >
                  Hapus Semua
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-neutral-50">
                {searchHistory.map((item, idx) => (
                  <div
                    key={`${item}_${idx}`}
                    onClick={() => handleSelectHistoryItem(item)}
                    className="flex items-center justify-between p-2.5 px-3 hover:bg-neutral-50 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-2">
                      <div className="w-6 h-6 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-[10px] shrink-0">
                        <i className="fas fa-magnifying-glass"></i>
                      </div>
                      <span className="text-xs font-semibold text-neutral-800 truncate">{item}</span>
                    </div>
                    <button
                      onClick={(e) => removeHistoryItem(item, e)}
                      className="text-neutral-300 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 transition-all text-xs cursor-pointer shrink-0"
                      title="Hapus dari riwayat"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results Dropdown */}
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-black/10 rounded-2xl shadow-2xl overflow-hidden animate-fade-in z-50">
              <div className="p-2.5 px-3 border-b border-neutral-100 bg-neutral-50/70 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                  Hasil Pencarian
                </p>
                <span className="text-[9px] font-bold text-neutral-400">
                  {results.length} pengguna
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto divide-y divide-neutral-50">
                {results.length > 0 ? (
                  results.map(user => {
                    const fallbackPhoto = `https://api.dicebear.com/7.x/initials/svg?seed=${user.name || 'Orbit'}&backgroundColor=000000&fontFamily=Inter&fontWeight=700`;
                    return (
                      <div 
                        key={user.id}
                        onClick={() => handleSelectUser(user)}
                        className="flex items-center p-2.5 px-3 hover:bg-black hover:text-white transition-all cursor-pointer group"
                      >
                        <img 
                          src={user.photoURL || fallbackPhoto} 
                          alt={user.name} 
                          className="w-8 h-8 rounded-full border border-black/10 mr-3 group-hover:border-white/20 object-cover shrink-0" 
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-extrabold text-xs truncate uppercase tracking-tight">{user.name || 'Unknown'}</p>
                          <p className="text-[9px] font-medium opacity-50 truncate">{(user.followers || []).length} Pengikut</p>
                        </div>
                        <i className="fas fa-arrow-right text-xs opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all"></i>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-4 text-center text-xs text-neutral-400 font-medium">
                    Tidak ada pengguna yang cocok dengan "{query}"
                  </div>
                )}

                {/* Quick search feed action */}
                <div 
                  onClick={() => {
                    saveToHistory(query);
                    setIsFocused(false);
                  }}
                  className="p-2.5 px-3 bg-neutral-50/50 hover:bg-neutral-100 text-xs font-bold text-neutral-700 flex items-center space-x-2 cursor-pointer transition-colors border-t border-neutral-100"
                >
                  <i className="fas fa-filter text-amber-500 text-xs"></i>
                  <span className="truncate">Cari postingan dengan kata: <strong className="text-black font-black">"{query}"</strong></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center shrink-0 space-x-1.5">
          <button 
            onClick={onLeaderboardClick}
            className="w-8 h-8 flex items-center justify-center border border-neutral-300 rounded-full hover:bg-black hover:text-white transition-all active:scale-90 text-neutral-800 cursor-pointer"
            title="Elite Rankings"
          >
            <i className="fas fa-medal text-xs"></i>
          </button>

          {onShopClick && (
            <button 
              onClick={onShopClick}
              className="h-8 px-2 sm:px-3 flex items-center justify-center space-x-1 border border-neutral-900 bg-yellow-400 hover:bg-yellow-300 text-black rounded-full transition-all active:scale-90 shadow-xs cursor-pointer"
              title={t('shop')}
            >
              <i className="fas fa-store text-xs"></i>
              <span className="text-[10px] font-black uppercase hidden sm:inline">{t('shop')}</span>
            </button>
          )}

          {isAdmin && (
            <button 
              onClick={onAdminClick}
              className="w-8 h-8 flex items-center justify-center border border-black bg-black text-white rounded-full hover:bg-white hover:text-black transition-all active:scale-90 shadow-xs cursor-pointer"
              title={t('admin')}
            >
              <i className="fas fa-shield-halved text-xs"></i>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
