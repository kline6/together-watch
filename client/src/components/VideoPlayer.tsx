import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import type { ParsedVideo } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  setCurrentTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  setPlaybackRate: (rate: number) => void;
  isPaused: () => boolean;
}

interface Props {
  parsedVideo: ParsedVideo;
  isOwner: boolean;
  isPlaying: boolean;
  currentTime: number;
  playbackRate: number;
  syncLocked: boolean;
  onPlay: (time: number) => void;
  onPause: (time: number) => void;
  onSeek: (time: number) => void;
  onRateChange: (rate: number) => void;
  onTimeUpdate: (time: number) => void;
  onToggleLock: () => void;
}

/** 等待 SourceBuffer 更新完成 */
function waitUpdate(sb: SourceBuffer): Promise<void> {
  return new Promise<void>((ok, fail) => {
    sb.addEventListener('updateend', () => ok(), { once: true });
    sb.addEventListener('error', () => fail(new Error('sb error')), { once: true });
  });
}

/** 流式写入 SourceBuffer */
async function pumpToBuffer(res: Response, sb: SourceBuffer) {
  const reader = res.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (sb.updating) await waitUpdate(sb);
    const p = waitUpdate(sb);
    sb.appendBuffer(value);
    await p;
  }
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(
  ({ parsedVideo, isOwner, isPlaying, currentTime, playbackRate, syncLocked,
     onPlay, onPause, onSeek, onRateChange, onTimeUpdate, onToggleLock }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const isInternalAction = useRef(false);
    const lastTimeRef = useRef(0);
    const lastSeekTime = useRef(0);
    const mseRef = useRef(false);

    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [videoError, setVideoError] = useState<string | null>(null);
    const [mseLoading, setMseLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const refreshAttempted = useRef(false);
    const initializedRef = useRef(false);
    const [qualities, setQualities] = useState<{ id: string; height: number; label: string }[]>([]);
    const [currentQuality, setCurrentQuality] = useState('best');
    const [showQualityMenu, setShowQualityMenu] = useState(false);
    const qualityMenuRef = useRef<HTMLDivElement>(null);

    // ====== 视频源初始化（仅执行一次） ======
    useEffect(() => {
      if (initializedRef.current) return;
      initializedRef.current = true;

      const rawAudio = parsedVideo.rawAudioUrl || parsedVideo.audioUrl;
      const rawVideo = parsedVideo.rawUrl || parsedVideo.url;
      const hasSourceUrl = !!parsedVideo.sourceUrl;

      if (rawAudio && rawVideo && hasSourceUrl) {
        console.log('[VideoPlayer] Bilibili DASH → 使用 yt-dlp 合并下载');
        setMseLoading(true);
        setVideoSrc(`${API_URL}/api/download-merged?url=${encodeURIComponent(parsedVideo.sourceUrl!)}`);
      } else if (rawAudio && rawVideo && window.MediaSource) {
        const videoCodec = parsedVideo.videoCodec || 'avc1.64001f';
        const audioCodec = parsedVideo.audioCodec || 'mp4a.40.2';
        const vMime = `video/mp4; codecs="${videoCodec}"`;
        const aMime = `audio/mp4; codecs="${audioCodec}"`;

        if (MediaSource.isTypeSupported(vMime) && MediaSource.isTypeSupported(aMime)) {
          console.log('[VideoPlayer] MSE 合并: v=', vMime, 'a=', aMime);
          setMseLoading(true);
          setVideoError(null);
          const ms = new MediaSource();
          const blobUrl = URL.createObjectURL(ms);

          ms.addEventListener('sourceopen', async () => {
            let vBuf: SourceBuffer, aBuf: SourceBuffer;
            try {
              vBuf = ms.addSourceBuffer(vMime);
              aBuf = ms.addSourceBuffer(aMime);
            } catch (e) {
              console.error('[MSE] SourceBuffer 创建失败:', e);
              setVideoSrc(parsedVideo.url);
              setMseLoading(false);
              return;
            }
            mseRef.current = true;

            try {
              const vProxy = `${API_URL}/api/proxy?url=${encodeURIComponent(rawVideo)}`;
              const aProxy = `${API_URL}/api/proxy?url=${encodeURIComponent(rawAudio)}`;
              const [vRes, aRes] = await Promise.all([fetch(vProxy), fetch(aProxy)]);
              if (!vRes.ok || !aRes.ok) throw new Error(`流获取失败: v=${vRes.status} a=${aRes.status}`);
              if (!vRes.body || !aRes.body) throw new Error('响应体为空');
              setMseLoading(false);
              await Promise.all([pumpToBuffer(vRes, vBuf), pumpToBuffer(aRes, aBuf)]);
              if (ms.readyState === 'open') ms.endOfStream();
            } catch (e) {
              console.error('[MSE] 错误:', e);
              mseRef.current = false;
              setMseLoading(false);
              setVideoSrc(parsedVideo.url);
            }
          });

          const video = videoRef.current;
          if (video) video.src = blobUrl;
          return () => { mseRef.current = false; URL.revokeObjectURL(blobUrl); };
        } else {
          setVideoSrc(parsedVideo.url);
        }
      } else {
        setVideoSrc(parsedVideo.url);
      }
    }, []); // 空依赖，只执行一次

    // ====== 刷新过期链接 ======
    const refreshVideoUrl = useCallback(async () => {
      const src = parsedVideo.sourceUrl;
      if (!src || refreshing) return;
      setRefreshing(true);
      setVideoError(null);
      try {
        const res = await fetch(`${API_URL}/api/refresh-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageUrl: src }),
        });
        const json = await res.json();
        if (json.success && json.data?.url) {
          const d = json.data;
          const fresh = d.url.startsWith('http')
            ? `${API_URL}/api/proxy?url=${encodeURIComponent(d.url)}${d.referer ? `&referer=${encodeURIComponent(d.referer)}` : ''}`
            : d.url;
          setVideoSrc(fresh);
          refreshAttempted.current = true;
        } else {
          setVideoError('视频链接刷新失败，请返回重新解析');
        }
      } catch {
        setVideoError('刷新请求失败，请检查网络');
      } finally {
        setRefreshing(false);
      }
    }, [parsedVideo.sourceUrl, refreshing]);

    // ====== 暴露方法 ======
    useImperativeHandle(ref, () => ({
      getCurrentTime: () => videoRef.current?.currentTime ?? lastTimeRef.current,
      setCurrentTime: (t: number) => {
        lastSeekTime.current = t;
        if (videoRef.current) {
          isInternalAction.current = true;
          videoRef.current.currentTime = t;
          setTimeout(() => { isInternalAction.current = false; }, 200);
        }
        lastTimeRef.current = t;
      },
      play: () => {
        if (videoRef.current) {
          isInternalAction.current = true;
          videoRef.current.play().catch(() => {});
          setTimeout(() => { isInternalAction.current = false; }, 200);
        }
      },
      pause: () => {
        if (videoRef.current) {
          isInternalAction.current = true;
          videoRef.current.pause();
          setTimeout(() => { isInternalAction.current = false; }, 200);
        }
      },
      setPlaybackRate: (r: number) => { if (videoRef.current) videoRef.current.playbackRate = r; },
      isPaused: () => videoRef.current?.paused ?? true,
    }));

    // ====== 键盘快捷键 ======
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
        const v = videoRef.current;
        if (!v) return;
        switch (e.key) {
          case ' ':
            e.preventDefault();
            if (v.paused) onPlay(v.currentTime); else onPause(v.currentTime);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - 5);
            break;
          case 'ArrowRight':
            e.preventDefault();
            v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5);
            break;
          case 'ArrowUp':
            e.preventDefault();
            v.volume = Math.min(1, v.volume + 0.1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            v.volume = Math.max(0, v.volume - 0.1);
            break;
          case 'f': case 'F':
            e.preventDefault();
            if (document.fullscreenElement) document.exitFullscreen();
            else (v.closest('.video-player-wrapper') as HTMLElement)?.requestFullscreen?.();
            break;
          case 'm': case 'M':
            e.preventDefault();
            v.muted = !v.muted;
            break;
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onPlay, onPause]);

    // ====== 代理预检 + 自动刷新 ======
    useEffect(() => {
      if (!parsedVideo.url.startsWith('/api/proxy')) return;
      fetch(parsedVideo.url, { method: 'HEAD' })
        .then(res => {
          if (!res.ok && parsedVideo.sourceUrl && !refreshAttempted.current) refreshVideoUrl();
          else if (!res.ok) setVideoError(`代理返回 ${res.status}，视频源可能已过期`);
        })
        .catch(() => {
          if (parsedVideo.sourceUrl && !refreshAttempted.current) refreshVideoUrl();
          else setVideoError('代理请求失败');
        });
    }, [parsedVideo.url]);

    // ====== 获取可用画质列表 ======
    useEffect(() => {
      if (!parsedVideo.sourceUrl) return;
      const src = encodeURIComponent(parsedVideo.sourceUrl);
      console.log('[VideoPlayer] 获取画质列表:', parsedVideo.sourceUrl.substring(0, 60));
      fetch(`${API_URL}/api/formats?url=${src}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(data => {
          console.log('[VideoPlayer] 画质列表:', data.formats?.length || 0, '项');
          if (data.formats?.length > 0) setQualities(data.formats);
        })
        .catch((err) => {
          console.error('[VideoPlayer] 获取画质失败:', err.message);
        });
    }, [parsedVideo.sourceUrl]);

    // ====== 切换画质（下载完成后才切换） ======
    const switchQuality = useCallback((quality: string) => {
      if (quality === currentQuality || !parsedVideo.sourceUrl) return;
      setCurrentQuality(quality);
      setShowQualityMenu(false);
      setMseLoading(true);
      setVideoError(null);
      setVideoSrc(`${API_URL}/api/download-merged?url=${encodeURIComponent(parsedVideo.sourceUrl)}&q=${quality}`);
    }, [currentQuality, parsedVideo.sourceUrl]);

    // 点击外部关闭画质菜单
    useEffect(() => {
      const handleClick = (e: MouseEvent) => {
        if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
          setShowQualityMenu(false);
        }
      };
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // ====== 错误处理 ======
    const handleVideoError = useCallback(() => {
      const v = videoRef.current;
      if (!v) return;
      if (mseRef.current) return; // MSE 模式下忽略

      // yt-dlp 合并下载失败
      if (videoSrc?.includes('/api/download-merged')) {
        setMseLoading(false);
        setVideoError('音视频合并下载失败，可能是服务器未安装 ffmpeg。点击下方按钮尝试纯视频播放。');
        return;
      }

      const code = v.error?.code ?? 0;
      const msgs: Record<number, string> = {
        1: '视频加载被中止', 2: '网络错误', 3: '视频解码失败', 4: '不支持的视频格式',
      };
      if ((code === 2 || code === 4) && parsedVideo.sourceUrl && !refreshAttempted.current) {
        refreshVideoUrl(); return;
      }
      setVideoError(msgs[code] || `未知错误 (code=${code})`);
    }, [parsedVideo.sourceUrl, videoSrc]);

    // ====== 原生事件 ======
    const handlePlay = useCallback(() => {
      if (isInternalAction.current) return;
      onPlay(videoRef.current?.currentTime ?? 0);
      setMseLoading(false);
    }, [onPlay]);

    const handlePause = useCallback(() => {
      if (isInternalAction.current) return;
      onPause(videoRef.current?.currentTime ?? 0);
    }, [onPause]);

    const handleSeeked = useCallback(() => {
      if (isInternalAction.current) return;
      const t = videoRef.current?.currentTime ?? 0;
      if (Math.abs(t - lastSeekTime.current) > 0.3) {
        lastSeekTime.current = t;
        onSeek(t);
      }
    }, [onSeek]);

    const handleTimeUpdate = useCallback(() => {
      if (!videoRef.current) return;
      lastTimeRef.current = videoRef.current.currentTime;
      onTimeUpdate(videoRef.current.currentTime);
    }, [onTimeUpdate]);

    const handleRateChange = useCallback(() => {
      if (!videoRef.current || isInternalAction.current) return;
      onRateChange(videoRef.current.playbackRate);
    }, [onRateChange]);

    const handleLoadedData = useCallback(() => { setMseLoading(false); }, []);

    // ====== 同步 ======
    useEffect(() => {
      const v = videoRef.current;
      if (!v || isInternalAction.current || mseLoading) return;
      isInternalAction.current = true;
      if (isPlaying && v.paused) {
        v.play().catch(() => {}).finally(() => { isInternalAction.current = false; });
      } else if (!isPlaying && !v.paused) {
        v.pause(); isInternalAction.current = false;
      } else { isInternalAction.current = false; }
    }, [isPlaying, mseLoading]);

    useEffect(() => {
      if (isInternalAction.current || !videoRef.current || mseLoading) return;
      if (Math.abs(videoRef.current.currentTime - currentTime) > 0.1) {
        isInternalAction.current = true;
        videoRef.current.currentTime = currentTime;
        setTimeout(() => { isInternalAction.current = false; }, 200);
      }
    }, [currentTime, mseLoading]);

    useEffect(() => {
      if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    }, [playbackRate]);

    return (
      <div className="video-player-wrapper">
        <div className="video-player-native">
          <video
            ref={videoRef}
            src={videoSrc ?? undefined}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onTimeUpdate={handleTimeUpdate}
            onRateChange={handleRateChange}
            onError={handleVideoError}
            onLoadedData={handleLoadedData}
            controls
            playsInline
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {mseLoading && (
          <div className="video-error-overlay">
            <div className="video-error-box">
              <div className="video-error-title">正在加载音视频...</div>
              <div className="video-error-msg">正在合并B站视频和音频流</div>
            </div>
          </div>
        )}

        {videoError && !refreshing && !mseLoading && (
          <div className="video-error-overlay">
            <div className="video-error-box">
              <div className="video-error-title">视频加载失败</div>
              <div className="video-error-msg">{videoError}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {parsedVideo.sourceUrl && (
                  <button className="video-refresh-btn" onClick={() => { refreshAttempted.current = false; refreshVideoUrl(); }}>
                    刷新视频链接
                  </button>
                )}
                {videoSrc?.includes('/api/download-merged') && (
                  <button className="video-refresh-btn" onClick={() => { setVideoError(null); setVideoSrc(parsedVideo.url); }}>
                    尝试纯视频播放（无音频）
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {refreshing && (
          <div className="video-error-overlay">
            <div className="video-error-box">
              <div className="video-error-title">正在刷新视频链接...</div>
            </div>
          </div>
        )}

        {parsedVideo.sourceUrl && videoSrc?.includes('/api/download-merged') && (
          <div className="quality-selector" ref={qualityMenuRef}>
            <button
              className="quality-btn"
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              title="切换画质"
            >
              {currentQuality === 'best' ? '自动' : currentQuality.toUpperCase()}
            </button>
            {showQualityMenu && (
              <div className="quality-menu">
                {qualities.length === 0 && (
                  <div className="quality-loading">加载中...</div>
                )}
                {qualities.map((q) => (
                  <button
                    key={q.id}
                    className={`quality-option ${(q.id === currentQuality || q.label.toLowerCase() === currentQuality) ? 'active' : ''}`}
                    onClick={() => switchQuality(q.label.toLowerCase())}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="video-shortcuts-hint">
          空格: 暂停 | ←→: 快退/快进 5s | ↑↓: 音量 | F: 全屏 | M: 静音
        </div>

        {isOwner && (
          <button className={`sync-lock-btn ${syncLocked ? 'locked' : ''}`} onClick={onToggleLock}>
            🔒 {syncLocked ? '已锁定' : '同步锁定'}
          </button>
        )}
      </div>
    );
  }
);

VideoPlayer.displayName = 'VideoPlayer';
export default VideoPlayer;
