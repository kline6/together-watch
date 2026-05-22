import React, { useState, useRef } from 'react';
import { PLACEHOLDER_TEXT, ERROR_PARSE_FAILED } from '../types';
import { parseVideoUrl, uploadVideo, getRandomNickname } from '../utils/roomUtils';
import type { ParsedVideo } from '../types';

interface Props {
  onNavigate: (page: 'home' | 'room') => void;
  onRoomCreated: (roomCode: string, nickname: string, videoUrl: string, parsedVideo?: ParsedVideo) => void;
  onRoomJoined: (roomCode: string, nickname: string) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

type Tab = 'create' | 'join';
type CreateMode = 'link' | 'upload';

const HomePage: React.FC<Props> = ({ onNavigate, onRoomCreated, onRoomJoined, addToast }) => {
  const [tab, setTab] = useState<Tab>('create');
  const [createMode, setCreateMode] = useState<CreateMode>('link');
  const [url, setUrl] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [nickname] = useState(getRandomNickname);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreateByUrl = async () => {
    if (!url.trim()) {
      setError('请粘贴视频链接');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const parsed = await parseVideoUrl(url.trim());
      if (!parsed) {
        setError(ERROR_PARSE_FAILED);
        setLoading(false);
        return;
      }

      onRoomCreated(roomCode || Math.random().toString(36).substring(2, 8).toUpperCase(), nickname, url.trim(), parsed);
      addToast('房间创建成功！', 'success');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateByUpload = async () => {
    if (!uploadedFile) {
      setError('请先选择要上传的视频');
      return;
    }

    setLoading(true);
    setError('');
    setUploadProgress(0);

    try {
      const result = await uploadVideo(uploadedFile, (pct) => setUploadProgress(pct));
      if (!result.success) {
        setError(result.error || '上传失败');
        setLoading(false);
        return;
      }

      // Create room with the uploaded video URL
      onRoomCreated(
        Math.random().toString(36).substring(2, 8).toUpperCase(),
        nickname,
        result.data!.url,
        result.data
      );
      addToast('视频上传成功，房间已创建！', 'success');
    } catch {
      setError('上传失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = () => {
    if (!roomCode.trim()) {
      setError('请输入房间号');
      return;
    }
    setError('');
    onRoomJoined(roomCode.trim().toUpperCase(), nickname);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (tab === 'join') handleJoin();
      else if (createMode === 'link') handleCreateByUrl();
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      if (file.type.startsWith('video/') || file.name.match(/\.(mp4|webm|ogg|mov|avi|mkv)$/i)) {
        setUploadedFile(file);
        setError('');
      } else {
        setError('请上传视频文件（mp4, webm, mov, avi, mkv 等）');
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setError('');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        <div className="home-logo">
          <span className="home-logo-icon">👁️</span>
          <h1 className="home-title">一起看吧</h1>
          <p className="home-subtitle">同步观影厅</p>
        </div>
        <p className="home-desc">和朋友一起，同步观看视频</p>
      </div>

      <div className="home-card">
        {/* Tabs: Create / Join */}
        <div className="mode-switch">
          <button className={`mode-btn ${tab === 'create' ? 'active' : ''}`} onClick={() => { setTab('create'); setError(''); }}>
            创建房间
          </button>
          <button className={`mode-btn ${tab === 'join' ? 'active' : ''}`} onClick={() => { setTab('join'); setError(''); }}>
            加入房间
          </button>
        </div>

        {tab === 'create' ? (
          <>
            {/* Sub-tabs: Link / Upload */}
            <div className="create-mode-tabs">
              <button
                className={`create-mode-tab ${createMode === 'link' ? 'active' : ''}`}
                onClick={() => { setCreateMode('link'); setError(''); }}
              >
                🔗 粘贴链接
              </button>
              <button
                className={`create-mode-tab ${createMode === 'upload' ? 'active' : ''}`}
                onClick={() => { setCreateMode('upload'); setError(''); }}
              >
                📤 上传视频
              </button>
            </div>

            {createMode === 'link' ? (
              <div className="home-form">
                <input
                  type="url"
                  className="home-input home-input-large"
                  placeholder={PLACEHOLDER_TEXT}
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError(''); }}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoFocus
                />
                <p className="home-hint">支持 YouTube、Bilibili、Vimeo 等，服务器会自动提取视频</p>
                <button
                  className="home-action-btn"
                  onClick={handleCreateByUrl}
                  disabled={loading || !url.trim()}
                >
                  {loading ? (
                    <span className="loading-spinner">
                      <span className="spinner-icon" />正在解析，请稍候…
                    </span>
                  ) : (
                    '解析并创建房间'
                  )}
                </button>
              </div>
            ) : (
              <div className="home-form">
                {/* Upload Zone */}
                <div
                  className={`upload-zone ${dragOver ? 'dragover' : ''} ${uploadedFile ? 'has-file' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !loading && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,.mp4,.webm,.ogg,.mov,.avi,.mkv"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  {uploadedFile ? (
                    <div className="upload-file-info">
                      <span className="upload-file-icon">🎬</span>
                      <span className="upload-file-name">{uploadedFile.name}</span>
                      <span className="upload-file-size">{formatFileSize(uploadedFile.size)}</span>
                      {!loading && (
                        <button
                          className="upload-file-remove"
                          onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setUploadProgress(0); }}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="upload-placeholder">
                      <span className="upload-icon">📁</span>
                      <span className="upload-text">点击或拖拽视频文件到此处</span>
                      <span className="upload-hint">支持 mp4, webm, mov, avi, mkv 等格式，最大 2GB</span>
                    </div>
                  )}
                </div>

                {loading && uploadProgress > 0 && (
                  <div className="upload-progress-bar">
                    <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                    <span className="upload-progress-text">{uploadProgress}%</span>
                  </div>
                )}

                <button
                  className="home-action-btn"
                  onClick={handleCreateByUpload}
                  disabled={loading || !uploadedFile}
                >
                  {loading ? (
                    <span className="loading-spinner">
                      <span className="spinner-icon" />正在上传…
                    </span>
                  ) : (
                    '上传并创建房间'
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="home-form">
            <input
              type="text"
              className="home-input home-input-large"
              placeholder="输入房间号"
              value={roomCode}
              onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); setError(''); }}
              onKeyDown={handleKeyDown}
              maxLength={6}
              autoFocus
            />
            <button className="home-action-btn" onClick={handleJoin} disabled={!roomCode.trim()}>
              立即加入
            </button>
          </div>
        )}

        {error && <div className="home-error">{error}</div>}
      </div>
    </div>
  );
};

export default HomePage;
