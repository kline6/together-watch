import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import multer from 'multer';
import { RoomManager } from './roomManager.js';
import { parseVideoUrl, parseVideoUrlAsync } from './videoParser.js';
import { isYtDlpAvailable } from './videoExtractor.js';
import { extractBilibiliVideo, isBilibiliUrl } from './bilibiliExtractor.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  DanmakuData,
  UserData,
  RoomData,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? '*' : ['http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(cors());
app.use(express.json());

// Log all incoming requests
app.use((req, _res, next) => {
  console.log(`[server] ${req.method} ${req.url}`);
  next();
});

const roomManager = new RoomManager();
const OWNER_TIMEOUT = 30000;
const SYNC_INTERVAL = 1000;

const disconnectedOwners = new Map<string, NodeJS.Timeout>();

// ---- Multer config ----
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (_req, file, cb) => {
    const videoTypes = [
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      'video/x-msvideo', 'video/x-matroska', 'video/mpeg',
    ];
    if (videoTypes.includes(file.mimetype) || file.originalname.match(/\.(mp4|webm|ogg|mov|avi|mkv|mpeg)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，请上传视频文件'));
    }
  },
});

// ---- Upload API ----
app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '文件太大，最大支持 2GB' });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的视频' });
    }

    const videoUrl = `/api/video/${req.file.filename}`;
    res.json({
      success: true,
      data: {
        type: 'direct',
        url: videoUrl,
        embedUrl: videoUrl,
        title: req.file.originalname.replace(/\.[^/.]+$/, ''),
        filename: req.file.filename,
        size: req.file.size,
      },
    });
  });
});

// ---- Video streaming with Range support ----
app.get('/api/video/:filename', (req, res) => {
  const requested = path.normalize(req.params.filename);
  if (path.isAbsolute(requested) || requested.includes('..') || requested.includes('/') || requested.includes('\\')) {
    return res.status(400).json({ error: '无效的文件名' });
  }

  const filePath = path.join(UPLOAD_DIR, requested);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep) && resolvedPath !== path.resolve(UPLOAD_DIR)) {
    return res.status(400).json({ error: '无效的文件名' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '视频文件不存在或已过期' });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ error: '视频文件不存在或已过期' });
  }
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filePath, { start, end });
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
      '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska', '.mpeg': 'video/mpeg',
    };

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeMap[ext] || 'video/mp4',
      'Cache-Control': 'public, max-age=3600',
    });
    stream.pipe(res);
  } else {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
      '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska', '.mpeg': 'video/mpeg',
    };

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeMap[ext] || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Cleanup old upload files (not referenced by any room) every 30 minutes
setInterval(() => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(UPLOAD_DIR, file);
      const stat = fs.statSync(filePath);
      // Delete files older than 2 hours
      if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* ignore */ }
}, 30 * 60 * 1000);

// ---- Video Proxy (for external URLs that need headers) ----
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url as string;
  console.log('[proxy] Incoming request, url:', targetUrl?.substring(0, 100));

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }

  try {
    const parsedUrl = new URL(targetUrl);

    const forbiddenHostnames = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (forbiddenHostnames.has(hostname) || hostname.startsWith('10.') || hostname.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
      return res.status(400).json({ error: '不允许访问该地址' });
    }
    const range = req.headers.range;

    // Auto-detect correct Referer based on CDN domain
    let refererHeader = parsedUrl.origin + '/';
    if (/bilivideo\.com$/i.test(parsedUrl.hostname)) {
      refererHeader = 'https://www.bilibili.com/';
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': refererHeader,
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (range) {
      headers['Range'] = range;
    }

    console.log('[proxy] Fetching:', parsedUrl.hostname + parsedUrl.pathname.substring(0, 40), range ? '(range)' : '', 'Referer:', refererHeader);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    console.log('[proxy] Upstream responded:', upstream.status, upstream.headers.get('content-type'));

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: 'Upstream returned ' + upstream.status });
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Accept-Ranges': upstream.headers.get('accept-ranges') || 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    };
    const cl = upstream.headers.get('content-length');
    if (cl) responseHeaders['Content-Length'] = cl;
    const cr = upstream.headers.get('content-range');
    if (cr) responseHeaders['Content-Range'] = cr;

    res.writeHead(upstream.status === 206 ? 206 : 200, responseHeaders);

    if (upstream.body) {
      const reader = (upstream.body as any).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || !res.writable) break;
          res.write(value);
        }
      } catch (e) {
        console.log('[proxy] Stream error:', (e as Error).message);
      }
    }
    res.end();
  } catch (err: any) {
    console.error('[proxy] Error:', err.message || err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy failed: ' + (err.message || 'unknown') });
    } else {
      res.end();
    }
  }
});

// ---- Parse API ----
app.post('/api/parse', async (req, res) => {
  const { url } = req.body;
  console.log('[parse] 收到请求:', url);

  if (!url) {
    console.log('[parse] 错误: 没有提供URL');
    return res.status(400).json({ error: '请提供视频链接' });
  }

  try {
    const parsed = await parseVideoUrlAsync(url);
    console.log('[parse] 解析结果:', parsed ? `成功 → ${parsed.url.substring(0, 100)}` : '失败');
    if (!parsed) {
      return res.status(400).json({
        error: '该网站无法自动提取视频直链。可能原因：1) 网站需要登录 2) 视频有防盗链保护 3) 不是直接视频链接。建议：使用 .mp4 直链或上传本地视频文件。',
      });
    }
    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('[parse] 异常:', err);
    res.status(500).json({ error: '解析过程出错，请重试' });
  }
});

// ---- Refresh Video URL (for expired CDN links like Bilibili) ----
app.post('/api/refresh-url', async (req, res) => {
  const { pageUrl } = req.body;
  console.log('[refresh] Refreshing URL for:', pageUrl);

  if (!pageUrl) {
    return res.status(400).json({ error: 'Missing pageUrl' });
  }

  try {
    const parsed = await parseVideoUrlAsync(pageUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Could not refresh video URL' });
    }
    console.log('[refresh] Success:', parsed.url.substring(0, 80));
    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('[refresh] Error:', err);
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// ---- 获取视频可用画质列表 ----
app.get('/api/formats', async (req, res) => {
  const pageUrl = req.query.url as string;
  if (!pageUrl) return res.status(400).json({ error: 'Missing url' });

  // B站视频暂不支持画质切换（自动选择最佳画质）
  if (isBilibiliUrl(pageUrl)) {
    return res.json({ formats: [], title: '' });
  }

  if (!isYtDlpAvailable()) return res.status(500).json({ error: 'yt-dlp 未安装' });

  try {
    console.log('[formats] 获取:', pageUrl.substring(0, 80));

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('yt-dlp', [
        '--dump-json', '--no-warnings', '--no-playlist', pageUrl,
      ], { timeout: 30000 });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.substring(0, 300) || `exit code ${code}`));
        } else {
          resolve(stdout);
        }
      });
    });

    const data = JSON.parse(output);

    // 提取视频格式（排除纯音频）
    const formats = (data.formats || [])
      .filter((f: any) => f.vcodec && f.vcodec !== 'none' && f.height)
      .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));

    // 去重并按高度分组
    const seenHeights = new Set<number>();
    const unique: { id: string; height: number; label: string }[] = [];
    for (const f of formats) {
      const h = f.height;
      if (h && !seenHeights.has(h)) {
        seenHeights.add(h);
        const label = h >= 2160 ? '4K' : h >= 1440 ? '2K' : h >= 1080 ? '1080P' : h >= 720 ? '720P' : h >= 480 ? '480P' : h >= 360 ? '360P' : `${h}P`;
        unique.push({ id: f.format_id, height: h, label });
      }
    }

    console.log('[formats] 可用画质:', unique.map(f => f.label).join(', '));
    res.json({ formats: unique, title: data.title || '' });
  } catch (err: any) {
    console.error('[formats] 获取失败:', err.message);
    res.status(500).json({ error: '获取画质列表失败: ' + err.message });
  }
});

// ---- 下载并合并音视频流（B站用API+ffmpeg，其他用yt-dlp） ----
app.get('/api/download-merged', async (req, res) => {
  const pageUrl = req.query.url as string;
  const quality = req.query.q as string || 'best';
  if (!pageUrl) return res.status(400).json({ error: 'Missing url' });

  console.log('[download-merged] 请求:', pageUrl.substring(0, 80));

  const tmpName = `merged_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = path.join(UPLOAD_DIR, tmpName + '.mp4');

  // B站视频：用专用API获取流地址，再用ffmpeg合并
  if (isBilibiliUrl(pageUrl)) {
    console.log('[download-merged] 检测到B站，使用API方案');
    try {
      const info = await extractBilibiliVideo(pageUrl);
      if (!info || !info.url) {
        return res.status(500).json({ error: 'B站视频解析失败' });
      }
      if (!info.audioUrl) {
        // 纯视频流（无独立音频），直接代理
        console.log('[download-merged] B站无独立音频，直接返回视频流');
        return res.redirect(`/api/proxy?url=${encodeURIComponent(info.url)}`);
      }

      // 下载视频+音频流，用ffmpeg合并
      console.log('[download-merged] B站DASH，用ffmpeg合并');
      const videoTmp = path.join(UPLOAD_DIR, `${tmpName}_v.mp4`);
      const audioTmp = path.join(UPLOAD_DIR, `${tmpName}_a.mp4`);

      // 直接下载视频+音频流（不走代理，避免502）
      console.log('[download-merged] 下载B站DASH流...');
      const headers = {
        'Referer': 'https://www.bilibili.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };
      const [vRes, aRes] = await Promise.all([
        fetch(info.url, { headers }),
        fetch(info.audioUrl, { headers }),
      ]);

      if (!vRes.ok || !aRes.ok) {
        console.error('[download-merged] 流下载失败: v=', vRes.status, 'a=', aRes.status);
        return res.status(502).json({ error: '视频流下载失败' });
      }

      const vBuf = Buffer.from(await vRes.arrayBuffer());
      const aBuf = Buffer.from(await aRes.arrayBuffer());
      fs.writeFileSync(videoTmp, vBuf);
      fs.writeFileSync(audioTmp, aBuf);
      console.log('[download-merged] 流下载完成: v=', vBuf.length, 'a=', aBuf.length);

      // ffmpeg合并
      await new Promise<void>((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-i', videoTmp, '-i', audioTmp,
          '-c:v', 'copy', '-c:a', 'copy',
          '-movflags', '+faststart',
          '-y', tmpPath,
        ], { timeout: 60000 });

        let stderr = '';
        ff.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        ff.on('error', reject);
        ff.on('close', (code) => {
          // 清理临时文件
          try { fs.unlinkSync(videoTmp); } catch {}
          try { fs.unlinkSync(audioTmp); } catch {}
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-200)}`));
        });
      });

      console.log('[download-merged] B站合并完成');
      serveFile(tmpPath, res);
    } catch (err: any) {
      console.error('[download-merged] B站方案失败:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'B站视频合并失败: ' + err.message });
      try { fs.unlinkSync(tmpPath); } catch {}
    }
    return;
  }

  // 非B站：用yt-dlp
  if (!isYtDlpAvailable()) {
    return res.status(500).json({ error: 'yt-dlp 未安装，无法合并音视频' });
  }

  console.log('[download-merged] 使用yt-dlp:', pageUrl.substring(0, 80));
  const args = [
    '-f', 'bv*+ba/bestvideo+bestaudio/best',
    '--format-sort', 'res,codec:h264',
    '--merge-output-format', 'mp4',
    '-o', tmpPath,
    '--no-warnings', '--no-check-certificates', '--newline',
    '--retries', '3', '--extractor-retries', '3', '--socket-timeout', '30',
    pageUrl,
  ];

  let responseSent = false;
  const child = spawn('yt-dlp', args, { timeout: 300000 });
  let stderrBuf = '';
  child.stderr?.on('data', (data: Buffer) => { stderrBuf += data.toString(); });

  child.on('error', (err) => {
    console.error('[yt-dlp] spawn error:', err.message);
    if (!responseSent && !res.headersSent) { responseSent = true; res.status(500).json({ error: 'yt-dlp 启动失败: ' + err.message }); }
    cleanupTmpFiles();
  });

  child.on('close', (code) => {
    if (responseSent) { if (code !== 0) console.error('[yt-dlp] 退出码:', code); return; }
    if (code !== 0) {
      console.error('[yt-dlp] 错误, 退出码:', code);
      console.error('[yt-dlp] stderr:', stderrBuf.substring(0, 500));
      if (!res.headersSent) { responseSent = true; res.status(500).json({ error: 'yt-dlp 下载失败 (code ' + code + ')' }); }
      cleanupTmpFiles(); return;
    }
    const actualPath = findMergedFile(tmpPath);
    if (!actualPath) { if (!res.headersSent) { responseSent = true; res.status(500).json({ error: '下载完成但文件不存在' }); } return; }
    responseSent = true;
    serveFile(actualPath, res);
  });

  child.stdout?.on('data', (data: Buffer) => { const line = data.toString().trim(); if (line.includes('%')) console.log('[yt-dlp]', line); });

  req.on('close', () => { if (!child.killed) { try { child.kill(); } catch {} } cleanupTmpFiles(); });

  function findMergedFile(primary: string): string | null {
    if (fs.existsSync(primary)) return primary;
    // yt-dlp 有时用不同扩展名
    const alt = primary.replace('.mp4', '.mkv');
    if (fs.existsSync(alt)) return alt;
    const alt2 = primary.replace('.mp4', '.webm');
    if (fs.existsSync(alt2)) return alt2;
    // 扫描 uploads 目录找匹配
    const base = path.basename(primary, '.mp4');
    try {
      const files = fs.readdirSync(UPLOAD_DIR);
      for (const f of files) {
        if (f.startsWith(base.replace('.mp4', ''))) {
          return path.join(UPLOAD_DIR, f);
        }
      }
    } catch {}
    return null;
  }

  function cleanupTmpFiles() {
    try {
      const base = tmpName;
      const files = fs.readdirSync(UPLOAD_DIR);
      for (const f of files) {
        if (f.startsWith(base)) {
          try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch {}
        }
      }
    } catch {}
  }
});

function serveFile(filePath: string, res: express.Response) {
  if (!fs.existsSync(filePath)) {
    if (!res.headersSent) res.status(404).json({ error: '视频文件不存在或已过期' });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    if (!res.headersSent) res.status(404).json({ error: '视频文件不存在或已过期' });
    return;
  }

  const fileSize = stat.size;
  const range = res.req.headers.range;

  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  };
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeMap[ext] || 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  }

  // 文件发送完毕后延迟删除（给视频播放器足够缓冲时间）
  res.on('finish', () => {
    setTimeout(() => {
      try { fs.unlinkSync(filePath); console.log('[cleanup] 已删除临时文件:', path.basename(filePath)); } catch {}
    }, 10 * 60 * 1000); // 10 分钟后删除
  });
}

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ---- Socket.IO ----
io.on('connection', (socket) => {
  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  // --- Create Room ---
  socket.on('create-room', ({ videoUrl, nickname, password, parsedVideo: clientParsed }) => {
    try {
      const parsed = clientParsed || parseVideoUrl(videoUrl);
      const { room, owner } = roomManager.createRoom(videoUrl, parsed, nickname, password);

      currentRoomId = room.id;
      currentUserId = owner.id;

      socket.join(room.id);
      socket.data.userId = owner.id;
      socket.data.roomId = room.id;

      const roomData: RoomData = {
        id: room.id,
        code: room.code,
        videoUrl: room.videoUrl,
        parsedVideo: room.parsedVideo,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        playbackRate: room.playbackRate,
        syncLocked: room.syncLocked,
        ownerId: room.ownerId,
      };

      const users = roomManager.getUsers(room);

      socket.emit('room-joined', { room: roomData, users });
      socket.to(room.id).emit('user-joined', { user: { id: owner.id, nickname: owner.nickname, isOwner: true } });
      socket.to(room.id).emit('user-list', { users });

      startHeartbeat();
    } catch (err) {
      socket.emit('room-error', { message: '创建房间失败，请重试' });
    }
  });

  // --- Join Room ---
  socket.on('join-room', ({ roomCode, nickname, password }) => {
    try {
      const room = roomManager.getRoomByCode(roomCode);
      if (!room) {
        return socket.emit('room-error', { message: '房间可能已经解散了哦' });
      }

      const user = roomManager.addUser(room, nickname, password);
      if (!user) {
        return socket.emit('room-error', { message: '房间密码错误' });
      }

      currentRoomId = room.id;
      currentUserId = user.id;

      socket.join(room.id);
      socket.data.userId = user.id;
      socket.data.roomId = room.id;

      const roomData: RoomData = {
        id: room.id,
        code: room.code,
        videoUrl: room.videoUrl,
        parsedVideo: room.parsedVideo,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        playbackRate: room.playbackRate,
        syncLocked: room.syncLocked,
        ownerId: room.ownerId,
      };

      const users = roomManager.getUsers(room);
      const history = roomManager.getDanmakuHistory(room, undefined);

      socket.emit('room-joined', { room: roomData, users });
      socket.emit('danmaku-history', {
        danmaku: history.map((d) => ({
          id: d.id,
          nickname: d.nickname,
          text: d.text,
          color: d.color,
          timestamp: d.timestamp,
          type: d.type,
          targetUserId: d.targetUserId,
          likes: d.likes,
          likedBy: d.likedBy,
        })),
      });

      socket.to(room.id).emit('user-joined', {
        user: { id: user.id, nickname: user.nickname, isOwner: false },
      });
      socket.to(room.id).emit('user-list', { users: roomManager.getUsers(room) });

      startHeartbeat();
    } catch (err) {
      socket.emit('room-error', { message: '加入房间失败，请重试' });
    }
  });

  // --- Sync Play ---
  socket.on('sync-play', ({ currentTime }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || socket.data.userId !== room.ownerId) return;

    room.isPlaying = true;
    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(room.id).emit('sync-state', {
      isPlaying: true,
      currentTime,
      playbackRate: room.playbackRate,
      serverTime: Date.now(),
    });
  });

  // --- Sync Pause ---
  socket.on('sync-pause', ({ currentTime }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || socket.data.userId !== room.ownerId) return;

    room.isPlaying = false;
    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(room.id).emit('sync-state', {
      isPlaying: false,
      currentTime,
      playbackRate: room.playbackRate,
      serverTime: Date.now(),
    });
  });

  // --- Sync Seek ---
  socket.on('sync-seek', ({ currentTime }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || socket.data.userId !== room.ownerId) return;

    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(room.id).emit('sync-state', {
      isPlaying: room.isPlaying,
      currentTime,
      playbackRate: room.playbackRate,
      serverTime: Date.now(),
    });
  });

  // --- Sync Rate ---
  socket.on('sync-rate', ({ playbackRate }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || socket.data.userId !== room.ownerId) return;

    room.playbackRate = playbackRate;
    room.lastUpdate = Date.now();

    socket.to(room.id).emit('sync-state', {
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      playbackRate,
      serverTime: Date.now(),
    });
  });

  // --- Sync Lock ---
  socket.on('sync-lock', ({ locked }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || socket.data.userId !== room.ownerId) return;

    room.syncLocked = locked;
  });

  // --- Send Danmaku ---
  socket.on('send-danmaku', ({ text, color, timestamp, type, targetUserId }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room) return;

    const user = room.users.get(socket.data.userId);
    if (!user) return;

    const danmaku = roomManager.addDanmaku(room, {
      userId: user.id,
      nickname: user.nickname,
      text: text.slice(0, 50),
      color,
      timestamp,
      type: type || 'public',
      targetUserId,
    });

    const danmakuData: DanmakuData = {
      id: danmaku.id,
      nickname: danmaku.nickname,
      text: danmaku.text,
      color: danmaku.color,
      timestamp: danmaku.timestamp,
      type: danmaku.type,
      targetUserId: danmaku.targetUserId,
      likes: danmaku.likes,
      likedBy: danmaku.likedBy,
    };

    if (type === 'private' && targetUserId) {
      const targetSocket = findSocketByUserId(targetUserId);
      if (targetSocket) {
        io.to(targetSocket.id).emit('private-danmaku', danmakuData);
      }
      socket.emit('danmaku-new', danmakuData);
    } else {
      io.to(room.id).emit('danmaku-new', danmakuData);
    }
  });

  // --- Like Danmaku ---
  socket.on('like-danmaku', ({ danmakuId }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room) return;

    const result = roomManager.likeDanmaku(room, danmakuId, socket.data.userId);
    if (result.success) {
      io.to(room.id).emit('danmaku-liked', {
        danmakuId,
        likes: result.likes!,
      });
    }
  });

  // --- Request Sync ---
  socket.on('request-sync', () => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room || room.syncLocked) return;

    socket.emit('sync-state', {
      isPlaying: room.isPlaying,
      currentTime: room.currentTime,
      playbackRate: room.playbackRate,
      serverTime: Date.now(),
    });
  });

  // --- Heartbeat ---
  socket.on('heartbeat', ({ currentTime }) => {
    const room = roomManager.getRoomById(currentRoomId!);
    if (!room) return;

    if (socket.data.userId === room.ownerId) {
      room.currentTime = currentTime;
      room.lastUpdate = Date.now();
    }
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    stopHeartbeat();

    if (currentRoomId && currentUserId) {
      const room = roomManager.getRoomById(currentRoomId);

      if (room) {
        if (room.ownerId === currentUserId) {
          const timeout = setTimeout(() => {
            const result = roomManager.transferOwnershipOnDisconnect(
              currentRoomId!,
              currentUserId!
            );
            if (result.newOwner) {
              const newOwnerSocket = findSocketByUserId(result.newOwner.id);
              if (newOwnerSocket) {
                io.to(currentRoomId!).emit('owner-changed', {
                  newOwnerId: result.newOwner.id,
                });
                io.to(currentRoomId!).emit('user-list', {
                  users: roomManager.getUsers(room),
                });
                io.to(currentRoomId!).emit('toast', {
                  message: '房主已离开，您现在成为新房主',
                });
              }
            }
            disconnectedOwners.delete(currentUserId!);
          }, OWNER_TIMEOUT);

          disconnectedOwners.set(currentUserId, timeout);
        }

        const { newOwner } = roomManager.removeUser(room, currentUserId);

        if (newOwner) {
          io.to(currentRoomId).emit('owner-changed', {
            newOwnerId: newOwner.id,
          });
        }

        socket.to(currentRoomId).emit('user-left', {
          userId: currentUserId,
          newOwner: newOwner
            ? { id: newOwner.id, nickname: newOwner.nickname, isOwner: true }
            : undefined,
        });

        socket.to(currentRoomId).emit('user-list', {
          users: roomManager.getUsers(room),
        });

        if (roomManager.isRoomEmpty(currentRoomId)) {
          room.lastUpdate = Date.now();
        }
      }
    }

    currentRoomId = null;
    currentUserId = null;
  });

  (socket as any).on('reconnect', () => {
    if (currentUserId && disconnectedOwners.has(currentUserId)) {
      const timeout = disconnectedOwners.get(currentUserId)!;
      clearTimeout(timeout);
      disconnectedOwners.delete(currentUserId);
    }
  });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (currentRoomId && currentUserId) {
        const room = roomManager.getRoomById(currentRoomId);
        if (room && currentUserId === room.ownerId) {
          socket.to(room.id).emit('sync-state', {
            isPlaying: room.isPlaying,
            currentTime: room.currentTime,
            playbackRate: room.playbackRate,
            serverTime: Date.now(),
          });
        }
      }
    }, SYNC_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function findSocketByUserId(userId: string) {
    for (const [sid, sock] of io.sockets.sockets) {
      if (sock.data.userId === userId) return sock;
    }
    return null;
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  一起看吧 · 同步观影厅');
  console.log(`  服务器运行在 http://localhost:${PORT}`);
  console.log(`  yt-dlp: ${isYtDlpAvailable() ? '已安装 ✓' : '未安装 ✗ (建议 pip install yt-dlp)'}`);
  console.log('========================================');
  console.log('');
});

process.on('SIGTERM', () => {
  roomManager.destroy();
  httpServer.close();
});