// Utility for parsing YouTube URLs, audio trimming, and global sound library

export interface YouTubeMusicInfo {
  videoId: string;
  title: string;
  author?: string;
  thumbnailUrl: string;
  url: string; // formatted identifier e.g. "youtube:VIDEO_ID" or direct URL
  start?: number;
  end?: number;
}

/**
 * Extracts a valid YouTube Video ID from various link formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://music.youtube.com/watch?v=VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 * - VIDEO_ID directly
 */
export function extractYouTubeId(urlOrText: string): string | null {
  if (!urlOrText) return null;
  const clean = urlOrText.trim();

  // If formatted as "youtube:VIDEO_ID" or "youtube:VIDEO_ID?start=X&end=Y"
  if (clean.startsWith('youtube:')) {
    const raw = clean.replace('youtube:', '').trim();
    const idPart = raw.split('?')[0].split('&')[0];
    return idPart.length >= 10 ? idPart : null;
  }

  // Common YouTube URL regex patterns
  const patterns = [
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/|live\/))([\w-]{11})/i,
    /^[a-zA-Z0-9_-]{11}$/
  ];

  for (const regex of patterns) {
    const match = clean.match(regex);
    if (match && match[1]) {
      return match[1];
    }
    if (match && match[0] && match[0].length === 11) {
      return match[0];
    }
  }

  return null;
}

/**
 * Parses a musicURL which might contain start and end timing
 * e.g. "youtube:dQw4w9WgXcQ?start=15&end=45"
 */
export function parseYouTubeMusicUrl(musicURL?: string): { videoId: string | null; start?: number; end?: number } {
  if (!musicURL) return { videoId: null };
  const videoId = extractYouTubeId(musicURL);
  if (!videoId) return { videoId: null };

  let start: number | undefined;
  let end: number | undefined;

  try {
    if (musicURL.includes('?')) {
      const queryString = musicURL.split('?')[1];
      const params = new URLSearchParams(queryString);
      const s = params.get('start') || params.get('t');
      const e = params.get('end');
      if (s) start = parseInt(s, 10);
      if (e) end = parseInt(e, 10);
    }
  } catch {}

  return { videoId, start, end };
}

/**
 * Builds formatted YouTube audio identifier with start and end trimming
 */
export function formatYouTubeMusicUrl(videoId: string, start?: number, end?: number): string {
  let url = `youtube:${videoId}`;
  const params: string[] = [];
  if (typeof start === 'number' && start > 0) {
    params.push(`start=${Math.floor(start)}`);
  }
  if (typeof end === 'number' && end > 0 && (start === undefined || end > start)) {
    params.push(`end=${Math.floor(end)}`);
  }
  if (params.length > 0) {
    url += `?${params.join('&')}`;
  }
  return url;
}

/**
 * Checks if a string is a YouTube music URL format
 */
export function isYouTubeMusic(musicURL?: string): boolean {
  if (!musicURL) return false;
  return musicURL.startsWith('youtube:') || !!extractYouTubeId(musicURL);
}

/**
 * Gets video ID from musicURL
 */
export function getYouTubeIdFromMusicURL(musicURL?: string): string | null {
  if (!musicURL) return null;
  return extractYouTubeId(musicURL);
}

/**
 * Formats seconds into mm:ss format (e.g. 75 -> "01:15")
 */
export function formatSecondsToTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Parses mm:ss or seconds string into number
 */
export function parseTimeToSeconds(input: string): number {
  if (!input) return 0;
  const clean = input.trim();
  if (clean.includes(':')) {
    const parts = clean.split(':').map(p => parseInt(p, 10) || 0);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  const num = parseInt(clean, 10);
  return isNaN(num) ? 0 : Math.max(0, num);
}

/**
 * Fetches YouTube video metadata (title, author, thumbnail) using YouTube OEMBED API (public & CORS friendly)
 */
export async function fetchYouTubeMetadata(videoId: string): Promise<{ title: string; author: string; thumbnailUrl: string }> {
  const fallback = {
    title: 'YouTube Audio Track',
    author: 'YouTube Artist',
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  };

  try {
    const oembedUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) {
        return {
          title: data.title,
          author: data.author_name || 'YouTube Music',
          thumbnailUrl: data.thumbnail_url || fallback.thumbnailUrl
        };
      }
    }
  } catch {
    // Fallback if network blocked
  }

  return fallback;
}

/**
 * Initial curated global sound library to seed empty state
 */
export const INITIAL_GLOBAL_SOUNDS = [
  {
    id: 'snd_lofi_study',
    title: 'Lofi Study Chill Beat',
    author: 'FASSounds',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=300&q=80',
    sourceType: 'preset' as const,
    url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    startTime: 0,
    endTime: 30,
    duration: 30,
    useCount: 142,
    addedByUserName: 'Vimos Sound Lab',
    createdAt: Date.now() - 86400000 * 3
  },
  {
    id: 'snd_acoustic_breeze',
    title: 'Acoustic Morning Breeze',
    author: 'Lesfm',
    thumbnailUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&q=80',
    sourceType: 'preset' as const,
    url: 'https://cdn.pixabay.com/download/audio/2021/11/25/audio_91b3cb81ed.mp3?filename=acoustic-motivational-113213.mp3',
    startTime: 0,
    endTime: 30,
    duration: 30,
    useCount: 98,
    addedByUserName: 'Vimos Sound Lab',
    createdAt: Date.now() - 86400000 * 2
  },
  {
    id: 'snd_cinematic_epic',
    title: 'Cinematic Trailer Epic Rise',
    author: 'AudioCoffee',
    thumbnailUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&q=80',
    sourceType: 'preset' as const,
    url: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_0625c1539c.mp3?filename=epic-cinematic-trailer-103890.mp3',
    startTime: 0,
    endTime: 30,
    duration: 30,
    useCount: 76,
    addedByUserName: 'Vimos Sound Lab',
    createdAt: Date.now() - 86400000 * 4
  },
  {
    id: 'snd_midnight_groove',
    title: 'Midnight Synth Groove',
    author: 'RetroWave Project',
    thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&q=80',
    sourceType: 'preset' as const,
    url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=midnight-forest-184304.mp3',
    startTime: 0,
    endTime: 30,
    duration: 30,
    useCount: 115,
    addedByUserName: 'Vimos Sound Lab',
    createdAt: Date.now() - 86400000 * 1
  }
];

