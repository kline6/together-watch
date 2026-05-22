「一起看吧 Watch Together」是我用 Claude Code 从 0 到 1 构建的多人同步观影 Web 应用。从架构设计、视频解析引擎、实时同步协议、弹幕系统到深色霓虹 UI，几乎每行代码都是与 Claude Code 协作产出。

产品流：房主粘贴视频链接（B站/YouTube/Vimeo 等）或拖拽上传本地文件 → 服务端多策略提取直链（B站专用解析器 + yt-dlp + 网页抓取 + 直链识别）→ 生成 6 位房间码 → 成员输入房间码即刻加入 → 房主控制播放/暂停/拖拽/倍速，所有成员毫秒级同步 → Canvas 弹幕实时飘屏（公屏 + 私聊、8 色可选、点赞、历史回溯）。一个房间管一场放映，房主断线 30 秒自动转让房主。

技术栈：Express 4.18 + Socket.IO 4.7 + TypeScript 5.3（后端）；React 18 + Vite + TypeScript（前端）；Canvas 2D 弹幕引擎；yt-dlp 视频提取；MSE 浏览器端音视频合并；深色霓虹 CSS 变量主题 + 移动端三档响应式。

Agent 协作关键场景：

1. 视频解析 pivot：初版仅支持直链 URL → 逐步迭代至 4 层策略架构。Claude Code 一次性产出 Bilibili 专用解析器（bilibiliExtractor.ts 316 行：__playinfo__ 解析 → __INITIAL_STATE__ 提取 → WBI 签名 API 调用，三层降级），yt-dlp 通用提取器，网页 og:video / JSON-LD / data-src 抓取器，以及 HEAD 预检 + content-type 验证管道。整个 videoParser.ts 用一条 async pipeline 串联四种策略，任一命中即返回。

2. B站 DASH 音视频合并：B站返回独立音频流 + 视频流（DASH 格式），浏览器原生 video 标签无法直接播放。Claude Code 设计了三级方案：yt-dlp 服务端合并（ffmpeg）→ MediaSource Extension 浏览器端双 SourceBuffer 流式写入 → 纯视频回退。VideoPlayer.tsx 中 MSE 的 pumpToBuffer() 实现了 ReadableStream → SourceBuffer 的流式灌入，避免内存溢出。

3. 同步精度工程：多人同步的核心难点是网络延迟。Claude Code 设计了 heartbeat + serverTime 插值 + 播放速率微调的三层机制：房主每秒心跳上报 currentTime → 服务端广播时附带 serverTime 时间戳 → 成员端用 `elapsed = (Date.now() - serverTime) / 1000` 插值房主当前位置 → 漂移 <1s 时微调 playbackRate 平滑追赶，>1s 时硬 seek。500ms 一次 correction timer，实测局域网同步误差 <200ms。

4. 弹幕引擎：非 BOM 弹幕库，纯手写 Canvas 2D 动画。DanmakuLayer.tsx 实现了行占用检测（rowOccupancy Map）→ 自动分配弹道 → requestAnimationFrame 逐帧位移 → strokeText 描边 + fillText 填充双层渲染，200 条弹幕池自动淘汰。跳转时全量清空 + 重建，保证弹幕与视频时间戳对齐。

5. 房主断线恢复：房主 WebSocket 断开后不立即转让，而是启动 30 秒宽限期（disconnectedOwners Map + setTimeout）。房主在宽限期内重连则取消转让（reconnect 事件清理 timer），超时则按加入时间排序自动转让给最早的成员，广播 owner-changed + toast 通知。

工程结构（前端 11 组件 / 后端 6 模块 / 总计约 2500 行业务代码）：

```
client/src/
├── pages/          HomePage（创建/加入/上传三入口）、RoomPage（视频+弹幕+成员）
├── components/     VideoPlayer、DanmakuLayer、DanmakuInput、DanmakuHistory、MemberList、TopBar、Toast
├── hooks/          useSocket（Socket.IO 类型化封装）、useToast、useLocalStorage
└── utils/          roomUtils（parseVideoUrl、uploadVideo、getRandomNickname）

server/src/
├── index.ts        Express + Socket.IO 主入口，所有 REST 和 WS 事件
├── roomManager.ts  内存房间管理（创建/加入/转让/清理/TTL）
├── videoParser.ts  4 层策略解析管道
├── bilibiliExtractor.ts  B站专用解析器（WBI 签名 + __playinfo__ + API 降级）
├── videoExtractor.ts      yt-dlp 通用提取器
└── types.ts        全局类型定义（前后端共享接口）
```

设计决策：

- 纯内存存储（无数据库）：房间数据全部存在 RoomManager 的 Map 中，弹幕 30 分钟 TTL 自动淘汰，空房间 10 分钟自动销毁。适合临时观影场景，零运维。
- 无用户系统：游客模式，随机 4 位数字昵称（游客 XXXX），房间码即身份。降低使用门槛，粘贴链接 3 秒开播。
- 双入口创建：链接解析 + 本地上传，覆盖「看网上的」和「看本地的」两种场景。上传文件 Range 请求支持拖拽进度条。
- Socket.IO 而非 WebSocket 原生：自动降级 polling、断线重连、Room 广播语义，省去大量协议层代码。
