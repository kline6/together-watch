import { createHash } from 'crypto';

/**
 * Bilibili-specific video URL extractor.
 * Parses __playinfo__ / __INITIAL_STATE__ from page HTML,
 * and calls Bilibili API with WBI signing when needed.
 */

// WBI mixin key permutation table (from Bilibili frontend)
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let cachedWbiKey: { key: string; ts: number } | null = null;

/**
 * Get WBI mixin key from Bilibili nav API.
 */
async function getWbiMixinKey(): Promise<string> {
  if (cachedWbiKey && Date.now() - cachedWbiKey.ts < 30 * 60 * 1000) {
    return cachedWbiKey.key;
  }

  const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/' },
  });
  const json = await resp.json();
  const imgUrl: string = json.data.wbi_img.img_url;
  const subUrl: string = json.data.wbi_img.sub_url;

  const imgKey = imgUrl.split('/').pop()!.split('.')[0];
  const subKey = subUrl.split('/').pop()!.split('.')[0];
  const rawKey = imgKey + subKey;

  let mixinKey = '';
  for (const idx of MIXIN_KEY_ENC_TAB) {
    mixinKey += rawKey[idx];
  }
  mixinKey = mixinKey.slice(0, 32);

  cachedWbiKey = { key: mixinKey, ts: Date.now() };
  return mixinKey;
}

/**
 * Sign parameters with WBI.
 */
async function signWbi(params: Record<string, string | number>): Promise<Record<string, string | number>> {
  const mixinKey = await getWbiMixinKey();
  const wts = Math.floor(Date.now() / 1000);
  params.wts = wts;

  // Sort keys and build query string
  const sorted = Object.keys(params).sort();
  const queryParts = sorted.map((k) => {
    const val = String(params[k]).replace(/[!'()*]/g, '');
    return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
  });
  const queryStr = queryParts.join('&');

  // MD5 hash
  const wRid = createHash('md5').update(queryStr + mixinKey).digest('hex');
  params.w_rid = wRid;

  return params;
}

/**
 * Parse Bilibili URL to extract bvid (and optionally aid, cid, page).
 * Supports:
 *   https://www.bilibili.com/video/BVxxxxxx
 *   https://www.bilibili.com/video/BVxxxxxx?p=2
 *   https://b23.tv/xxxxx (short link — needs redirect)
 */
function parseBilibiliUrl(url: string): { bvid?: string; aid?: number; page?: number } | null {
  // BV format
  const bvMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  if (bvMatch) {
    const bvid = bvMatch[1];
    const pageMatch = url.match(/[?&]p=(\d+)/);
    return { bvid, page: pageMatch ? parseInt(pageMatch[1]) : 1 };
  }

  // AV format
  const avMatch = url.match(/\/video\/av(\d+)/);
  if (avMatch) {
    const aid = parseInt(avMatch[1]);
    const pageMatch = url.match(/[?&]p=(\d+)/);
    return { aid, page: pageMatch ? parseInt(pageMatch[1]) : 1 };
  }

  return null;
}

/**
 * Extract bvid, aid, cid from page HTML via __INITIAL_STATE__.
 */
async function extractPageInfo(url: string): Promise<{ bvid: string; aid: number; cid: number; title: string } | null> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://www.bilibili.com/',
      'Cookie': 'buvid3=placeholder',
    },
  });
  const html = await resp.text();

  // Strategy 1: Extract __INITIAL_STATE__
  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\});\s*(?:window\.|<\/script>)/s);
  if (stateMatch) {
    try {
      const state = JSON.parse(stateMatch[1]);
      const videoData = state.videoData;
      if (videoData) {
        const bvid = videoData.bvid;
        const aid = videoData.aid;
        const page = parseBilibiliUrl(url)?.page || 1;
        let cid = videoData.cid;
        if (videoData.pages && videoData.pages.length >= page) {
          cid = videoData.pages[page - 1].cid;
        }
        const title = videoData.title || '';
        console.log('[bilibili] Extracted from __INITIAL_STATE__:', { bvid, aid, cid, title: title.substring(0, 40) });
        return { bvid, aid, cid, title };
      }
    } catch {
      // fall through
    }
  }

  // Strategy 2: Extract bvid from page URL, cid from __playinfo__ or video-info element
  const parsed = parseBilibiliUrl(url);
  if (!parsed?.bvid && !parsed?.aid) {
    console.log('[bilibili] Could not extract bvid/aid from URL');
    return null;
  }

  const bvid = parsed.bvid || '';
  const aid = parsed.aid || 0;

  // Try to extract cid from __playinfo__ first
  const playInfoMatch = html.match(/window\.__playinfo__\s*=\s*(\{.+?\});\s*(?:window\.|<\/script>)/s);
  if (playInfoMatch) {
    try {
      const playInfo = JSON.parse(playInfoMatch[1]);
      const cid = playInfo?.data?.cid;
      if (cid) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch?.[1]?.replace(/_哔哩哔哩.*$/, '').trim() || '';
        console.log('[bilibili] Extracted from __playinfo__ cid:', cid, 'title:', title.substring(0, 40));
        return { bvid, aid, cid, title };
      }
    } catch {}
  }

  // Strategy 3: Search for cid in embedded video data (React state, JSON-LD, etc.)
  const cidMatch = html.match(/"cid"\s*:\s*(\d+)/);
  if (cidMatch) {
    const cid = parseInt(cidMatch[1]);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/_哔哩哔哩.*$/, '').trim() || '';
    console.log('[bilibili] Extracted cid from regex:', cid, 'title:', title.substring(0, 40));
    return { bvid, aid, cid, title };
  }

  // Strategy 4: Extract cid from HTML meta or script JSON-LD
  const jsonLdMatch = html.match(/"contentUrl"\s*:\s*"[^"]+(\d+)"[^}]*"duration"/s);
  if (jsonLdMatch) {
    const cid = parseInt(jsonLdMatch[1]);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/_哔哩哔哩.*$/, '').trim() || '';
    console.log('[bilibili] Extracted cid from JSON-LD:', cid);
    return { bvid, aid, cid, title };
  }

  console.log('[bilibili] Could not find cid in page');
  return null;
}

/**
 * Extract video + audio URLs from __playinfo__ HTML.
 * Returns DASH { videoUrl, audioUrl, videoCodec, audioCodec } or combined { videoUrl }.
 */
function extractPlayInfoFromHtml(html: string): { videoUrl: string; audioUrl?: string; videoCodec?: string; audioCodec?: string } | null {
  const match = html.match(/window\.__playinfo__\s*=\s*(\{.+?\});\s*(?:window\.|<\/script>)/s);
  if (!match) return null;

  try {
    const playInfo = JSON.parse(match[1]);
    const data = playInfo.data;
    if (!data) return null;

    // DASH format: video + audio separate
    if (data.dash) {
      const videos = data.dash.video || [];
      const audios = data.dash.audio || [];
      // 优先选 H.264 编码（浏览器兼容性最好）
      const h264Video = videos.find((v: any) => (v.codecs || '').startsWith('avc'));
      const bestVideo = h264Video || videos.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      const videoUrl = bestVideo?.baseUrl || bestVideo?.base_url;
      if (!videoUrl) return null;
      const videoCodec = bestVideo?.codecs || 'avc1.64001f';
      const bestAudio = audios.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      const audioUrl = bestAudio?.baseUrl || bestAudio?.base_url;
      const audioCodec = bestAudio?.codecs || 'mp4a.40.2';
      return { videoUrl, audioUrl, videoCodec, audioCodec };
    }

    // Legacy combined format
    if (data.durl && data.durl.length > 0) {
      return { videoUrl: data.durl[0].url };
    }
  } catch {
    // parse error
  }
  return null;
}

/**
 * Get video play URL from Bilibili API.
 * Uses fnval=4048 to request DASH format (separate video + audio streams).
 */
async function getPlayUrl(bvid: string, cid: number): Promise<{ videoUrl: string; audioUrl?: string; videoCodec?: string; audioCodec?: string } | null> {
  const params: Record<string, string | number> = {
    bvid,
    cid,
    fnval: 4048, // DASH format (separate video + audio streams), includes codecs info
    qn: 80,      // quality: 1080P (16=360P, 32=480P, 64=720P, 80=1080P, 116=1080P60, 120=4K)
    fourk: 1,
  };

  const signed = await signWbi(params);
  const qs = Object.entries(signed).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const apiUrl = `https://api.bilibili.com/x/player/wbi/playurl?${qs}`;

  console.log('[bilibili] Calling playurl API...');

  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.bilibili.com/',
    },
  });
  const json = await resp.json();

  if (json.code !== 0) {
    console.log('[bilibili] playurl API error:', json.code, json.message);
    return null;
  }

  const data = json.data;

  // FLV/MP4 format (durl array) — combined audio+video
  if (data.durl && data.durl.length > 0) {
    console.log('[bilibili] Got durl combined format, segments:', data.durl.length);
    return { videoUrl: data.durl[0].url };
  }

  // DASH format — separate video + audio streams
  if (data.dash && data.dash.video?.length > 0) {
    const videos = data.dash.video;
    const audios = data.dash.audio || [];
    // 优先选 H.264 编码（浏览器兼容性最好）
    const h264Video = videos.find((v: any) => (v.codecs || '').startsWith('avc'));
    const bestVideo = h264Video || videos.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    const bestAudio = audios.sort((a: any, b: any) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    const videoUrl = bestVideo?.baseUrl || bestVideo?.base_url;
    const audioUrl = bestAudio?.baseUrl || bestAudio?.base_url;
    const videoCodec = bestVideo?.codecs || 'avc1.64001f';
    const audioCodec = bestAudio?.codecs || 'mp4a.40.2';
    console.log('[bilibili] Got DASH format, video codec:', videoCodec, 'audio:', !!audioUrl);
    return { videoUrl, audioUrl, videoCodec, audioCodec };
  }

  console.log('[bilibili] No playable URL in API response');
  return null;
}

/**
 * Main entry: extract a playable Bilibili video URL.
 * Tries multiple strategies:
 * 1. Parse __playinfo__ from page HTML (fastest, no API call)
 * 2. Extract bvid/cid from __INITIAL_STATE__, then call playurl API
 */
export async function extractBilibiliVideo(pageUrl: string): Promise<{ url: string; audioUrl?: string; videoCodec?: string; audioCodec?: string; title: string; sourceUrl: string } | null> {
  console.log('[bilibili] Extracting video from:', pageUrl);

  // Resolve short URLs (b23.tv)
  let resolvedUrl = pageUrl;
  if (pageUrl.includes('b23.tv')) {
    try {
      const resp = await fetch(pageUrl, { redirect: 'follow', headers: { 'User-Agent': UA } });
      resolvedUrl = resp.url;
      console.log('[bilibili] Resolved short URL to:', resolvedUrl);
    } catch {
      // use original
    }
  }

  // Fetch the page HTML
  let html = '';
  try {
    const resp = await fetch(resolvedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.bilibili.com/',
        'Cookie': 'buvid3=placeholder',
      },
    });
    html = await resp.text();
  } catch (e) {
    console.log('[bilibili] Failed to fetch page:', (e as Error).message);
    return null;
  }

  // Strategy 1: Try __playinfo__ from HTML (SSR embedded)
  const playInfo = extractPlayInfoFromHtml(html);
  if (playInfo) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/_哔哩哔哩.*$/, '').trim() || 'Bilibili Video';
    console.log('[bilibili] Got URL from __playinfo__, has audio:', !!playInfo.audioUrl);
    return { url: playInfo.videoUrl, audioUrl: playInfo.audioUrl, videoCodec: playInfo.videoCodec, audioCodec: playInfo.audioCodec, title, sourceUrl: resolvedUrl };
  }

  // Strategy 2: Extract info from __INITIAL_STATE__ and call API
  const info = await extractPageInfo(resolvedUrl);
  if (!info) {
    console.log('[bilibili] Could not extract video info from page');
    return null;
  }

  const playResult = await getPlayUrl(info.bvid, info.cid);
  if (!playResult) {
    console.log('[bilibili] Could not get play URL from API');
    return null;
  }

  return { url: playResult.videoUrl, audioUrl: playResult.audioUrl, videoCodec: playResult.videoCodec, audioCodec: playResult.audioCodec, title: info.title, sourceUrl: resolvedUrl };
}

/**
 * Check if a URL is a Bilibili URL.
 */
export function isBilibiliUrl(url: string): boolean {
  return /bilibili\.com\/video\//i.test(url) || /b23\.tv\//i.test(url);
}
