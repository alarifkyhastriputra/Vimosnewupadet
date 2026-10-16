import React, { useState, useCallback, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import { compressImage } from '../services/imageCompressor.ts';
import { 
  extractYouTubeId, 
  fetchYouTubeMetadata, 
  formatYouTubeMusicUrl, 
  formatSecondsToTime,
  parseYouTubeMusicUrl
} from '../services/youtubeMusic.ts';
import { GlobalSound } from '../types.ts';
import { GlobalSoundModal } from './GlobalSoundModal.tsx';

interface PostCreatorProps {
  globalSounds?: GlobalSound[];
  onPost: (data: { 
    text: string; 
    photoURL?: string; 
    videoURL?: string; 
    musicURL?: string;
    musicTitle?: string;
    musicAuthor?: string;
    musicThumbnail?: string;
    musicStart?: number;
    musicEnd?: number;
  }) => void;
}

const PREDEFINED_MUSIC = [
  { name: 'Tanpa Musik', url: '', title: '', author: '' },
  { 
    name: 'Lofi Chill Beat', 
    url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    title: 'Lofi Study Chill Beat',
    author: 'FASSounds',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80'
  },
  { 
    name: 'Acoustic Breeze', 
    url: 'https://cdn.pixabay.com/download/audio/2021/11/25/audio_91b3cb81ed.mp3?filename=acoustic-motivational-113213.mp3',
    title: 'Acoustic Morning Breeze',
    author: 'Lesfm',
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80'
  },
  { 
    name: 'Cinematic Epic', 
    url: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=epic-cinematic-trailer-103890.mp3',
    title: 'Cinematic Trailer Epic Rise',
    author: 'AudioCoffee',
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80'
  },
];

export const getCroppedImg = async (imageSrc: string, pixelCrop: any): Promise<string> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise(resolve => (image.onload = resolve));

  const targetWidth = Math.min(pixelCrop.width || 800, 1080);
  const targetHeight = Math.round(((pixelCrop.height || 800) * targetWidth) / (pixelCrop.width || 800));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, targetWidth);
  canvas.height = Math.max(1, targetHeight);
  const ctx = canvas.getContext('2d');

  if (!ctx) return imageSrc;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    targetWidth,
    targetHeight
  );

  return canvas.toDataURL('image/jpeg', 0.85);
};

const PostCreator: React.FC<PostCreatorProps> = ({ onPost, globalSounds = [] }) => {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  
  // Crop state
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isCropping, setIsCropping] = useState(false);

  // Audio / Sound state
  const [musicURL, setMusicURL] = useState('');
  const [musicTitle, setMusicTitle] = useState('');
  const [musicAuthor, setMusicAuthor] = useState('');
  const [musicThumbnail, setMusicThumbnail] = useState('');
  const [musicStart, setMusicStart] = useState<number>(0);
  const [musicEnd, setMusicEnd] = useState<number>(30);
  const [showTrimmer, setShowTrimmer] = useState(false);
  const [isTrimmerPreviewPlaying, setIsTrimmerPreviewPlaying] = useState(false);

  const [musicSource, setMusicSource] = useState<'preset' | 'youtube' | 'global' | 'upload'>('preset');
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeInfo, setYoutubeInfo] = useState<{ title: string; author: string; thumbnailUrl: string; videoId: string } | null>(null);
  const [isResolvingYouTube, setIsResolvingYouTube] = useState(false);
  const [youtubeError, setYoutubeError] = useState('');
  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);

  // Handle YouTube link resolving
  const handleResolveYouTube = async () => {
    setYoutubeError('');
    if (!youtubeInput.trim()) return;

    const videoId = extractYouTubeId(youtubeInput.trim());
    if (!videoId) {
      setYoutubeError('Link YouTube tidak valid. Gunakan format seperti: https://www.youtube.com/watch?v=... atau https://youtu.be/...');
      return;
    }

    setIsResolvingYouTube(true);
    try {
      const meta = await fetchYouTubeMetadata(videoId);
      setYoutubeInfo({
        videoId,
        title: meta.title,
        author: meta.author,
        thumbnailUrl: meta.thumbnailUrl
      });
      setMusicTitle(meta.title);
      setMusicAuthor(meta.author);
      setMusicThumbnail(meta.thumbnailUrl);
      setMusicStart(0);
      setMusicEnd(30);
      setMusicURL(formatYouTubeMusicUrl(videoId, 0, 30));
      setShowTrimmer(true); // Open trimmer automatically so user can adjust cut
    } catch {
      setYoutubeInfo({
        videoId,
        title: 'YouTube Audio Clip',
        author: 'YouTube',
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      });
      setMusicTitle('YouTube Audio Clip');
      setMusicAuthor('YouTube');
      setMusicThumbnail(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`);
      setMusicStart(0);
      setMusicEnd(30);
      setMusicURL(formatYouTubeMusicUrl(videoId, 0, 30));
      setShowTrimmer(true);
    } finally {
      setIsResolvingYouTube(false);
    }
  };

  const handleUpdateTrim = (newStart: number, newEnd: number) => {
    setMusicStart(newStart);
    setMusicEnd(newEnd);
    setIsTrimmerPreviewPlaying(false);

    if (youtubeInfo?.videoId) {
      setMusicURL(formatYouTubeMusicUrl(youtubeInfo.videoId, newStart, newEnd));
    } else if (musicURL.startsWith('youtube:')) {
      const { videoId } = parseYouTubeMusicUrl(musicURL);
      if (videoId) {
        setMusicURL(formatYouTubeMusicUrl(videoId, newStart, newEnd));
      }
    }
  };

  const handleSelectGlobalSound = (sound: {
    url: string;
    title: string;
    author: string;
    thumbnailUrl: string;
    startTime?: number;
    endTime?: number;
    sourceType: 'youtube' | 'preset' | 'upload';
    youtubeId?: string;
  }) => {
    setMusicURL(sound.url);
    setMusicTitle(sound.title);
    setMusicAuthor(sound.author);
    setMusicThumbnail(sound.thumbnailUrl);
    const s = sound.startTime || 0;
    const e = sound.endTime || (s + 30);
    setMusicStart(s);
    setMusicEnd(e);

    if (sound.sourceType === 'youtube' || sound.youtubeId) {
      const vId = sound.youtubeId || extractYouTubeId(sound.url);
      if (vId) {
        setYoutubeInfo({
          videoId: vId,
          title: sound.title,
          author: sound.author,
          thumbnailUrl: sound.thumbnailUrl
        });
      }
    } else {
      setYoutubeInfo(null);
    }
  };

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleFinishCrop = async () => {
    if (preview?.type === 'image' && croppedAreaPixels) {
      try {
        const croppedImage = await getCroppedImg(preview.url, croppedAreaPixels);
        setPreview({ url: croppedImage, type: 'image' });
        setIsCropping(false);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!text.trim() && !preview) || isPosting) return;
    setIsPosting(true);
    
    try {
      let finalPhotoURL = undefined;
      if (preview?.type === 'image') {
        try {
          finalPhotoURL = await compressImage(preview.url, 1080, 1080, 0.82);
        } catch {
          finalPhotoURL = preview.url;
        }
      }

      onPost({ 
        text: text.trim(), 
        photoURL: finalPhotoURL,
        videoURL: preview?.type === 'video' ? preview.url : undefined,
        musicURL: musicURL || undefined,
        musicTitle: musicTitle || undefined,
        musicAuthor: musicAuthor || undefined,
        musicThumbnail: musicThumbnail || undefined,
        musicStart: musicStart !== undefined ? musicStart : undefined,
        musicEnd: musicEnd !== undefined ? musicEnd : undefined
      });
      
      setText('');
      setPreview(null);
      setMusicURL('');
      setMusicTitle('');
      setMusicAuthor('');
      setMusicThumbnail('');
      setMusicStart(0);
      setMusicEnd(30);
      setYoutubeInfo(null);
      setYoutubeInput('');
      setShowTrimmer(false);
    } catch (err) {
      console.error('Error posting:', err);
    } finally {
      setIsPosting(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const type = file.type.startsWith('video/') ? 'video' : 'image';
      if (type === 'image') {
        try {
          const optimizedData = await compressImage(file, 1200, 1200, 0.88);
          setPreview({ url: optimizedData, type: 'image' });
          setIsCropping(true);
        } catch {
          const reader = new FileReader();
          reader.onloadend = () => {
            setPreview({ url: reader.result as string, type: 'image' });
            setIsCropping(true);
          };
          reader.readAsDataURL(file);
        }
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview({ url: reader.result as string, type: 'video' });
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const activeYtId = youtubeInfo?.videoId || extractYouTubeId(musicURL);

  return (
    <div className="p-6">
      {/* Hidden preview player for audio trimmer */}
      {isTrimmerPreviewPlaying && activeYtId && (
        <div className="sr-only opacity-0 pointer-events-none" aria-hidden="true">
          <iframe
            key={`post_creator_trim_${activeYtId}_${musicStart}_${musicEnd}`}
            src={`https://www.youtube-nocookie.com/embed/${activeYtId}?autoplay=1&start=${musicStart}&end=${musicEnd}&controls=0`}
            title="YouTube Trim Preview"
            allow="autoplay; encrypted-media"
            className="w-1 h-1"
          />
        </div>
      )}

      <h2 className="text-2xl font-black mb-6 uppercase tracking-tighter">New Memory</h2>
      
      {isCropping && preview?.type === 'image' ? (
        <div className="space-y-4">
          <div className="relative w-full h-96 bg-black rounded-2xl overflow-hidden">
            <Cropper
              image={preview.url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          <div className="flex justify-between items-center mt-4">
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-1/3 accent-black"
            />
            <div className="flex space-x-3">
              <button 
                onClick={() => setIsCropping(false)}
                className="bg-gray-200 text-black px-4 py-2 rounded-full font-bold shadow-sm hover:bg-gray-300 transition-colors"
              >
                Skip
              </button>
              <button 
                onClick={handleFinishCrop}
                className="bg-black text-white px-4 py-2 rounded-full font-bold shadow-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Etch your thought... (Gunakan @username untuk mention)"
              className="w-full h-32 bg-gray-50 border-2 border-black rounded-2xl p-4 text-sm focus:outline-none focus:ring-0 resize-none transition-all placeholder:text-gray-400"
            />
          </div>

          {preview && (
            <div className="relative rounded-2xl overflow-hidden border-2 border-black bg-black">
              {preview.type === 'image' ? (
                <img src={preview.url} alt="Preview" className="w-full max-h-96 object-contain" />
              ) : (
                <video src={preview.url} className="w-full max-h-96 object-contain" controls muted />
              )}
              <button 
                type="button"
                onClick={() => setPreview(null)}
                className="absolute top-2 right-2 bg-black text-white w-8 h-8 rounded-full flex items-center justify-center text-xs shadow-lg hover:bg-neutral-800"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          )}
          
          {(preview?.type === 'image' || preview?.type === 'video') && (
            <div className="flex flex-col space-y-3 bg-neutral-50/90 p-4 rounded-2xl border border-black/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-full bg-black text-white flex items-center justify-center text-[10px]">
                    <i className="fas fa-music"></i>
                  </div>
                  <label className="text-xs font-black uppercase tracking-wider text-neutral-900">Tambahkan Musik / Audio</label>
                </div>

                {/* Tabs: Preset / YouTube / Search Global / Upload */}
                <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-neutral-200 text-[11px] font-bold overflow-x-auto max-w-full">
                  <button
                    type="button"
                    onClick={() => setMusicSource('preset')}
                    className={`px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                      musicSource === 'preset' ? 'bg-black text-white shadow-xs' : 'text-neutral-600 hover:text-black'
                    }`}
                  >
                    Pilihan
                  </button>
                  <button
                    type="button"
                    onClick={() => setMusicSource('youtube')}
                    className={`px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 whitespace-nowrap ${
                      musicSource === 'youtube' ? 'bg-red-600 text-white shadow-xs' : 'text-neutral-600 hover:text-red-600'
                    }`}
                  >
                    <i className="fab fa-youtube text-[11px]"></i>
                    <span>Link YT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMusicSource('global');
                      setIsGlobalModalOpen(true);
                    }}
                    className={`px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 whitespace-nowrap ${
                      musicSource === 'global' ? 'bg-amber-500 text-white shadow-xs' : 'text-neutral-600 hover:text-amber-600'
                    }`}
                  >
                    <i className="fas fa-search text-[10px]"></i>
                    <span>Cari Global</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMusicSource('upload')}
                    className={`px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                      musicSource === 'upload' ? 'bg-black text-white shadow-xs' : 'text-neutral-600 hover:text-black'
                    }`}
                  >
                    Upload
                  </button>
                </div>
              </div>

              {/* Option 1: Preset */}
              {musicSource === 'preset' && (
                <div className="flex items-center space-x-2">
                  <select 
                    value={musicURL.startsWith('youtube:') ? '' : musicURL} 
                    onChange={(e) => {
                      const selectedUrl = e.target.value;
                      setMusicURL(selectedUrl);
                      const matched = PREDEFINED_MUSIC.find(m => m.url === selectedUrl);
                      if (matched && matched.url) {
                        setMusicTitle(matched.title || matched.name);
                        setMusicAuthor(matched.author || 'Vimos Sound');
                        setMusicThumbnail(matched.thumbnailUrl || '');
                        setMusicStart(0);
                        setMusicEnd(30);
                      } else if (!selectedUrl) {
                        setMusicTitle('');
                        setMusicAuthor('');
                        setMusicThumbnail('');
                      }
                      setYoutubeInfo(null);
                    }}
                    className="flex-1 border-2 border-black rounded-xl p-2.5 text-xs font-semibold focus:outline-none bg-white shadow-xs"
                  >
                    {PREDEFINED_MUSIC.map((music, idx) => (
                      <option key={idx} value={music.url}>{music.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Option 2: YouTube Link to Audio */}
              {musicSource === 'youtube' && (
                <div className="space-y-2.5">
                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={youtubeInput}
                        onChange={(e) => {
                          setYoutubeInput(e.target.value);
                          setYoutubeError('');
                        }}
                        placeholder="Tempel link YouTube (contoh: https://youtu.be/...)"
                        className="w-full pl-9 pr-3 py-2.5 text-xs border-2 border-neutral-300 focus:border-red-600 rounded-xl outline-none bg-white transition-colors"
                      />
                      <i className="fab fa-youtube absolute left-3 top-1/2 -translate-y-1/2 text-red-600 text-sm"></i>
                    </div>
                    <button
                      type="button"
                      onClick={handleResolveYouTube}
                      disabled={!youtubeInput.trim() || isResolvingYouTube}
                      className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition-all shadow-xs active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 shrink-0"
                    >
                      {isResolvingYouTube ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <i className="fas fa-scissors text-[10px]"></i>
                      )}
                      <span>Ubah & Potong</span>
                    </button>
                  </div>

                  {youtubeError && (
                    <p className="text-[11px] text-red-600 font-semibold flex items-center space-x-1">
                      <i className="fas fa-circle-exclamation"></i>
                      <span>{youtubeError}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Option 3: Global Sound Search Button Bar */}
              {musicSource === 'global' && (
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsGlobalModalOpen(true)}
                    className="flex-1 py-3 px-4 bg-white border-2 border-dashed border-amber-400 hover:border-amber-600 rounded-xl text-amber-900 text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-xs"
                  >
                    <i className="fas fa-compact-disc text-amber-500 text-sm"></i>
                    <span>
                      {musicTitle ? `Sound Terpilih: ${musicTitle} (Ganti Sound)` : 'Buka Koleksi Sound Global & Cari Lagu...'}
                    </span>
                  </button>
                </div>
              )}

              {/* Option 4: Custom File Upload */}
              {musicSource === 'upload' && (
                <div className="flex items-center space-x-2">
                  <label className="flex-1 bg-white border-2 border-dashed border-neutral-300 hover:border-black p-3 rounded-xl cursor-pointer text-center transition-all flex items-center justify-center space-x-2">
                    <i className="fas fa-file-audio text-neutral-600"></i>
                    <span className="text-xs font-bold text-neutral-800">
                      {musicURL && !musicURL.startsWith('youtube:') && !PREDEFINED_MUSIC.some(m => m.url === musicURL) 
                        ? 'Audio File Terpasang (Klik untuk ganti)' 
                        : 'Pilih File MP3 / Audio dari Perangkat'}
                    </span>
                    <input 
                      type="file" 
                      accept="audio/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setMusicURL(reader.result as string);
                            setMusicTitle(file.name.replace(/\.[^/.]+$/, ''));
                            setMusicAuthor('Local File');
                            setYoutubeInfo(null);
                          };
                          reader.readAsDataURL(file);
                        }
                      }} 
                    />
                  </label>
                </div>
              )}

              {/* ATTACHED SOUND CARD (Works for YT, Global, Preset, Upload) */}
              {musicURL && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between bg-neutral-900 text-white p-3 rounded-2xl border border-neutral-800 shadow-md animate-fade-in">
                    <div className="flex items-center space-x-3 min-w-0">
                      <img 
                        src={musicThumbnail || (youtubeInfo?.thumbnailUrl) || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&q=80'} 
                        alt="Sound thumb" 
                        className="w-12 h-12 object-cover rounded-xl border border-neutral-700 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5 mb-0.5">
                          <span className={`${musicURL.startsWith('youtube:') ? 'bg-red-600' : 'bg-neutral-800'} text-[8px] font-black px-1.5 py-0.2 rounded text-white uppercase tracking-tighter`}>
                            {musicURL.startsWith('youtube:') ? 'YouTube Sound' : 'Vimos Sound'}
                          </span>
                          <span className="text-[10px] text-amber-400 font-bold">
                            {formatSecondsToTime(musicStart)} - {formatSecondsToTime(musicEnd)} ({musicEnd - musicStart}s)
                          </span>
                        </div>
                        <p className="text-xs font-bold truncate text-white">{musicTitle || youtubeInfo?.title || 'Soundtrack Post'}</p>
                        <p className="text-[10px] text-neutral-400 truncate">{musicAuthor || youtubeInfo?.author || 'Vimos Artist'}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => setShowTrimmer(!showTrimmer)}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center space-x-1 ${
                          showTrimmer ? 'bg-red-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
                        }`}
                        title="Potong lagu ini"
                      >
                        <i className="fas fa-scissors text-[10px]"></i>
                        <span className="hidden sm:inline">{showTrimmer ? 'Tutup' : 'Potong'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setYoutubeInfo(null);
                          setMusicURL('');
                          setMusicTitle('');
                          setMusicAuthor('');
                          setMusicThumbnail('');
                          setMusicStart(0);
                          setMusicEnd(30);
                          setYoutubeInput('');
                          setShowTrimmer(false);
                        }}
                        className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center justify-center transition-colors"
                        title="Hapus Sound"
                      >
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    </div>
                  </div>

                  {/* INLINE AUDIO TRIMMER TOOL */}
                  {showTrimmer && (
                    <div className="p-3.5 bg-neutral-100/90 rounded-2xl border border-neutral-300 space-y-3 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black uppercase tracking-wider text-neutral-800 flex items-center space-x-1.5">
                          <i className="fas fa-scissors text-red-600"></i>
                          <span>Pemotong Durasi Suara</span>
                        </span>
                        <div className="flex items-center space-x-1 text-xs font-bold text-neutral-700">
                          <span className="bg-white px-2 py-0.5 rounded-md border border-neutral-200">
                            {formatSecondsToTime(musicStart)}
                          </span>
                          <span>-</span>
                          <span className="bg-white px-2 py-0.5 rounded-md border border-neutral-200">
                            {formatSecondsToTime(musicEnd)}
                          </span>
                        </div>
                      </div>

                      {/* Sliders */}
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-[11px] font-bold text-neutral-600 mb-1">
                            <span>Mulai Dari: {formatSecondsToTime(musicStart)} ({musicStart}s)</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max={Math.max(0, musicEnd - 5)} 
                            step="1"
                            value={musicStart}
                            onChange={(e) => handleUpdateTrim(parseInt(e.target.value, 10), musicEnd)}
                            className="w-full accent-black cursor-pointer h-1.5 bg-neutral-300 rounded-lg"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-[11px] font-bold text-neutral-600 mb-1">
                            <span>Selesai Pada: {formatSecondsToTime(musicEnd)} ({musicEnd}s)</span>
                            <span className="text-red-600 font-black">Durasi: {musicEnd - musicStart} Detik</span>
                          </div>
                          <input 
                            type="range" 
                            min={musicStart + 5} 
                            max={240} 
                            step="1"
                            value={musicEnd}
                            onChange={(e) => handleUpdateTrim(musicStart, parseInt(e.target.value, 10))}
                            className="w-full accent-red-600 cursor-pointer h-1.5 bg-neutral-300 rounded-lg"
                          />
                        </div>
                      </div>

                      {/* Quick Duration Buttons & Playback Tester */}
                      <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                        <div className="flex items-center space-x-1 text-xs">
                          <span className="text-[10px] font-bold text-neutral-500 mr-1">Durasi:</span>
                          {[15, 30, 45, 60].map(dur => (
                            <button
                              key={dur}
                              type="button"
                              onClick={() => handleUpdateTrim(musicStart, musicStart + dur)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all border ${
                                musicEnd - musicStart === dur 
                                  ? 'bg-black text-white border-black' 
                                  : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-200'
                              }`}
                            >
                              {dur}s
                            </button>
                          ))}
                        </div>

                        {activeYtId && (
                          <button
                            type="button"
                            onClick={() => setIsTrimmerPreviewPlaying(!isTrimmerPreviewPlaying)}
                            className={`px-3 py-1 rounded-xl text-xs font-black transition-all flex items-center space-x-1.5 ${
                              isTrimmerPreviewPlaying 
                                ? 'bg-red-600 text-white animate-pulse' 
                                : 'bg-white hover:bg-neutral-200 text-neutral-900 border border-neutral-300'
                            }`}
                          >
                            <i className={`fas ${isTrimmerPreviewPlaying ? 'fa-pause' : 'fa-play'} text-[9px]`}></i>
                            <span>{isTrimmerPreviewPlaying ? 'Stop' : 'Tes Potongan'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex space-x-3 items-center">
              <label className="w-12 h-12 flex items-center justify-center border-2 border-black rounded-full cursor-pointer hover:bg-black hover:text-white transition-all shadow-md active:scale-90">
                <i className="fas fa-camera"></i>
                <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
              </label>
              <div className="flex flex-col justify-center">
                <p className="text-[8px] font-black uppercase tracking-widest opacity-40">Add Visual</p>
                <p className="text-[8px] font-black uppercase tracking-widest opacity-40">Vimos</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMusicSource('global');
                  setIsGlobalModalOpen(true);
                }}
                className="ml-2 flex items-center space-x-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-full text-xs font-bold text-amber-900 transition-colors shadow-xs"
                title="Cari Sound Global"
              >
                <i className="fas fa-compact-disc text-amber-600"></i>
                <span>Sound List</span>
              </button>
            </div>
            
            <button 
              type="submit"
              disabled={(!text.trim() && !preview) || isPosting}
              className="bg-black text-white px-10 py-3 rounded-full font-black uppercase tracking-widest hover:opacity-80 transition-opacity shadow-lg active:scale-95 disabled:opacity-20 flex items-center space-x-2"
            >
              {isPosting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Posting...</span>
                </>
              ) : (
                <span>Post</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Global Sound Search Modal */}
      <GlobalSoundModal
        isOpen={isGlobalModalOpen}
        onClose={() => setIsGlobalModalOpen(false)}
        globalSounds={globalSounds}
        onSelectSound={handleSelectGlobalSound}
      />
    </div>
  );
};

export default PostCreator;
