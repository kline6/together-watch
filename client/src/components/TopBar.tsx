import React from 'react';

interface Props {
  roomCode: string;
  onLeave: () => void;
}

const TopBar: React.FC<Props> = ({ roomCode, onLeave }) => {
  const handleCopy = async () => {
    try {
      const link = `${window.location.origin}/room/${roomCode}`;
      await navigator.clipboard.writeText(roomCode);
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: { message: `房间号 ${roomCode} 已复制！邀请链接：${link}`, type: 'success' },
        })
      );
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = roomCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      window.dispatchEvent(
        new CustomEvent('toast', {
          detail: { message: `房间号 ${roomCode} 已复制！`, type: 'success' },
        })
      );
    }
  };

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <span className="logo">👁️ 一起看吧</span>
      </div>
      <div className="top-bar-center">
        <span className="room-code-label">房间号</span>
        <span className="room-code-value">{roomCode}</span>
        <button className="copy-btn" onClick={handleCopy}>
          复制
        </button>
      </div>
      <div className="top-bar-right">
        <button className="leave-btn" onClick={onLeave}>
          退出房间
        </button>
      </div>
    </header>
  );
};

export default TopBar;
