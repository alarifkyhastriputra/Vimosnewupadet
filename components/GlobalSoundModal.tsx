import React, { useState, useRef, useEffect } from 'react';
import { GlobalSound } from '../types';
import { 
  formatSecondsToTime, 
  parseYouTubeMusicUrl, 
  fetchYouTubeMetadata, 
  extractYouTubeId,
  formatYouTubeMusicUrl
} from '../services/youtubeMusic';

interface GlobalSoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  globalSounds: GlobalSound[];
  onSelectSound: (sound: {
    url: string;
    title: string;
    author: string;
    thumbnailUrl: string;
    startTime?: number;
    endTime?: number;
    sourceType: 'youtube' | 'preset' | 'upload';
    youtubeId?: string;
  }) => void;
}

export const GlobalSoundModal: React.FC<GlobalSoundModalProps> = ({
  isOpen,
  onClose,
  globalSounds,
  onSelectSound
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'popular' | 'youtube' | 'recent'>('all');
  const [playingSoundId, setPlayingSoundId] = useState<string | null>(null);
  const [trimmingSound, setTrimmingSound] = useState<GlobalSound | null>(null);
  
  // Trimmer state
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(30);
  const [maxDuration, setMaxDuration] = useState<number>(180);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);

  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<any>(null);

  // Stop audio preview when modal closes or switching sound
  useEffect(() => {
    if (!isOpen) {
      setPlayingSoundId(null);
      setTrimmingSound(null);
      setIsPreviewPlaying(false);
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      if (previewTimerRef.current) {
        clearInterval(previewTimerRef.current);
      }
    }
  }, [isOpen]);

  // Handle preview playing timing for trimmed segment
  useEffect(() => {
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current);
    }

    if (isPreviewPlaying && trimmingSound) {
      const segmentDuration = Math.max(1, (endTime - startTime));
      let elapsed = 0;
      setPreviewProgress(0);

      previewTimerRef.current = setInterval(() => {
        elapsed += 0.1;
        const pct = Math.min(100, (elapsed / segmentDuration) * 100);
        setPreviewProgress(pct);

        if (elapsed >= segmentDuration) {
          setIsPreviewPlaying(false);
          setPreviewProgress(0);
          clearInterval(previewTimerRef.current);
        }
      }, 100);
    } else {
      setPreviewProgress(0);
    }

    return () => {
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    };
  }, [isPreviewPlaying, startTime, endTime, trimmingSound]);

  if (!isOpen) return null;

  // Filter sounds
  const filteredSounds = globalSounds.filter(sound => {
    const term = searchTerm.toLowerCase().trim();
    const matchSearch = !term || 
      (sound.title || '').toLowerCase().includes(term) ||
      (sound.author || '').toLowerCase().includes(term) ||
      (sound.addedByUserName || '').toLowerCase().includes(term);

    if (!matchSearch) return false;

    if (activeTab === 'popular') return (sound.useCount || 0) > 0;
    if (activeTab === 'youtube') return sound.sourceType === 'youtube' || sound.url.startsWith('youtube:');
    if (activeTab === 'recent') return true;

    return true;
  }).sort((a, b) => {
    if (activeTab === 'popular') return (b.useCount || 0) - (a.useCount || 0);
    if (activeTab === 'recent') return (b.createdAt || 0) - (a.createdAt || 0);
    return (b.useCount || 0) - (a.useCount || 0);
  });

  const handleTogglePlay = (sound: GlobalSound, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingSoundId === sound.id) {
      setPlayingSoundId(null);
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
    } else {
      setPlayingSoundId(sound.id);
      if (!sound.url.startsWith('youtube:')) {
        if (audioPreviewRef.current) {
          audioPreviewRef.current.src = sound.url;
          audioPreviewRef.current.currentTime = sound.startTime || 0;
          audioPreviewRef.current.play().catch(() => {});
        }
      }
    }
  };

  const handleOpenTrimmer = (sound: GlobalSound) => {
    const sTime = sound.startTime || 0;
    const eTime = sound.endTime || (sTime + 30);
    setTrimmingSound(sound);
    setStartTime(sTime);
    setEndTime(eTime);
    setMaxDuration(sound.duration || 180);
    setIsPreviewPlaying(false);
    setPlayingSoundId(null);
  };

  const handleApplyTrimAndSelect = () => {
    if (!trimmingSound) return;

    let finalUrl = trimmingSound.url;
    if (trimmingSound.sourceType === 'youtube' || trimmingSound.url.startsWith('youtube:')) {
      const { videoId } = parseYouTubeMusicUrl(trimmingSound.url);
      if (videoId) {
        finalUrl = formatYouTubeMusicUrl(videoId, startTime, endTime);
      }
    }

    onSelectSound({
      url: finalUrl,
      title: trimmingSound.title,
      author: trimmingSound.author,
      thumbnailUrl: trimmingSound.thumbnailUrl,
      startTime,
      endTime,
      sourceType: trimmingSound.sourceType,
      youtubeId: trimmingSound.youtubeId || extractYouTubeId(trimmingSound.url) || undefined
    });

    onClose();
  };

  const currentlyPlayingSound = globalSounds.find(s => s.id === playingSoundId);
  const isPlayingYouTube = currentlyPlayingSound?.url.startsWith('youtube:');
  const playingYouTubeId = isPlayingYouTube ? extractYouTubeId(currentlyPlayingSound?.url || '') : null;

  // Active trimming YouTube preview
  const isTrimmingYouTube = trimmingSound?.url.startsWith('youtube:') || trimmingSound?.sourceType === 'youtube';
  const trimmingYouTubeId = isTrimmingYouTube ? extractYouTubeId(trimmingSound?.url || '') : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      {/* Hidden audio tag for standard mp3 preview */}
      <audio ref={audioPreviewRef} onEnded={() => setPlayingSoundId(null)} />

      {/* Hidden YouTube Iframe for direct quick preview */}
      {playingSoundId && isPlayingYouTube && playingYouTubeId && (
        <div className="sr-only opacity-0 pointer-events-none" aria-hidden="true">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${playingYouTubeId}?autoplay=1&loop=1&playlist=${playingYouTubeId}&start=${currentlyPlayingSound?.startTime || 0}&controls=0`}
            title="YouTube Preview"
            allow="autoplay; encrypted-media"
            className="w-1 h-1"
          />
        </div>
      )}

      {/* Hidden YouTube Iframe for trimmer test */}
      {trimmingSound && isTrimmingYouTube && trimmingYouTubeId && isPreviewPlaying && (
        <div className="sr-only opacity-0 pointer-events-none" aria-hidden="true">
          <iframe
            key={`${trimmingYouTubeId}_${startTime}_${endTime}`}
            src={`https://www.youtube-nocookie.com/embed/${trimmingYouTubeId}?autoplay=1&start=${startTime}&end=${endTime}&controls=0`}
            title="Trim Preview"
            allow="autoplay; encrypted-media"
            className="w-1 h-1"
          />
        </div>
      )}

      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-neutral-200 flex flex-col max-h-[90vh] animate-scale-up">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-xs">
              <i className="fas fa-music"></i>
            </div>
            <div>
              <h3 className="text-base font-black text-neutral-900 tracking-tight">
                {trimmingSound ? 'Potong & Sesuaikan Sound' : 'Koleksi Sound Global'}
              </h3>
              <p className="text-[11px] text-neutral-500 font-medium">
                {trimmingSound 
                  ? 'Pilih bagian lagu terbaik untuk postingan kamu' 
                  : 'Cari lagu YouTube & audio yang telah dibagikan pengguna'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (trimmingSound) {
                setTrimmingSound(null);
                setIsPreviewPlaying(false);
              } else {
                onClose();
              }
            }}
            className="w-8 h-8 rounded-full bg-neutral-200/80 hover:bg-neutral-300 text-neutral-700 flex items-center justify-center transition-colors"
          >
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        {/* VIEW 1: AUDIO TRIMMER */}
        {trimmingSound ? (
          <div className="p-5 flex-1 overflow-y-auto space-y-5">
            {/* Selected Track Banner */}
            <div className="flex items-center space-x-3.5 p-3.5 bg-neutral-900 text-white rounded-2xl shadow-md border border-neutral-800">
              <img 
                src={trimmingSound.thumbnailUrl || `https://img.youtube.com/vi/${extractYouTubeId(trimmingSound.url)}/hqdefault.jpg`} 
                alt={trimmingSound.title}
                className="w-14 h-14 object-cover rounded-xl border border-neutral-700 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-1.5 mb-0.5">
                  <span className="bg-red-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded uppercase">
                    {isTrimmingYouTube ? 'YouTube Audio' : 'Sound'}
                  </span>
                  <span className="text-[10px] text-neutral-400">
                    {formatSecondsToTime(endTime - startTime)} terpilih
                  </span>
                </div>
                <h4 className="text-sm font-bold text-white truncate">{trimmingSound.title}</h4>
                <p className="text-xs text-neutral-400 truncate">{trimmingSound.author}</p>
              </div>
            </div>

            {/* Trimmer Waveform & Slider Area */}
            <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-neutral-800 flex items-center space-x-1.5">
                  <i className="fas fa-scissors text-red-600"></i>
                  <span>Pilih Rentang Waktu (Detik)</span>
                </span>
                <span className="text-xs font-bold text-neutral-600 bg-white px-2.5 py-1 rounded-lg border border-neutral-200">
                  {formatSecondsToTime(startTime)} - {formatSecondsToTime(endTime)}
                </span>
              </div>

              {/* Simulated Waveform & Trim Window */}
              <div className="relative h-16 bg-neutral-900 rounded-xl overflow-hidden flex items-center justify-center px-3 border border-neutral-800 shadow-inner">
                {/* Fake waveform bars */}
                <div className="absolute inset-0 flex items-center justify-between px-4 opacity-40 gap-1">
                  {[40, 65, 30, 80, 95, 45, 60, 85, 35, 75, 90, 50, 70, 85, 40, 60, 95, 75, 55, 80, 45, 90, 65, 40, 70, 85, 50].map((h, i) => (
                    <div 
                      key={i} 
                      className={`flex-1 rounded-full ${
                        (i / 27) >= (startTime / maxDuration) && (i / 27) <= (endTime / maxDuration)
                          ? 'bg-red-500'
                          : 'bg-neutral-600'
                      }`} 
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>

                {/* Progress bar overlay during preview play */}
                {isPreviewPlaying && (
                  <div 
                    className="absolute top-0 bottom-0 left-0 bg-red-600/30 border-r-2 border-red-500 pointer-events-none transition-all duration-100"
                    style={{ width: `${previewProgress}%` }}
                  />
                )}

                <div className="relative z-10 text-center">
                  <span className="text-xs font-black text-white bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
                    Durasi: {endTime - startTime} Detik
                  </span>
                </div>
              </div>

              {/* Start Time Controls */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-neutral-700">
                  <span>Mulai: {formatSecondsToTime(startTime)} ({startTime}s)</span>
                  <span>Maks: {formatSecondsToTime(maxDuration)}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max={Math.max(0, endTime - 5)} 
                  step="1"
                  value={startTime}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setStartTime(val);
                    setIsPreviewPlaying(false);
                  }}
                  className="w-full accent-black cursor-pointer h-2 bg-neutral-200 rounded-lg"
                />
              </div>

              {/* End Time Controls */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-neutral-700">
                  <span>Selesai: {formatSecondsToTime(endTime)} ({endTime}s)</span>
                  <span>Rentang: +{endTime - startTime}s</span>
                </div>
                <input 
                  type="range" 
                  min={startTime + 5} 
                  max={maxDuration} 
                  step="1"
                  value={endTime}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setEndTime(val);
                    setIsPreviewPlaying(false);
                  }}
                  className="w-full accent-red-600 cursor-pointer h-2 bg-neutral-200 rounded-lg"
                />
              </div>

              {/* Quick Presets (15s, 30s, 45s, 60s) */}
              <div className="pt-1 flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold text-neutral-500">Preset Cepat:</span>
                <div className="flex items-center space-x-1.5">
                  {[15, 30, 45, 60].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => {
                        const newEnd = Math.min(maxDuration, startTime + sec);
                        setEndTime(newEnd);
                        setIsPreviewPlaying(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
                        endTime - startTime === sec 
                          ? 'bg-black text-white border-black' 
                          : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Trimmer Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setIsPreviewPlaying(!isPreviewPlaying)}
                className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center space-x-2 shadow-xs ${
                  isPreviewPlaying 
                    ? 'bg-red-600 text-white animate-pulse' 
                    : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-300'
                }`}
              >
                <i className={`fas ${isPreviewPlaying ? 'fa-pause' : 'fa-play'} text-[10px]`}></i>
                <span>{isPreviewPlaying ? 'Jeda Pratinjau' : 'Dengarkan Potongan'}</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setTrimmingSound(null)}
                  className="px-3.5 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition-colors"
                >
                  Kembali
                </button>
                <button
                  type="button"
                  onClick={handleApplyTrimAndSelect}
                  className="px-5 py-2.5 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-black transition-all shadow-md flex items-center space-x-1.5 active:scale-95"
                >
                  <i className="fas fa-check text-[10px]"></i>
                  <span>Gunakan Sound Ini</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* VIEW 2: GLOBAL SOUND LIST & SEARCH */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Search Input Bar */}
            <div className="p-4 border-b border-neutral-100 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cari lagu, artis, atau uploader sound..."
                  className="w-full pl-9 pr-8 py-2.5 text-xs rounded-xl border-2 border-neutral-200 focus:border-black outline-none transition-colors bg-neutral-50/70"
                />
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-xs"></i>
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 text-xs"
                  >
                    <i className="fas fa-times-circle"></i>
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                    activeTab === 'all' ? 'bg-black text-white shadow-xs' : 'bg-neutral-100 text-neutral-600 hover:text-black'
                  }`}
                >
                  Semua Sound ({globalSounds.length})
                </button>
                <button
                  onClick={() => setActiveTab('popular')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center space-x-1 ${
                    activeTab === 'popular' ? 'bg-amber-500 text-white shadow-xs' : 'bg-neutral-100 text-neutral-600 hover:text-amber-600'
                  }`}
                >
                  <i className="fas fa-fire text-[10px]"></i>
                  <span>Populer</span>
                </button>
                <button
                  onClick={() => setActiveTab('youtube')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all flex items-center space-x-1 ${
                    activeTab === 'youtube' ? 'bg-red-600 text-white shadow-xs' : 'bg-neutral-100 text-neutral-600 hover:text-red-600'
                  }`}
                >
                  <i className="fab fa-youtube text-[11px]"></i>
                  <span>YouTube</span>
                </button>
                <button
                  onClick={() => setActiveTab('recent')}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                    activeTab === 'recent' ? 'bg-black text-white shadow-xs' : 'bg-neutral-100 text-neutral-600 hover:text-black'
                  }`}
                >
                  Terbaru
                </button>
              </div>
            </div>

            {/* List of Sounds */}
            <div className="flex-1 overflow-y-auto p-4 divide-y divide-neutral-100">
              {filteredSounds.length === 0 ? (
                <div className="py-12 text-center text-neutral-400 space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-lg">
                    <i className="fas fa-compact-disc"></i>
                  </div>
                  <p className="text-xs font-bold text-neutral-600">Sound tidak ditemukan</p>
                  <p className="text-[11px] text-neutral-400">
                    Coba kata kunci lain atau tempel link YouTube baru di tab sebelumnya.
                  </p>
                </div>
              ) : (
                filteredSounds.map((sound) => {
                  const isPlaying = playingSoundId === sound.id;
                  const isYt = sound.sourceType === 'youtube' || sound.url.startsWith('youtube:');

                  return (
                    <div 
                      key={sound.id}
                      className="py-3 flex items-center justify-between gap-3 group hover:bg-neutral-50/80 -mx-2 px-2 rounded-2xl transition-colors"
                    >
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        {/* Play button with thumbnail */}
                        <div 
                          onClick={(e) => handleTogglePlay(sound, e)}
                          className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-neutral-900 cursor-pointer shadow-xs group-hover:scale-105 transition-transform"
                        >
                          <img 
                            src={sound.thumbnailUrl} 
                            alt={sound.title} 
                            className={`w-full h-full object-cover ${isPlaying ? 'opacity-40' : 'opacity-85'}`}
                          />
                          <div className={`absolute inset-0 flex items-center justify-center ${isPlaying ? 'bg-black/50' : 'bg-black/30 group-hover:bg-black/40'}`}>
                            <i className={`fas ${isPlaying ? 'fa-pause text-amber-400 animate-pulse' : 'fa-play text-white'} text-xs`}></i>
                          </div>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5 mb-0.5">
                            {isYt ? (
                              <span className="bg-red-600 text-white text-[8px] font-black px-1.5 py-0.2 rounded uppercase tracking-tight">
                                YT Audio
                              </span>
                            ) : (
                              <span className="bg-neutral-900 text-white text-[8px] font-bold px-1.5 py-0.2 rounded uppercase tracking-tight">
                                Vimos
                              </span>
                            )}
                            <h4 className="text-xs font-bold text-neutral-900 truncate">{sound.title}</h4>
                          </div>

                          <div className="flex items-center space-x-2 text-[10px] text-neutral-500">
                            <span className="truncate max-w-[120px]">{sound.author || 'Artist'}</span>
                            <span>•</span>
                            <span className="flex items-center space-x-1 text-neutral-600 font-semibold">
                              <i className="fas fa-fire text-amber-500 text-[9px]"></i>
                              <span>{sound.useCount || 0} post</span>
                            </span>
                            {sound.addedByUserName && (
                              <>
                                <span>•</span>
                                <span className="truncate text-neutral-400">oleh @{sound.addedByUserName}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenTrimmer(sound)}
                          className="px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-bold transition-all flex items-center space-x-1"
                          title="Potong durasi lagu ini"
                        >
                          <i className="fas fa-scissors text-[10px] text-neutral-600"></i>
                          <span className="hidden sm:inline">Potong</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onSelectSound({
                              url: sound.url,
                              title: sound.title,
                              author: sound.author,
                              thumbnailUrl: sound.thumbnailUrl,
                              startTime: sound.startTime,
                              endTime: sound.endTime,
                              sourceType: sound.sourceType,
                              youtubeId: sound.youtubeId || extractYouTubeId(sound.url) || undefined
                            });
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-black transition-all shadow-xs active:scale-95"
                        >
                          Pakai
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
