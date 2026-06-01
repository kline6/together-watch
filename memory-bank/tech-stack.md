# 技术栈

## 前端
- React 18 + TypeScript
- Vite (构建工具)
- Socket.IO Client (实时通信)
- 原生 HTML5 Video API + MediaSource Extensions (MSE)

## 后端
- Node.js 20 + TypeScript (tsx 运行)
- Express (HTTP 服务器)
- Socket.IO (WebSocket 实时通信)
- Multer (文件上传)
- child_process.spawn (调用外部工具)

## 外部工具
- yt-dlp — 视频平台解析（YouTube等，B站已被封412）
- ffmpeg — 音视频合并

## 部署
- Docker (node:20-bookworm)
- Railway (自动部署)
- GitHub (源码管理)

## B站解析方案
- 专用 API: x/web-interface/view + x/player/wbi/playurl
- WBI 签名机制
- 返回 DASH 格式（分离的视频流+音频流）
- 服务端 ffmpeg 合并
