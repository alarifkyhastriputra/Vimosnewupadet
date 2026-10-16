import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types.ts';
import { useLanguage } from '../LanguageContext.tsx';
import { db } from '../firebase.ts';
import { ref, onValue, set, push } from 'firebase/database';

export interface ActiveCall {
  id: string;
  type: 'private' | 'collective';
  mediaType: 'audio' | 'video';
  callerId: string;
  callerName: string;
  callerPhoto: string;
  receiverId?: string;
  groupId?: string;
  groupName?: string;
  status: 'calling' | 'ringing' | 'connected' | 'ended';
  timestamp: number;
  activeParticipants?: Record<string, boolean>;
}

interface CallingOverlayProps {
  activeCall: ActiveCall;
  currentUser: User;
  users: User[];
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
}

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// ============================================================================
// AUDIO SYNTHESIZER FOR TELEPHONE SOUNDS (Web Audio API)
// ============================================================================
class CallAudioSynthesizer {
  private ctx: AudioContext | null = null;
  private ringInterval: any = null;

  private getContext(): AudioContext | null {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  // Outgoing phone ringback tone (Dual 440Hz + 480Hz beep every 3.5 seconds)
  public startOutgoingRing() {
    this.stop();
    const playBurst = () => {
      const ctx = this.getContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(440, now);
        osc2.frequency.setValueAtTime(480, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.05);
        gain.gain.setValueAtTime(0.15, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.35);
        osc2.stop(now + 1.35);
      } catch {}
    };

    playBurst();
    this.ringInterval = setInterval(playBurst, 3500);
  }

  // Incoming melodic smartphone ringtone
  public startIncomingRing() {
    this.stop();
    const playMelody = () => {
      const ctx = this.getContext();
      if (!ctx) return;
      try {
        const notes = [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50];
        const now = ctx.currentTime;

        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.18;

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, noteStart);

          gain.gain.setValueAtTime(0.001, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.2, noteStart + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.25);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteStart);
          osc.stop(noteStart + 0.3);
        });
      } catch {}
    };

    playMelody();
    this.ringInterval = setInterval(playMelody, 2600);
  }

  // Connected chime
  public playConnectedChime() {
    this.stop();
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + idx * 0.12;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.18, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + 0.25);
      });
    } catch {}
  }

  // Call ended chime
  public playEndedChime() {
    this.stop();
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [440, 330, 220].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + idx * 0.1;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.15, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + 0.2);
      });
    } catch {}
  }

  public stop() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }
}

const callAudio = new CallAudioSynthesizer();

// Fallback stream generator if hardware camera/mic is denied or unavailable
const createFallbackStream = (userName: string, isVideo = true): MediaStream => {
  const stream = new MediaStream();

  // Virtual audio track using silent AudioContext oscillator
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.00001; // inaudible
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
  } catch {}

  // Virtual video track using dynamic canvas
  if (isVideo) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#09090b';
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#3f3f46';
        ctx.beginPath();
        ctx.arc(320, 210, 80, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((userName || 'V').substring(0, 1).toUpperCase(), 320, 210);
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(userName || 'Pengguna', 320, 330);
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '14px sans-serif';
        ctx.fillText('Mode Tanpa Kamera', 320, 360);

        const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(10) : null;
        if (canvasStream) {
          canvasStream.getVideoTracks().forEach((t: MediaStreamTrack) => stream.addTrack(t));
        }
      }
    } catch {}
  }

  return stream;
};

const CallingOverlay: React.FC<CallingOverlayProps> = ({
  activeCall,
  currentUser,
  users,
  onAccept,
  onDecline,
  onEnd
}) => {
  const { t } = useLanguage();
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteState, setRemoteState] = useState<{ isMuted: boolean; isCameraOff: boolean } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [isRequestingDevice, setIsRequestingDevice] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const outgoingLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const isCaller = activeCall.callerId === currentUser.id;
  const isJoined = activeCall.activeParticipants?.[currentUser.id] === true;

  const showIncoming = !isCaller && !isJoined && activeCall.status !== 'connected';
  const showOutgoing = isCaller && activeCall.status !== 'connected';
  const showConnected = activeCall.status === 'connected' || isJoined;

  // Sound Synthesizer control
  useEffect(() => {
    if (activeCall.status === 'ended') {
      callAudio.playEndedChime();
      return;
    }

    if (showIncoming) {
      callAudio.startIncomingRing();
    } else if (showOutgoing) {
      callAudio.startOutgoingRing();
    } else if (showConnected) {
      callAudio.playConnectedChime();
    } else {
      callAudio.stop();
    }

    return () => {
      callAudio.stop();
    };
  }, [showIncoming, showOutgoing, showConnected, activeCall.status]);

  // Duration timer
  useEffect(() => {
    let timer: any;
    if (showConnected) {
      timer = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(timer);
  }, [showConnected]);

  // Acquire media stream with progressive fallbacks
  const requestMedia = async (userInitiated = false) => {
    setIsRequestingDevice(true);
    setCameraError(null);

    const isVideo = activeCall.mediaType === 'video';

    // 1. Try real hardware devices with flexible constraints
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo ? true : false
      });

      setLocalStream(stream);
      setIsPermissionDenied(false);
      setCameraError(null);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      if (outgoingLocalVideoRef.current) {
        outgoingLocalVideoRef.current.srcObject = stream;
        outgoingLocalVideoRef.current.play().catch(() => {});
      }
      setIsRequestingDevice(false);
      return;
    } catch (err: any) {
      console.warn("First hardware getUserMedia attempt failed:", err);

      // If video failed, attempt audio-only
      if (isVideo) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setLocalStream(audioStream);
          setIsPermissionDenied(false);
          setCameraError("Kamera tidak diizinkan. Melanjutkan dengan mode suara saja.");
          setIsRequestingDevice(false);
          return;
        } catch (audioErr) {
          console.warn("Audio-only attempt also failed:", audioErr);
        }
      }

      // If browser explicitly denied permission or policy blocked it
      setIsPermissionDenied(true);
      setCameraError("Akses kamera atau mikrofon belum diizinkan oleh peramban browser.");
      if (userInitiated) {
        setShowPermissionGuide(true);
      }

      // Safe fallback stream so WebRTC connection doesn't break
      const fallback = createFallbackStream(currentUser.name || 'Pengguna', isVideo);
      setLocalStream(fallback);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = fallback;
      }
      if (outgoingLocalVideoRef.current) {
        outgoingLocalVideoRef.current.srcObject = fallback;
      }
      setIsRequestingDevice(false);
    }
  };

  // Initial media request on mount / state change
  useEffect(() => {
    const shouldStartMedia = showConnected || showOutgoing || (showIncoming && activeCall.mediaType === 'video');
    if (shouldStartMedia) {
      requestMedia(false);
    }
  }, [showConnected, showOutgoing, showIncoming, activeCall.mediaType]);

  // Synchronize local video elements whenever localStream updates
  useEffect(() => {
    if (localStream) {
      if (localVideoRef.current && localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
        localVideoRef.current.play().catch(() => {});
      }
      if (outgoingLocalVideoRef.current && outgoingLocalVideoRef.current.srcObject !== localStream) {
        outgoingLocalVideoRef.current.srcObject = localStream;
        outgoingLocalVideoRef.current.play().catch(() => {});
      }
    }
  }, [localStream, showConnected, showOutgoing, isCameraOff]);

  // Remote audio output element
  useEffect(() => {
    if (remoteStream) {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.play().catch(err => {
          console.warn("Autoplay remote audio blocked, will play on user interaction:", err);
        });
      }
      if (remoteVideoRef.current && activeCall.mediaType === 'video') {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.play().catch(() => {});
      }
    }
  }, [remoteStream, activeCall.mediaType]);

  // Sync mute & cameraOff state to Firebase
  useEffect(() => {
    if (showConnected) {
      const stateRef = ref(db, `calls/${activeCall.id}/participantsState/${currentUser.id}`);
      set(stateRef, {
        isMuted,
        isCameraOff
      }).catch(() => {});
    }
  }, [isMuted, isCameraOff, showConnected, activeCall.id, currentUser.id]);

  // Read remote participant's state (mute / cameraOff)
  useEffect(() => {
    if (showConnected) {
      const targetId = isCaller ? activeCall.receiverId : activeCall.callerId;
      if (targetId) {
        const remoteStateRef = ref(db, `calls/${activeCall.id}/participantsState/${targetId}`);
        const unsubscribe = onValue(remoteStateRef, (snapshot) => {
          setRemoteState(snapshot.val());
        });
        return () => unsubscribe();
      }
    }
  }, [showConnected, isCaller, activeCall.id, activeCall.receiverId, activeCall.callerId]);

  // WebRTC Signal & Peer Connection Establishment
  useEffect(() => {
    if (!showConnected || !localStream) return;

    const pc = new RTCPeerConnection(iceServers);
    peerConnection.current = pc;
    pendingCandidates.current = [];

    // Add local tracks to peer connection
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Handle incoming track
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        setRemoteStream(stream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
        }
      }
    };

    // Gather ICE candidates and push them to database
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidatePath = `calls/${activeCall.id}/signal/${isCaller ? 'callerCandidates' : 'receiverCandidates'}`;
        const newCandidateRef = push(ref(db, candidatePath));
        set(newCandidateRef, event.candidate.toJSON()).catch(() => {});
      }
    };

    // Signaling references
    const offerRef = ref(db, `calls/${activeCall.id}/signal/offer`);
    const answerRef = ref(db, `calls/${activeCall.id}/signal/answer`);
    const callerCandidatesRef = ref(db, `calls/${activeCall.id}/signal/callerCandidates`);
    const receiverCandidatesRef = ref(db, `calls/${activeCall.id}/signal/receiverCandidates`);

    let unsubscribeOffer: () => void = () => {};
    let unsubscribeAnswer: () => void = () => {};
    let unsubscribeCandidates: () => void = () => {};

    const applyCandidate = (candidateData: any) => {
      if (!pc || !candidateData) return;
      if (pc.remoteDescription && pc.remoteDescription.type) {
        pc.addIceCandidate(new RTCIceCandidate(candidateData)).catch(() => {});
      } else {
        pendingCandidates.current.push(candidateData);
      }
    };

    const flushPendingCandidates = () => {
      if (!pc || !pc.remoteDescription) return;
      while (pendingCandidates.current.length > 0) {
        const cand = pendingCandidates.current.shift();
        if (cand) {
          pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      }
    };

    if (isCaller) {
      // 1. Create and send offer
      pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: activeCall.mediaType === 'video' })
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          set(offerRef, {
            type: pc.localDescription?.type,
            sdp: pc.localDescription?.sdp
          });
        })
        .catch((err) => console.error("Error creating offer", err));

      // 2. Listen for answer
      unsubscribeAnswer = onValue(answerRef, (snapshot) => {
        const answer = snapshot.val();
        if (answer && pc.signalingState !== 'stable') {
          pc.setRemoteDescription(new RTCSessionDescription(answer))
            .then(() => flushPendingCandidates())
            .catch((err) => console.error("Error setting remote description for answer", err));
        }
      });

      // 3. Listen for receiver candidates
      unsubscribeCandidates = onValue(receiverCandidatesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          Object.values(data).forEach((candidateData: any) => {
            applyCandidate(candidateData);
          });
        }
      });
    } else {
      // Receiver side
      // 1. Listen for offer and create answer
      unsubscribeOffer = onValue(offerRef, (snapshot) => {
        const offer = snapshot.val();
        if (offer && pc.signalingState !== 'have-local-offer') {
          pc.setRemoteDescription(new RTCSessionDescription(offer))
            .then(() => {
              flushPendingCandidates();
              return pc.createAnswer();
            })
            .then((answer) => pc.setLocalDescription(answer))
            .then(() => {
              set(answerRef, {
                type: pc.localDescription?.type,
                sdp: pc.localDescription?.sdp
              });
            })
            .catch((err) => console.error("Error setting offer or creating answer", err));
        }
      });

      // 2. Listen for caller candidates
      unsubscribeCandidates = onValue(callerCandidatesRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          Object.values(data).forEach((candidateData: any) => {
            applyCandidate(candidateData);
          });
        }
      });
    }

    return () => {
      unsubscribeOffer();
      unsubscribeAnswer();
      unsubscribeCandidates();
      pc.close();
      peerConnection.current = null;
      setRemoteStream(null);
    };
  }, [showConnected, localStream, isCaller, activeCall.id, activeCall.mediaType]);

  // Format calling duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle audio track
  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsMuted(!isMuted);
  };

  // Toggle video track
  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
    }
    setIsCameraOff(!isCameraOff);
  };

  // Find target participant info (for private call)
  const targetUser = users.find(u => 
    activeCall.type === 'private' && (isCaller ? u.id === activeCall.receiverId : u.id === activeCall.callerId)
  );

  const callTitle = activeCall.type === 'private' 
    ? (targetUser?.name || activeCall.callerName)
    : (activeCall.groupName || t('collective_call'));

  const callPhoto = activeCall.type === 'private'
    ? (targetUser?.photoURL || activeCall.callerPhoto)
    : undefined;

  return (
    <div className="fixed inset-0 z-[999] bg-zinc-950 text-white flex flex-col justify-between p-6 animate-fade-in select-none">
      
      {/* Remote Audio Output Element - MUST NOT be display:none so browser audio output stays active */}
      <audio 
        ref={remoteAudioRef} 
        autoPlay 
        playsInline 
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {/* Full-screen Background Video for Connected Video Calls */}
      {activeCall.mediaType === 'video' && showConnected && (
        <div className="absolute inset-0 w-full h-full bg-black z-0 overflow-hidden">
          {remoteStream && !(remoteState?.isCameraOff) ? (
            <video 
              ref={(el) => {
                remoteVideoRef.current = el;
                if (el && remoteStream && el.srcObject !== remoteStream) {
                  el.srcObject = remoteStream;
                  el.play().catch(() => {});
                }
              }}
              autoPlay 
              playsInline 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center space-y-4 bg-zinc-900">
              <div className="w-28 h-28 rounded-full border-4 border-white/10 p-1 bg-zinc-800 relative shadow-2xl">
                <div className="absolute -inset-2 rounded-full bg-blue-500/10 animate-ping"></div>
                {callPhoto ? (
                  <img src={callPhoto} className="w-full h-full rounded-full object-cover" alt={callTitle} />
                ) : (
                  <div className="w-full h-full rounded-full bg-blue-600 flex items-center justify-center text-3xl font-black">
                    {callTitle.substring(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                {remoteState?.isCameraOff ? "Kamera Teman Dimatikan" : "Menghubungkan Video Teman..."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Camera Preview for Caller during Outgoing Video Call */}
      {activeCall.mediaType === 'video' && showOutgoing && (
        <div className="absolute inset-0 w-full h-full bg-black z-0 overflow-hidden">
          {localStream && !isCameraOff ? (
            <video 
              ref={(el) => {
                outgoingLocalVideoRef.current = el;
                if (el && localStream && el.srcObject !== localStream) {
                  el.srcObject = localStream;
                  el.play().catch(() => {});
                }
              }}
              autoPlay 
              playsInline 
              muted
              className="w-full h-full object-cover scale-x-[-1]"
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
              <i className="fas fa-video-slash text-5xl text-zinc-700"></i>
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-2xs pointer-events-none"></div>
        </div>
      )}

      {/* Floating Picture-in-Picture Local Stream for Video Calls when Connected */}
      {activeCall.mediaType === 'video' && showConnected && (
        <div className="absolute top-24 right-4 w-32 h-44 bg-zinc-900 rounded-3xl border-2 border-white/20 shadow-2xl overflow-hidden z-20 transition-all">
          {!isCameraOff && localStream ? (
            <video 
              ref={(el) => {
                localVideoRef.current = el;
                if (el && localStream && el.srcObject !== localStream) {
                  el.srcObject = localStream;
                  el.play().catch(() => {});
                }
              }}
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover scale-x-[-1]" 
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 p-2 text-center">
              <div className="w-10 h-10 rounded-full border border-white/10 overflow-hidden mb-1">
                <img 
                  src={currentUser.photoURL || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.name}`} 
                  className="w-full h-full object-cover" 
                  alt={currentUser.name} 
                />
              </div>
              <span className="text-[9px] font-bold text-zinc-400">Kamera Mati</span>
            </div>
          )}
          <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider text-white">
            Anda
          </div>
        </div>
      )}

      {/* Top Bar Status / Header */}
      <div className="flex flex-col items-center mt-12 space-y-2 z-10">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400 bg-blue-500/20 px-3.5 py-1.5 rounded-full border border-blue-400/30 backdrop-blur-md shadow-xs">
          {activeCall.mediaType === 'video' ? '🎥 ' + t('video_call') : '📞 ' + t('audio_call')}
        </span>
        
        {showConnected ? (
          <span className="text-base font-bold tracking-widest font-mono text-emerald-400 bg-black/50 px-3 py-1 rounded-full border border-emerald-500/30 backdrop-blur-md">
            {formatDuration(duration)}
          </span>
        ) : (
          <span className="text-sm font-black tracking-widest animate-pulse text-zinc-300 uppercase bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">
            {showIncoming ? '🔔 ' + t('incoming_call') : '⏳ Menghubungi...'}
          </span>
        )}

        {/* Interactive Permission Banner if Camera/Mic is Blocked */}
        {isPermissionDenied && (
          <div className="mt-2 p-3 bg-red-950/90 border border-red-500/80 rounded-2xl max-w-sm w-full mx-auto text-center space-y-2 backdrop-blur-md shadow-2xl animate-fade-in">
            <div className="flex items-center justify-center space-x-1.5 text-red-400 text-xs font-bold">
              <i className="fas fa-triangle-exclamation"></i>
              <span>Izin Kamera & Mikrofon Diperlukan</span>
            </div>
            <p className="text-[10px] text-zinc-300 leading-relaxed">
              Browser belum mengizinkan akses kamera atau mikrofon. Klik tombol di bawah untuk meminta izin ulang:
            </p>

            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => requestMedia(true)}
                disabled={isRequestingDevice}
                className="px-3 py-1.5 bg-white hover:bg-neutral-200 text-black text-[10px] font-black uppercase rounded-xl transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isRequestingDevice ? 'Memeriksa...' : 'Izinkan Sekarang'}
              </button>

              <button
                type="button"
                onClick={() => setShowPermissionGuide(!showPermissionGuide)}
                className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-200 text-[10px] font-bold uppercase rounded-xl transition-all border border-red-500/40 cursor-pointer"
              >
                {showPermissionGuide ? 'Tutup Panduan' : 'Lihat Cara Buka Izin'}
              </button>
            </div>

            {/* Step-by-Step Instructions */}
            {showPermissionGuide && (
              <div className="pt-2 border-t border-red-800/80 text-[10px] text-left text-zinc-300 space-y-1.5">
                <p className="font-bold text-white">Cara Mengizinkan di Browser:</p>
                <div className="bg-black/50 p-2.5 rounded-xl space-y-1 text-[9px] leading-relaxed">
                  <p>1. Di bilah alamat web atas (URL), klik ikon 🔒 <strong>Gembok</strong> atau ⚙️ <strong>Setelan</strong>.</p>
                  <p>2. Cari menu <strong>Kamera</strong> dan <strong>Mikrofon</strong>, lalu ubah statusnya menjadi <strong>Izinkan (Allow)</strong>.</p>
                  <p>3. Setelah itu, tekan tombol <strong>"Izinkan Sekarang"</strong> di atas.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main visual display area (Shown for Voice Calls or Incoming Call Screen) */}
      <div className="flex-1 flex flex-col items-center justify-center relative my-6">
        {(!showConnected || activeCall.mediaType === 'audio') && (
          <div className="flex flex-col items-center space-y-6 z-10 text-center">
            
            {/* Pulse rings background */}
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-blue-500/20 animate-ping" style={{ animationDuration: '3s' }}></div>
              <div className="absolute -inset-8 rounded-full bg-blue-500/10 animate-ping" style={{ animationDuration: '4s' }}></div>
              
              <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-full border-4 border-white/20 p-1 bg-zinc-900 relative z-10 shadow-2xl overflow-hidden">
                {callPhoto ? (
                  <img src={callPhoto} className="w-full h-full rounded-full object-cover" alt={callTitle} />
                ) : (
                  <div className="w-full h-full rounded-full bg-blue-600 flex items-center justify-center text-4xl font-black">
                    {callTitle.substring(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
            </div>

            {/* Target caller/receiver text info */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white drop-shadow-md">
                {callTitle}
              </h2>
              {activeCall.type === 'collective' ? (
                <p className="text-xs text-zinc-400 font-bold tracking-widest uppercase">
                  {t('collective_call')} • {Object.keys(activeCall.activeParticipants || {}).length} Aktif
                </p>
              ) : (
                <p className="text-xs text-zinc-400 font-medium tracking-wide">
                  {showConnected ? (
                    remoteState?.isMuted ? 'Mikrofon teman dimatikan' : 'Terhubung • Suara Aktif'
                  ) : (
                    showIncoming ? 'Memanggil Anda...' : 'Menunggu jawaban...'
                  )}
                </p>
              )}
            </div>

            {/* Bouncing audio wave simulation (for connected voice calls) */}
            {showConnected && (
              <div className="flex items-center justify-center space-x-1.5 h-8 pt-4">
                {[1, 2, 3, 4, 5, 6, 7].map((bar) => (
                  <div 
                    key={bar} 
                    className="w-1.5 bg-emerald-400 rounded-full animate-bounce shadow-xs"
                    style={{ 
                      height: '100%', 
                      animationDelay: `${bar * 0.15}s`,
                      animationDuration: '0.8s'
                    }}
                  />
                ))}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Action controls button deck */}
      <div className="mb-12 flex justify-center items-center space-x-6 z-10">
        
        {showIncoming ? (
          // INCOMING CALL BUTTONS (Tolak / Terima)
          <>
            <button 
              type="button"
              onClick={onDecline}
              className="w-16 h-16 bg-red-600 hover:bg-red-500 hover:scale-105 active:scale-95 text-white rounded-full flex flex-col items-center justify-center shadow-2xl transition-all cursor-pointer"
              title="Tolak Panggilan"
            >
              <i className="fas fa-phone-slash text-xl"></i>
              <span className="text-[8px] font-black uppercase mt-1">Tolak</span>
            </button>
            <button 
              type="button"
              onClick={onAccept}
              className="w-16 h-16 bg-emerald-500 hover:bg-emerald-400 hover:scale-105 active:scale-95 text-white rounded-full flex flex-col items-center justify-center shadow-2xl transition-all cursor-pointer animate-bounce"
              title="Terima Panggilan"
            >
              <i className="fas fa-phone text-xl"></i>
              <span className="text-[8px] font-black uppercase mt-1">Terima</span>
            </button>
          </>
        ) : (
          // OUTGOING OR CONNECTED BUTTONS
          <>
            {showConnected && (
              <button 
                type="button"
                onClick={toggleMute}
                className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all border shadow-lg cursor-pointer ${
                  isMuted 
                    ? 'bg-red-500/30 border-red-500 text-red-400' 
                    : 'bg-zinc-900 border-white/20 text-white hover:bg-zinc-800'
                }`}
                title={isMuted ? "Aktifkan Mikrofon" : "Bisukan Mikrofon"}
              >
                <i className={`fas ${isMuted ? 'fa-microphone-slash text-lg' : 'fa-microphone text-lg'}`}></i>
                <span className="text-[8px] font-bold mt-0.5">{isMuted ? 'Muted' : 'Mic'}</span>
              </button>
            )}

            <button 
              type="button"
              onClick={onEnd}
              className="w-16 h-16 bg-red-600 hover:bg-red-500 hover:scale-105 active:scale-95 text-white rounded-full flex flex-col items-center justify-center shadow-2xl transition-all cursor-pointer"
              title={t('end_call')}
            >
              <i className="fas fa-phone-slash text-xl"></i>
              <span className="text-[8px] font-black uppercase mt-1">Akhiri</span>
            </button>

            {showConnected && activeCall.mediaType === 'video' && (
              <button 
                type="button"
                onClick={toggleCamera}
                className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all border shadow-lg cursor-pointer ${
                  isCameraOff 
                    ? 'bg-red-500/30 border-red-500 text-red-400' 
                    : 'bg-zinc-900 border-white/20 text-white hover:bg-zinc-800'
                }`}
                title={isCameraOff ? "Nyalakan Kamera" : "Matikan Kamera"}
              >
                <i className={`fas ${isCameraOff ? 'fa-video-slash text-lg' : 'fa-video text-lg'}`}></i>
                <span className="text-[8px] font-bold mt-0.5">{isCameraOff ? 'Off' : 'Cam'}</span>
              </button>
            )}
          </>
        )}

      </div>

    </div>
  );
};

export default CallingOverlay;
