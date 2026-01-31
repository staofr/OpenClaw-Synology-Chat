# OpenClaw-Synology-Chat
Guide de démarrage rapide de Synology Chat with OpenClaw (Ex.Clawdbot)
# Synology Chat 快速接入指南 🚀

## 5 分钟快速开始

### 第一步：准备 Synology Chat Webhook

1. **打开 Synology Chat** 应用
2. 选择要接入的频道（或创建新频道）
3. 点击频道右上角的 **⚙️ 设置**
4. 进入 **整合（Integration）** 选项卡

#### 创建 Incoming Webhook（用于接收 Clawdbot 的回复）
1. 点击 **添加（Add）** → **Incoming Webhook**
2. 名称设置为：`Clawdbot`
3. 复制生成的 Webhook URL（很重要！）
   ```
   https://your-nas.local:5001/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=XXXXX
   ```

#### 创建 Outgoing Webhook（用于发送消息到 Clawdbot）
1. 点击 **添加（Add）** → **Outgoing Webhook**
2. 配置：
   - **名称**：`Clawdbot Listener`
   - **触发词**：留空（监听所有消息）
     - 或者设置 `@clawd` 只在提及时触发
   - **Webhook URL**：先留空，稍后填写
3. 保存

### 第二步：配置桥接脚本

1. **编辑 `synology-chat-webhook.js`**：

```javascript
const CONFIG = {
  gateway: {
    url: 'http://localhost:18789',
    token: '1f0a1a9085f99dbf24411ecdf9e87a51dfe9f02a772beea4', // ✅ 已自动填写
  },
  
  synology: {
    webhookUrl: 'YOUR_SYNOLOGY_INCOMING_WEBHOOK_URL', // ⚠️ 替换为第一步中复制的 URL
  },
  
  webhook: {
    port: 18790,
    host: '0.0.0.0',
    path: '/synology-chat-webhook',
  },
};
```

2. **启动脚本**：

```bash
# 测试运行
node synology-chat-webhook.js

# 看到这样的输出说明启动成功：
# ✅ Synology Chat Webhook 桥接服务已启动！
# 📍 监听地址: http://0.0.0.0:18790/synology-chat-webhook
```

### 第三步：完成 Outgoing Webhook 配置

1. 回到 Synology Chat 的 Outgoing Webhook 设置
2. **Webhook URL** 填写：
   ```
   http://YOUR_COMPUTER_IP:18790/synology-chat-webhook
   ```
   
   如何找到你的 IP？
   ```bash
   # Linux/Mac
   ip addr show | grep inet
   # 或
   ifconfig | grep inet
   
   # Windows WSL
   ip addr show eth0 | grep inet
   ```

3. 保存

### 第四步：测试

1. 在 Synology Chat 频道发送消息：`你好，Clawd！`
2. 应该看到：
   - 脚本终端输出收到的消息
   - Clawdbot 处理消息
   - Synology Chat 收到回复

## 🔧 故障排查

### ❌ Synology Chat 显示 "无法连接到 Webhook"

**原因**：Synology NAS 无法访问你的电脑

**解决方案**：

1. **检查防火墙**：
   ```bash
   # Linux 开放端口
   sudo ufw allow 18790
   
   # Windows WSL：需要在 Windows 防火墙中开放
   ```

2. **检查网络连通性**：
   ```bash
   # 在 Synology NAS SSH 中测试
   curl http://YOUR_COMPUTER_IP:18790/health
   # 应该返回：{"status":"ok",...}
   ```

3. **使用 Tailscale**（推荐）：
   - 在两台设备上安装 Tailscale
   - 使用 Tailscale IP 地址

### ❌ 收不到 Clawdbot 的回复

**检查事项**：
1. Synology Incoming Webhook URL 是否正确
2. 查看脚本日志是否有错误
3. 测试 Incoming Webhook：
   ```bash
   curl -X POST "YOUR_SYNOLOGY_WEBHOOK_URL" \
     -H "Content-Type: application/json" \
     -d '{"text": "测试消息"}'
   ```

### ❌ SSL 证书错误

如果 Synology 使用自签名证书：

```bash
# 临时解决（仅用于测试）
NODE_TLS_REJECT_UNAUTHORIZED=0 node synology-chat-webhook.js
```

生产环境应该：
- 使用 Let's Encrypt 证书
- 或在 Synology 安装受信任的证书

## 🎯 后台运行

使用 PM2 让服务持续运行：

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start synology-chat-webhook.js --name synology-chat-bridge

# 保存配置（开机自启）
pm2 save
pm2 startup

# 查看日志
pm2 logs synology-chat-bridge

# 停止服务
pm2 stop synology-chat-bridge
```

## 📊 当前方案的能力

✅ **支持的功能**：
- 双向对话
- 文本消息
- 多用户对话
- 频道/私聊

❌ **暂不支持**：
- 文件上传/下载
- 图片/视频
- 表情反应
- 消息编辑/删除
- 线程回复

如需完整功能，建议开发正式的 Clawdbot 插件。

## 🚀 下一步

如果这个方案运行良好，可以考虑：

1. **开发正式插件**：
   - 参考 Nextcloud Talk 插件源码
   - 实现完整的 Channel Adapter
   - 支持更多 Synology Chat 特性

2. **提交到 Clawdbot 社区**：
   - 发布到 npm：`@clawdbot/synology-chat`
   - 贡献到官方仓库

3. **功能增强**：
   - 支持文件传输
   - 支持富文本格式
   - 支持消息引用

## 📚 参考资料

- [Synology Chat Integration 官方文档](https://kb.synology.com/en-global/DSM/help/Chat/chat_integration)
- [Clawdbot Plugin 开发文档](file:///home/msun/.npm-global/lib/node_modules/clawdbot/docs/plugin.md)
- [Nextcloud Talk 插件示例](file:///home/msun/.npm-global/lib/node_modules/clawdbot/docs/channels/nextcloud-talk.md)

---

有问题？查看详细文档：`synology-chat-integration.md`
