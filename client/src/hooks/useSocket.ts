import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomData, UserData, DanmakuData } from '../types';

interface ServerEvents {
  'room-joined': (data: { room: RoomData; users: UserData[] }) => void;
  'room-error': (data: { message: string }) => void;
  'user-joined': (data: { user: UserData }) => void;
  'user-left': (data: { userId: string; newOwner?: UserData }) => void;
  'owner-changed': (data: { newOwnerId: string }) => void;
  'sync-state': (data: { isPlaying: boolean; currentTime: number; playbackRate: number; serverTime: number }) => void;
  'danmaku-new': (data: DanmakuData) => void;
  'danmaku-history': (data: { danmaku: DanmakuData[] }) => void;
  'danmaku-liked': (data: { danmakuId: string; likes: number }) => void;
  'private-danmaku': (data: DanmakuData) => void;
  'user-list': (data: { users: UserData[] }) => void;
  'toast': (data: { message: string }) => void;
}

interface ClientEvents {
  'create-room': (data: { videoUrl: string; nickname: string; password?: string; parsedVideo?: any }) => void;
  'join-room': (data: { roomCode: string; nickname: string; password?: string }) => void;
  'sync-play': (data: { currentTime: number }) => void;
  'sync-pause': (data: { currentTime: number }) => void;
  'sync-seek': (data: { currentTime: number }) => void;
  'sync-rate': (data: { playbackRate: number }) => void;
  'sync-lock': (data: { locked: boolean }) => void;
  'send-danmaku': (data: { text: string; color: string; timestamp: number; type?: 'public' | 'private'; targetUserId?: string }) => void;
  'like-danmaku': (data: { danmakuId: string }) => void;
  'request-sync': () => void;
  'heartbeat': (data: { currentTime: number }) => void;
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function useSocket() {
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);

  useEffect(() => {
    const socket: Socket<ServerEvents, ClientEvents> = io(API_URL || undefined, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: false,
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room-joined', (data) => {
      setRoomData(data.room);
      setUsers(data.users);
    });

    socket.on('room-error', () => {
      setRoomData(null);
      setUsers([]);
    });

    socket.on('user-list', (data) => {
      setUsers(data.users);
    });

    socket.on('user-joined', (data) => {
      setUsers((prev) => {
        if (prev.find((u) => u.id === data.user.id)) return prev;
        return [...prev, data.user];
      });
    });

    socket.on('user-left', (data) => {
      setUsers((prev) => prev.filter((u) => u.id !== data.userId));
    });

    socket.on('owner-changed', (data) => {
      setUsers((prev) =>
        prev.map((u) => ({ ...u, isOwner: u.id === data.newOwnerId }))
      );
      setRoomData((prev) => (prev ? { ...prev, ownerId: data.newOwnerId } : null));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const emit = useCallback(<K extends keyof ClientEvents>(
    event: K,
    ...args: Parameters<ClientEvents[K]>
  ) => {
    if (socketRef.current?.connected) {
      (socketRef.current.emit as any)(event, ...args);
    }
  }, []);

  const on = useCallback(<K extends keyof ServerEvents>(
    event: K,
    handler: ServerEvents[K]
  ) => {
    const socket = socketRef.current;
    if (!socket) return () => {};

    socket.on(event, handler as any);

    return () => {
      socket.off(event, handler as any);
    };
  }, []);

  const updateRoomData = useCallback((updates: Partial<RoomData>) => {
    setRoomData((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  return {
    socket: socketRef,
    connected,
    roomData,
    users,
    emit,
    on,
    updateRoomData,
    setRoomData,
    setUsers,
  };
}
