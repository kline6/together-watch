export interface ParsedVideo {
  type: 'direct';
  title?: string;
  url: string;
  rawUrl?: string;
  audioUrl?: string;
  rawAudioUrl?: string;
  videoCodec?: string;
  audioCodec?: string;
  embedUrl: string;
  thumbnail?: string;
  duration?: number;
  referer?: string;
  sourceUrl?: string;
}

export interface UserData {
  id: string;
  nickname: string;
  isOwner: boolean;
}

export interface DanmakuData {
  id: string;
  nickname: string;
  text: string;
  color: string;
  timestamp: number;
  type: 'public' | 'private';
  targetUserId?: string;
  likes: number;
  likedBy: string[];
}

export interface RoomData {
  id: string;
  code: string;
  videoUrl: string;
  parsedVideo: ParsedVideo | null;
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  syncLocked: boolean;
  ownerId: string;
}

export const DANMAKU_COLORS = [
  '#FFFFFF',
  '#FF6B6B',
  '#FFD93D',
  '#6BCB77',
  '#4D96FF',
  '#FF6BDF',
  '#00E5FF',
  '#B000FF',
];

export const PLACEHOLDER_TEXT = '粘贴视频链接到这里';
export const ERROR_PARSE_FAILED = '哎呀，链接解析不出来，换个视频试试？';
export const ERROR_ROOM_NOT_FOUND = '房间可能已经解散了哦';
export const TOAST_DURATION = 3000;
