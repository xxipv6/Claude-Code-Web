/**
 * Claude Code Standalone Server
 * 纯 Node.js 实现，无需外部依赖
 * 支持配置文件和环境变量
 */

import { createServer } from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CLAUDE_CONFIG_PATH || path.join(__dirname, '../config.json');
const PROJECTS_PATH = path.join(__dirname, '../projects.json');

// 项目存储
let projects = new Map();

// 加载项目配置
function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_PATH)) {
      const data = fs.readFileSync(PROJECTS_PATH, 'utf8');
      const projectsArray = JSON.parse(data);
      projectsArray.forEach(p => projects.set(p.id, p));
      console.log(`[Server] Loaded ${projects.size} projects`);
    }
  } catch (error) {
    console.error('[Server] Failed to load projects:', error);
  }
}

// 保存项目配置
function saveProjects() {
  try {
    const projectsArray = Array.from(projects.values());
    fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projectsArray, null, 2));
  } catch (error) {
    console.error('[Server] Failed to save projects:', error);
  }
}

// 加载项目配置
loadProjects();
let config = {
  env: {
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    API_TIMEOUT_MS: '300000',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
  },
  permissions: {
    allow: [],
    defaultMode: 'bypassPermissions'
  },
  enabledPlugins: {},
  server: {
    port: 3000,
    host: 'localhost',
    // 客户端断开后是否继续在后台运行任务
    keepRunningInBackground: true
  }
};

// 加载配置文件
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
      const fileConfig = JSON.parse(configData);

      // 合并配置
      config = {
        ...config,
        ...fileConfig,
        env: {
          ...config.env,
          ...fileConfig.env
        },
        server: {
          ...config.server,
          ...fileConfig.server
        }
      };

      console.log(`[Config] Loaded from: ${CONFIG_PATH}`);
    } else {
      console.log(`[Config] No config file found at ${CONFIG_PATH}, using defaults`);
    }
  } catch (error) {
    console.error(`[Config] Error loading config: ${error.message}`);
  }

  // 环境变量优先级更高
  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    config.env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    config.env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.API_TIMEOUT_MS) {
    config.env.API_TIMEOUT_MS = process.env.API_TIMEOUT_MS;
  }
  if (process.env.PORT) {
    config.server.port = parseInt(process.env.PORT);
  }

  return config;
}

// 加载配置
config = loadConfig();

const CLAUDE_BINARY = process.env.CLAUDE_BINARY || config.claudeBinary || './claude';
const PORT = config.server.port;
const HOST = config.server.host;

// 获取 API Key (支持多种格式)
function getApiKey() {
  // 优先使用 ANTHROPIC_API_KEY
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  // 其次使用配置文件中的 ANTHROPIC_AUTH_TOKEN
  if (config.env.ANTHROPIC_AUTH_TOKEN) {
    return config.env.ANTHROPIC_AUTH_TOKEN;
  }
  return '';
}

// 获取 Base URL
function getBaseUrl() {
  return config.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
}

// 存储活跃会话
const sessions = new Map();
// 存储后台运行的会话（客户端断开但进程仍在运行）
const backgroundSessions = new Map();
let sessionIdCounter = 0;

// 会话历史存储
const sessionHistory = new Map(); // session_id -> { messages: [], createdAt: {}, updatedAt: {} }
const SESSIONS_FILE = path.join(__dirname, '../sessions.json');

// 加载会话历史
function loadSessionHistory() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const history = JSON.parse(data);
      for (const [id, session] of Object.entries(history)) {
        sessionHistory.set(parseInt(id), session);
      }
      console.log(`[Server] Loaded ${sessionHistory.size} sessions from history`);
      // 更新计数器
      const maxId = Math.max(...Array.from(sessionHistory.keys()).map(Number), 0);
      sessionIdCounter = maxId;
    }
  } catch (error) {
    console.error('[Server] Error loading session history:', error.message);
  }
}

// 保存会话历史
function saveSessionHistory() {
  try {
    const history = {};
    sessionHistory.forEach((session, id) => {
      history[id] = session;
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('[Server] Error saving session history:', error.message);
  }
}

// 初始化时加载历史
loadSessionHistory();

// Claude 进程管理
class ClaudeSession {
  constructor(id, res, existingHistory = null, projectId = null) {
    this.id = id;
    this.res = res;
    this.claudeProcess = null;
    this.buffer = '';
    this.messages = existingHistory || [];
    this.projectId = projectId;
    this.createdAt = existingHistory ? sessionHistory.get(id)?.createdAt : new Date().toISOString();
    this.updatedAt = existingHistory ? sessionHistory.get(id)?.updatedAt : new Date().toISOString();
    // 缓存输出（用于后台任务继续运行时的消息存储）
    this.outputCache = [];

    // 获取项目工作目录
    if (projectId && projects.has(projectId)) {
      this.project = projects.get(projectId);
      console.log(`[Session ${this.id}] Bound to project: ${this.project.name} (${this.project.path})`);
    }
  }

  start() {
    // 如果进程已经存在且在运行，不要重复启动
    if (this.claudeProcess && this.claudeProcess.stdin && !this.claudeProcess.killed) {
      console.log(`[Session ${this.id}] Claude process already running, skipping start`);
      return;
    }

    console.log(`[Session ${this.id}] Starting Claude process`);

    // 检查 binary 是否存在
    if (!fs.existsSync(CLAUDE_BINARY)) {
      console.error(`[Session ${this.id}] Claude binary not found: ${CLAUDE_BINARY}`);
      this.send({
        type: 'error',
        message: `Claude binary not found at: ${CLAUDE_BINARY}`
      });
      this.sendMockResponse('Claude binary 未找到。请检查 CLAUDE_BINARY 环境变量。');
      return;
    }

    // 检查 API Key
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(`[Session ${this.id}] No API key configured`);
    }

    try {
      // 准备环境变量
      const env = {
        ...process.env,
        CLAUDE_SESSION_ID: this.id.toString(),
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_BASE_URL: getBaseUrl(),
        API_TIMEOUT_MS: config.env.API_TIMEOUT_MS,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: config.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
      };

      console.log(`[Session ${this.id}] Using Base URL: ${getBaseUrl()}`);
      console.log(`[Session ${this.id}] API Key configured: ${!!apiKey}`);

      // 二进制文件需要的命令行参数（从 VSCode 插件代码中提取）
      const args = [
        '--output-format', 'stream-json',
        '--input-format', 'stream-json',
        '--verbose'
      ];

      console.log(`[Session ${this.id}] Spawning: ${CLAUDE_BINARY} ${args.join(' ')}`);

      // 准备 spawn 选项
      const spawnOptions = {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env
      };

      // 如果绑定了项目，设置工作目录
      if (this.project && this.project.path) {
        spawnOptions.cwd = this.project.path;
        console.log(`[Session ${this.id}] Working directory: ${this.project.path}`);
      }

      // 启动 Claude 原生进程
      this.claudeProcess = spawn(CLAUDE_BINARY, args, spawnOptions);

      // 处理 Claude 的输出
      this.claudeProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`[Session ${this.id}] Claude output:`, output.substring(0, 100));

        // 缓冲输出，按行处理
        this.buffer += output;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            // 尝试解析 JSON
            try {
              const json = JSON.parse(line);
              this.send({ type: 'claude_output', data: json });

              // 保存助手响应到历史
              if (json.type === 'assistant' && json.message) {
                this.messages.push({
                  role: 'assistant',
                  ...json.message,
                  timestamp: new Date().toISOString()
                });
                this.updatedAt = new Date().toISOString();
                this.saveToHistory();
              }
            } catch {
              // 纯文本输出
              this.send({ type: 'claude_output', data: line });
            }
          }
        }
      });

      this.claudeProcess.stderr.on('data', (data) => {
        console.error(`[Session ${this.id}] Claude error:`, data.toString());
        // 错误可能是有用的信息，也发送出去
        this.send({ type: 'claude_output', data: data.toString() });
      });

      this.claudeProcess.on('close', (code) => {
        console.log(`[Session ${this.id}] Claude process exited with code ${code}`);
        this.send({
          type: 'claude_closed',
          code
        });
      });

      this.claudeProcess.on('error', (error) => {
        console.error(`[Session ${this.id}] Claude process error:`, error);
        this.send({
          type: 'error',
          message: error.message
        });

        // 发送模拟响应（带配置信息）
        let errorMsg = `Claude 进程启动失败: ${error.message}\n\n`;
        if (!apiKey) {
          errorMsg += `⚠️ 未配置 API Key\n\n`;
          errorMsg += `配置方法：\n`;
          errorMsg += `1. 编辑配置文件: ${CONFIG_PATH}\n`;
          errorMsg += `2. 设置 ANTHROPIC_AUTH_TOKEN\n`;
          errorMsg += `3. 或设置环境变量: export ANTHROPIC_API_KEY=your-key\n`;
        } else {
          errorMsg += `可能的原因：\n`;
          errorMsg += `1. Binary 不兼容当前系统\n`;
          errorMsg += `2. 网络连接问题 (Base URL: ${getBaseUrl()})\n`;
          errorMsg += `3. API Key 无效\n`;
        }
        this.sendMockResponse(errorMsg);
      });
    } catch (error) {
      console.error(`[Session ${this.id}] Failed to start Claude:`, error);
      this.send({
        type: 'error',
        message: `Failed to start Claude: ${error.message}`
      });
    }
  }

  sendMockResponse(message) {
    // 当 Claude 无法启动时，发送模拟响应
    this.send({
      type: 'claude_output',
      data: message
    });
  }

  send(data) {
    // 缓存所有输出（即使客户端断开也保存）
    this.outputCache.push(data);

    // 如果客户端连接着，立即发送
    if (this.res && !this.res.writableEnded) {
      this.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  // 更新 response 对象（用于客户端重连）
  updateResponse(newRes) {
    this.res = newRes;
    console.log(`[Session ${this.id}] Response updated, client reconnected`);

    // 延迟发送缓存，确保 HTTP 头已经设置
    setTimeout(() => {
      // 发送所有缓存的输出
      if (this.outputCache.length > 0) {
        console.log(`[Session ${this.id}] Sending ${this.outputCache.length} cached messages`);
        this.outputCache.forEach(data => {
          if (this.res && !this.res.writableEnded) {
            this.res.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        });
      }
    }, 100);
  }

  sendMessage(message) {
    if (!this.claudeProcess || !this.claudeProcess.stdin.writable) {
      console.log(`[Session ${this.id}] Claude process not available, restarting...`);
      // 重启 Claude 进程
      this.start();

      // 等待进程启动
      setTimeout(() => {
        this.sendMessage(message);
      }, 500);
      return;
    }

    // 保存用户消息到历史
    this.messages.push({
      role: 'user',
      ...message,
      timestamp: new Date().toISOString()
    });
    this.updatedAt = new Date().toISOString();
    this.saveToHistory();

    console.log(`[Session ${this.id}] Sending to Claude:`, message);
    this.claudeProcess.stdin.write(JSON.stringify(message) + '\n');
  }

  saveToHistory() {
    // 保存会话到历史存储
    sessionHistory.set(this.id, {
      messages: this.messages,
      projectId: this.projectId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    });
    saveSessionHistory();
  }

  getMockResponse(message) {
    // 生成模拟响应
    const content = message.content || '';
    const apiKey = getApiKey();

    if (content.startsWith('/')) {
      const command = content.split(' ')[0];
      let response = `命令 ${command} 已收到！\n\n`;

      if (!apiKey) {
        response += `⚠️ 这是模拟响应。\n\n`;
        response += `要使用真实的 Claude AI：\n`;
        response += `1. 编辑配置文件: ${CONFIG_PATH}\n`;
        response += `2. 设置 ANTHROPIC_AUTH_TOKEN\n`;
        response += `3. 重启服务器\n`;
      } else {
        response += `⚠️ Claude 进程无法启动。\n`;
        response += `配置的 Base URL: ${getBaseUrl()}\n`;
        response += `请检查 binary 和网络连接。`;
      }
      return response;
    }

    let response = `你发送了: "${content}"\n\n`;

    if (!apiKey) {
      response += `⚠️ 当前使用模拟响应模式\n\n`;
      response += `要使用真实的 Claude AI，请配置 API Key：\n`;
      response += `配置文件: ${CONFIG_PATH}\n`;
      response += `或设置环境变量: export ANTHROPIC_API_KEY=your-key\n`;
    } else {
      response += `⚠️ Claude 进程未正常运行\n`;
      response += `请检查服务器日志。`;
    }
    return response;
  }

  stop() {
    if (this.claudeProcess) {
      this.claudeProcess.kill();
    }
  }
}

// HTTP 服务器
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 主页面 - 重定向到聊天页面
  if (url.pathname === '/') {
    res.writeHead(302, { 'Location': '/chat.html' });
    res.end();
    return;
  }

  // 聊天页面
  if (url.pathname === '/chat.html') {
    serveFile(res, path.join(__dirname, '../public/chat.html'), 'text/html');
    return;
  }

  // VSCode shim
  if (url.pathname === '/vscode-shim.js') {
    serveFile(res, path.join(__dirname, '../public/vscode-shim.js'), 'application/javascript');
    return;
  }

  // 原始 webview 资源
  if (url.pathname.startsWith('/webview/')) {
    const filePath = path.join('/workspace/claudeCodePlugin/extension', url.pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const contentType = getContentType(ext);
      serveFile(res, filePath, contentType);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // API 端点
  if (url.pathname === '/api/health') {
    const apiKey = getApiKey();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      sessions: sessions.size,
      claude_binary: CLAUDE_BINARY,
      api_key_configured: !!apiKey,
      base_url: getBaseUrl(),
      config_file: CONFIG_PATH,
      config_exists: fs.existsSync(CONFIG_PATH)
    }));
    return;
  }

  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      base_url: getBaseUrl(),
      api_key_configured: !!getApiKey(),
      permissions: config.permissions,
      enabled_plugins: config.enabledPlugins,
      timeout_ms: config.env.API_TIMEOUT_MS
    }));
    return;
  }

  // ==================== 项目管理 API ====================

  // 获取所有项目
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    const projectsList = Array.from(projects.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projects: projectsList }));
    return;
  }

  // 创建新项目
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, path: projectPath } = JSON.parse(body);

        if (!name || !projectPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Name and path are required' }));
          return;
        }

        // 检查路径是否存在
        if (!fs.existsSync(projectPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path does not exist' }));
          return;
        }

        // 创建项目
        const project = {
          id: Date.now(),
          name,
          path: projectPath,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        projects.set(project.id, project);
        saveProjects();

        console.log(`[Server] Created project: ${name} (${projectPath})`);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(project));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 更新项目
  if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'PUT') {
    const projectId = parseInt(url.pathname.split('/').pop());
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const project = projects.get(projectId);

        if (project) {
          // 更新允许的字段
          if (updates.name) project.name = updates.name;
          if (updates.path) project.path = updates.path;
          project.updatedAt = new Date().toISOString();

          projects.set(projectId, project);
          saveProjects();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(project));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Project not found' }));
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 删除项目
  if (url.pathname.match(/^\/api\/projects\/\d+$/) && req.method === 'DELETE') {
    const projectId = parseInt(url.pathname.split('/').pop());

    if (projects.has(projectId)) {
      const project = projects.get(projectId);
      projects.delete(projectId);
      saveProjects();

      console.log(`[Server] Deleted project: ${project.name}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project not found' }));
    }
    return;
  }

  // ==================== 会话管理 API ====================

  // 获取所有会话历史
  if (url.pathname === '/api/sessions' && req.method === 'GET') {
    const urlParams = new URLSearchParams(url.search);
    const filterProjectId = urlParams.get('project'); // 可选的项目ID过滤

    let sessionsList = Array.from(sessionHistory.entries()).map(([id, data]) => ({
      id,
      projectId: data.projectId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      messageCount: data.messages.length
    }));

    // 如果指定了项目ID，只返回该项目的会话
    if (filterProjectId && filterProjectId !== '') {
      const projectId = parseInt(filterProjectId);
      console.log(`[Server] Filtering sessions by projectId: ${projectId}`);
      sessionsList = sessionsList.filter(s => s.projectId === projectId);
    } else {
      // 如果没有指定项目ID，只返回无项目的会话（projectId 为 null）
      console.log(`[Server] Filtering sessions with no project`);
      sessionsList = sessionsList.filter(s => s.projectId === null || s.projectId === undefined);
    }

    sessionsList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total: sessionsList.length,
      sessions: sessionsList
    }));
    return;
  }

  // 创建新会话
  if (url.pathname === '/api/sessions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { projectId } = JSON.parse(body);

        const newId = ++sessionIdCounter;
        const newSession = {
          messages: [],
          projectId: projectId || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        sessionHistory.set(newId, newSession);
        saveSessionHistory();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: newId,
          ...newSession
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 获取特定会话的消息
  if (url.pathname.match(/^\/api\/sessions\/\d+$/) && req.method === 'GET') {
    const sessionId = parseInt(url.pathname.split('/').pop());
    const urlParams = new URLSearchParams(url.search);
    const limit = parseInt(urlParams.get('limit')) || 50; // 默认只返回最近 50 条
    const offset = parseInt(urlParams.get('offset')) || 0;

    const sessionData = sessionHistory.get(sessionId);

    if (sessionData) {
      // 分页：只返回指定范围的消息
      const messages = sessionData.messages || [];
      const totalMessages = messages.length;
      const paginatedMessages = messages.slice(offset, offset + limit);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: sessionId,
        messages: paginatedMessages,
        total: totalMessages,
        offset,
        limit,
        hasMore: offset + limit < totalMessages,
        createdAt: sessionData.createdAt,
        updatedAt: sessionData.updatedAt
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // 停止会话（中断当前运行的任务）
  if (url.pathname.match(/^\/api\/sessions\/\d+\/stop$/) && req.method === 'POST') {
    const sessionId = parseInt(url.pathname.split('/').slice(0, -1).pop());
    console.log(`[Server] Stop request for session ${sessionId}`);

    let stopped = false;

    // 检查活跃会话
    let session = sessions.get(sessionId);
    if (session) {
      console.log(`[Server] Found active session ${sessionId}`);
      if (session.claudeProcess) {
        session.stop();
        stopped = true;
      }
      sessions.delete(sessionId);
    }

    // 检查后台会话
    session = backgroundSessions.get(sessionId);
    if (session) {
      console.log(`[Server] Found background session ${sessionId}`);
      if (session.claudeProcess) {
        session.stop();
        stopped = true;
      }
      backgroundSessions.delete(sessionId);
    }

    if (stopped || session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Session stopped' }));
    } else {
      // 即使没有找到进程，也返回成功（可能已经停止了）
      console.log(`[Server] Session ${sessionId} not found or already stopped`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Session not running' }));
    }
    return;
  }

  // 删除会话
  if (url.pathname.match(/^\/api\/sessions\/\d+$/) && req.method === 'DELETE') {
    const sessionId = parseInt(url.pathname.split('/').pop());

    if (sessionHistory.has(sessionId)) {
      // 关闭对应的活跃会话
      const activeSession = sessions.get(sessionId);
      if (activeSession) {
        activeSession.stop();
        sessions.delete(sessionId);
      }

      // 从历史中删除
      sessionHistory.delete(sessionId);
      saveSessionHistory();

      console.log(`[Server] Deleted session ${sessionId}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
    return;
  }

  // SSE 流式端点
  if (url.pathname === '/api/stream') {
    // 检查是否要连接到现有会话
    const urlParams = new URLSearchParams(url.search);
    const existingSessionId = urlParams.get('session');
    const projectId = urlParams.get('project') ? parseInt(urlParams.get('project')) : null;

    let sessionId, session;

    // 优先检查后台运行的会话
    if (existingSessionId && backgroundSessions.has(parseInt(existingSessionId))) {
      // 恢复后台运行的会话
      sessionId = parseInt(existingSessionId);
      session = backgroundSessions.get(sessionId);
      session.updateResponse(res);
      backgroundSessions.delete(sessionId);
      sessions.set(sessionId, session);
      console.log(`[Server] Reconnected to background session ${sessionId}`);
    } else if (existingSessionId && sessions.has(parseInt(existingSessionId))) {
      // 会话已存在但没有 SSE 连接（可能是通过 /api/message 创建的）
      sessionId = parseInt(existingSessionId);
      session = sessions.get(sessionId);
      console.log(`[Server] Attaching SSE to existing session ${sessionId}`);
      session.updateResponse(res);
    } else if (existingSessionId && sessionHistory.has(parseInt(existingSessionId))) {
      // 恢复现有会话（从历史加载）
      sessionId = parseInt(existingSessionId);
      const historyData = sessionHistory.get(sessionId);
      session = new ClaudeSession(sessionId, res, historyData.messages, projectId);
      sessions.set(sessionId, session);
      console.log(`[Server] Resuming session ${sessionId} with ${historyData.messages.length} messages`);
    } else {
      // 创建新会话
      sessionId = ++sessionIdCounter;
      session = new ClaudeSession(sessionId, res, null, projectId);
      sessions.set(sessionId, session);
      // 初始化会话历史
      sessionHistory.set(sessionId, {
        messages: [],
        projectId: projectId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      });
      saveSessionHistory();
      console.log(`[Server] Created new session ${sessionId}`);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // 发送初始消息
    session.send({
      type: 'connected',
      sessionId
    });

    // 只在新会话时启动 Claude 进程
    if (!session.claudeProcess) {
      setTimeout(() => {
        session.start();
      }, 500);
    }

    req.on('close', () => {
      console.log(`[Session ${sessionId}] Client disconnected`);

      // 检查配置：是否在后台继续运行
      if (config.server.keepRunningInBackground && session.claudeProcess) {
        console.log(`[Session ${sessionId}] Moving session to background (Claude process continues running)`);
        sessions.delete(sessionId);
        backgroundSessions.set(sessionId, session);
      } else {
        // 停止会话和进程
        console.log(`[Session ${sessionId}] Stopping session`);
        session.stop();
        sessions.delete(sessionId);
      }
    });

    return;
  }

  // POST /api/message
  if (url.pathname === '/api/message' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionId, message } = JSON.parse(body);
        let session = sessions.get(sessionId);

        // 如果活跃会话中找不到，检查后台会话
        if (!session && backgroundSessions.has(sessionId)) {
          console.log(`[Server] Found session ${sessionId} in background, moving to active`);
          session = backgroundSessions.get(sessionId);
          backgroundSessions.delete(sessionId);
          sessions.set(sessionId, session);
        }

        // 如果还是找不到，检查会话历史记录（会话已创建但 SSE 未连接）
        if (!session && sessionHistory.has(sessionId)) {
          console.log(`[Server] Session ${sessionId} exists in history but no SSE connection, creating session`);
          const historyData = sessionHistory.get(sessionId);

          // 创建一个没有 SSE response 的会话（用于纯消息发送）
          session = new ClaudeSession(sessionId, null, historyData.messages, historyData.projectId);
          sessions.set(sessionId, session);

          // 立即启动 Claude 进程
          console.log(`[Server] Starting Claude process for session ${sessionId}`);
          session.start();
        }

        if (session) {
          // 转换消息格式为 Claude 二进制文件期望的格式
          const claudeMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: message.content || message.prompt || ''
            }
          };
          session.sendMessage(claudeMessage);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

function getContentType(ext) {
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
  };
  return types[ext] || 'application/octet-stream';
}

server.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║   Claude Code Standalone Server                       ║
║   🚀 Server: http://${HOST}:${PORT}                      ║
║   💬 Chat: http://${HOST}:${PORT}/chat.html              ║
║   📡 SSE: http://${HOST}:${PORT}/api/stream              ║
╠═══════════════════════════════════════════════════════╣
║   Configuration:                                       ║
║   📁 Config: ${CONFIG_PATH}              ║
║   ✅ Config exists: ${fs.existsSync(CONFIG_PATH)}                          ║
║   🔑 API Key: ${getApiKey() ? '已配置' : '未配置'}                        ║
║   🌐 Base URL: ${getBaseUrl()}   ║
║   ⏱️  Timeout: ${config.env.API_TIMEOUT_MS}ms                    ║
║   🔧 Claude Binary: ${CLAUDE_BINARY}           ║
╠═══════════════════════════════════════════════════════╣
║   Permissions: ${config.permissions.defaultMode}                    ║
║   Plugins: ${Object.keys(config.enabledPlugins).length} enabled           ║
║   Sessions: ${sessions.size}                                ║
╚═══════════════════════════════════════════════════════╝
  `);
});
