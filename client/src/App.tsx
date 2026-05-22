import { useState, useCallback, useEffect } from 'react';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import { useSocket } from './hooks/useSocket';
import { useToast } from './hooks/useToast';
import { useLocalStorage } from './hooks/useLocalStorage';
import { getRandomNickname } from './utils/roomUtils';
import type { RoomData, UserData, ParsedVideo } from './types';

type Page = 'home' | 'room';

const App: React.FC = () => {
  const [page, setPage] = useState<Page>('home');
  const [myNickname, setMyNickname] = useLocalStorage('wt_nickname', getRandomNickname());
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>('');
  const [joinVideoUrl, setJoinVideoUrl] = useState<string>('');

  const {
    socket,
    connected,
    roomData,
    users,
    setRoomData,
    setUsers,
  } = useSocket();

  const { toasts, addToast, removeToast } = useToast();

  // Listen for global toast events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      addToast(detail.message, detail.type || 'info');
    };
    window.addEventListener('toast', handler);
    return () => window.removeEventListener('toast', handler);
  }, [addToast]);

  // Listen for toast from server
  useEffect(() => {
    if (!socket.current) return;
    const handler = (data: { message: string }) => {
      addToast(data.message, 'info');
    };
    socket.current.on('toast', handler);
    return () => { socket.current?.off('toast', handler); };
  }, [socket.current]);

  const handleRoomCreated = useCallback(
    (code: string, nickname: string, videoUrl: string, parsedVideo?: ParsedVideo) => {
      setRoomCode(code);
      setMyNickname(nickname);
      setJoinVideoUrl(videoUrl);

      // Emit create-room event via socket
      if (socket.current?.connected) {
        socket.current.emit('create-room', {
          videoUrl,
          nickname,
          parsedVideo,
        });

        const onJoined = (data: { room: RoomData; users: UserData[] }) => {
          setCurrentUserId(data.users.find((u) => u.isOwner)?.id || '');
          setPage('room');
        };
        const onError = (data: { message: string }) => {
          addToast(data.message, 'error');
        };
        socket.current.once('room-joined', onJoined);
        socket.current.once('room-error', onError);
      } else {
        addToast('正在连接服务器...', 'info');
        // Wait for connection then retry
        const checkConn = setInterval(() => {
          if (socket.current?.connected) {
            clearInterval(checkConn);
            socket.current.emit('create-room', { videoUrl, nickname, parsedVideo });
            socket.current.once('room-joined', (data: { room: RoomData; users: UserData[] }) => {
              setCurrentUserId(data.users.find((u) => u.isOwner)?.id || '');
              setPage('room');
            });
          }
        }, 500);
        setTimeout(() => clearInterval(checkConn), 10000);
      }
    },
    [socket.current, addToast]
  );

  const handleRoomJoined = useCallback(
    (code: string, nickname: string) => {
      setRoomCode(code);
      setMyNickname(nickname);

      if (socket.current?.connected) {
        socket.current.emit('join-room', { roomCode: code, nickname });

        socket.current.once('room-joined', (data: { room: RoomData; users: UserData[] }) => {
          const myId = data.users.find((u) => u.id !== data.room.ownerId)?.id || data.users[0]?.id || '';
          setCurrentUserId(myId);
          setJoinVideoUrl(data.room.videoUrl);
          setPage('room');
          addToast('已加入房间！', 'success');
        });

        socket.current.once('room-error', (data: { message: string }) => {
          addToast(data.message, 'error');
        });
      } else {
        addToast('正在连接服务器...', 'info');
      }
    },
    [socket.current, addToast]
  );

  const handleLeave = useCallback(() => {
    setPage('home');
    setRoomData(null);
    setUsers([]);
    setCurrentUserId('');
    addToast('已退出房间', 'info');
  }, [addToast, setRoomData, setUsers]);

  return (
    <div className="app">
      {page === 'home' ? (
        <HomePage
          onNavigate={setPage as any}
          onRoomCreated={handleRoomCreated}
          onRoomJoined={handleRoomJoined}
          addToast={addToast}
        />
      ) : roomData ? (
        <RoomPage
          roomData={roomData}
          users={users}
          currentUserId={currentUserId}
          nickname={myNickname}
          connected={connected}
          socket={socket}
          toasts={toasts}
          removeToast={removeToast}
          addToast={addToast}
          onLeave={handleLeave}
        />
      ) : (
        <div className="loading-page">
          <div className="loading-spinner">
            <span className="spinner-icon" />
            <p>加载房间中...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
