import React, { useState } from 'react';
import { DANMAKU_COLORS } from '../types';

interface Props {
  onSend: (text: string, color: string) => void;
  nickname: string;
  onNicknameChange: (name: string) => void;
}

const DanmakuInput: React.FC<Props> = ({ onSend, nickname, onNicknameChange }) => {
  const [text, setText] = useState('');
  const [color, setColor] = useState(DANMAKU_COLORS[0]);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, color);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="danmaku-input-area">
      <div className="danmaku-nickname-row">
        <input
          type="text"
          className="danmaku-nickname-input"
          value={nickname}
          onChange={(e) => onNicknameChange(e.target.value.slice(0, 12))}
          placeholder="你的昵称"
          maxLength={12}
        />
        <div className="danmaku-color-selector">
          <button
            className="danmaku-color-btn"
            style={{ backgroundColor: color }}
            onClick={() => setShowColorPicker(!showColorPicker)}
            title="选择弹幕颜色"
          />
          {showColorPicker && (
            <div className="danmaku-color-picker">
              {DANMAKU_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-option ${c === color ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => {
                    setColor(c);
                    setShowColorPicker(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="danmaku-input-row">
        <input
          type="text"
          className="danmaku-text-input"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 50))}
          onKeyDown={handleKeyDown}
          placeholder="输入弹幕..."
          maxLength={50}
        />
        <button
          className="danmaku-send-btn"
          onClick={handleSend}
          disabled={!text.trim()}
        >
          发送弹幕
        </button>
      </div>
    </div>
  );
};

export default DanmakuInput;
