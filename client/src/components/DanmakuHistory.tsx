import React from 'react';
import type { DanmakuData } from '../types';

interface Props {
  danmakuList: DanmakuData[];
  currentUserId: string;
  onLike: (danmakuId: string) => void;
}

const DanmakuHistory: React.FC<Props> = ({ danmakuList, currentUserId, onLike }) => {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [danmakuList.length]);

  return (
    <div className="danmaku-history">
      <div className="section-title">弹幕历史</div>
      <div className="danmaku-history-list" ref={listRef}>
        {danmakuList.length === 0 ? (
          <div className="danmaku-history-empty">暂无弹幕，发一条吧~</div>
        ) : (
          danmakuList.map((d) => (
            <div key={d.id} className="danmaku-history-item">
              <div className="danmaku-history-meta">
                <span
                  className="danmaku-history-color"
                  style={{ backgroundColor: d.color }}
                />
                <span className="danmaku-history-nickname">{d.nickname}</span>
                <span className="danmaku-history-time">
                  {Math.floor(d.timestamp / 60)}:{String(Math.floor(d.timestamp % 60)).padStart(2, '0')}
                </span>
              </div>
              <div className="danmaku-history-text">{d.text}</div>
              <button
                className={`danmaku-history-like ${d.likedBy.includes(currentUserId) ? 'liked' : ''}`}
                onClick={() => onLike(d.id)}
              >
                👍 {d.likes || 0}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DanmakuHistory;
