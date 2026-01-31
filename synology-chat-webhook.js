#!/usr/bin/env node
/**
 * Synology Chat <-> Clawdbot 双向桥接
 * 
 * 使用方法：
 * 1. 修改下方的 CONFIG 配置
 * 2. 运行：node synology-chat-webhook.js
 * 3. 或用 PM2：pm2 start synology-chat-webhook.js --name synology-chat-bridge
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ========== 配置区域 ==========
const CONFIG = {
  // Clawdbot Gateway 配置
  gateway: {
    url: 'http://localhost:18789',
    token: '22c672ee2eeb849b501eed30fcff4cd9522d39fe683f5', // 从 ~/.clawdbot/clawdbot.json 获取
  },
  
  // Synology Chat Incoming Webhook（Clawdbot 发送消息到 Synology）
  synology: {
    webhookUrl: 'http://192.168.10.116:20000/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=ZeEaMR7DpfLXrIGwGgq8NcoVdaPNEixOMn6IohtMnLE5nijt21VPDdDCm9C5tS4R',
  },
  
  // Webhook 服务器配置（接收 Synology Chat 的消息）
  webhook: {
    port: 18790,
    host: '0.0.0.0',
    path: '/synology-chat-webhook',
  },
  
  // 日志配置
  logging: {
    verbose: true,
  },
};

// ========== 主程序 ==========

console.log('🐾 Synology Chat <-> Clawdbot 桥接启动中...\n');

// 验证配置
if (CONFIG.synology.webhookUrl === 'YOUR_SYNOLOGY_INCOMING_WEBHOOK_URL') {
  console.error('❌ 错误：请先在配置中设置 Synology Incoming Webhook URL！');
  console.error('   编辑文件中的 CONFIG.synology.webhookUrl');
  process.exit(1);
}

// 启动 Webhook 服务器
const server = http.createServer(async (req, res) => {
  // 健康检查端点
  if (req.url === '/health' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      service: 'synology-chat-bridge',
      timestamp: new Date().toISOString(),
    }));
    return;
  }
  
  // Webhook 端点
  if (req.method === 'POST' && req.url === CONFIG.webhook.path) {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        // Synology Chat 可能发送 URL-encoded 或 JSON 格式
        let payload;
        
        // 检查 Content-Type
        const contentType = req.headers['content-type'] || '';
        
        if (contentType.includes('application/x-www-form-urlencoded')) {
          // URL-encoded 格式：token=xxx&text=xxx&user_name=xxx
          const params = new URLSearchParams(body);
          payload = {
            text: params.get('text') || '',
            user_name: params.get('user_name') || params.get('username') || 'unknown',
            channel_name: params.get('channel_name') || 'Channel',
            channel_id: params.get('channel_id') || 'default',
            token: params.get('token'),
          };
        } else {
          // JSON 格式
          payload = JSON.parse(body);
        }
        
        if (CONFIG.logging.verbose) {
          console.log('📨 收到 Synology Chat 消息:', JSON.stringify(payload, null, 2));
        }
        
        // Synology Chat Outgoing Webhook 格式
        // 参考：https://kb.synology.com/en-global/DSM/help/Chat/chat_integration
        const text = payload.text || '';
        const userId = payload.user_name || 'unknown';
        const userName = payload.user_name || 'User';
        const channelId = payload.channel_id || 'default';
        const channelName = payload.channel_name || 'Channel';
        
        // 跳过 Bot 自己的消息（避免循环）
        if (payload.username === 'Clawdbot' || userId === 'clawdbot') {
          console.log('⏭️  跳过 Bot 自己的消息');
          res.writeHead(200);
          res.end();
          return;
        }
        
        console.log(`💬 ${userName} (${channelName}): ${text}`);
        
        // 发送到 Clawdbot 处理
        const response = await sendToClawdbot(text, userId, channelId);
        
        if (response) {
          console.log(`🤖 Clawdbot 回复: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);
          await sendToSynology(response);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        
      } catch (error) {
        console.error('❌ 处理消息失败:', error.message);
        if (CONFIG.logging.verbose) {
          console.error(error.stack);
        }
        res.writeHead(500);
        res.end();
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// 发送消息到 Clawdbot Gateway (使用 OpenResponses API)
async function sendToClawdbot(text, userId, channelId) {
  return new Promise((resolve, reject) => {
    // 使用 OpenResponses API 格式
    const data = JSON.stringify({
      model: "clawdbot:main",
      input: text,
      user: `synology-${userId}`,  // 稳定的 session 路由
    });
    
    const url = new URL('/v1/responses', CONFIG.gateway.url);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Authorization': `Bearer ${CONFIG.gateway.token}`,
        'x-clawdbot-agent-id': 'main',
      },
    };
    
    if (CONFIG.logging.verbose) {
      console.log(`📤 发送到 Clawdbot: ${url}`);
    }
    
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error(`❌ Clawdbot API 返回错误: ${res.statusCode}`);
            console.error(body);
            resolve(null);
            return;
          }
          
          const response = JSON.parse(body);
          
          // 从 OpenResponses 格式提取文本
          if (response.output && response.output.length > 0) {
            for (const item of response.output) {
              if (item.type === 'message' && item.role === 'assistant') {
                if (item.content && item.content.length > 0) {
                  const textPart = item.content.find(part => part.type === 'output_text' || part.type === 'text');
                  if (textPart && textPart.text) {
                    resolve(textPart.text);
                    return;
                  }
                }
              }
            }
          }
          
          console.error('❌ 未找到有效的回复内容');
          resolve(null);
        } catch (e) {
          console.error('❌ 解析 Clawdbot 响应失败:', e.message);
          if (CONFIG.logging.verbose) {
            console.error('响应内容:', body);
          }
          resolve(null);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ 连接 Clawdbot Gateway 失败:', error.message);
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

// 发送消息到 Synology Chat
async function sendToSynology(text) {
  return new Promise((resolve, reject) => {
    // Synology Chat Incoming Webhook 需要 URL-encoded form 格式
    const payload = JSON.stringify({ text: text });
    const encodedPayload = encodeURIComponent(payload);
    const formData = `payload=${encodedPayload}`;
    
    const url = new URL(CONFIG.synology.webhookUrl);
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData),
      },
    };
    
    // 处理自签名证书（仅用于开发/测试）
    if (url.protocol === 'https:' && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
      // 生产环境应该使用有效证书
      options.rejectUnauthorized = false;
    }
    
    const protocol = url.protocol === 'https:' ? https : http;
    const req = protocol.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error(`❌ Synology Webhook 返回错误: ${res.statusCode}`);
          console.error(`   响应: ${body}`);
        } else {
          try {
            const response = JSON.parse(body);
            if (response.success) {
              console.log('✅ 成功发送到 Synology Chat');
            } else {
              console.error('❌ Synology 返回失败:', body);
            }
          } catch (e) {
            console.log('📤 已发送到 Synology Chat');
          }
        }
        resolve();
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ 发送到 Synology Chat 失败:', error.message);
      reject(error);
    });
    
    req.write(formData);
    req.end();
  });
}

// 启动服务器
server.listen(CONFIG.webhook.port, CONFIG.webhook.host, () => {
  console.log('✅ Synology Chat Webhook 桥接服务已启动！\n');
  console.log(`📍 监听地址: http://${CONFIG.webhook.host}:${CONFIG.webhook.port}${CONFIG.webhook.path}`);
  console.log(`🔗 Clawdbot Gateway: ${CONFIG.gateway.url}`);
  console.log(`💬 Synology Chat: ${CONFIG.synology.webhookUrl.substring(0, 50)}...`);
  console.log('\n📝 下一步：');
  console.log('   1. 在 Synology Chat 创建 Outgoing Webhook');
  console.log(`   2. Webhook URL 设置为: http://YOUR_IP:${CONFIG.webhook.port}${CONFIG.webhook.path}`);
  console.log('   3. 在 Synology Chat 发送消息测试\n');
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 正在关闭服务...');
  server.close(() => {
    console.log('✅ 服务已停止');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
