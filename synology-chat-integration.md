# Synology Chat 集成方案

## 概述
通过 Webhook 实现 Clawdbot 与 Synology Chat 的双向通信。

## 前置条件
- Synology Chat 已安装并运行
- Clawdbot Gateway 可以被 Synology Chat 访问（同一网络或通过反向代理）
- Synology Chat 管理员权限

## 架构
```
Synology Chat (用户消息) 
    ↓ Outgoing Webhook
Clawdbot Gateway (处理)
    ↓ Incoming Webhook
Synology Chat (Bot 回复)
```

## 第一步：在 Synology Chat 创建 Bot

### 1.1 创建 Incoming Webhook
1. 打开 Synology Chat
2. 进入 **频道设置** → **整合**
3. 点击 **添加** → **Incoming Webhook**
4. 设置名称：`Clawdbot`
5. **保存 Webhook URL**（格式类似）：
   ```
   https://your-synology.local:5001/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=YOUR_TOKEN
   ```

### 1.2 创建 Outgoing Webhook
1. 在同一频道，点击 **添加** → **Outgoing Webhook**
2. 设置：
   - **名称**：`Clawdbot Listener`
   - **触发词**：留空（监听所有消息）或设置触发词（如 `@clawd`）
   - **Webhook URL**：`http://YOUR_GATEWAY_IP:18789/synology-chat-webhook`
3. 保存

## 第二步：配置网络访问

### 选项 A：同一局域网
确保 Synology Chat 可以访问运行 Clawdbot 的机器：
```bash
# 测试连通性
curl http://YOUR_GATEWAY_IP:18789/status
```

### 选项 B：通过 Tailscale/反向代理
如果 Synology Chat 和 Clawdbot 不在同一网络，使用：
- Tailscale（推荐）
- Cloudflare Tunnel
- Nginx 反向代理

## 第三步：创建 Webhook 处理脚本

保存为 `synology-chat-webhook.js`：

```javascript
// synology-chat-webhook.js
// Synology Chat <-> Clawdbot 双向桥接

const http = require('http');
const https = require('https');
const { URL } = require('url');

// 配置
const CONFIG = {
  // Clawdbot Gateway
  gatewayUrl: 'http://localhost:18789',
  gatewayToken: '1f0a1a9085f99dbf24411ecdf9e87a51dfe9f02a772beea4', // 从你的配置获取
  
  // Synology Chat Incoming Webhook
  synologyWebhookUrl: 'YOUR_SYNOLOGY_INCOMING_WEBHOOK_URL',
  
  // Webhook 服务器
  port: 18790,
  path: '/synology-chat-webhook',
};

// 启动 Webhook 服务器
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === CONFIG.path) {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        console.log('收到 Synology Chat 消息:', payload);
        
        // 提取消息内容
        const text = payload.text;
        const userId = payload.user_name;
        const channelId = payload.channel_id;
        
        // 发送到 Clawdbot
        const response = await sendToClawdbot(text, userId, channelId);
        
        // 回复给 Synology Chat
        if (response) {
          await sendToSynology(response);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        console.error('处理失败:', error);
        res.writeHead(500);
        res.end();
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

// 发送到 Clawdbot Gateway
async function sendToClawdbot(text, userId, channelId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      message: text,
      senderId: userId,
      channelId: channelId,
      channel: 'synology-chat',
    });
    
    const url = new URL(`${CONFIG.gatewayUrl}/api/message`);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${CONFIG.gatewayToken}`,
      },
    };
    
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response.reply);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 发送到 Synology Chat
async function sendToSynology(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ text });
    const url = new URL(CONFIG.synologyWebhookUrl);
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };
    
    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request(url, options, (res) => {
      resolve();
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 启动服务器
server.listen(CONFIG.port, () => {
  console.log(`Synology Chat Webhook 服务运行在端口 ${CONFIG.port}`);
  console.log(`监听路径: ${CONFIG.path}`);
});
```

## 第四步：运行

```bash
# 安装依赖（如果需要）
npm install

# 运行脚本
node synology-chat-webhook.js

# 或者用 PM2 保持后台运行
npm install -g pm2
pm2 start synology-chat-webhook.js --name synology-chat-bridge
pm2 save
```

## 测试

1. 在 Synology Chat 发送消息
2. 检查脚本日志
3. 应该能收到 Clawdbot 的回复

## 故障排查

### Synology Chat 无法访问 Gateway
- 检查防火墙设置
- 确认 IP 地址正确
- 尝试从 Synology NAS SSH 测试：`curl http://GATEWAY_IP:18789/status`

### 没有收到回复
- 检查脚本日志
- 确认 Synology Webhook URL 正确
- 检查 Clawdbot Gateway token

### SSL/证书问题
如果 Synology 使用自签名证书，在脚本中添加：
```javascript
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 仅用于测试！
```

## 进阶：开发完整插件

如果这个临时方案工作良好，可以考虑将其转化为正式的 Clawdbot 插件：

1. 参考 `/home/msun/.npm-global/lib/node_modules/clawdbot/docs/plugin.md`
2. 使用 Nextcloud Talk 插件作为模板
3. 实现完整的 channel adapter

## 限制

- 这是一个基础的桥接方案
- 不支持：
  - 文件上传
  - 表情反应
  - 消息编辑/删除
  - 线程/回复

如需完整功能，建议开发正式插件。
