
import React from 'react';
import { View } from '../types';
import { useLanguage } from '../LanguageContext';

interface NavbarProps {
  activeView: View;
  onViewChange: (view: View) => void;
  unreadCount?: number;
}

const Navbar: React.FC<NavbarProps> = ({ activeView, onViewChange, unreadCount = 0 }) => {
  const { t } = useLanguage();

  const primaryTabs = [
    { id: View.FEED, icon: 'fa-house', label: t('home') },
    { id: View.REELS, icon: 'fa-film', label: t('reels') },
    { id: View.SHOP, icon: 'fa-bag-shopping', label: t('shop') },
    { id: View.POST, icon: 'fa-plus', label: t('create'), isAction: true },
    { id: View.NOTIFICATIONS, icon: 'fa-bell', label: t('alerts'), count: unreadCount },
    { id: View.CHAT, icon: 'fa-comment-dots', label: t('inbox') },
    { id: View.PROFILE, icon: 'fa-user', label: t('you') },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center pb-safe">
      <nav className="pointer-events-auto w-full max-w-xl mx-auto bg-white/95 backdrop-blur-xl border-t border-neutral-200 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] px-1.5 py-1.5 flex items-center justify-between transition-all">
        {primaryTabs.map((tab) => {
          const isActive = activeView === tab.id;

          if (tab.isAction) {
            return (
              <button
                key={tab.id}
                onClick={() => onViewChange(tab.id)}
                className="flex-1 flex flex-col items-center justify-center group focus:outline-none"
                title={tab.label}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm ${
                  isActive 
                    ? 'bg-black text-white scale-105 ring-2 ring-neutral-400' 
                    : 'bg-neutral-900 text-white hover:bg-black hover:scale-105 active:scale-95'
                }`}>
                  <i className="fas fa-plus text-xs font-black"></i>
                </div>
                <span className="text-[8px] font-extrabold uppercase tracking-tight text-neutral-800 mt-0.5">
                  {tab.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1 rounded-xl transition-all duration-150 relative group focus:outline-none ${
                isActive ? 'scale-[1.03]' : 'hover:bg-neutral-100/60 active:scale-95'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <i className={`fas ${tab.icon} text-base transition-colors duration-150 ${
                  isActive 
                    ? 'text-black font-black' 
                    : 'text-neutral-400 group-hover:text-neutral-700'
                }`}></i>

                {/* Badge unread count */}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-600 text-white text-[8px] font-black h-3.5 min-w-[14px] px-1 flex items-center justify-center rounded-full border border-white shadow-sm">
                    {tab.count > 9 ? '9+' : tab.count}
                  </span>
                )}
              </div>

              <span className={`text-[8.5px] font-bold tracking-tighter mt-1 transition-colors leading-none whitespace-nowrap overflow-hidden text-ellipsis ${
                isActive 
                  ? 'text-black font-black'
                  : 'text-neutral-400 group-hover:text-neutral-600'
              }`}>
                {tab.label}
              </span>

              {/* Active Indicator Bar */}
              {isActive && (
                <div className="h-0.5 w-3 rounded-full mt-1 bg-black" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default Navbar;

