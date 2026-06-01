# 项目简介

## 项目名称
一起看吧 (Watch Together) — 同步观影厅

## 做什么
多人在线同步观看视频的 Web 应用。房主控制播放，所有房客视频自动同步。

## 核心功能
- 创建/加入观影房间（房间码 + 密码）
- 视频同步播放（播放/暂停/跳转/倍速）
- 弹幕系统（公聊/私聊/点赞）
- 支持直链视频、本地上传、B站/YouTube 等平台解析
- 房主离开自动转移权限

## 部署
- 平台：Railway
- 域名：https://distinguished-tenderness-production.up.railway.app
- 构建方式：Dockerfile（Node.js 20 + Python + yt-dlp + ffmpeg）

## 仓库
- GitHub: https://github.com/kline6/together-watch
