import React, { useEffect, useRef, useState, useCallback } from 'react';
import TopBar from '../components/TopBar';
import VideoPlayer, { VideoPlayerHandle } from '../components/VideoPlayer';
import DanmakuLayer from '../components/DanmakuLayer';
import DanmakuInput from '../components/DanmakuInput';
import DanmakuHistory from '../components/DanmakuHistory';
import MemberList from '../components/MemberList';
import Toast from '../components/Toast';
import type { RoomData, UserData, DanmakuData, ParsedVideo } from '../types';
import { getRandomNickname } from '../utils/roomUtils';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Props {
  roomData: RoomData;
  users: UserData[];
  currentUserId: string;
  nickname: string;
  connected: boolean;
  socket: any;
  toasts: Array<{ id: number; message: string; type: 'success' | 'error' | 'info' }>;
  removeToast: (id: number) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  onLeave: () => void;
}

const RoomPage: React.FC<Props> = ({
  roomData,
  users,
  currentUserId,
  nickname: initialNickname,
  connected,
  socket,
  toasts,
  removeToast,
  addToast,
  onLeave,
}) => {
  const videoRef = useRef<VideoPlayerHandle>(null);
  const [nickname, setNickname] = useState(initialNickname || getRandomNickname());
  const [danmakuList, setDanmakuList] = useState<DanmakuData[]>([]);
  const [danmakuVisible, setDanmakuVisible] = useState(true);
  const [memberListCollapsed, setMemberListCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(roomData?.currentTime || 0);
  const [isPlaying, setIsPlaying] = useState(roomData?.isPlaying || false);
  const [playbackRate, setPlaybackRate] = useState(roomData?.playbackRate || 1);
  const [syncLocked, setSyncLocked] = useState(roomData?.syncLocked || false);
  const [whisperTarget, setWhisperTarget] = useState<{ id: string; nickname: string } | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousTimeRef = useRef<number>(roomData?.currentTime || 0);
  const isOwner = currentUserId === roomData?.ownerId;
  const syncingRef = useRef(false);

  // Sync reference data for interpolation
  const syncRef = useRef({
    serverTime: 0,
    currentTime: roomData?.currentTime || 0,
    isPlaying: roomData?.isPlaying || false,
    playbackRate: roomData?.playbackRate || 1,
  });

  // Handle incoming socket events
  useEffect(() => {
    if (!socket.current) return;

    const handlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];

    const addHandler = (event: string, handler: (...args: any[]) => void) => {
      handlers.push({ event, handler });
      socket.current!.on(event, handler);
    };

    // Sync state from owner — use serverTime interpolation for precision
    addHandler('sync-state', (data: { isPlaying: boolean; currentTime: number; playbackRate: number; serverTime: number }) => {
      if (isOwner) return;

      // Store raw sync data for interpolation
      syncRef.current = {
        serverTime: data.serverTime,
        currentTime: data.currentTime,
        isPlaying: data.isPlaying,
        playbackRate: data.playbackRate,
      };

      setIsPlaying(data.isPlaying);
      setPlaybackRate(data.playbackRate);

      // Calculate owner's current position accounting for network delay
      const elapsed = (Date.now() - data.serverTime) / 1000;
      const ownerNow = data.isPlaying
        ? data.currentTime + elapsed * data.playbackRate
        : data.currentTime;

      const video = videoRef.current;
      if (!video) return;

      const myTime = video.getCurrentTime();
      const diff = Math.abs(myTime - ownerNow);

      if (diff > 0.1) {
        previousTimeRef.current = ownerNow;
        setCurrentTime(ownerNow);
        video.setCurrentTime(ownerNow);
      }

      // Apply play/pause state
      if (data.isPlaying) {
        video.play();
      } else {
        video.pause();
      }
    });

    // New danmaku
    addHandler('danmaku-new', (data: DanmakuData) => {
      setDanmakuList((prev) => [...prev, data]);
    });

    // Danmaku history
    addHandler('danmaku-history', (data: { danmaku: DanmakuData[] }) => {
      setDanmakuList((prev) => {
        const existingIds = new Set(prev.map((d) => d.id));
        const newOnes = data.danmaku.filter((d) => !existingIds.has(d.id));
        return [...prev, ...newOnes].slice(-200);
      });
    });

    // Danmaku liked
    addHandler('danmaku-liked', (data: { danmakuId: string; likes: number }) => {
      setDanmakuList((prev) =>
        prev.map((d) => (d.id === data.danmakuId ? { ...d, likes: data.likes } : d))
      );
    });

    // Private danmaku
    addHandler('private-danmaku', (data: DanmakuData) => {
      setDanmakuList((prev) => [...prev, data]);
      addToast(`来自 ${data.nickname} 的私聊: ${data.text}`, 'info');
    });

    // Toast from server
    addHandler('toast', (data: { message: string }) => {
      addToast(data.message, 'info');
    });

    // Owner changed
    addHandler('owner-changed', (data: { newOwnerId: string }) => {
      if (data.newOwnerId === currentUserId) {
        addToast('房主已离开，您现在成为新房主', 'info');
      }
    });

    return () => {
      handlers.forEach(({ event, handler }) => {
        socket.current?.off(event, handler);
      });
    };
  }, [socket.current, currentUserId, isOwner]);

  // Heartbeat for owner — keeps server's room time updated + broadcasts to members every 1s
  useEffect(() => {
    if (!isOwner || !socket.current?.connected) return;

    heartbeatRef.current = setInterval(() => {
      const time = videoRef.current?.getCurrentTime() || 0;
      socket.current?.emit('heartbeat', { currentTime: time });
    }, 1000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [isOwner, socket.current?.connected]);

  // Continuous playback correction for non-owners — check drift every 500ms
  useEffect(() => {
    if (isOwner) return;

    const correctionTimer = setInterval(() => {
      const { serverTime, currentTime, isPlaying: ownerPlaying, playbackRate } = syncRef.current;
      if (!serverTime || !ownerPlaying) return;

      const video = videoRef.current;
      if (!video) return;

      // Interpolate owner's current position
      const elapsed = (Date.now() - serverTime) / 1000;
      const ownerNow = currentTime + elapsed * playbackRate;
      const myTime = video.getCurrentTime();
      const diff = ownerNow - myTime;

      if (Math.abs(diff) > 0.1) {
        // If drift is small (0.1-1s), adjust playback rate to catch up smoothly
        if (Math.abs(diff) < 1.0 && video.isPaused() === false) {
          const adjustRate = diff > 0
            ? Math.min(playbackRate + 0.1, playbackRate * 1.05)
            : Math.max(playbackRate - 0.1, playbackRate * 0.95);
          video.setPlaybackRate(adjustRate);
        } else {
          // Large drift: hard seek
          video.setCurrentTime(ownerNow);
          video.setPlaybackRate(playbackRate);
          previousTimeRef.current = ownerNow;
        }
      } else {
        // Within tolerance: restore normal playback rate
        video.setPlaybackRate(playbackRate);
      }
    }, 500);

    return () => clearInterval(correctionTimer);
  }, [isOwner]);

  // Owner video control handlers
  const handlePlay = useCallback((time: number) => {
    if (!isOwner) return;
    setIsPlaying(true);
    previousTimeRef.current = time;
    socket.current?.emit('sync-play', { currentTime: time });
  }, [isOwner, socket.current]);

  const handlePause = useCallback((time: number) => {
    if (!isOwner) return;
    setIsPlaying(false);
    previousTimeRef.current = time;
    socket.current?.emit('sync-pause', { currentTime: time });
  }, [isOwner, socket.current]);

  const handleSeek = useCallback((time: number) => {
    if (!isOwner) return;
    previousTimeRef.current = time;
    setCurrentTime(time);
    socket.current?.emit('sync-seek', { currentTime: time });
  }, [isOwner, socket.current]);

  const handleRateChange = useCallback((rate: number) => {
    if (!isOwner) return;
    setPlaybackRate(rate);
    socket.current?.emit('sync-rate', { playbackRate: rate });
  }, [isOwner, socket.current]);

  const handleTimeUpdate = useCallback((time: number) => {
    previousTimeRef.current = time;
  }, []);

  const handleToggleLock = useCallback(() => {
    const newLocked = !syncLocked;
    setSyncLocked(newLocked);
    socket.current?.emit('sync-lock', { locked: newLocked });
  }, [syncLocked, socket.current]);

  // Danmaku send
  const handleSendDanmaku = useCallback((text: string, color: string) => {
    if (!socket.current?.connected) return;

    const time = videoRef.current?.getCurrentTime() || 0;

    socket.current.emit('send-danmaku', {
      text,
      color,
      timestamp: time,
      type: whisperTarget ? 'private' : 'public',
      targetUserId: whisperTarget?.id,
    });

    if (whisperTarget) {
      addToast(`已向 ${whisperTarget.nickname} 发送私聊弹幕`, 'success');
      setWhisperTarget(null);
    }
  }, [socket.current, whisperTarget, addToast]);

  // Danmaku like
  const handleDanmakuLike = useCallback((danmakuId: string) => {
    if (!socket.current?.connected) return;
    socket.current.emit('like-danmaku', { danmakuId });
  }, [socket.current]);

  // Whisper
  const handleWhisper = useCallback((userId: string, nickname: string) => {
    setWhisperTarget({ id: userId, nickname });
    addToast(`正在向 ${nickname} 发送私聊弹幕`, 'info');
  }, [addToast]);

  // Request initial sync
  useEffect(() => {
    if (socket.current?.connected && roomData && !isOwner) {
      socket.current.emit('request-sync');
    }
  }, [socket.current?.connected, roomData?.id, isOwner]);

  const parsedVideo: ParsedVideo | null = roomData?.parsedVideo || null;

  // Route external video URLs through the server proxy
  const effectiveVideo = React.useMemo(() => {
    if (!parsedVideo) return null;
    return {
      ...parsedVideo,
      url: parsedVideo.url.startsWith('http')
        ? `${API_URL}/api/proxy?url=${encodeURIComponent(parsedVideo.url)}${parsedVideo.referer ? `&referer=${encodeURIComponent(parsedVideo.referer)}` : ''}`
        : parsedVideo.url,
      audioUrl: parsedVideo.audioUrl?.startsWith('http')
        ? `${API_URL}/api/proxy?url=${encodeURIComponent(parsedVideo.audioUrl)}${parsedVideo.referer ? `&referer=${encodeURIComponent(parsedVideo.referer)}` : ''}`
        : parsedVideo.audioUrl,
    };
  }, [parsedVideo]);

  if (!effectiveVideo) {
    return (
      <div className="room-page">
        <TopBar roomCode={roomData.code} onLeave={onLeave} />
        <div className="loading-page">
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}> :( </div>
            <h2 style={{ color: '#ff6b6b', marginBottom: 12 }}>视频无法加载</h2>
            <p style={{ color: '#aaa', lineHeight: 1.6, marginBottom: 16 }}>
              服务器无法从该链接提取可播放的视频地址。
              该网站可能有防盗链保护或需要登录。
            </p>
            <p style={{ color: '#666', fontSize: 13 }}>
              建议：使用 .mp4/.webm 直链，或上传本地视频文件。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="room-page">
      <TopBar roomCode={roomData.code} onLeave={onLeave} />

      <div className="room-content">
        <div className="room-main">
          <div className="video-container">
            <div className="video-area">
              <VideoPlayer
                ref={videoRef}
                parsedVideo={effectiveVideo}
                isOwner={isOwner}
                isPlaying={isPlaying}
                currentTime={currentTime}
                playbackRate={playbackRate}
                syncLocked={syncLocked}
                onPlay={handlePlay}
                onPause={handlePause}
                onSeek={handleSeek}
                onRateChange={handleRateChange}
                onTimeUpdate={handleTimeUpdate}
                onToggleLock={handleToggleLock}
              />
              <DanmakuLayer
                danmakuList={danmakuList}
                currentTime={currentTime}
                visible={danmakuVisible}
              />
            </div>
          </div>

          <div className="video-controls-bar">
            <label className="danmaku-toggle">
              <input
                type="checkbox"
                checked={danmakuVisible}
                onChange={(e) => setDanmakuVisible(e.target.checked)}
              />
              <span>弹幕</span>
            </label>
            {!isOwner && (
              <button
                className="request-sync-btn"
                onClick={() => {
                  socket.current?.emit('request-sync');
                  addToast('正在请求同步...', 'info');
                }}
              >
                同步进度
              </button>
            )}
            {whisperTarget && (
              <span className="whisper-indicator">
                私聊给 {whisperTarget.nickname}
                <button onClick={() => setWhisperTarget(null)}>取消</button>
              </span>
            )}
          </div>

          <div className="sync-status">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? '已同步' : '连接中...'} · 共 {users.length} 人观看
            {!isOwner && <span className="sync-hint"> · 只有房主可以控制视频进度</span>}
          </div>
        </div>

        <div className="room-sidebar">
          <MemberList
            users={users}
            currentUserId={currentUserId}
            onWhisper={handleWhisper}
            collapsed={memberListCollapsed}
            onToggleCollapse={() => setMemberListCollapsed(!memberListCollapsed)}
          />

          <div className="sidebar-divider" />

          <DanmakuInput
            onSend={handleSendDanmaku}
            nickname={nickname}
            onNicknameChange={setNickname}
          />

          <DanmakuHistory
            danmakuList={danmakuList}
            currentUserId={currentUserId}
            onLike={handleDanmakuLike}
          />
        </div>
      </div>

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
};

export default RoomPage;

