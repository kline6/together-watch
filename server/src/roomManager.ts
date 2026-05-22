import { Room, User, Danmaku, ParsedVideo } from './types.js';
import { v4 as uuidv4 } from 'uuid';
import { unlinkSync, existsSync } from 'fs';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const ROOM_TTL = 10 * 60 * 1000; // 10 minutes after all users leave
const MAX_DANMAKU_AGE = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_DANMAKU = 50;
const UPLOAD_DIR = 'uploads';

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private codeIndex: Map<string, string> = new Map(); // code -> roomId
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
      if (!this.codeIndex.has(code)) return code;
    }
    return uuidv4().slice(0, 6).toUpperCase();
  }

  createRoom(
    videoUrl: string,
    parsedVideo: ParsedVideo | null,
    ownerNickname: string,
    password?: string
  ): { room: Room; owner: User } {
    const roomId = uuidv4();
    const code = this.generateRoomCode();
    const ownerId = uuidv4();

    const owner: User = {
      id: ownerId,
      nickname: ownerNickname,
      isOwner: true,
      joinedAt: Date.now(),
    };

    const users = new Map<string, User>();
    users.set(ownerId, owner);

    const room: Room = {
      id: roomId,
      code,
      videoUrl,
      parsedVideo,
      users,
      danmaku: [],
      ownerId,
      isPlaying: false,
      currentTime: 0,
      playbackRate: 1,
      lastUpdate: Date.now(),
      createdAt: Date.now(),
      password,
      syncLocked: false,
    };

    this.rooms.set(roomId, room);
    this.codeIndex.set(code, roomId);

    return { room, owner };
  }

  getRoomByCode(code: string): Room | undefined {
    const roomId = this.codeIndex.get(code.toUpperCase());
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  getRoomById(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  addUser(room: Room, nickname: string, password?: string): User | null {
    if (room.password && room.password !== password) return null;

    const userId = uuidv4();
    const user: User = {
      id: userId,
      nickname,
      isOwner: false,
      joinedAt: Date.now(),
    };

    room.users.set(userId, user);
    room.lastUpdate = Date.now();
    return user;
  }

  removeUser(room: Room, userId: string): { newOwner?: User } {
    room.users.delete(userId);
    room.lastUpdate = Date.now();

    // Transfer ownership if needed
    if (room.ownerId === userId && room.users.size > 0) {
      const sorted = [...room.users.values()].sort(
        (a, b) => a.joinedAt - b.joinedAt
      );
      const newOwner = sorted[0];
      newOwner.isOwner = true;
      room.ownerId = newOwner.id;
      return { newOwner };
    }

    return {};
  }

  transferOwnershipOnDisconnect(roomId: string, userId: string): { newOwner?: User; found: boolean } {
    const room = this.rooms.get(roomId);
    if (!room) return { found: false };

    if (room.ownerId === userId && room.users.size > 0) {
      // Find the user with this ID - they might still be in the room (disconnected but not left)
      const user = room.users.get(userId);
      if (user) {
        user.isOwner = false;
      }

      const sorted = [...room.users.values()]
        .filter((u) => u.id !== userId)
        .sort((a, b) => a.joinedAt - b.joinedAt);

      if (sorted.length > 0) {
        const newOwner = sorted[0];
        newOwner.isOwner = true;
        room.ownerId = newOwner.id;
        return { newOwner, found: true };
      }
    }

    return { found: true };
  }

  getUsers(room: Room) {
    return [...room.users.values()].map((u) => ({
      id: u.id,
      nickname: u.nickname,
      isOwner: u.isOwner,
    }));
  }

  addDanmaku(room: Room, danmaku: Omit<Danmaku, 'id' | 'sentAt' | 'likes' | 'likedBy'>): Danmaku {
    const newDanmaku: Danmaku = {
      ...danmaku,
      id: uuidv4(),
      sentAt: Date.now(),
      likes: 0,
      likedBy: [],
    };

    room.danmaku.push(newDanmaku);
    return newDanmaku;
  }

  getDanmakuHistory(room: Room, currentTime?: number): Danmaku[] {
    const cutoff = Date.now() - MAX_DANMAKU_AGE;
    const filtered = room.danmaku.filter((d) => d.sentAt >= cutoff);

    if (currentTime !== undefined) {
      // Return danmaku that are "in the future" relative to current video time
      return filtered
        .filter((d) => d.timestamp >= currentTime)
        .slice(-MAX_HISTORY_DANMAKU);
    }

    return filtered.slice(-MAX_HISTORY_DANMAKU);
  }

  likeDanmaku(room: Room, danmakuId: string, userId: string): { success: boolean; likes?: number } {
    const danmaku = room.danmaku.find((d) => d.id === danmakuId);
    if (!danmaku) return { success: false };

    if (danmaku.likedBy.includes(userId)) return { success: false, likes: danmaku.likes };

    danmaku.likes++;
    danmaku.likedBy.push(userId);
    return { success: true, likes: danmaku.likes };
  }

  isRoomEmpty(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.users.size === 0 : true;
  }

  deleteRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (room) {
      // Delete uploaded file if exists
      if (room.uploadedFile) {
        try {
          const filePath = room.uploadedFile;
          if (existsSync(filePath)) unlinkSync(filePath);
        } catch { /* file already deleted or in use */ }
      }
      this.codeIndex.delete(room.code);
      this.rooms.delete(roomId);
    }
  }

  setRoomUploadedFile(roomId: string, filePath: string) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.uploadedFile = filePath;
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      // Remove stale danmaku
      const cutoff = now - MAX_DANMAKU_AGE;
      room.danmaku = room.danmaku.filter((d) => d.sentAt >= cutoff);

      // Remove empty rooms after TTL
      if (room.users.size === 0 && now - room.lastUpdate > ROOM_TTL) {
        this.deleteRoom(roomId);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}
