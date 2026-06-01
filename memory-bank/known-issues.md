# 已知问题和踩坑记录

## 已解决

### 1. yt-dlp URL 中的 & 被 shell 解释
- 原因：execFile 在某些环境下仍使用 shell
- 解决：改用 spawn() 替代 execFile

### 2. B站返回 412 Precondition Failed
- 原因：Railway 服务器 IP 被 B站反爬虫拦截
- 解决：改用 B站 API 直接获取（x/web-interface/view + x/player/wbi/playurl），不经过页面抓取

### 3. MSE QuotaExceededError
- 原因：B站视频流太大，浏览器 SourceBuffer 放不下
- 解决：B站视频跳过 MSE，直接走服务端 ffmpeg 合并

### 4. /api/proxy 获取 B站流返回 502
- 原因：代理层对 B站 CDN 请求处理有问题
- 解决：在 /api/download-merged 中直接 fetch B站 CDN URL（带 Referer 头）

### 5. 房客加入后视频卡在 0 秒循环
- 原因：视频加载中（mseLoading=true）时，同步指令被跳过；加载完成后多个 setTimeout 竞争
- 解决：
  - pendingSeekRef 存储待执行的 seek 位置
  - blockSync() 单一定时器替代多个 setTimeout
  - isReady() 方法让校正计时器在视频未就绪时跳过
  - handleLoadedData 中一次性跳到正确位置

## 未解决

### 6. 同步进度按钮不可用
- 房客点击"同步进度"后没有效果
- 可能原因：request-sync 事件处理逻辑有问题

### 7. 非 B站视频的 yt-dlp 超时
- 部分视频下载速度慢，5 分钟超时不够
- 需要更智能的超时策略或流式响应
