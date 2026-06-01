# 技术架构

## 整体结构
```
project5/
├── client/          ← React 前端 (Vite + TypeScript)
│   └── src/
│       ├── components/    ← VideoPlayer, DanmakuLayer, MemberList 等
│       ├── pages/         ← HomePage, RoomPage
│       ├── hooks/         ← useSocket, useLocalStorage, useToast
│       └── types.ts
├── server/          ← Express 后端 (TypeScript + tsx)
│   └── src/
│       ├── index.ts           ← 主入口，HTTP + Socket.IO
│       ├── roomManager.ts     ← 房间/用户/弹幕管理
│       ├── videoParser.ts     ← 视频解析调度（B站 → yt-dlp → 网页抓取）
│       ├── videoExtractor.ts  ← yt-dlp 封装
│       ├── bilibiliExtractor.ts ← B站专用解析（WBI签名 + API）
│       └── types.ts
├── memory-bank/     ← AI 记忆库
├── Dockerfile       ← Railway 部署配置
└── railway.json
```

## 数据流
```
用户输入URL → /api/parse → videoParser.ts
  ├── B站? → bilibiliExtractor.ts（API直接获取）
  ├── yt-dlp? → videoExtractor.ts
  └── 直链? → 直接返回

视频播放：
  ├── B站DASH → /api/download-merged → B站API获取流 → ffmpeg合并 → 返回mp4
  ├── MSE模式 → 客户端直接合并音视频流（适用于小视频）
  └── 直链 → /api/proxy 代理播放

同步机制：
  房主 → heartbeat(1s) → 服务器 → sync-state → 所有房客
```

## 关键端口
- 生产：Railway 动态分配（通过 PORT 环境变量）
- 开发：server 3001, client 5173
