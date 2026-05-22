import React, { useEffect, useRef, useCallback } from 'react';
import type { DanmakuData } from '../types';

interface FloatingDanmaku {
  id: string;
  text: string;
  color: string;
  nickname: string;
  x: number;
  y: number;
  speed: number;
  opacity: number;
  fontSize: number;
}

interface Props {
  danmakuList: DanmakuData[];
  currentTime: number;
  visible: boolean;
  videoDuration?: number;
}

const FONT_SIZE = 20;
const ROW_HEIGHT = 32;
const PADDING = 8;
const SPEED = 120; // pixels per second
const ROWS = 8;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;

const DanmakuLayer: React.FC<Props> = ({
  danmakuList,
  currentTime,
  visible,
  videoDuration,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const danmakuPool = useRef<FloatingDanmaku[]>([]);
  const rowOccupancy = useRef<Map<number, number>>(new Map());
  const processedTimestamps = useRef<Set<string>>(new Set());
  const lastTimeRef = useRef<number>(0);

  const addDanmaku = useCallback((d: DanmakuData, time: number) => {
    const key = `${d.id}-${d.timestamp}`;
    if (processedTimestamps.current.has(key)) return;
    processedTimestamps.current.add(key);

    // Don't show private danmaku on the public canvas
    if (d.type === 'private') return;

    // Find best row
    let row = -1;
    for (let r = 0; r < ROWS; r++) {
      const occupiedUntil = rowOccupancy.current.get(r) || 0;
      if (time >= occupiedUntil) {
        row = r;
        break;
      }
    }
    if (row < 0) {
      // Pick least occupied row
      let minUntil = Infinity;
      for (let r = 0; r < ROWS; r++) {
        const until = rowOccupancy.current.get(r) || 0;
        if (until < minUntil) {
          minUntil = until;
          row = r;
        }
      }
    }

    const text = `${d.nickname}: ${d.text}`;
    const textWidth = text.length * FONT_SIZE * 0.6;
    const duration = (CANVAS_WIDTH + textWidth) / SPEED;

    rowOccupancy.current.set(row, time + duration);

    const floating: FloatingDanmaku = {
      id: d.id,
      text,
      color: d.color,
      nickname: d.nickname,
      x: CANVAS_WIDTH,
      y: PADDING + row * ROW_HEIGHT + FONT_SIZE,
      speed: SPEED,
      opacity: 0.9,
      fontSize: FONT_SIZE,
    };

    danmakuPool.current.push(floating);

    // Limit active danmaku
    if (danmakuPool.current.length > 200) {
      danmakuPool.current = danmakuPool.current.slice(-150);
    }
  }, []);

  // Process incoming danmaku
  useEffect(() => {
    if (!visible) return;

    // Clear processed track for new video position
    // Only process danmaku close to current time
    danmakuList.forEach((d) => {
      if (
        d.timestamp >= currentTime - 0.5 &&
        d.timestamp <= currentTime + 0.5 &&
        d.type === 'public'
      ) {
        addDanmaku(d, currentTime);
      }
    });
  }, [danmakuList.length, currentTime, visible, addDanmaku]);

  // When seeking, clear and re-evaluate
  useEffect(() => {
    if (Math.abs(currentTime - lastTimeRef.current) > 2) {
      // Significant seek - clear current danmaku and add relevant ones
      danmakuPool.current = [];
      rowOccupancy.current.clear();
      processedTimestamps.current.clear();
      lastTimeRef.current = currentTime;

      // Re-add relevant danmaku
      const relevant = danmakuList.filter(
        (d) => d.timestamp >= currentTime && d.timestamp <= currentTime + 3 && d.type === 'public'
      );
      relevant.forEach((d) => addDanmaku(d, currentTime));
    } else {
      lastTimeRef.current = currentTime;
    }
  }, [Math.floor(currentTime / 10)]); // check every 10 seconds of seek

  // Animation loop
  useEffect(() => {
    if (!visible) {
      danmakuPool.current = [];
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = (timestamp: number) => {
      if (!lastFrameRef.current) lastFrameRef.current = timestamp;
      const dt = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      if (dt > 0.1) {
        animFrameRef.current = requestAnimationFrame(animate);
        return; // Skip if tab was hidden
      }

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Update positions
      danmakuPool.current = danmakuPool.current.filter((d) => {
        d.x -= d.speed * dt;
        return d.x > -d.text.length * d.fontSize * 0.6;
      });

      // Draw
      for (const d of danmakuPool.current) {
        ctx.font = `bold ${d.fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        ctx.textBaseline = 'top';

        // Stroke
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(d.text, d.x - 1, d.y - 1);

        // Fill
        ctx.fillStyle = d.color;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 2;
        ctx.fillText(d.text, d.x, d.y);
        ctx.shadowBlur = 0;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    lastFrameRef.current = 0;
    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="danmaku-canvas"
    />
  );
};

export default DanmakuLayer;
