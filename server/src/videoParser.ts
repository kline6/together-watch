import { ParsedVideo } from './types.js';
import { extractWithYtDlp, isYtDlpAvailable } from './videoExtractor.js';
import { extractBilibiliVideo, isBilibiliUrl } from './bilibiliExtractor.js';

const YT_DLP_AVAILABLE = isYtDlpAvailable();

export function parseVideoUrl(url: string): ParsedVideo | null {
  try {
    if (YT_DLP_AVAILABLE) {
      const result = extractWithYtDlp(url);
      if (result) return result;
    }

    if (isDirectMediaUrl(url)) {
      return { type: 'direct', url, embedUrl: url };
    }

    return null;
  } catch {
    return null;
  }
}

export async function parseVideoUrlAsync(url: string): Promise<ParsedVideo | null> {
  console.log('[parseVideo] 开始解析:', url);
  console.log('[parseVideo] yt-dlp 可用:', YT_DLP_AVAILABLE);

  // Strategy 0: Bilibili dedicated extractor (fast, no yt-dlp needed)
  if (isBilibiliUrl(url)) {
    console.log('[parseVideo] 检测到B站链接，使用专用解析器');
    try {
      const result = await extractBilibiliVideo(url);
      if (result) {
        console.log('[parseVideo] B站解析成功:', result.url.substring(0, 80), 'audio:', !!result.audioUrl);
        return { type: 'direct', url: result.url, rawUrl: result.url, audioUrl: result.audioUrl, rawAudioUrl: result.audioUrl, videoCodec: result.videoCodec, audioCodec: result.audioCodec, embedUrl: result.url, title: result.title, referer: 'https://www.bilibili.com/', sourceUrl: result.sourceUrl };
      }
      console.log('[parseVideo] B站专用解析失败，尝试其他方法...');
    } catch (e) {
      console.log('[parseVideo] B站解析异常:', (e as Error).message);
    }
  }

  // Strategy 1: yt-dlp (handles YouTube, Bilibili, Vimeo, etc.)
  if (YT_DLP_AVAILABLE) {
    const result = extractWithYtDlp(url);
    if (result) {
      console.log('[parseVideo] yt-dlp 解析成功:', result.url.substring(0, 80));
      return result;
    }
    console.log('[parseVideo] yt-dlp 解析失败');
  }

  // Strategy 2: Direct media URL (ends in .mp4, .webm, etc.)
  if (isDirectMediaUrl(url)) {
    console.log('[parseVideo] 是直链媒体URL');
    return { type: 'direct', url, embedUrl: url };
  }

  // Strategy 3: Web page scraping
  console.log('[parseVideo] 尝试网页抓取...');
  const scraped = await scrapeVideoFromPage(url);
  if (scraped) {
    console.log('[parseVideo] 网页抓取成功:', scraped.url.substring(0, 80));
    return scraped;
  }

  console.log('[parseVideo] 所有方法均失败');
  return null;
}

function isDirectMediaUrl(url: string): boolean {
  // Must have a real media file extension
  return /\.(mp4|webm|ogg|m3u8|ts)(\?|$|#)/i.test(url);
}

/**
 * Validates that a URL is LIKELY a direct playable video URL.
 * Rejects embed pages, player pages, and other HTML endpoints.
 */
function isLikelyVideoUrl(url: string): boolean {
  if (!url.startsWith('http')) return false;

  // Reject obvious non-video URLs (embed/player/webpage URLs)
  if (/\/(embed|player|iframe)\b/i.test(url)) return false;
  if (/\.(html?|php|aspx?|jsp)(\?|$|#)/i.test(url)) return false;

  // Reject video platform watch pages (not direct video links)
  if (/bilibili\.com\/video\//i.test(url)) return false;
  if (/youtube\.com\/watch/i.test(url)) return false;
  if (/youtu\.be\//i.test(url)) return false;
  if (/vimeo\.com\/\d+($|\/|\?)/i.test(url)) return false;

  // Strong signal: actual media file extension
  if (isDirectMediaUrl(url)) return true;
  if (/\.(mp4|webm|m3u8|flv|mkv|mov)(\?|$|#)/i.test(url)) return true;

  // Streaming/CDN patterns with media extensions in the URL
  if (/(cdn|stream|media)\.[^/]+\//i.test(url) && /\.(mp4|webm|m3u8|flv)/i.test(url)) return true;

  return false;
}

function resolveUrl(u: string, base: string): string {
  if (u.startsWith('http')) return u;
  try { return new URL(u, base).href; } catch { return u; }
}

/**
 * Verify that a URL actually returns video content (not HTML).
 * Returns the URL if it's video, null otherwise.
 */
async function verifyVideoUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const origin = new URL(url).origin;
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': origin + '/',
      },
    });
    clearTimeout(timeout);

    const ct = resp.headers.get('content-type') || '';
    console.log('[verify] HEAD', url.substring(0, 60), '→', resp.status, ct);

    // Must not be HTML
    if (ct.includes('text/html')) return null;

    // Video content types are good
    if (ct.includes('video/') || ct.includes('application/octet-stream') || ct.includes('application/vnd.')) {
      return url;
    }

    // m3u8 manifests
    if (ct.includes('application/x-mpegurl') || ct.includes('application/vnd.apple.mpegurl')) {
      return url;
    }

    // If content-type is unknown but URL has media extension, accept it
    if (isDirectMediaUrl(url)) return url;

    return null;
  } catch {
    // If HEAD fails, still accept URLs with strong media extensions
    if (isDirectMediaUrl(url)) return url;
    return null;
  }
}

async function scrapeVideoFromPage(url: string): Promise<ParsedVideo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    console.log('[scrape] 正在抓取页面:', url);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': url,
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    console.log('[scrape] 响应状态:', response.status);
    if (!response.ok) return null;

    const html = await response.text();
    console.log('[scrape] 页面大小:', html.length, '字节');

    // Extract page title
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitle =
      html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const pageTitle = ogTitle?.[1] || titleTag?.[1] || '';

    // Collect all candidate video URLs
    const candidates: string[] = [];

    // og:video
    const ogMatch =
      html.match(/<meta\s+[^>]*property=["']og:video["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:video["']/i);
    if (ogMatch?.[1]) candidates.push(resolveUrl(ogMatch[1], url));

    // og:video:url
    const ogUrlMatch =
      html.match(/<meta\s+[^>]*property=["']og:video:url["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:video:url["']/i);
    if (ogUrlMatch?.[1]) candidates.push(resolveUrl(ogUrlMatch[1], url));

    // <video src>
    const videoTagMatch = html.match(/<video[^>]*src=["']([^"']+)["']/i);
    if (videoTagMatch?.[1]) candidates.push(resolveUrl(videoTagMatch[1], url));

    // <source src>
    const sourceMatch = html.match(/<source[^>]*src=["']([^"']+)["']/i);
    if (sourceMatch?.[1]) candidates.push(resolveUrl(sourceMatch[1], url));

    // JSON-LD contentUrl
    const jsonLdMatch = html.match(/"contentUrl"\s*:\s*"([^"]+)"/);
    if (jsonLdMatch?.[1]) {
      const u = jsonLdMatch[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (u.startsWith('http')) candidates.push(u);
    }

    // data-video-src / data-src / data-url with media extensions
    const dataSrcMatch = html.match(/data-(?:video-src|src|url)\s*=\s*["']([^"']+\.(?:mp4|webm|m3u8)[^"']*)["']/i);
    if (dataSrcMatch?.[1]) candidates.push(resolveUrl(dataSrcMatch[1], url));

    console.log('[scrape] 候选URL数量:', candidates.length);

    // Filter candidates with isLikelyVideoUrl
    const filtered = candidates.filter((u) => isLikelyVideoUrl(u));
    console.log('[scrape] 通过过滤:', filtered.length);

    if (filtered.length === 0) {
      console.log('[scrape] 无有效视频URL');
      return null;
    }

    // Verify the first candidate actually returns video content
    for (const candidate of filtered) {
      const verified = await verifyVideoUrl(candidate);
      if (verified) {
        console.log('[scrape] 验证通过:', verified.substring(0, 80));
        return { type: 'direct', url: verified, embedUrl: verified, title: pageTitle };
      }
    }

    console.log('[scrape] 所有候选URL验证失败（返回的不是视频内容）');
    return null;
  } catch (err) {
    console.error('[scrape] 抓取异常:', err);
    return null;
  }
}
