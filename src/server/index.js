import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateAssistantResponse, getAvailableModels } from '../api/client.js';
import { generateRequestBody } from '../utils/utils.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json({ limit: config.security.maxRequestSize }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../../public')));

// Token upload endpoint
app.post('/api/upload-token', (req, res) => {
  try {
    const tokenData = req.body;
    if (!tokenData) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Ensure data directory exists
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write to accounts.json
    fs.writeFileSync(
      path.join(dataDir, 'accounts.json'),
      JSON.stringify(tokenData, null, 2)
    );

    logger.info('Token updated via Web UI');
    res.json({ success: true, message: 'Token saved' });
  } catch (error) {
    logger.error('Failed to save token:', error);
    res.status(500).json({ error: 'Failed to save token' });
  }
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `请求体过大，最大支持 ${config.security.maxRequestSize}` });
  }
  next(err);
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.request(req.method, req.path, res.statusCode, Date.now() - start);
  });
  next();
});

app.use((req, res, next) => {
  if (req.path.startsWith('/v1/')) {
    const apiKey = config.security?.apiKey;
    if (apiKey) {
      const authHeader = req.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
      if (providedKey !== apiKey) {
        logger.warn(`API Key 验证失败: ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Invalid API Key' });
      }
    }
  }
  next();
});

app.get('/v1/models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json(models);
  } catch (error) {
    logger.error('获取模型列表失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model, stream = true, tools, ...params } = req.body;
  try {

    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    const requestBody = generateRequestBody(messages, model, params, tools);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const id = `chatcmpl-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      let hasToolCall = false;

      await generateAssistantResponse(requestBody, (data) => {
        if (data.type === 'tool_calls') {
          hasToolCall = true;
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { tool_calls: data.tool_calls }, finish_reason: null }]
          })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: data.content }, finish_reason: null }]
          })}\n\n`);
        }
      });

      res.write(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: hasToolCall ? 'tool_calls' : 'stop' }]
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      let fullContent = '';
      let toolCalls = [];
      await generateAssistantResponse(requestBody, (data) => {
        if (data.type === 'tool_calls') {
          toolCalls = data.tool_calls;
        } else {
          fullContent += data.content;
        }
      });

      const message = { role: 'assistant', content: fullContent };
      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        }]
      });
    }
  } catch (error) {
    logger.error('生成响应失败:', error.message);
    if (!res.headersSent) {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const id = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: `错误: ${error.message}` }, finish_reason: null }]
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }
});

const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`服务器已启动: ${config.server.host}:${config.server.port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`端口 ${config.server.port} 已被占用`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    logger.error(`端口 ${config.server.port} 无权限访问`);
    process.exit(1);
  } else {
    logger.error('服务器启动失败:', error.message);
    process.exit(1);
  }
});

const shutdown = () => {
  logger.info('正在关闭服务器...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
