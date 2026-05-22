import { execSync } from 'child_process';
import { ParsedVideo } from './types.js';

/**
 * Try to extract a direct video URL using yt-dlp.
 * Returns null if yt-dlp is not installed or fails.
 */
export function extractWithYtDlp(url: string): ParsedVideo | null {
  try {
    console.log('[yt-dlp] 开始提取:', url);
    const output = execSync(
      `yt-dlp --dump-json --no-warnings --no-playlist "${url.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 }
    );

    const data = JSON.parse(output);
    console.log('[yt-dlp] 提取成功, title:', data.title);
    console.log('[yt-dlp] formats count:', data.formats?.length || 0);

    // Get direct video URL — NEVER use webpage_url (it's an HTML page, not a video)
    let videoUrl = '';

    // Helper: does this URL look like a direct video link (not a webpage)?
    const isDirectVideo = (u: string) =>
      u.startsWith('http') && /\.(mp4|webm|m3u8|flv|ts)(\?|$|#|&)/i.test(u);

    // Try data.url if it looks like a direct video link
    if (data.url && isDirectVideo(data.url)) {
      videoUrl = data.url;
    }

    // Multi-format: yt-dlp provides requested_formats with separate audio/video
    if (!videoUrl && data.requested_formats?.length > 0) {
      const best = data.requested_formats
        .filter((f: any) => f.url && f.vcodec !== 'none')
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))[0];
      if (best?.url) videoUrl = best.url;
    }

    // Fallback: find any format with a direct video URL
    if (!videoUrl && data.formats?.length > 0) {
      // Prefer formats with media extensions
      const withExt = data.formats
        .filter((f: any) => f.url && isDirectVideo(f.url))
        .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
      if (withExt.length > 0) {
        videoUrl = withExt[0].url;
      } else {
        // Some sites serve video from URLs without extensions (CDN)
        // Pick the best quality format that has video codec
        const anyVideo = data.formats
          .filter((f: any) => f.url && f.vcodec && f.vcodec !== 'none' && f.url.startsWith('http'))
          .sort((a: any, b: any) => (b.height || 0) - (a.height || 0));
        if (anyVideo.length > 0) {
          videoUrl = anyVideo[0].url;
        }
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

    return {
      type: 'direct',
      title: title || `视频 (${url.slice(0, 30)}...)`,
      url: videoUrl,
      embedUrl: videoUrl,
      thumbnail: data.thumbnail || undefined,
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
    const version = execSync('yt-dlp --version', { encoding: 'utf-8', timeout: 5000 }).trim();
    console.log('[yt-dlp] 可用, 版本:', version);
    return true;
  } catch {
    console.log('[yt-dlp] 不可用 (未安装或不在PATH中)');
    return false;
  }
}
