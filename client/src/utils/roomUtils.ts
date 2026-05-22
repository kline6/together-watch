import { ParsedVideo } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

export function parseVideoUrl(url: string): Promise<ParsedVideo | null> {
  return fetch(`${API_URL}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success && data.data) return data.data as ParsedVideo;
      return null;
    })
    .catch(() => null);
}

export function uploadVideo(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ success: boolean; data?: ParsedVideo; error?: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && res.success) {
          resolve({ success: true, data: res.data });
        } else {
          resolve({ success: false, error: res.error || '上传失败' });
        }
      } catch {
        reject(new Error('解析响应失败'));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.open('POST', `${API_URL}/api/upload`);
    xhr.send(formData);
  });
}

export function getRandomNickname(): string {
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `游客${num}`;
}
