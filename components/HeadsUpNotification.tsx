import React, { useEffect, useState } from 'react';
import { User, Group, View } from '../types.ts';

export interface IncomingMessagePayload {
  id: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  text: string;
  timestamp: number;
  chatType: 'user' | 'group' | 'shop';
  targetId: string; // userId or groupId
  groupName?: string;
}

interface HeadsUpNotificationProps {
  payload: IncomingMessagePayload | null;
  onClose: () => void;
  onOpenChat: (targetId: string, type: 'user' | 'group' | 'shop') => void;
  permissionStatus: NotificationPermission | 'unsupported';
  onRequestPermission: () => void;
}

// Audio chime using Web Audio API (No external file dependencies needed)
export const playChatNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Tone 2: 880 Hz (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0.22, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.45);
  } catch (err) {
    console.warn('Could not play notification sound:', err);
  }
};

export const HeadsUpNotification: React.FC<HeadsUpNotificationProps> = ({
  payload,
  onClose,
  onOpenChat,
  permissionStatus,
  onRequestPermission
}) => {
  useEffect(() => {
    if (!payload) return;

    // Play chime sound
    playChatNotificationSound();

    // Trigger Browser Native Notification if granted
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const title = payload.chatType === 'group'
          ? `${payload.senderName} (${payload.groupName || 'Grup'})`
          : payload.senderName;

        const notif = new Notification(title, {
          body: payload.text || 'Mengirim pesan baru',
          icon: payload.senderPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${payload.senderId}`,
          tag: 'vimos_msg_' + payload.id,
        });

        notif.onclick = () => {
          window.focus();
          onOpenChat(payload.targetId, payload.chatType);
          onClose();
        };
      } catch (err) {
        console.warn('Native notification error:', err);
      }
    }

    // Auto dismiss Heads-Up banner after 5 seconds
    const timer = setTimeout(() => {
      onClose();
    }, 5000);

    return () => clearTimeout(timer);
  }, [payload]);

  if (!payload) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[92%] animate-bounce-in">
      <div className="bg-black/95 text-white rounded-2xl p-3.5 shadow-2xl border border-white/20 flex items-center justify-between space-x-3 backdrop-blur-md">
        <div 
          onClick={() => {
            onOpenChat(payload.targetId, payload.chatType);
            onClose();
          }}
          className="flex items-center space-x-3 flex-1 cursor-pointer min-w-0"
        >
          <div className="relative flex-shrink-0">
            <img
              src={payload.senderPhoto || `https://api.dicebear.com/7.x/initials/svg?seed=${payload.senderId}`}
              alt={payload.senderName}
              className="w-10 h-10 rounded-full object-cover border border-white/30 shadow-sm"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-green-500 border-2 border-black rounded-full animate-pulse"></span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="font-extrabold text-xs text-white truncate max-w-[170px]">
                {payload.chatType === 'group' ? `${payload.senderName} @ ${payload.groupName}` : payload.senderName}
              </p>
              <span className="text-[9px] text-gray-400 font-medium">Baru saja</span>
            </div>
            <p className="text-xs text-gray-300 truncate mt-0.5 leading-snug">
              {payload.text}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1 pl-2 border-l border-white/10 flex-shrink-0">
          <button
            onClick={() => {
              onOpenChat(payload.targetId, payload.chatType);
              onClose();
            }}
            className="bg-white text-black text-[10px] font-black px-2.5 py-1.5 rounded-xl hover:bg-gray-200 transition-colors uppercase tracking-wider"
          >
            Buka
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors text-xs"
            title="Tutup"
          >
            <i className="fas fa-xmark"></i>
          </button>
        </div>
      </div>
    </div>
  );
};
