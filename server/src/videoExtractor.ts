import { execFileSync } from 'child_process';
import { ParsedVideo } from './types.js';

/**
 * Try to extract a direct video URL using yt-dlp.
 * Returns null if yt-dlp is not installed or fails.
 */
export function extractWithYtDlp(url: string): ParsedVideo | null {
  try {
    console.log('[yt-dlp] 开始提取:', url);
    const output = execFileSync(
      'yt-dlp',
      ['--dump-json', '--no-warnings', '--no-playlist', url],
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 }
    );

    const data = JSON.parse(output);
    console.log('[yt-dlp] 提取成功, title:', data.title);
    console.log('[yt-dlp] formats count:', data.formats?.length || 0);

    const isDirectVideo = (u: string) =>
      u.startsWith('http') && /\.(mp4|webm|m3u8|flv|ts)(\?|$|#|&)/i.test(u);

    let videoUrl = '';
    let audioUrl: string | undefined;
    let videoCodec: string | undefined;
    let audioCodec: string | undefined;

    // 从 formats 数组中找出最佳视频和音频流
    if (data.formats?.length > 0) {
      // 视频流：有 video codec
      const videoFormats = data.formats
        .filter((f: any) => f.url && f.vcodec && f.vcodec !== 'none' && f.url.startsWith('http'))
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
      if (videoFormats.length > 0) {
        videoUrl = videoFormats[0].url;
        videoCodec = videoFormats[0].vcodec;
      }

      // 音频流：有 audio codec 但无 video codec（独立音频）
      const audioFormats = data.formats
        .filter((f: any) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url.startsWith('http'))
        .sort((a: any, b: any) => (b.abr || 0) - (a.abr || 0));
      if (audioFormats.length > 0) {
        audioUrl = audioFormats[0].url;
        audioCodec = audioFormats[0].acodec;
      }
    }

    // Try data.url if no video found yet
    if (!videoUrl && data.url && isDirectVideo(data.url)) {
      videoUrl = data.url;
    }

    // requested_formats fallback
    if (!videoUrl && data.requested_formats?.length > 0) {
      const best = data.requested_formats
        .filter((f: any) => f.url && f.vcodec !== 'none')
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
      if (best?.url) {
        videoUrl = best.url;
        videoCodec = best.vcodec;
      }
      const bestAudio = data.requested_formats
        .filter((f: any) => f.url && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
        .sort((a: any, b: any) => (b.abr || 0) - (a.abr || 0))[0];
      if (bestAudio?.url && !audioUrl) {
        audioUrl = bestAudio.url;
        audioCodec = bestAudio.acodec;
      }
    }

    const title = data.title || '';

    if (!videoUrl) {
      console.log('[yt-dlp] 没有找到直链视频URL');
      console.log('[yt-dlp] data.url:', data.url?.substring(0, 80) || '(empty)');
      console.log('[yt-dlp] webpage_url:', data.webpage_url?.substring(0, 80) || '(empty)');
      return null;
    }

    console.log('[yt-dlp] 视频URL:', videoUrl.substring(0, 100));
    if (audioUrl) console.log('[yt-dlp] 音频URL:', audioUrl.substring(0, 60) + '...');
    console.log('[yt-dlp] sourceUrl:', data.webpage_url || '(none)');

    return {
      type: 'direct',
      title: title || `视频 (${url.slice(0, 30)}...)`,
      url: videoUrl,
      rawUrl: videoUrl,
      audioUrl,
      rawAudioUrl: audioUrl,
      videoCodec,
      audioCodec,
      embedUrl: videoUrl,
      thumbnail: data.thumbnail || undefined,
      sourceUrl: data.webpage_url || undefined,
    };
  } catch (err: any) {
    console.log('[yt-dlp] 提取失败:', err.message?.substring(0, 200));
    return null;
  }
}

/**
 * Check if yt-dlp is available on the system.
 */
export function isYtDlpAvailable(): boolean {
  try {
    const version = execFileSync('yt-dlp', ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim();
    console.log('[yt-dlp] 可用, 版本:', version);
    return true;
  } catch {
    console.log('[yt-dlp] 不可用 (未安装或不在PATH中)');
    return false;
  }
}
