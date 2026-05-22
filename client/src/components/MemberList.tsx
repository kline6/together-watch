import React, { useState } from 'react';
import type { UserData } from '../types';

interface Props {
  users: UserData[];
  currentUserId: string;
  onWhisper: (userId: string, nickname: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const MemberList: React.FC<Props> = ({
  users,
  currentUserId,
  onWhisper,
  collapsed,
  onToggleCollapse,
}) => {
  const [menuUserId, setMenuUserId] = useState<string | null>(null);

  return (
    <div className="member-list">
      <div className="member-list-header" onClick={onToggleCollapse}>
        <span className="section-title">
          在线成员 ({users.length})
        </span>
        <button className="collapse-btn">{collapsed ? '展开' : '收起'}</button>
      </div>
      {!collapsed && (
        <div className="member-list-body">
          {users.map((user) => (
            <div
              key={user.id}
              className={`member-item ${user.id === currentUserId ? 'is-self' : ''}`}
            >
              <div className="member-icon">
                {user.isOwner ? '👑' : '👤'}
              </div>
              <div className="member-info">
                <span className="member-nickname">
                  {user.nickname}
                  {user.id === currentUserId && ' (我)'}
                </span>
                {user.isOwner && <span className="member-tag">房主</span>}
              </div>
              {user.id !== currentUserId && (
                <div className="member-actions">
                  <button
                    className="whisper-btn"
                    onClick={() => {
                      onWhisper(user.id, user.nickname);
                      setMenuUserId(null);
                    }}
                    title="发送私聊弹幕"
                  >
                    💬
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemberList;
