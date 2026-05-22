export interface User {
  id: string;
  nickname: string;
  isOwner: boolean;
  joinedAt: number;
}

export interface Danmaku {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  color: string;
  timestamp: number; // video relative time in seconds
  sentAt: number; // server time
  type: 'public' | 'private';
  targetUserId?: string;
  likes: number;
  likedBy: string[];
}

export interface Room {
  id: string;
  code: string;
  videoUrl: string;
  parsedVideo: ParsedVideo | null;
  users: Map<string, User>;
  danmaku: Danmaku[];
  ownerId: string;
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  lastUpdate: number;
  createdAt: number;
  password?: string;
  syncLocked: boolean;
  uploadedFile?: string; // path to uploaded file
}

export interface ParsedVideo {
  type: 'youtube' | 'bilibili' | 'vimeo' | 'tencent' | 'iqiyi' | 'direct';
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

export interface ServerToClientEvents {
  'room-joined': (data: { room: RoomData; users: UserData[] }) => void;
  'room-error': (data: { message: string }) => void;
  'user-joined': (data: { user: UserData }) => void;
  'user-left': (data: { userId: string; newOwner?: UserData }) => void;
  'owner-changed': (data: { newOwnerId: string }) => void;
  'sync-state': (data: {
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
    serverTime: number;
  }) => void;
  'danmaku-new': (data: DanmakuData) => void;
  'danmaku-history': (data: { danmaku: DanmakuData[] }) => void;
  'danmaku-liked': (data: { danmakuId: string; likes: number }) => void;
  'private-danmaku': (data: DanmakuData) => void;
  'user-list': (data: { users: UserData[] }) => void;
  'toast': (data: { message: string }) => void;
}

export interface ClientToServerEvents {
  'create-room': (data: {
    videoUrl: string;
    nickname: string;
    password?: string;
    parsedVideo?: ParsedVideo;
  }) => void;
  'join-room': (data: {
    roomCode: string;
    nickname: string;
    password?: string;
  }) => void;
  'sync-play': (data: { currentTime: number }) => void;
  'sync-pause': (data: { currentTime: number }) => void;
  'sync-seek': (data: { currentTime: number }) => void;
  'sync-rate': (data: { playbackRate: number }) => void;
  'sync-lock': (data: { locked: boolean }) => void;
  'send-danmaku': (data: {
    text: string;
    color: string;
    timestamp: number;
    type?: 'public' | 'private';
    targetUserId?: string;
  }) => void;
  'like-danmaku': (data: { danmakuId: string }) => void;
  'request-sync': () => void;
  'heartbeat': (data: { currentTime: number }) => void;
}

export type UserData = {
  id: string;
  nickname: string;
  isOwner: boolean;
};

export type DanmakuData = {
  id: string;
  nickname: string;
  text: string;
  color: string;
  timestamp: number;
  type: 'public' | 'private';
  targetUserId?: string;
  likes: number;
  likedBy: string[];
};

export type RoomData = {
  id: string;
  code: string;
  videoUrl: string;
  parsedVideo: ParsedVideo | null;
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  syncLocked: boolean;
  ownerId: string;
};
