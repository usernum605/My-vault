---
links pages:
  - "[[Ai Assistant]]"
  - "[[Obsidian Ai Assistant]]"
---
const { Plugin, ItemView, Modal, Notice, MarkdownView, MarkdownRenderer } = require('obsidian');

const VIEW_TYPE = 'ai-sidebar';

const DEFAULT_SETTINGS = {
  baseUrl: "http://127.0.0.1:11434",
  localModel: "llama2",
  localEndpoint: "/v1/chat/completions",
  temperature: 0.7,
  max_tokens: 2048,
  autoCheckHealth: true,
  timeoutMs: 120000,
  showTokenCounter: true,
  shortcuts: {
    newConversation: 'Ctrl+Shift+N',
    saveConversation: 'Ctrl+Shift+S',
    settings: 'Ctrl+Shift+P',
    askSelection: 'Ctrl+Shift+A',
    editSelection: 'Ctrl+Shift+E'
  },
  conversationsFolder: "AI Conversations",
  currentMode: 'local',
  cloudApiType: 'openai',
  openaiApiKey: "",
  openaiModel: "gpt-3.5-turbo",
  openaiEndpoint: "https://api.openai.com/v1/chat/completions",
  geminiApiKey: "",
  geminiModel: "gemini-1.5-flash",
  geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  anthropicApiKey: "",
  anthropicModel: "claude-3-haiku-20240307",
  anthropicEndpoint: "https://api.anthropic.com/v1/messages",
  customApiKey: "",
  customModel: "",
  customEndpoint: "",
  customHeaders: "{}",
  customBodyTemplate: '{"messages": {{messages}}, "model": "{{model}}"}'
};

// ==================== UTILITY FUNCTIONS ====================

function trimContent(text, maxChars = 4000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[Content truncated automatically...]";
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ==================== CUSTOM ERROR CLASSES ====================

class NetworkError extends Error {
  constructor(statusCode, message, statusText) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
    this.statusText = statusText;
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class StreamingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StreamingError';
  }
}

class AuthenticationError extends Error {
  constructor(message, provider) {
    super(message);
    this.name = 'AuthenticationError';
    this.provider = provider;
  }
}

class RateLimitError extends Error {
  constructor(message, provider, retryAfter) {
    super(message);
    this.name = 'RateLimitError';
    this.provider = provider;
    this.retryAfter = retryAfter;
  }
}

// ==================== NETWORK MANAGER ====================

class NetworkManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.abortControllers = new Map();
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.connectionPool = new Map();
  }

  async fetchWithRetry(url, options, requestId = null) {
    const controller = new AbortController();
    if (requestId) {
      this.abortControllers.set(requestId, controller);
    }

    const timeoutMs = options.timeout || this.plugin.settings.timeoutMs || 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          cache: 'no-cache',
          credentials: 'omit',
          mode: 'cors'
        });

        if (!response.ok) {
          const errorText = await response.text();
          
          if (response.status === 401 || response.status === 403) {
            throw new AuthenticationError(`Authentication failed: ${response.status}`, url);
          } else if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 60;
            throw new RateLimitError(`Rate limit exceeded`, url, parseInt(retryAfter));
          } else {
            throw new NetworkError(response.status, errorText, response.statusText);
          }
        }

        clearTimeout(timeoutId);
        if (requestId) {
          this.abortControllers.delete(requestId);
        }

        return response;
      } catch (error) {
        lastError = error;
        
        if (error.name === 'AbortError') {
          clearTimeout(timeoutId);
          throw new TimeoutError(`Request timeout after ${timeoutMs}ms`);
        }

        if (error instanceof AuthenticationError || error instanceof RateLimitError) {
          throw error;
        }

        if (this.shouldRetry(error, attempt)) {
          const delay = this.calculateBackoff(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        break;
      }
    }

    clearTimeout(timeoutId);
    if (requestId) {
      this.abortControllers.delete(requestId);
    }

    throw this.normalizeError(lastError);
  }

  shouldRetry(error, attempt) {
    if (attempt >= this.maxRetries) return false;
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return true;
    }
    
    if (error.name === 'NetworkError') {
      return [408, 429, 500, 502, 503, 504].includes(error.statusCode);
    }
    
    return false;
  }

  calculateBackoff(attempt) {
    return Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 100, 30000);
  }

  normalizeError(error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return new NetworkError(0, 'Network connection failed. Please check your internet connection and ensure the AI service is running.', 'NETWORK_ERROR');
    }
    return error;
  }

  abortRequest(requestId) {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  abortAllRequests() {
    this.abortControllers.forEach(controller => controller.abort());
    this.abortControllers.clear();
  }
}

// ==================== STREAMING HANDLER ====================

class StreamingHandler {
  constructor() {
    this.buffer = '';
    this.chunkProcessors = new Map();
    
    this.registerChunkProcessor('openai', this.processOpenAIChunk.bind(this));
    this.registerChunkProcessor('local', this.processLocalChunk.bind(this));
    this.registerChunkProcessor('anthropic', this.processAnthropicChunk.bind(this));
    this.registerChunkProcessor('gemini', this.processGeminiChunk.bind(this));
    this.registerChunkProcessor('generic', this.processGenericChunk.bind(this));
  }

  registerChunkProcessor(provider, processor) {
    this.chunkProcessors.set(provider, processor);
  }

  async handleStreamingResponse(response, onChunk, provider = 'local') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const processor = this.chunkProcessors.get(provider) || this.processGenericChunk;
    
    let accumulatedText = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          const text = processor(line);
          if (text) {
            accumulatedText += text;
            onChunk(text);
          }
        }
      }

      if (buffer.trim()) {
        const text = processor(buffer);
        if (text) {
          accumulatedText += text;
          onChunk(text);
        }
      }

      return accumulatedText;
    } catch (error) {
      console.error('Streaming error:', error);
      throw new StreamingError('Stream interrupted: ' + error.message);
    }
  }

  processLocalChunk(line) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') return '';
      
      try {
        const parsed = JSON.parse(data);
        if (parsed.message?.content) {
          return parsed.message.content;
        }
        if (parsed.choices?.[0]?.delta?.content) {
          return parsed.choices[0].delta.content;
        }
        if (parsed.response) {
          return parsed.response;
        }
        if (parsed.content) {
          return parsed.content;
        }
      } catch (e) {
        return data;
      }
    }
    
    try {
      const parsed = JSON.parse(line);
      if (parsed.message?.content) return parsed.message.content;
      if (parsed.response) return parsed.response;
      if (parsed.content) return parsed.content;
    } catch {
      if (!line.startsWith('{') && !line.startsWith('[') && line.length > 0) {
        return line;
      }
    }
    
    return '';
  }

  processOpenAIChunk(line) {
    if (!line.startsWith('data: ')) return '';
    const data = line.slice(6);
    if (data === '[DONE]') return '';
    
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || '';
    } catch {
      return '';
    }
  }

  processAnthropicChunk(line) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }
    } catch {
      const match = line.match(/"text":"([^"]+)"/);
      return match ? match[1] : '';
    }
    return '';
  }

  processGeminiChunk(line) {
    try {
      const parsed = JSON.parse(line);
      return parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      return '';
    }
  }

  processGenericChunk(line) {
    try {
      const parsed = JSON.parse(line);
      return parsed.content || 
             parsed.text || 
             parsed.response || 
             parsed.message?.content ||
             parsed.choices?.[0]?.text ||
             parsed.choices?.[0]?.delta?.content ||
             parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
             '';
    } catch {
      return line.length > 0 && !line.startsWith('{') ? line : '';
    }
  }
}

// ==================== SESSION MANAGER ====================

class SessionManager {
  constructor(saved = []) {
    this.sessions = (saved && saved.length) ? saved : [];
    this.activeId = (this.sessions[0] && this.sessions[0].id) || null;
  }
  
  create(name = null, sys = "") {
    const id = Date.now().toString();
    const session = { 
      id, 
      name: name || `Session ${this.sessions.length + 1}`, 
      systemPrompt: sys || "", 
      messages: [] 
    };
    this.sessions.push(session);
    this.activeId = id;
    return session;
  }
  
  delete(id) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    if (this.activeId === id) {
      this.activeId = (this.sessions[0] && this.sessions[0].id) || null;
    }
  }
  
  switchTo(id) {
    if (this.sessions.find(s => s.id === id)) this.activeId = id;
  }
  
  getActive() { 
    return this.sessions.find(s => s.id === this.activeId) || null; 
  }
  
  addMessage(role, content, attachments = []) {
    const s = this.getActive();
    if (!s) return;
    s.messages.push({ 
      role, 
      content,
      attachments: attachments || [],
      timestamp: Date.now()
    });
  }
  
  getMessagesForRequest(maxMessages = 10) {
    const s = this.getActive();
    if (!s) return [];
    const out = [];
    if (s.systemPrompt && s.systemPrompt.trim()) {
      out.push({ 
        role: "system", 
        content: s.systemPrompt 
      });
    }
    const recent = s.messages.slice(-maxMessages);
    
    return out.concat(recent.map(msg => {
      let fullContent = msg.content;
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(attachment => {
          fullContent += `\n\n[File content: ${attachment.name}]\n${attachment.content}`;
        });
      }
      return {
        role: msg.role,
        content: fullContent
      };
    }));
  }

  exportToMarkdown(session) {
    let content = `# ${session.name}\n\n`;
    content += `**Created:** ${new Date(parseInt(session.id)).toLocaleString()}\n\n`;
    content += `**Messages:** ${session.messages.length}\n\n`;
    
    if (session.systemPrompt) {
      content += `## System Prompt\n${session.systemPrompt}\n\n---\n\n`;
    }
    
    session.messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      content += `### ${role} (Message ${index + 1}) ${time ? '- ' + time : ''}\n\n`;
      
      if (msg.attachments && msg.attachments.length > 0) {
        content += `**Attachments:**\n`;
        msg.attachments.forEach(attachment => {
          content += `- 📄 **${attachment.name}**\n`;
        });
        content += `\n`;
      }
      
      content += `${msg.content}\n\n---\n\n`;
    });
    
    return content;
  }
}

// ==================== BASE AI PROVIDER ====================

class BaseAIProvider {
  constructor(plugin, providerName) {
    this.plugin = plugin;
    this.name = providerName;
    this.networkManager = new NetworkManager(plugin);
    this.streamingHandler = new StreamingHandler();
  }

  async send(payload, opts = {}) {
    const requestId = this.generateRequestId();
    
    try {
      const url = this.buildUrl(payload);
      const headers = this.buildHeaders();
      const body = this.buildBody(payload);
      
      if (payload.stream && this.supportsStreaming()) {
        return await this.sendStreamingRequest(url, headers, body, opts, requestId);
      } else {
        return await this.sendNormalRequest(url, headers, body, opts, requestId);
      }
    } catch (error) {
      return this.handleError(error);
    } finally {
      if (requestId) {
        this.networkManager.abortRequest(requestId);
      }
    }
  }

  supportsStreaming() {
    return true;
  }

  async sendStreamingRequest(url, headers, body, opts, requestId) {
    const response = await this.networkManager.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body,
      timeout: opts.timeoutMs
    }, requestId);

    const accumulatedText = await this.streamingHandler.handleStreamingResponse(
      response,
      opts.onChunk || (() => {}),
      this.getStreamingFormat()
    );

    return { final: accumulatedText };
  }

  async sendNormalRequest(url, headers, body, opts, requestId) {
    const response = await this.networkManager.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body,
      timeout: opts.timeoutMs
    }, requestId);

    const data = await response.json();
    return this.parseResponse(data);
  }

  generateRequestId() {
    return `${this.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  handleError(error) {
    console.error(`${this.name} error:`, error);
    
    if (error instanceof AuthenticationError) {
      throw new Error(`🔐 ${this.name} authentication failed. Please check your API key in settings.`);
    }
    
    if (error instanceof RateLimitError) {
      throw new Error(`⏳ ${this.name} rate limit exceeded. Please wait ${error.retryAfter} seconds and try again.`);
    }
    
    if (error instanceof NetworkError) {
      if (error.statusCode === 0) {
        throw new Error(`🌐 Cannot connect to ${this.name}. Please check if the service is running and accessible.`);
      }
      if (error.statusCode === 404) {
        throw new Error(`🔍 ${this.name} endpoint not found. Please check your URL configuration.`);
      }
      throw new Error(`🌐 ${this.name} network error (${error.statusCode}): ${error.message}`);
    }
    
    if (error instanceof TimeoutError) {
      throw new Error(`⏱️ ${this.name} request timed out. The service might be slow or unresponsive.`);
    }
    
    if (error instanceof StreamingError) {
      throw new Error(`📡 Streaming error with ${this.name}: ${error.message}`);
    }
    
    throw new Error(`${this.name} error: ${error.message}`);
  }

  buildUrl(payload) { throw new Error('Not implemented'); }
  buildHeaders() { throw new Error('Not implemented'); }
  buildBody(payload) { throw new Error('Not implemented'); }
  parseResponse(data) { throw new Error('Not implemented'); }
  getStreamingFormat() { return 'generic'; }
}

// ==================== LOCAL AI PROVIDER ====================

class LocalAIProvider extends BaseAIProvider {
  constructor(plugin) {
    super(plugin, 'LocalAI');
  }

  buildUrl(payload) {
    const base = this.plugin.settings.baseUrl.replace(/\/$/, "");
    const endpoint = this.plugin.settings.localEndpoint || '/v1/chat/completions';
    return base + endpoint;
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*'
    };
  }

  buildBody(payload) {
    const body = {
      model: this.plugin.settings.localModel,
      messages: payload.messages,
      temperature: payload.temperature || this.plugin.settings.temperature,
      max_tokens: payload.max_tokens || this.plugin.settings.max_tokens
    };

    if (payload.stream) {
      body.stream = true;
    }

    return JSON.stringify(body);
  }

  parseResponse(data) {
    if (data.choices && data.choices[0]) {
      if (data.choices[0].message) {
        return { final: data.choices[0].message.content };
      }
      if (data.choices[0].text) {
        return { final: data.choices[0].text };
      }
    }
    
    if (data.message) {
      return { final: data.message.content };
    }
    
    if (data.response) {
      return { final: data.response };
    }
    
    return { final: JSON.stringify(data) };
  }

  getStreamingFormat() {
    return 'local';
  }

  async checkHealth() {
    try {
      const base = this.plugin.settings.baseUrl.replace(/\/$/, "");
      
      const endpoints = ['/health', '/api/health', '/v1/health', '/'];
      
      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch(base + endpoint, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            try {
              const data = await response.json();
              if (data && (data.status === 'ok' || data.status === 'healthy' || data.ready === true)) {
                return { ok: true, message: '✅ Service is healthy' };
              }
            } catch {
              return { ok: true, message: '✅ Service is reachable' };
            }
          }
        } catch {
          continue;
        }
      }
      
      try {
        const testResponse = await this.send({
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
          stream: false
        }, { timeoutMs: 5000 });
        
        if (testResponse && testResponse.final) {
          return { ok: true, message: '✅ Service is responding' };
        }
      } catch {
        // Ignore
      }
      
      return { ok: false, message: '❌ Local AI service is not reachable' };
    } catch (error) {
      return { ok: false, message: `❌ ${error.message}` };
    }
  }
}

// ==================== OPENAI PROVIDER ====================

class OpenAIProvider extends BaseAIProvider {
  constructor(plugin) {
    super(plugin, 'OpenAI');
  }

  buildUrl(payload) {
    return this.plugin.settings.openaiEndpoint || "https://api.openai.com/v1/chat/completions";
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.plugin.settings.openaiApiKey}`
    };
  }

  buildBody(payload) {
    const body = {
      model: this.plugin.settings.openaiModel || "gpt-3.5-turbo",
      messages: payload.messages,
      temperature: payload.temperature || this.plugin.settings.temperature,
      max_tokens: payload.max_tokens || this.plugin.settings.max_tokens
    };

    if (payload.stream) {
      body.stream = true;
    }

    return JSON.stringify(body);
  }

  parseResponse(data) {
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return { final: data.choices[0].message.content };
    }
    return { final: JSON.stringify(data) };
  }

  getStreamingFormat() {
    return 'openai';
  }

  async checkHealth() {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { 'Authorization': `Bearer ${this.plugin.settings.openaiApiKey}` },
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.status === 401) {
        return { ok: false, message: '❌ Invalid API key' };
      }
      
      return { ok: response.ok, message: response.ok ? '✅ Connected to OpenAI' : `❌ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `❌ ${e.message}` };
    }
  }
}

// ==================== GEMINI PROVIDER (NON-STREAMING) ====================

class GeminiProvider extends BaseAIProvider {
  constructor(plugin) {
    super(plugin, 'Gemini');
    this.lastRequestTime = 0;
    this.minDelay = 2000;
  }

  supportsStreaming() {
    return false;
  }

  async send(payload, opts) {
    await this.throttleRequests();
    return super.send(payload, opts);
  }

  buildUrl(payload) {
    const modelName = this.plugin.settings.geminiModel || "gemini-1.5-flash";
    return `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.plugin.settings.geminiApiKey}`;
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json'
    };
  }

  buildBody(payload) {
    const contents = this.convertToGeminiFormat(payload.messages);
    
    return JSON.stringify({
      contents: contents,
      generationConfig: {
        temperature: payload.temperature || this.plugin.settings.temperature,
        maxOutputTokens: payload.max_tokens || this.plugin.settings.max_tokens,
        topP: 0.8,
        topK: 40
      }
    });
  }

  parseResponse(data) {
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return { final: data.candidates[0].content.parts[0].text };
    }
    return { final: JSON.stringify(data) };
  }

  async throttleRequests() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minDelay) {
      const delay = this.minDelay - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  convertToGeminiFormat(messages) {
    const contents = [];
    let systemPrompt = '';
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        const content = systemPrompt ? `[System: ${systemPrompt}]\n\n${msg.content}` : msg.content;
        contents.push({
          role: 'user',
          parts: [{ text: content }]
        });
        systemPrompt = '';
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content }]
        });
      }
    }
    
    return contents;
  }

  async checkHealth() {
    try {
      const modelName = this.plugin.settings.geminiModel || "gemini-1.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}?key=${this.plugin.settings.geminiApiKey}`;
      
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.status === 403 || response.status === 401) {
        return { ok: false, message: '❌ Invalid API key' };
      }
      
      if (response.status === 429) {
        return { ok: false, message: '⏳ Rate limit exceeded. Please wait.' };
      }
      
      return { ok: response.ok, message: response.ok ? '✅ Connected to Gemini' : `❌ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `❌ ${e.message}` };
    }
  }
}

// ==================== ANTHROPIC PROVIDER ====================

class AnthropicProvider extends BaseAIProvider {
  constructor(plugin) {
    super(plugin, 'Anthropic');
  }

  buildUrl(payload) {
    return this.plugin.settings.anthropicEndpoint || "https://api.anthropic.com/v1/messages";
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.plugin.settings.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    };
  }

  buildBody(payload) {
    const body = {
      model: this.plugin.settings.anthropicModel || "claude-3-haiku-20240307",
      messages: payload.messages.filter(m => m.role !== 'system'),
      temperature: payload.temperature || this.plugin.settings.temperature,
      max_tokens: payload.max_tokens || this.plugin.settings.max_tokens
    };

    const systemMessage = payload.messages.find(m => m.role === 'system');
    if (systemMessage) {
      body.system = systemMessage.content;
    }

    if (payload.stream) {
      body.stream = true;
    }

    return JSON.stringify(body);
  }

  parseResponse(data) {
    if (data.content && data.content[0] && data.content[0].text) {
      return { final: data.content[0].text };
    }
    return { final: JSON.stringify(data) };
  }

  getStreamingFormat() {
    return 'anthropic';
  }

  async checkHealth() {
    try {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        method: 'GET',
        headers: { 'x-api-key': this.plugin.settings.anthropicApiKey },
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.status === 401) {
        return { ok: false, message: '❌ Invalid API key' };
      }
      
      return { ok: response.ok, message: response.ok ? '✅ Connected to Anthropic' : `❌ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `❌ ${e.message}` };
    }
  }
}

// ==================== CUSTOM PROVIDER ====================

class CustomProvider extends BaseAIProvider {
  constructor(plugin) {
    super(plugin, 'Custom API');
  }

  buildUrl(payload) {
    return this.plugin.settings.customEndpoint;
  }

  buildHeaders() {
    let headers = { 'Content-Type': 'application/json' };
    
    try {
      const customHeaders = JSON.parse(this.plugin.settings.customHeaders || '{}');
      headers = { ...headers, ...customHeaders };
    } catch (e) {
      if (this.plugin.settings.customApiKey) {
        headers['Authorization'] = `Bearer ${this.plugin.settings.customApiKey}`;
      }
    }
    
    return headers;
  }

  buildBody(payload) {
    let bodyData = {
      model: this.plugin.settings.customModel,
      messages: payload.messages,
      temperature: payload.temperature || this.plugin.settings.temperature || 0.7,
      max_tokens: payload.max_tokens || this.plugin.settings.max_tokens || 2048
    };

    try {
      if (this.plugin.settings.customBodyTemplate && this.plugin.settings.customBodyTemplate.includes('{{')) {
        let bodyStr = this.plugin.settings.customBodyTemplate
          .replace('{{model}}', JSON.stringify(this.plugin.settings.customModel))
          .replace('{{messages}}', JSON.stringify(payload.messages))
          .replace('{{temperature}}', (payload.temperature || this.plugin.settings.temperature || 0.7).toString())
          .replace('{{max_tokens}}', (payload.max_tokens || this.plugin.settings.max_tokens || 2048).toString());
        bodyData = JSON.parse(bodyStr);
      }
    } catch (e) {
      console.log("Using default body template");
    }

    return JSON.stringify(bodyData);
  }

  parseResponse(data) {
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return { final: data.choices[0].message.content };
    } else if (data.choices && data.choices[0] && data.choices[0].text) {
      return { final: data.choices[0].text };
    } else if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return { final: data.candidates[0].content.parts[0].text };
    } else if (data.message && data.message.content) {
      return { final: data.message.content };
    } else if (data.result) {
      return { final: data.result };
    } else if (data.content) {
      return { final: data.content };
    } else {
      return { final: JSON.stringify(data) };
    }
  }

  getStreamingFormat() {
    return 'generic';
  }

  async checkHealth() {
    try {
      const testResponse = await this.send({
        messages: [{ role: "user", content: "Say 'OK' in one word" }],
        temperature: 0.7,
        max_tokens: 10
      }, { timeoutMs: 15000 });
      
      return { 
        ok: true, 
        message: `✅ Connection successful. Response: "${testResponse.final.substring(0, 50)}..."` 
      };
    } catch (error) {
      return { 
        ok: false, 
        message: `❌ ${error.message}` 
      };
    }
  }
}

// ==================== API MANAGER ====================

class APIManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.providers = {
      openai: new OpenAIProvider(plugin),
      gemini: new GeminiProvider(plugin),
      anthropic: new AnthropicProvider(plugin),
      custom: new CustomProvider(plugin),
      local: new LocalAIProvider(plugin)
    };
  }
  
  async sendMessage(payload, opts = {}) {
    const mode = this.plugin.settings.currentMode;
    const apiType = mode === 'cloud' ? this.plugin.settings.cloudApiType : 'local';
    
    const provider = this.providers[apiType];
    if (!provider) {
      throw new Error(`Unknown API provider: ${apiType}`);
    }
    
    return await provider.send(payload, opts);
  }
  
  async checkHealth() {
    const mode = this.plugin.settings.currentMode;
    const apiType = mode === 'cloud' ? this.plugin.settings.cloudApiType : 'local';
    
    const provider = this.providers[apiType];
    return provider ? await provider.checkHealth() : { ok: false, message: 'No provider selected' };
  }

  getCurrentProviderName() {
    const mode = this.plugin.settings.currentMode;
    if (mode === 'local') return 'Local AI';
    
    const names = {
      openai: 'OpenAI',
      gemini: 'Gemini',
      anthropic: 'Claude',
      custom: 'Custom API'
    };
    return names[this.plugin.settings.cloudApiType] || 'Cloud AI';
  }

  getCurrentProviderIcon() {
    if (this.plugin.settings.currentMode === 'local') return '🖥️';
    
    const icons = {
      openai: '🎡',
      gemini: '🌀',
      anthropic: '☁️',
      custom: '⚙️'
    };
    return icons[this.plugin.settings.cloudApiType] || '☁️';
  }
}

// ==================== PROMPT MODAL ====================

class PromptModal extends Modal {
  constructor(app, title = "Prompt", initial = "", onSubmit) {
    super(app);
    this.title = title;
    this.initial = initial;
    this.onSubmit = onSubmit;
  }
  
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h3', { text: this.title, cls: 'ai-modal-title' });
    
    this.ta = contentEl.createEl('textarea', {
      cls: 'ai-modal-textarea',
      attr: {
        placeholder: 'Type your prompt here...'
      }
    });
    this.ta.style.width = '100%';
    this.ta.style.height = '160px';
    this.ta.style.padding = '12px';
    this.ta.style.borderRadius = '8px';
    this.ta.style.border = '1px solid var(--background-modifier-border)';
    this.ta.style.backgroundColor = 'var(--background-primary)';
    this.ta.style.color = 'var(--text-normal)';
    this.ta.style.fontSize = '14px';
    this.ta.style.fontFamily = 'inherit';
    this.ta.style.resize = 'vertical';
    this.ta.value = this.initial;
    
    const row = contentEl.createEl('div', { cls: 'ai-modal-btn-row' });
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '10px';
    row.style.marginTop = '16px';
    
    const send = row.createEl('button', { 
      text: 'Send',
      cls: 'ai-modal-send-btn'
    });
    send.style.padding = '8px 24px';
    send.style.borderRadius = '6px';
    send.style.border = 'none';
    send.style.backgroundColor = 'var(--interactive-accent)';
    send.style.color = 'var(--text-on-accent)';
    send.style.cursor = 'pointer';
    send.style.fontSize = '14px';
    send.style.fontWeight = '600';
    
    const cancel = row.createEl('button', { 
      text: 'Cancel',
      cls: 'ai-modal-cancel-btn'
    });
    cancel.style.padding = '8px 24px';
    cancel.style.borderRadius = '6px';
    cancel.style.border = '1px solid var(--background-modifier-border)';
    cancel.style.backgroundColor = 'transparent';
    cancel.style.color = 'var(--text-normal)';
    cancel.style.cursor = 'pointer';
    cancel.style.fontSize = '14px';
    
    send.addEventListener('click', () => {
      const v = this.ta.value.trim();
      if (!v) { 
        new Notice("Prompt cannot be empty"); 
        return; 
      }
      this.onSubmit(v);
      this.close();
    });
    
    cancel.addEventListener('click', () => this.close());
    
    this.ta.focus();
  }
  
  onClose() { 
    this.contentEl.empty(); 
  }
}

// ==================== ATTACH MODAL ====================

class AttachModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
    this.selected = new Set();
    this.searchTerm = '';
    this.selectedFiles = [];
  }
  
  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    const title = contentEl.createEl('h2', { 
      text: '📎 Attach Files',
      cls: 'ai-attach-title'
    });
    title.style.textAlign = 'center';
    title.style.margin = '0 0 20px 0';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';
    
    const searchRow = contentEl.createDiv({ cls: 'ai-search-row' });
    const searchInput = searchRow.createEl('input', {
      type: 'text',
      placeholder: '🔍 Search files...'
    });
    searchInput.style.width = '100%';
    searchInput.style.padding = '10px 14px';
    searchInput.style.borderRadius = '8px';
    searchInput.style.border = '1px solid var(--background-modifier-border)';
    searchInput.style.backgroundColor = 'var(--background-secondary)';
    searchInput.style.color = 'var(--text-normal)';
    searchInput.style.fontSize = '14px';
    searchInput.style.marginBottom = '16px';
    
    const container = contentEl.createDiv({ cls: 'ai-file-list-container' });
    container.style.maxHeight = '300px';
    container.style.overflowY = 'auto';
    container.style.border = '1px solid var(--background-modifier-border)';
    container.style.borderRadius = '8px';
    container.style.padding = '8px';
    container.style.backgroundColor = 'var(--background-secondary)';
    container.style.marginBottom = '16px';
    
    const buttonRow = contentEl.createDiv({ cls: 'ai-attach-btn-row' });
    buttonRow.style.display = 'flex';
    buttonRow.style.justifyContent = 'center';
    buttonRow.style.gap = '12px';
    buttonRow.style.marginTop = '20px';
    
    const sendSel = buttonRow.createEl('button', { 
      text: '📎 Attach Selected',
      cls: 'ai-attach-send-btn'
    });
    sendSel.style.padding = '10px 24px';
    sendSel.style.borderRadius = '8px';
    sendSel.style.border = 'none';
    sendSel.style.backgroundColor = 'var(--interactive-accent)';
    sendSel.style.color = 'var(--text-on-accent)';
    sendSel.style.cursor = 'pointer';
    sendSel.style.fontSize = '14px';
    sendSel.style.fontWeight = '600';
    sendSel.style.minWidth = '140px';
    
    const cancel = buttonRow.createEl('button', { 
      text: 'Cancel',
      cls: 'ai-attach-cancel-btn'
    });
    cancel.style.padding = '10px 24px';
    cancel.style.borderRadius = '8px';
    cancel.style.border = '1px solid var(--background-modifier-border)';
    cancel.style.backgroundColor = 'transparent';
    cancel.style.color = 'var(--text-normal)';
    cancel.style.cursor = 'pointer';
    cancel.style.fontSize = '14px';
    cancel.style.minWidth = '140px';
    
    sendSel.addEventListener('click', async () => {
      const files = this.app.vault.getMarkdownFiles();
      const picked = files.filter(f => this.selected.has(f.path));
      if (picked.length === 0) {
        new Notice('No files selected');
        return;
      }
      
      this.selectedFiles = picked;
      this.onSubmit('files', picked);
      this.close();
    });
    
    cancel.addEventListener('click', () => this.close());
    
    const renderFiles = () => {
      container.empty();
      const files = this.app.vault.getMarkdownFiles();
      let filteredFiles = files;
      
      if (this.searchTerm.trim()) {
        const term = this.searchTerm.toLowerCase();
        filteredFiles = files.filter(f => 
          f.path.toLowerCase().includes(term) ||
          f.basename.toLowerCase().includes(term)
        );
      }
      
      if (filteredFiles.length === 0) {
        const emptyMsg = container.createDiv({ 
          cls: 'ai-empty-files',
          text: this.searchTerm.trim() ? 
            'No files match your search' : 
            'No markdown files found'
        });
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.padding = '40px 20px';
        emptyMsg.style.color = 'var(--text-muted)';
        emptyMsg.style.fontSize = '14px';
        return;
      }
      
      filteredFiles.forEach((f) => {
        const row = container.createDiv({ cls: 'ai-file-row' });
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.padding = '10px 12px';
        row.style.borderRadius = '6px';
        row.style.marginBottom = '6px';
        row.style.backgroundColor = 'var(--background-primary)';
        row.style.border = '1px solid var(--background-modifier-border)';
        row.style.cursor = 'pointer';
        
        const checkboxContainer = row.createDiv({ cls: 'ai-checkbox-container' });
        checkboxContainer.style.marginLeft = '12px';
        checkboxContainer.style.flexShrink = '0';
        
        const cb = checkboxContainer.createEl('input', { 
          type: 'checkbox',
          cls: 'ai-file-checkbox'
        });
        cb.style.width = '18px';
        cb.style.height = '18px';
        cb.style.cursor = 'pointer';
        cb.checked = this.selected.has(f.path);
        
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          if (e.target.checked) {
            this.selected.add(f.path);
          } else {
            this.selected.delete(f.path);
          }
        });
        
        const fileInfo = row.createDiv({ cls: 'ai-file-info' });
        fileInfo.style.flex = '1';
        fileInfo.style.minWidth = '0';
        
        const fileName = fileInfo.createEl('div', { 
          text: f.basename,
          cls: 'ai-file-name'
        });
        fileName.style.fontWeight = '600';
        fileName.style.fontSize = '14px';
        fileName.style.color = 'var(--text-normal)';
        fileName.style.marginBottom = '2px';
        fileName.style.whiteSpace = 'nowrap';
        fileName.style.overflow = 'hidden';
        fileName.style.textOverflow = 'ellipsis';
        
        const filePath = fileInfo.createEl('div', { 
          text: f.path,
          cls: 'ai-file-path'
        });
        filePath.style.fontSize = '12px';
        filePath.style.color = 'var(--text-muted)';
        filePath.style.whiteSpace = 'nowrap';
        filePath.style.overflow = 'hidden';
        filePath.style.textOverflow = 'ellipsis';
        
        row.addEventListener('click', (e) => {
          if (e.target.type !== 'checkbox') {
            cb.checked = !cb.checked;
            const event = new Event('change', { bubbles: true });
            cb.dispatchEvent(event);
          }
        });
      });
    };
    
    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      renderFiles();
    });
    
    renderFiles();
  }
  
  onClose() { 
    this.contentEl.empty(); 
  }
}

// ==================== IN-NOTE AI INTERACTIONS ====================

class InNoteAIInteractions {
  constructor(plugin) {
    this.plugin = plugin;
    this.floatingMenu = null;
    this.registerContextMenu();
    this.registerFloatingMenu();
    this.registerKeyboardShortcuts();
  }

  registerContextMenu() {
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('editor-menu', (menu, editor, view) => {
        const selection = editor.getSelection();
        
        if (selection && selection.trim().length > 0) {
          menu.addSeparator();
          
          menu.addItem((item) => {
            item.setTitle('🤖 AI: Ask about selection')
                .setIcon('brain')
                .onClick(() => this.askAboutSelection(editor, selection));
          });

          menu.addItem((item) => {
            item.setTitle('✏️ AI: Edit/Improve selection')
                .setIcon('pencil')
                .onClick(() => this.editSelection(editor, selection));
          });

          menu.addItem((item) => {
            item.setTitle('📝 AI: Continue writing')
                .setIcon('quote')
                .onClick(() => this.continueWriting(editor, selection));
          });

          menu.addItem((item) => {
            item.setTitle('🌐 AI: Translate selection')
                .setIcon('languages')
                .onClick(() => this.translateSelection(editor, selection));
          });

          const submenu = menu.addItem((item) => {
            item.setTitle('🤖 AI: More options...')
                .setIcon('chevron-down');
          });

          submenu.setSubmenu((submenu) => {
            this.addMoreAIOptions(submenu, editor, selection);
          });
        }
      })
    );
  }

  registerFloatingMenu() {
    let timeoutId = null;
    
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('editor-change', (editor) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        timeoutId = setTimeout(() => {
          const selection = editor.getSelection();
          if (selection && selection.trim().length > 20) {
            this.showFloatingMenu(editor);
          } else {
            this.hideFloatingMenu();
          }
        }, 500);
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.workspace.on('click', () => {
        this.hideFloatingMenu();
      })
    );
  }

  showFloatingMenu(editor) {
    this.hideFloatingMenu();

    const cursor = editor.getCursor('from');
    const coords = editor.charCoords(cursor, 'screen');
    
    const menu = document.createElement('div');
    menu.className = 'ai-floating-menu';
    menu.style.position = 'fixed';
    menu.style.top = (coords.top - 50) + 'px';
    menu.style.left = coords.left + 'px';
    menu.style.zIndex = '1000';
    menu.style.display = 'flex';
    menu.style.gap = '8px';
    menu.style.padding = '8px';
    menu.style.background = 'var(--background-primary)';
    menu.style.border = '1px solid var(--background-modifier-border)';
    menu.style.borderRadius = '30px';
    menu.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
    menu.style.backdropFilter = 'blur(10px)';
    menu.style.animation = 'ai-float-in 0.2s ease';
    
    const buttons = [
      { icon: '🤖', title: 'Ask AI', action: () => this.askAboutSelection(editor, editor.getSelection()) },
      { icon: '✏️', title: 'Edit', action: () => this.editSelection(editor, editor.getSelection()) },
      { icon: '📝', title: 'Continue', action: () => this.continueWriting(editor, editor.getSelection()) },
      { icon: '🌐', title: 'Translate', action: () => this.translateSelection(editor, editor.getSelection()) }
    ];

    buttons.forEach(btn => {
      const button = menu.createEl('button', {
        text: btn.icon,
        cls: 'ai-floating-btn',
        attr: { title: btn.title }
      });
      button.style.width = '36px';
      button.style.height = '36px';
      button.style.borderRadius = '50%';
      button.style.border = 'none';
      button.style.background = 'var(--interactive-accent)';
      button.style.color = 'var(--text-on-accent)';
      button.style.fontSize = '18px';
      button.style.cursor = 'pointer';
      button.style.transition = 'all 0.2s ease';
      button.style.display = 'flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      
      button.addEventListener('mouseenter', () => {
        button.style.transform = 'scale(1.1)';
        button.style.background = 'var(--interactive-accent-hover)';
      });
      
      button.addEventListener('mouseleave', () => {
        button.style.transform = 'scale(1)';
        button.style.background = 'var(--interactive-accent)';
      });
      
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.action();
        menu.remove();
      });
    });

    document.body.appendChild(menu);
    this.floatingMenu = menu;

    setTimeout(() => {
      const closeHandler = (e) => {
        if (menu && !menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  hideFloatingMenu() {
    if (this.floatingMenu) {
      this.floatingMenu.remove();
      this.floatingMenu = null;
    }
  }

  registerKeyboardShortcuts() {
    this.plugin.addCommand({
      id: 'ai-ask-selection',
      name: 'Ask AI about selected text',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'A' }],
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (selection && selection.trim().length > 0) {
          this.askAboutSelection(editor, selection);
        } else {
          new Notice('Please select some text first');
        }
      }
    });

    this.plugin.addCommand({
      id: 'ai-edit-selection',
      name: 'Edit selected text with AI',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'E' }],
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (selection && selection.trim().length > 0) {
          this.editSelection(editor, selection);
        } else {
          new Notice('Please select some text first');
        }
      }
    });

    this.plugin.addCommand({
      id: 'ai-continue-writing',
      name: 'Continue writing from cursor',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'C' }],
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const textBeforeCursor = line.substring(0, cursor.ch);
        const textAfterCursor = line.substring(cursor.ch);
        const context = textBeforeCursor + (textAfterCursor ? ' ' + textAfterCursor : '');
        
        if (context.trim().length > 0) {
          this.continueWriting(editor, context);
        } else {
          new Notice('No text context found at cursor');
        }
      }
    });
  }

  async askAboutSelection(editor, selection) {
    const prompt = await this.showPromptModal('What would you like to ask about this selection?');
    if (!prompt) return;

    const fullPrompt = `Context from my note:\n\n${selection}\n\nMy question: ${prompt}`;
    
    const cursor = editor.getCursor('to');
    editor.replaceRange('\n\n--- 🤖 AI Response ---\n\n', cursor);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
      
      editor.replaceRange('\n\n---\n\n', editor.getCursor());
    } catch (error) {
      editor.replaceRange(`\n\n❌ Error: ${error.message}\n\n`, editor.getCursor());
      new Notice('AI Error: ' + error.message);
    }
  }

  async editSelection(editor, selection) {
    const prompt = await this.showPromptModal('How would you like to edit this text? (e.g., "make it formal", "summarize", "fix grammar")');
    if (!prompt) return;

    const fullPrompt = `Original text:\n\n${selection}\n\nInstructions: ${prompt}\n\nEdited version:`;
    
    const cursor = editor.getCursor('from');
    const to = editor.getCursor('to');
    const tempCursor = { line: cursor.line, ch: cursor.ch };
    
    editor.replaceRange('⏳ Editing...', cursor, to);
    
    try {
      let fullResponse = '';
      await this.streamAIResponse(fullPrompt, (chunk) => {
        fullResponse += chunk;
        editor.replaceRange(fullResponse, tempCursor, { 
          line: tempCursor.line, 
          ch: tempCursor.ch + 1000 
        });
      });
      
      editor.replaceRange(fullResponse, tempCursor, { 
        line: tempCursor.line, 
        ch: tempCursor.ch + 1000 
      });
    } catch (error) {
      editor.replaceRange(selection, tempCursor, { 
        line: tempCursor.line, 
        ch: tempCursor.ch + 1000 
      });
      new Notice('AI Error: ' + error.message);
    }
  }

  async continueWriting(editor, context) {
    const fullPrompt = `Continue the following text naturally:\n\n${context}\n\n`;
    
    const cursor = editor.getCursor('to');
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async translateSelection(editor, selection) {
    const targetLanguage = await this.showPromptModal('Translate to which language?');
    if (!targetLanguage) return;

    const fullPrompt = `Translate the following text to ${targetLanguage}:\n\n${selection}\n\nTranslation:`;
    
    const cursor = editor.getCursor('from');
    const to = editor.getCursor('to');
    
    editor.replaceRange(`\n\n[${targetLanguage} translation]:\n`, cursor, to);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
      
      editor.replaceRange('\n\n', editor.getCursor());
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async summarizeText(editor, selection) {
    const fullPrompt = `Summarize the following text concisely:\n\n${selection}\n\nSummary:`;
    
    const cursor = editor.getCursor('to');
    editor.replaceRange('\n\n📝 Summary:\n\n', cursor);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async expandText(editor, selection) {
    const fullPrompt = `Expand and elaborate on the following text, adding more details and depth:\n\n${selection}\n\nExpanded version:`;
    
    const cursor = editor.getCursor('to');
    editor.replaceRange('\n\n🔍 Expanded:\n\n', cursor);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async generateQuestions(editor, selection) {
    const fullPrompt = `Generate 5 thoughtful questions based on this text:\n\n${selection}\n\nQuestions:`;
    
    const cursor = editor.getCursor('to');
    editor.replaceRange('\n\n❓ Questions:\n\n', cursor);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async extractKeywords(editor, selection) {
    const fullPrompt = `Extract the most important keywords and key phrases from this text:\n\n${selection}\n\nKeywords:`;
    
    const cursor = editor.getCursor('to');
    editor.replaceRange('\n\n🔑 Keywords:\n\n', cursor);
    
    try {
      await this.streamAIResponse(fullPrompt, (chunk) => {
        editor.replaceRange(chunk, editor.getCursor());
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  async changeTone(editor, selection, tone) {
    const toneMap = {
      professional: 'professional and formal',
      casual: 'casual and friendly',
      academic: 'academic and scholarly',
      poetic: 'poetic and literary',
      technical: 'technical and precise',
      simple: 'simple and easy to understand'
    };
    
    const fullPrompt = `Rewrite the following text in a ${toneMap[tone] || tone} tone:\n\n${selection}\n\nRewritten version:`;
    
    const cursor = editor.getCursor('from');
    const to = editor.getCursor('to');
    
    try {
      let fullResponse = '';
      await this.streamAIResponse(fullPrompt, (chunk) => {
        fullResponse += chunk;
        editor.replaceRange(fullResponse, cursor, to);
      });
    } catch (error) {
      new Notice('AI Error: ' + error.message);
    }
  }

  addMoreAIOptions(submenu, editor, selection) {
    submenu.addItem((item) => {
      item.setTitle('📊 Summarize')
          .setIcon('file-text')
          .onClick(() => this.summarizeText(editor, selection));
    });
    
    submenu.addItem((item) => {
      item.setTitle('🔍 Expand')
          .setIcon('plus-circle')
          .onClick(() => this.expandText(editor, selection));
    });
    
    submenu.addItem((item) => {
      item.setTitle('❓ Generate questions')
          .setIcon('help-circle')
          .onClick(() => this.generateQuestions(editor, selection));
    });
    
    submenu.addItem((item) => {
      item.setTitle('🔑 Extract keywords')
          .setIcon('key')
          .onClick(() => this.extractKeywords(editor, selection));
    });
    
    submenu.addSeparator();
    
    submenu.addItem((item) => {
      item.setTitle('💼 Professional tone')
          .setIcon('briefcase')
          .onClick(() => this.changeTone(editor, selection, 'professional'));
    });
    
    submenu.addItem((item) => {
      item.setTitle('😊 Casual tone')
          .setIcon('smile')
          .onClick(() => this.changeTone(editor, selection, 'casual'));
    });
    
    submenu.addItem((item) => {
      item.setTitle('🎓 Academic tone')
          .setIcon('graduation-cap')
          .onClick(() => this.changeTone(editor, selection, 'academic'));
    });
    
    submenu.addItem((item) => {
      item.setTitle('📐 Technical tone')
          .setIcon('code')
          .onClick(() => this.changeTone(editor, selection, 'technical'));
    });
    
    submenu.addSeparator();
    
    submenu.addItem((item) => {
      item.setTitle('📋 Copy to clipboard')
          .setIcon('copy')
          .onClick(() => {
            navigator.clipboard.writeText(selection);
            new Notice('Selection copied to clipboard');
          });
    });
  }

  async streamAIResponse(prompt, onChunk) {
    const session = this.plugin._sessionManager.getActive();
    
    if (session) {
      this.plugin._sessionManager.addMessage('user', prompt);
    }

    const result = await this.plugin.apiManager.sendMessage({
      messages: session ? this.plugin._sessionManager.getMessagesForRequest() : [{ role: 'user', content: prompt }],
      temperature: this.plugin.settings.temperature,
      max_tokens: this.plugin.settings.max_tokens,
      stream: true
    }, {
      onChunk: onChunk,
      timeoutMs: this.plugin.settings.timeoutMs
    });

    if (session && result.final) {
      this.plugin._sessionManager.addMessage('assistant', result.final);
      this.plugin.saveState();
    }

    return result.final;
  }

  async showPromptModal(placeholder) {
    return new Promise((resolve) => {
      const modal = new PromptModal(
        this.plugin.app,
        'AI Assistant',
        '',
        (result) => resolve(result)
      );
      
      modal.open();
    });
  }
}

// ==================== CHAT SIDEBAR VIEW ====================

class ChatView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.containerEl.addClass('ai-sidebar');
    this._streaming = true;
    this.pendingAttachments = [];
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'AI Assistant'; }
  getIcon() { return 'brain'; }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass('ai-sidebar');
    this.containerEl.style.direction = 'ltr';
    this.containerEl.style.textAlign = 'left';
    this.containerEl.style.display = 'flex';
    this.containerEl.style.flexDirection = 'column';
    this.containerEl.style.height = '100%';
    this.containerEl.style.padding = '8px';
    this.containerEl.style.gap = '8px';
    this.containerEl.style.boxSizing = 'border-box';

    const topBar = this.containerEl.createDiv({ cls: 'ai-top-bar' });
    topBar.style.display = 'flex';
    topBar.style.justifyContent = 'flex-start';
    topBar.style.alignItems = 'center';
    topBar.style.height = '36px';
    topBar.style.width = '100%';
    topBar.style.gap = '8px';

    this.shortcutsBtn = topBar.createEl('button', {
      cls: 'ai-shortcuts-btn',
      text: '⚡'
    });
    this.shortcutsBtn.style.background = 'transparent';
    this.shortcutsBtn.style.border = 'none';
    this.shortcutsBtn.style.cursor = 'pointer';
    this.shortcutsBtn.style.fontSize = '20px';
    this.shortcutsBtn.style.color = 'var(--text-normal)';
    this.shortcutsBtn.style.padding = '4px 8px';
    this.shortcutsBtn.style.borderRadius = '4px';
    this.shortcutsBtn.style.width = '32px';
    this.shortcutsBtn.style.height = '32px';
    this.shortcutsBtn.style.display = 'flex';
    this.shortcutsBtn.style.alignItems = 'center';
    this.shortcutsBtn.style.justifyContent = 'center';
    this.shortcutsBtn.title = 'Shortcuts';

    this.modeToggleBtn = topBar.createEl('button', {
      cls: 'ai-mode-toggle',
      text: this.getProviderIcon()
    });
    this.modeToggleBtn.style.background = 'transparent';
    this.modeToggleBtn.style.border = 'none';
    this.modeToggleBtn.style.cursor = 'pointer';
    this.modeToggleBtn.style.fontSize = '20px';
    this.modeToggleBtn.style.color = 'var(--text-normal)';
    this.modeToggleBtn.style.padding = '4px 8px';
    this.modeToggleBtn.style.borderRadius = '4px';
    this.modeToggleBtn.style.width = '32px';
    this.modeToggleBtn.style.height = '32px';
    this.modeToggleBtn.style.display = 'flex';
    this.modeToggleBtn.style.alignItems = 'center';
    this.modeToggleBtn.style.justifyContent = 'center';
    this.modeToggleBtn.title = this.getProviderInfo();

    this.tokenCounter = topBar.createDiv({ 
      cls: 'ai-token-counter',
      text: '🔢 0/8192'
    });
    this.tokenCounter.style.fontSize = '11px';
    this.tokenCounter.style.padding = '4px 8px';
    this.tokenCounter.style.borderRadius = '12px';
    this.tokenCounter.style.background = 'transparent';
    this.tokenCounter.style.color = 'var(--text-muted)';
    this.tokenCounter.style.border = '1px solid var(--background-modifier-border)';
    this.tokenCounter.style.display = 'flex';
    this.tokenCounter.style.alignItems = 'center';
    this.tokenCounter.style.justifyContent = 'center';
    this.tokenCounter.style.minWidth = '70px';
    this.tokenCounter.style.height = '24px';
    
    this.updateTokenCounterVisibility();

    const spacer = topBar.createDiv({ cls: 'ai-top-spacer' });
    spacer.style.flex = '1';

    this.settingsBtn = topBar.createEl('button', { 
      text: '⚙️', 
      cls: 'ai-settings-btn'
    });
    this.settingsBtn.style.background = 'transparent';
    this.settingsBtn.style.border = 'none';
    this.settingsBtn.style.cursor = 'pointer';
    this.settingsBtn.style.fontSize = '20px';
    this.settingsBtn.style.color = 'var(--text-normal)';
    this.settingsBtn.style.padding = '4px 8px';
    this.settingsBtn.style.borderRadius = '4px';
    this.settingsBtn.style.width = '32px';
    this.settingsBtn.style.height = '32px';
    this.settingsBtn.style.display = 'flex';
    this.settingsBtn.style.alignItems = 'center';
    this.settingsBtn.style.justifyContent = 'center';
    this.settingsBtn.title = 'Settings';

    this.modeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleAIMode();
    });

    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      const settingsModal = new SettingsModal(this.app, this.plugin);
      settingsModal.open();
    });

    this.shortcutsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showShortcutsMenu();
    });

    this.chatEl = this.containerEl.createDiv({ cls: 'ai-chat' });
    this.chatEl.style.flex = '1';
    this.chatEl.style.overflowY = 'auto';
    this.chatEl.style.padding = '16px';
    this.chatEl.style.borderRadius = '8px';
    this.chatEl.style.background = 'var(--background-primary)';
    this.chatEl.style.border = '1px solid var(--background-modifier-border)';
    this.chatEl.style.margin = '4px 0';
    this.chatEl.style.display = 'flex';
    this.chatEl.style.flexDirection = 'column';

    const inputWrap = this.containerEl.createDiv({ cls: 'ai-input-wrap' });
    inputWrap.style.position = 'relative';
    inputWrap.style.width = '100%';
    inputWrap.style.marginTop = 'auto';
    inputWrap.style.paddingTop = '8px';
    inputWrap.style.borderTop = '1px solid var(--background-modifier-border)';
    
    this.inputEl = inputWrap.createEl('textarea', { 
      cls: 'ai-input',
      attr: { 
        placeholder: 'Type a message... (Shift+Enter for new line)',
        rows: '2'
      }
    });
    this.inputEl.style.width = '100%';
    this.inputEl.style.resize = 'vertical';
    this.inputEl.style.padding = '12px';
    this.inputEl.style.paddingBottom = '60px';
    this.inputEl.style.borderRadius = '8px';
    this.inputEl.style.border = '1px solid var(--background-modifier-border)';
    this.inputEl.style.background = 'var(--background-secondary)';
    this.inputEl.style.color = 'var(--text-normal)';
    this.inputEl.style.fontSize = '15px';
    this.inputEl.style.minHeight = '120px';
    this.inputEl.style.maxHeight = '300px';
    this.inputEl.style.lineHeight = '1.5';

    this.attachBtn = inputWrap.createEl('button', { 
      text: '+', 
      cls: 'ai-attach-btn floating-btn'
    });
    this.attachBtn.style.position = 'absolute';
    this.attachBtn.style.width = '36px';
    this.attachBtn.style.height = '36px';
    this.attachBtn.style.borderRadius = '50%';
    this.attachBtn.style.border = 'none';
    this.attachBtn.style.cursor = 'pointer';
    this.attachBtn.style.display = 'flex';
    this.attachBtn.style.alignItems = 'center';
    this.attachBtn.style.justifyContent = 'center';
    this.attachBtn.style.fontSize = '16px';
    this.attachBtn.style.zIndex = '100';
    this.attachBtn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
    this.attachBtn.style.bottom = '60px';
    this.attachBtn.style.right = '15px';
    this.attachBtn.style.background = 'var(--interactive-accent)';
    this.attachBtn.style.color = 'var(--text-on-accent)';
    this.attachBtn.title = 'Attach files';

    this.sendBtn = inputWrap.createEl('button', { 
      text: '➤', 
      cls: 'ai-send-btn floating-btn' 
    });
    this.sendBtn.style.position = 'absolute';
    this.sendBtn.style.width = '36px';
    this.sendBtn.style.height = '36px';
    this.sendBtn.style.borderRadius = '50%';
    this.sendBtn.style.border = 'none';
    this.sendBtn.style.cursor = 'pointer';
    this.sendBtn.style.display = 'flex';
    this.sendBtn.style.alignItems = 'center';
    this.sendBtn.style.justifyContent = 'center';
    this.sendBtn.style.fontSize = '16px';
    this.sendBtn.style.zIndex = '100';
    this.sendBtn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
    this.sendBtn.style.bottom = '15px';
    this.sendBtn.style.right = '15px';
    this.sendBtn.style.background = 'var(--interactive-accent)';
    this.sendBtn.style.color = 'var(--text-on-accent)';
    this.sendBtn.title = 'Send';

    this.sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._onSend();
    });
    
    this.attachBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._onAttach();
    });
    
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          return;
        } else {
          e.preventDefault();
          this._onSend();
        }
      }
    });

    this._renderMessages();
    this._streaming = true;
    
    if (this.plugin.settings.showTokenCounter) {
      this.inputEl.addEventListener('input', () => this._updateTokenCounter());   
      setTimeout(() => this._updateTokenCounter(), 100);
    }
  }

  updateTokenCounterVisibility() {
    if (!this.tokenCounter) return;
    
    if (this.plugin.settings.showTokenCounter) {
      this.tokenCounter.style.display = 'flex';
    } else {
      this.tokenCounter.style.display = 'none';
    }
  }

  showShortcutsMenu() {
    const existingMenus = document.querySelectorAll('.ai-shortcuts-menu');
    existingMenus.forEach(menu => menu.remove());
    
    const menu = document.createElement('div');
    menu.className = 'ai-shortcuts-menu';
    menu.style.position = 'fixed';
    menu.style.background = 'var(--background-primary)';
    menu.style.border = '1px solid var(--background-modifier-border)';
    menu.style.borderRadius = '8px';
    menu.style.padding = '10px';
    menu.style.minWidth = '200px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
    menu.style.zIndex = '9999';
    menu.style.backdropFilter = 'blur(10px)';
    
    const shortcuts = [
      { key: 'New Conversation', shortcut: this.plugin.settings.shortcuts.newConversation, action: () => this.createNewConversation() },
      { key: 'Save Conversation', shortcut: this.plugin.settings.shortcuts.saveConversation, action: () => this.saveCurrentConversation() },
      { key: 'Settings', shortcut: this.plugin.settings.shortcuts.settings, action: () => {
        const settingsModal = new SettingsModal(this.app, this.plugin);
        settingsModal.open();
      }},
      { key: 'Ask Selection', shortcut: this.plugin.settings.shortcuts.askSelection || 'Ctrl+Shift+A', action: () => {
        new Notice('Use this shortcut in the editor with text selected');
      }},
      { key: 'Edit Selection', shortcut: this.plugin.settings.shortcuts.editSelection || 'Ctrl+Shift+E', action: () => {
        new Notice('Use this shortcut in the editor with text selected');
      }}
    ];
    
    shortcuts.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'shortcut-item';
      menuItem.style.padding = '8px 12px';
      menuItem.style.cursor = 'pointer';
      menuItem.style.fontSize = '13px';
      menuItem.style.color = 'var(--text-normal)';
      menuItem.style.borderBottom = '1px solid var(--background-modifier-border)';
      menuItem.style.display = 'flex';
      menuItem.style.justifyContent = 'space-between';
      menuItem.style.alignItems = 'center';
      
      const keySpan = document.createElement('span');
      keySpan.className = 'shortcut-key';
      keySpan.style.fontWeight = '600';
      keySpan.textContent = item.key;
      
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'shortcut-value';
      shortcutSpan.style.fontFamily = 'monospace';
      shortcutSpan.style.fontSize = '12px';
      shortcutSpan.style.color = 'var(--text-muted)';
      shortcutSpan.style.background = 'var(--background-secondary)';
      shortcutSpan.style.padding = '2px 6px';
      shortcutSpan.style.borderRadius = '4px';
      shortcutSpan.style.border = '1px solid var(--background-modifier-border)';
      shortcutSpan.textContent = item.shortcut;
      
      menuItem.appendChild(keySpan);
      menuItem.appendChild(shortcutSpan);
      
      menuItem.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      
      menu.appendChild(menuItem);
    });
    
    document.body.appendChild(menu);
    
    const btnRect = this.shortcutsBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    
    let top = btnRect.bottom + 5;
    let left = btnRect.left;
    
    if (top + menuRect.height > window.innerHeight) {
      top = btnRect.top - menuRect.height - 5;
    }
    
    if (left + menuRect.width > window.innerWidth) {
      left = btnRect.right - menuRect.width;
    }
    
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== this.shortcutsBtn) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 10);
  }

  createNewConversation() {
    const name = prompt('New conversation name:', `Conversation ${this.plugin._sessionManager.sessions.length + 1}`);
    if (name && name.trim()) {
      this.plugin._sessionManager.create(name.trim());
      this._renderMessages();
      this.plugin.saveState();
      new Notice(`✅ Created conversation: ${name}`);
    }
  }

  async saveCurrentConversation() {
    const session = this.plugin._sessionManager.getActive();
    if (!session) {
      new Notice('No active conversation to save');
      return;
    }
    
    try {
      const content = this.plugin._sessionManager.exportToMarkdown(session);
      const folderPath = this.plugin.settings.conversationsFolder || 'AI Conversations';
      const fileName = `${session.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      
      const folderExists = await this.app.vault.adapter.exists(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
      
      await this.app.vault.create(fullPath, content);
      new Notice(`✅ Conversation saved to: ${fullPath}`);
    } catch (error) {
      console.error('Error saving conversation:', error);
      new Notice(`❌ Error saving conversation: ${error.message}`);
    }
  }

  getProviderIcon() {
    return this.plugin.apiManager.getCurrentProviderIcon();
  }

  getProviderName() {
    return this.plugin.apiManager.getCurrentProviderName();
  }

  getProviderInfo() {
    if (this.plugin.settings.currentMode === 'local') {
      return `${this.plugin.settings.localModel} - Click to switch to cloud`;
    } else {
      return `${this.getProviderName()} - Click to switch to local`;
    }
  }

  toggleAIMode() {
    this.plugin.settings.currentMode = 
      this.plugin.settings.currentMode === 'local' ? 'cloud' : 'local';
    
    this.modeToggleBtn.textContent = this.getProviderIcon();
    this.modeToggleBtn.title = this.getProviderInfo();
    
    this.plugin.saveSettings();
    new Notice(`Switched to ${this.getProviderName()}`);
    this._updateTokenCounter();
  }

  _updateTokenCounter() {
    if (!this.plugin.settings.showTokenCounter || !this.tokenCounter || this.tokenCounter.style.display === 'none') return;
    
    const text = this.inputEl.value;
    const estimatedTokens = estimateTokens(text);
    
    const s = this.plugin._sessionManager.getActive();
    let contextTokens = 0;
    if (s) {
      const messages = this.plugin._sessionManager.getMessagesForRequest(10);
      messages.forEach(m => contextTokens += estimateTokens(m.content));
    }
    
    const totalTokens = estimatedTokens + contextTokens;
    const maxTokens = 8192;
    
    const providerName = this.getProviderName();
    
    if (this.tokenCounter) {
      this.tokenCounter.textContent = `${this.getProviderIcon()} ${totalTokens}/${maxTokens}`;
      this.tokenCounter.title = `${providerName}\nContext: ${contextTokens} | Input: ${estimatedTokens}`;
      
      if (totalTokens > maxTokens) {
        this.tokenCounter.style.color = 'var(--text-error)';
        this.tokenCounter.style.backgroundColor = 'rgba(var(--background-modifier-error-rgb), 0.2)';
      } else if (totalTokens > maxTokens * 0.8) {
        this.tokenCounter.style.color = 'var(--text-warning)';
        this.tokenCounter.style.backgroundColor = 'rgba(var(--background-modifier-warning-rgb), 0.2)';
      } else {
        this.tokenCounter.style.color = 'var(--text-muted)';
        this.tokenCounter.style.backgroundColor = 'transparent';
      }
    }
  }

  _renderMessages() {
    this.chatEl.empty();
    const s = this.plugin._sessionManager.getActive();
    if (!s) return;
    
    s.messages.forEach(m => this._appendBubble(m.role, m.content, m.attachments));
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  _appendBubble(role, text, attachments = []) {
    const msgContainer = this.chatEl.createDiv({ cls: `ai-msg-container ${role}` });
    msgContainer.style.marginBottom = '16px';
    msgContainer.style.maxWidth = '88%';
    msgContainer.style.alignSelf = role === 'user' ? 'flex-start' : 'flex-end';
    
    const bubble = msgContainer.createDiv({ cls: `ai-msg ${role}` });
    bubble.style.padding = '12px 16px';
    bubble.style.borderRadius = role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px';
    bubble.style.lineHeight = '1.5';
    bubble.style.whiteSpace = 'pre-wrap';
    bubble.style.wordBreak = 'break-word';
    bubble.style.fontSize = '14px';
    
    if (role === 'user') {
      bubble.style.background = 'var(--interactive-accent)';
      bubble.style.color = 'var(--text-on-accent)';
      bubble.textContent = text;
    } else {
      bubble.style.background = 'var(--background-secondary)';
      bubble.style.color = 'var(--text-normal)';
      MarkdownRenderer.render(this.app, text, bubble, '', this.plugin);
    }
    
    if (attachments && attachments.length > 0) {
      const attachmentsContainer = msgContainer.createDiv({ cls: 'ai-attachments-container' });
      attachmentsContainer.style.marginTop = '8px';
      attachmentsContainer.style.padding = '10px';
      attachmentsContainer.style.background = 'rgba(var(--interactive-accent-rgb), 0.1)';
      attachmentsContainer.style.borderRadius = '8px';
      attachmentsContainer.style.border = '1px dashed var(--background-modifier-border)';
      
      attachmentsContainer.createEl('div', { 
        text: '📎 Attachments:', 
        cls: 'ai-attachments-title' 
      }).style.fontSize = '12px';
      
      attachments.forEach(attachment => {
        const attachmentEl = attachmentsContainer.createDiv({ cls: 'ai-attachment' });
        attachmentEl.style.display = 'flex';
        attachmentEl.style.alignItems = 'center';
        attachmentEl.style.padding = '6px 8px';
        attachmentEl.style.background = 'var(--background-primary)';
        attachmentEl.style.borderRadius = '6px';
        attachmentEl.style.marginBottom = '4px';
        attachmentEl.style.border = '1px solid var(--background-modifier-border)';
        
        attachmentEl.createEl('div', { 
          text: `📄 ${attachment.name}`, 
          cls: 'ai-attachment-name' 
        }).style.fontSize = '13px';
      });
    }
    
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
    return bubble;
  }

  async _onAttach() {
    const modal = new AttachModal(this.app, async (choice, files) => {
      if (!files || !files.length) { 
        new Notice('No files selected'); 
        return; 
      }
      
      this.pendingAttachments = [];
      
      for (const f of files) {
        try {
          const data = await this.app.vault.read(f);
          const trimmedContent = trimContent(data, 3500);
          this.pendingAttachments.push({
            name: f.basename,
            path: f.path,
            content: trimmedContent
          });
        } catch (e) { 
          console.error(e); 
          new Notice(`Error reading file: ${f.path}`);
        }
      }
      
      const attachmentCount = this.pendingAttachments.length;
      if (attachmentCount > 0) {
        this.inputEl.value += `\n[📎 ${attachmentCount} file${attachmentCount > 1 ? 's' : ''} attached]`;
        new Notice(`✅ ${attachmentCount} file${attachmentCount > 1 ? 's' : ''} ready to attach`);
      }
    });
    modal.open();
  }

  async _onSend() {
    const txt = this.inputEl.value.trim();
    if (!txt && this.pendingAttachments.length === 0) { 
      new Notice('Message is empty'); 
      return; 
    }
    
    let s = this.plugin._sessionManager.getActive();
    if (!s) { 
      this.plugin._sessionManager.create('New Conversation');
      s = this.plugin._sessionManager.getActive();
    }
    
    this.plugin._sessionManager.addMessage('user', txt, this.pendingAttachments);
    this.plugin.saveState();
    
    this._appendBubble('user', txt, this.pendingAttachments);
    
    this.inputEl.value = '';
    this.pendingAttachments = [];

    const messages = this.plugin._sessionManager.getMessagesForRequest();

    let acc = '';
    const loadingMsg = this._appendBubble('assistant', '⏳ Processing...');
    
    try {
      let dots = 0;
      const loadingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        loadingMsg.textContent = '⏳ Processing' + '.'.repeat(dots);
      }, 500);
      
      const result = await this.plugin.apiManager.sendMessage({
        messages: messages,
        temperature: this.plugin.settings.temperature,
        max_tokens: this.plugin.settings.max_tokens,
        stream: false
      }, {
        timeoutMs: this.plugin.settings.timeoutMs
      });
      
      clearInterval(loadingInterval);
      
      const finalText = (result && result.final) ? result.final : acc;
      
      loadingMsg.empty();
      MarkdownRenderer.render(this.app, finalText, loadingMsg, '', this.plugin);
      this.plugin._sessionManager.addMessage('assistant', finalText);
      this.plugin.saveState();
      
    } catch (e) {
      console.error("Chat Error:", e);
      
      let errorMessage = '❌ Error occurred';
      if (e.message.includes('429')) {
        errorMessage = '⏳ Rate limit exceeded. Please wait a moment and try again.';
      } else if (e.message.includes('401') || e.message.includes('403')) {
        errorMessage = '🔐 Authentication failed. Please check your API key.';
      } else if (e.message.includes('timeout')) {
        errorMessage = '⏱️ Request timed out. Check your internet connection.';
      } else if (e.message.includes('fetch')) {
        errorMessage = '🌐 Network error. Please check if the service is running.';
      } else {
        errorMessage = `❌ Error: ${e.message}`;
      }
      
      loadingMsg.textContent = errorMessage;
      new Notice(errorMessage);
    }
  }
}

// ==================== SETTINGS MODAL ====================

class SettingsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = '600px';
    contentEl.style.maxWidth = '800px';
    
    contentEl.createEl('h2', { text: '⚙️ AI Assistant Settings' });
    
    const tabsContainer = contentEl.createDiv({ cls: 'ai-settings-tabs' });
    tabsContainer.style.display = 'flex';
    tabsContainer.style.gap = '8px';
    tabsContainer.style.marginBottom = '20px';
    tabsContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
    tabsContainer.style.paddingBottom = '10px';
    tabsContainer.style.flexWrap = 'wrap';
    
    const localTab = tabsContainer.createEl('button', { 
      text: '🖥️ Local Model',
      cls: 'ai-tab-btn active'
    });
    localTab.style.padding = '10px 16px';
    localTab.style.border = 'none';
    localTab.style.background = 'transparent';
    localTab.style.color = 'var(--text-muted)';
    localTab.style.cursor = 'pointer';
    localTab.style.borderRadius = '6px';
    localTab.style.fontSize = '14px';
    
    const cloudTab = tabsContainer.createEl('button', { 
      text: '☁️ Cloud Model',
      cls: 'ai-tab-btn'
    });
    
    const generalTab = tabsContainer.createEl('button', { 
      text: '⚙️ General',
      cls: 'ai-tab-btn'
    });
    
    const shortcutsTab = tabsContainer.createEl('button', { 
      text: '⚡ Shortcuts',
      cls: 'ai-tab-btn'
    });
    
    const conversationsTab = tabsContainer.createEl('button', { 
      text: '💬 Conversations',
      cls: 'ai-tab-btn'
    });
    
    [cloudTab, generalTab, shortcutsTab, conversationsTab].forEach(tab => {
      tab.style.padding = '10px 16px';
      tab.style.border = 'none';
      tab.style.background = 'transparent';
      tab.style.color = 'var(--text-muted)';
      tab.style.cursor = 'pointer';
      tab.style.borderRadius = '6px';
      tab.style.fontSize = '14px';
    });
    
    const contentContainer = contentEl.createDiv({ cls: 'ai-settings-content' });
    contentContainer.style.maxHeight = '400px';
    contentContainer.style.overflowY = 'auto';
    contentContainer.style.paddingRight = '10px';
    contentContainer.style.marginBottom = '20px';
    
    this.showLocalSettings(contentContainer);
    
    localTab.addEventListener('click', () => {
      this.setActiveTab(localTab, [cloudTab, generalTab, shortcutsTab, conversationsTab]);
      this.showLocalSettings(contentContainer);
    });
    
    cloudTab.addEventListener('click', () => {
      this.setActiveTab(cloudTab, [localTab, generalTab, shortcutsTab, conversationsTab]);
      this.showCloudSettings(contentContainer);
    });
    
    generalTab.addEventListener('click', () => {
      this.setActiveTab(generalTab, [localTab, cloudTab, shortcutsTab, conversationsTab]);
      this.showGeneralSettings(contentContainer);
    });
    
    shortcutsTab.addEventListener('click', () => {
      this.setActiveTab(shortcutsTab, [localTab, cloudTab, generalTab, conversationsTab]);
      this.showShortcutsSettings(contentContainer);
    });
    
    conversationsTab.addEventListener('click', () => {
      this.setActiveTab(conversationsTab, [localTab, cloudTab, generalTab, shortcutsTab]);
      this.showConversationsSettings(contentContainer);
    });
    
    const buttonRow = contentEl.createDiv({ cls: 'ai-settings-btn-row' });
    buttonRow.style.display = 'flex';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.gap = '10px';
    buttonRow.style.paddingTop = '20px';
    buttonRow.style.borderTop = '1px solid var(--background-modifier-border)';
    
    const saveBtn = buttonRow.createEl('button', { 
      text: '💾 Save',
      cls: 'ai-settings-save-btn'
    });
    saveBtn.style.padding = '10px 24px';
    saveBtn.style.borderRadius = '8px';
    saveBtn.style.border = 'none';
    saveBtn.style.background = 'var(--interactive-accent)';
    saveBtn.style.color = 'var(--text-on-accent)';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontSize = '14px';
    saveBtn.style.fontWeight = '600';
    
    const cancelBtn = buttonRow.createEl('button', { 
      text: '❌ Cancel',
      cls: 'ai-settings-cancel-btn'
    });
    cancelBtn.style.padding = '10px 24px';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.border = '1px solid var(--background-modifier-border)';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = 'var(--text-normal)';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.fontSize = '14px';
    
    saveBtn.addEventListener('click', async () => {
      await this.plugin.saveSettings();
      new Notice('✅ Settings saved successfully!');
      this.close();
    });
    
    cancelBtn.addEventListener('click', () => this.close());
  }

  setActiveTab(activeTab, otherTabs) {
    activeTab.classList.add('active');
    activeTab.style.background = 'var(--interactive-accent)';
    activeTab.style.color = 'var(--text-on-accent)';
    activeTab.style.fontWeight = '600';
    
    otherTabs.forEach(tab => {
      tab.classList.remove('active');
      tab.style.background = 'transparent';
      tab.style.color = 'var(--text-muted)';
      tab.style.fontWeight = 'normal';
    });
  }
  
  showLocalSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '🖥️ Local Model Configuration' });
    
    this.createInputField(section, 'Base URL:', 'baseUrl', this.plugin.settings.baseUrl, 'text', 'http://127.0.0.1:11434');
    this.createInputField(section, 'Endpoint:', 'localEndpoint', this.plugin.settings.localEndpoint, 'text', '/v1/chat/completions');
    this.createInputField(section, 'Model Name:', 'localModel', this.plugin.settings.localModel, 'text', 'llama2');
    
    const testBtn = section.createEl('button', {
      text: '🔄 Test Connection',
      cls: 'ai-test-btn'
    });
    testBtn.style.width = '100%';
    testBtn.style.padding = '12px';
    testBtn.style.borderRadius = '8px';
    testBtn.style.border = '1px solid var(--background-modifier-border)';
    testBtn.style.background = 'var(--background-secondary)';
    testBtn.style.color = 'var(--text-normal)';
    testBtn.style.cursor = 'pointer';
    testBtn.style.fontSize = '14px';
    testBtn.style.marginTop = '10px';
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      
      try {
        const provider = new LocalAIProvider(this.plugin);
        const health = await provider.checkHealth();
        if (health.ok) {
          new Notice('✅ ' + health.message);
        } else {
          new Notice('❌ ' + health.message);
        }
      } catch (e) {
        new Notice('❌ Error: ' + e.message);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🔄 Test Connection';
      }
    });
  }
  
  showCloudSettings(container) {
    container.empty();
    
    const apiTypeSection = container.createDiv({ cls: 'ai-settings-section' });
    apiTypeSection.style.background = 'var(--background-secondary)';
    apiTypeSection.style.borderRadius = '8px';
    apiTypeSection.style.padding = '20px';
    apiTypeSection.style.marginBottom = '20px';
    apiTypeSection.style.border = '1px solid var(--background-modifier-border)';
    
    apiTypeSection.createEl('h3', { text: '☁️ Cloud Provider Selection' });

    this.createAPITypeSelector(apiTypeSection);

    const settingsContainer = container.createDiv({ cls: 'ai-api-settings-container' });
    this.showSpecificAPISettings(settingsContainer);
  }

  createAPITypeSelector(container) {
    const row = container.createDiv({ cls: 'ai-api-type-selector' });
    row.style.display = 'flex';
    row.style.gap = '10px';
    row.style.marginBottom = '20px';
    row.style.flexWrap = 'wrap';

    const providers = [
      { id: 'openai', name: 'OpenAI', icon: '🎡' },
      { id: 'gemini', name: 'Gemini', icon: '🌀' },
      { id: 'anthropic', name: 'Claude', icon: '☁️' },
      { id: 'custom', name: 'Custom', icon: '⚙️' }
    ];

    providers.forEach(provider => {
      const btn = row.createEl('button', {
        cls: `ai-provider-btn ${this.plugin.settings.cloudApiType === provider.id ? 'active' : ''}`,
        text: `${provider.icon} ${provider.name}`
      });
      btn.style.flex = '1';
      btn.style.minWidth = '120px';
      btn.style.padding = '12px';
      btn.style.borderRadius = '8px';
      btn.style.border = '2px solid';
      btn.style.background = 'var(--background-secondary)';
      btn.style.color = 'var(--text-normal)';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '14px';
      btn.style.fontWeight = '600';
      
      if (this.plugin.settings.cloudApiType === provider.id) {
        btn.style.background = 'var(--background-primary)';
        btn.style.borderWidth = '3px';
      }

      btn.dataset.provider = provider.id;

      btn.addEventListener('click', () => {
        this.plugin.settings.cloudApiType = provider.id;
        
        document.querySelectorAll('.ai-provider-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'var(--background-secondary)';
          b.style.borderWidth = '2px';
        });
        
        btn.classList.add('active');
        btn.style.background = 'var(--background-primary)';
        btn.style.borderWidth = '3px';
        
        this.showSpecificAPISettings(document.querySelector('.ai-api-settings-container'));
      });
    });
  }

  showSpecificAPISettings(container) {
    container.empty();

    switch (this.plugin.settings.cloudApiType) {
      case 'openai':
        this.showOpenAISettings(container);
        break;
      case 'gemini':
        this.showGeminiSettings(container);
        break;
      case 'anthropic':
        this.showAnthropicSettings(container);
        break;
      case 'custom':
        this.showCustomSettings(container);
        break;
    }
  }

  showOpenAISettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '🎡 OpenAI Configuration' });

    this.createInputField(section, 'API Key:', 'openaiApiKey', 
      this.plugin.settings.openaiApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'openaiModel', 
      this.plugin.settings.openaiModel, 'text', 'gpt-3.5-turbo');
    
    this.createInputField(section, 'Custom Endpoint (optional):', 'openaiEndpoint', 
      this.plugin.settings.openaiEndpoint, 'text', 'https://api.openai.com/v1/chat/completions');
    
    const testBtn = section.createEl('button', { text: '🔄 Test Connection', cls: 'ai-test-btn' });
    testBtn.style.width = '100%';
    testBtn.style.padding = '12px';
    testBtn.style.borderRadius = '8px';
    testBtn.style.border = '1px solid var(--background-modifier-border)';
    testBtn.style.background = 'var(--background-secondary)';
    testBtn.style.color = 'var(--text-normal)';
    testBtn.style.cursor = 'pointer';
    testBtn.style.fontSize = '14px';
    testBtn.style.marginTop = '10px';
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      const provider = new OpenAIProvider(this.plugin);
      const health = await provider.checkHealth();
      new Notice(health.message);
      testBtn.disabled = false;
      testBtn.textContent = '🔄 Test Connection';
    });
  }
  
  showGeminiSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '🌀 Google Gemini Configuration (Non-Streaming)' });
    
    this.createInputField(section, 'API Key:', 'geminiApiKey', 
      this.plugin.settings.geminiApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'geminiModel', 
      this.plugin.settings.geminiModel, 'text', 'gemini-1.5-flash');
    
    const testBtn = section.createEl('button', {
      text: '🔄 Test Connection',
      cls: 'ai-test-btn'
    });
    testBtn.style.width = '100%';
    testBtn.style.padding = '12px';
    testBtn.style.borderRadius = '8px';
    testBtn.style.border = '1px solid var(--background-modifier-border)';
    testBtn.style.background = 'var(--background-secondary)';
    testBtn.style.color = 'var(--text-normal)';
    testBtn.style.cursor = 'pointer';
    testBtn.style.fontSize = '14px';
    testBtn.style.marginTop = '10px';
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      
      const provider = new GeminiProvider(this.plugin);
      const health = await provider.checkHealth();
      new Notice(health.message);
      
      testBtn.disabled = false;
      testBtn.textContent = '🔄 Test Connection';
    });
  }

  showAnthropicSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '☁️ Anthropic Claude Configuration' });

    this.createInputField(section, 'API Key:', 'anthropicApiKey', 
      this.plugin.settings.anthropicApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'anthropicModel', 
      this.plugin.settings.anthropicModel, 'text', 'claude-3-haiku-20240307');
    
    const testBtn = section.createEl('button', { text: '🔄 Test Connection', cls: 'ai-test-btn' });
    testBtn.style.width = '100%';
    testBtn.style.padding = '12px';
    testBtn.style.borderRadius = '8px';
    testBtn.style.border = '1px solid var(--background-modifier-border)';
    testBtn.style.background = 'var(--background-secondary)';
    testBtn.style.color = 'var(--text-normal)';
    testBtn.style.cursor = 'pointer';
    testBtn.style.fontSize = '14px';
    testBtn.style.marginTop = '10px';
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      const provider = new AnthropicProvider(this.plugin);
      const health = await provider.checkHealth();
      new Notice(health.message);
      testBtn.disabled = false;
      testBtn.textContent = '🔄 Test Connection';
    });
  }

  showCustomSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '⚙️ Custom API Configuration' });

    this.createInputField(section, 'API Key:', 'customApiKey', this.plugin.settings.customApiKey, 'password');
    this.createInputField(section, 'Model Name:', 'customModel', this.plugin.settings.customModel, 'text');
    this.createInputField(section, 'Endpoint URL:', 'customEndpoint', this.plugin.settings.customEndpoint, 'text');
    
    const row = section.createDiv({ cls: 'ai-settings-row' });
    row.style.marginBottom = '16px';
    
    row.createEl('label', { text: 'HTTP Headers (JSON):' }).style.display = 'block';
    
    const headersText = row.createEl('textarea', {
      text: this.plugin.settings.customHeaders || '{}',
      rows: 3
    });
    headersText.style.width = '100%';
    headersText.style.padding = '10px 14px';
    headersText.style.borderRadius = '8px';
    headersText.style.border = '1px solid var(--background-modifier-border)';
    headersText.style.backgroundColor = 'var(--background-primary)';
    headersText.style.color = 'var(--text-normal)';
    headersText.style.fontSize = '14px';
    headersText.style.fontFamily = 'monospace';
    headersText.addEventListener('change', (e) => {
      this.plugin.settings.customHeaders = e.target.value;
    });

    const row2 = section.createDiv({ cls: 'ai-settings-row' });
    row2.style.marginBottom = '16px';
    
    row2.createEl('label', { text: 'Body Template (JSON):' }).style.display = 'block';
    
    const templateText = row2.createEl('textarea', {
      text: this.plugin.settings.customBodyTemplate || '{"messages": {{messages}}, "model": "{{model}}"}',
      rows: 4
    });
    templateText.style.width = '100%';
    templateText.style.padding = '10px 14px';
    templateText.style.borderRadius = '8px';
    templateText.style.border = '1px solid var(--background-modifier-border)';
    templateText.style.backgroundColor = 'var(--background-primary)';
    templateText.style.color = 'var(--text-normal)';
    templateText.style.fontSize = '14px';
    templateText.style.fontFamily = 'monospace';
    templateText.addEventListener('change', (e) => {
      this.plugin.settings.customBodyTemplate = e.target.value;
    });

    const testBtn = section.createEl('button', { text: '🔄 Test Connection', cls: 'ai-test-btn' });
    testBtn.style.width = '100%';
    testBtn.style.padding = '12px';
    testBtn.style.borderRadius = '8px';
    testBtn.style.border = '1px solid var(--background-modifier-border)';
    testBtn.style.background = 'var(--background-secondary)';
    testBtn.style.color = 'var(--text-normal)';
    testBtn.style.cursor = 'pointer';
    testBtn.style.fontSize = '14px';
    testBtn.style.marginTop = '10px';
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      const provider = new CustomProvider(this.plugin);
      const health = await provider.checkHealth();
      new Notice(health.message);
      testBtn.disabled = false;
      testBtn.textContent = '🔄 Test Connection';
    });
  }

  showGeneralSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '⚙️ General Settings' });
    
    this.createSliderField(section, 'Temperature:', 'temperature', this.plugin.settings.temperature, 0, 2, 0.1);
    this.createInputField(section, 'Max Tokens:', 'max_tokens', this.plugin.settings.max_tokens, 'number', '2048');
    this.createInputField(section, 'Conversations Folder:', 'conversationsFolder', this.plugin.settings.conversationsFolder, 'text', 'AI Conversations');
    this.createInputField(section, 'Timeout (ms):', 'timeoutMs', this.plugin.settings.timeoutMs, 'number', '120000');
    this.createCheckboxField(section, 'Auto-check health on startup:', 'autoCheckHealth', this.plugin.settings.autoCheckHealth);
    this.createCheckboxField(section, 'Show token counter:', 'showTokenCounter', this.plugin.settings.showTokenCounter);
  }

  showShortcutsSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '⚡ Keyboard Shortcuts' });
    
    this.createShortcutField(section, 'New Conversation:', 'shortcuts', 'newConversation', this.plugin.settings.shortcuts.newConversation);
    this.createShortcutField(section, 'Save Conversation:', 'shortcuts', 'saveConversation', this.plugin.settings.shortcuts.saveConversation);
    this.createShortcutField(section, 'Open Settings:', 'shortcuts', 'settings', this.plugin.settings.shortcuts.settings);
    this.createShortcutField(section, 'Ask Selection:', 'shortcuts', 'askSelection', this.plugin.settings.shortcuts.askSelection || 'Ctrl+Shift+A');
    this.createShortcutField(section, 'Edit Selection:', 'shortcuts', 'editSelection', this.plugin.settings.shortcuts.editSelection || 'Ctrl+Shift+E');
    
    const info = section.createDiv({ cls: 'ai-shortcuts-info' });
    info.style.background = 'var(--background-primary)';
    info.style.borderRadius = '8px';
    info.style.padding = '12px';
    info.style.marginTop = '16px';
    info.style.border = '1px solid var(--background-modifier-border)';
    info.style.fontSize = '12px';
    info.style.color = 'var(--text-muted)';
    
    info.innerHTML = '<p><strong>Note:</strong> Use Ctrl for Windows/Linux, Cmd for Mac. Examples: Ctrl+Shift+N, Cmd+Shift+N</p>';
  }

  showConversationsSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    section.createEl('h3', { text: '💬 Conversation Management' });
    
    const sessionList = section.createDiv({ cls: 'ai-session-list' });
    sessionList.style.maxHeight = '300px';
    sessionList.style.overflowY = 'auto';
    sessionList.style.border = '1px solid var(--background-modifier-border)';
    sessionList.style.borderRadius = '8px';
    sessionList.style.padding = '8px';
    sessionList.style.marginBottom = '16px';
    sessionList.style.backgroundColor = 'var(--background-primary)';
    
    const sessions = this.plugin._sessionManager.sessions;
    
    if (sessions.length === 0) {
      const emptyMsg = sessionList.createDiv({ 
        cls: 'ai-empty-sessions',
        text: 'No conversations yet'
      });
      emptyMsg.style.textAlign = 'center';
      emptyMsg.style.padding = '40px 20px';
      emptyMsg.style.color = 'var(--text-muted)';
      emptyMsg.style.fontSize = '14px';
    } else {
      sessions.forEach(session => {
        const sessionRow = sessionList.createDiv({ 
          cls: `ai-session-row ${this.plugin._sessionManager.activeId === session.id ? 'active' : ''}` 
        });
        sessionRow.style.display = 'flex';
        sessionRow.style.justifyContent = 'space-between';
        sessionRow.style.alignItems = 'center';
        sessionRow.style.padding = '10px 12px';
        sessionRow.style.borderRadius = '6px';
        sessionRow.style.marginBottom = '6px';
        sessionRow.style.backgroundColor = 'var(--background-secondary)';
        sessionRow.style.border = '1px solid var(--background-modifier-border)';
        
        if (this.plugin._sessionManager.activeId === session.id) {
          sessionRow.style.backgroundColor = 'rgba(var(--interactive-accent-rgb), 0.1)';
          sessionRow.style.borderColor = 'var(--interactive-accent)';
        }
        
        const sessionInfo = sessionRow.createDiv({ cls: 'ai-session-info' });
        sessionInfo.style.flex = '1';
        sessionInfo.style.minWidth = '0';
        
        const nameSpan = sessionInfo.createEl('div', { 
          cls: 'ai-session-name',
          text: session.name 
        });
        nameSpan.style.fontWeight = '600';
        nameSpan.style.fontSize = '14px';
        nameSpan.style.color = 'var(--text-normal)';
        nameSpan.style.marginBottom = '2px';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        
        const messageCount = sessionInfo.createEl('div', { 
          cls: 'ai-session-count',
          text: `${session.messages.length} message${session.messages.length !== 1 ? 's' : ''}` 
        });
        messageCount.style.fontSize = '12px';
        messageCount.style.color = 'var(--text-muted)';
        
        const sessionActions = sessionRow.createDiv({ cls: 'ai-session-actions' });
        sessionActions.style.display = 'flex';
        sessionActions.style.gap = '6px';
        sessionActions.style.flexShrink = '0';
        
        const switchBtn = sessionActions.createEl('button', {
          text: 'Activate',
          cls: 'ai-session-action-btn'
        });
        switchBtn.style.padding = '4px 8px';
        switchBtn.style.borderRadius = '4px';
        switchBtn.style.border = '1px solid var(--background-modifier-border)';
        switchBtn.style.backgroundColor = 'var(--background-secondary)';
        switchBtn.style.color = 'var(--text-normal)';
        switchBtn.style.cursor = 'pointer';
        switchBtn.style.fontSize = '11px';
        
        switchBtn.addEventListener('click', () => {
          this.plugin._sessionManager.switchTo(session.id);
          this.plugin.saveState();
          this.showConversationsSettings(container);
          new Notice(`Switched to conversation: ${session.name}`);
          this.refreshChatViews();
        });
        
        const renameBtn = sessionActions.createEl('button', {
          text: 'Rename',
          cls: 'ai-session-action-btn'
        });
        renameBtn.style.padding = '4px 8px';
        renameBtn.style.borderRadius = '4px';
        renameBtn.style.border = '1px solid var(--background-modifier-border)';
        renameBtn.style.backgroundColor = 'var(--background-secondary)';
        renameBtn.style.color = 'var(--text-normal)';
        renameBtn.style.cursor = 'pointer';
        renameBtn.style.fontSize = '11px';
        
        renameBtn.addEventListener('click', () => {
          const newName = prompt('New name:', session.name);
          if (newName && newName.trim()) {
            session.name = newName.trim();
            this.plugin.saveState();
            this.showConversationsSettings(container);
            new Notice('Conversation renamed');
          }
        });
        
        const saveBtn = sessionActions.createEl('button', {
          text: '💾 Save',
          cls: 'ai-session-action-btn save'
        });
        saveBtn.style.padding = '4px 8px';
        saveBtn.style.borderRadius = '4px';
        saveBtn.style.border = '1px solid #2e7d32';
        saveBtn.style.backgroundColor = 'rgba(46, 125, 50, 0.1)';
        saveBtn.style.color = '#2e7d32';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.fontSize = '11px';
        
        saveBtn.addEventListener('click', async () => {
          await this.saveConversationToFile(session);
        });
        
        const deleteBtn = sessionActions.createEl('button', {
          text: 'Delete',
          cls: 'ai-session-action-btn delete'
        });
        deleteBtn.style.padding = '4px 8px';
        deleteBtn.style.borderRadius = '4px';
        deleteBtn.style.border = '1px solid var(--text-error)';
        deleteBtn.style.backgroundColor = 'rgba(var(--background-modifier-error-rgb), 0.1)';
        deleteBtn.style.color = 'var(--text-error)';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.fontSize = '11px';
        
        deleteBtn.addEventListener('click', () => {
          if (confirm(`Delete conversation "${session.name}"?`)) {
            this.plugin._sessionManager.delete(session.id);
            this.plugin.saveState();
            this.showConversationsSettings(container);
            new Notice('Conversation deleted');
            this.refreshChatViews();
          }
        });
      });
    }
    
    const newSessionSection = section.createDiv({ cls: 'ai-new-session-section' });
    newSessionSection.style.display = 'flex';
    newSessionSection.style.gap = '10px';
    newSessionSection.style.marginBottom = '16px';
    
    const newSessionInput = newSessionSection.createEl('input', {
      type: 'text',
      placeholder: 'New conversation name',
      cls: 'ai-new-session-input'
    });
    newSessionInput.style.flex = '1';
    newSessionInput.style.padding = '10px 14px';
    newSessionInput.style.borderRadius = '8px';
    newSessionInput.style.border = '1px solid var(--background-modifier-border)';
    newSessionInput.style.backgroundColor = 'var(--background-primary)';
    newSessionInput.style.color = 'var(--text-normal)';
    newSessionInput.style.fontSize = '14px';
    
    const newSessionBtn = newSessionSection.createEl('button', {
      text: '➕ New Conversation',
      cls: 'ai-new-session-btn'
    });
    newSessionBtn.style.padding = '10px 16px';
    newSessionBtn.style.borderRadius = '8px';
    newSessionBtn.style.border = '1px solid var(--background-modifier-border)';
    newSessionBtn.style.backgroundColor = 'var(--interactive-accent)';
    newSessionBtn.style.color = 'var(--text-on-accent)';
    newSessionBtn.style.cursor = 'pointer';
    newSessionBtn.style.fontSize = '14px';
    
    newSessionBtn.addEventListener('click', () => {
      const name = newSessionInput.value.trim();
      if (!name) {
        new Notice('Please enter a conversation name');
        return;
      }
      
      this.plugin._sessionManager.create(name);
      this.plugin.saveState();
      this.showConversationsSettings(container);
      new Notice(`✅ Created conversation: ${name}`);
      newSessionInput.value = '';
      this.refreshChatViews();
    });
    
    const clearAllSection = section.createDiv({ cls: 'ai-clear-all-section' });
    clearAllSection.style.marginTop = '16px';
    clearAllSection.style.paddingTop = '16px';
    clearAllSection.style.borderTop = '1px solid var(--background-modifier-border)';
    
    const clearAllBtn = clearAllSection.createEl('button', {
      text: '🗑️ Delete All Conversations',
      cls: 'ai-clear-all-btn'
    });
    clearAllBtn.style.width = '100%';
    clearAllBtn.style.padding = '12px';
    clearAllBtn.style.borderRadius = '8px';
    clearAllBtn.style.border = '1px solid var(--text-error)';
    clearAllBtn.style.backgroundColor = 'rgba(var(--background-modifier-error-rgb), 0.1)';
    clearAllBtn.style.color = 'var(--text-error)';
    clearAllBtn.style.cursor = 'pointer';
    clearAllBtn.style.fontSize = '14px';
    
    clearAllBtn.addEventListener('click', () => {
      if (confirm('Delete ALL conversations? This cannot be undone.')) {
        this.plugin._sessionManager.sessions = [];
        this.plugin._sessionManager.create('Default Conversation');
        this.plugin.saveState();
        this.showConversationsSettings(container);
        new Notice('All conversations deleted');
        this.refreshChatViews();
      }
    });
  }

  async saveConversationToFile(session) {
    try {
      const content = this.plugin._sessionManager.exportToMarkdown(session);
      const folderPath = this.plugin.settings.conversationsFolder || 'AI Conversations';
      const fileName = `${session.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      
      const folderExists = await this.app.vault.adapter.exists(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
      
      await this.app.vault.create(fullPath, content);
      new Notice(`✅ Conversation saved to: ${fullPath}`);
    } catch (error) {
      console.error('Error saving conversation:', error);
      new Notice(`❌ Error saving conversation: ${error.message}`);
    }
  }

  refreshChatViews() {
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof ChatView) {
        leaf.view._renderMessages();
        leaf.view.updateTokenCounterVisibility();
      }
    });
  }
  
  createInputField(container, label, key, value, type = 'text', placeholder = '') {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.style.marginBottom = '16px';
    
    row.createEl('label', { text: label }).style.display = 'block';
    
    const input = row.createEl('input', {
      type: type,
      value: value,
      placeholder: placeholder
    });
    input.style.width = '100%';
    input.style.padding = '10px 14px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid var(--background-modifier-border)';
    input.style.backgroundColor = 'var(--background-primary)';
    input.style.color = 'var(--text-normal)';
    input.style.fontSize = '14px';
    input.style.boxSizing = 'border-box';
    
    input.addEventListener('change', (e) => {
      this.plugin.settings[key] = type === 'number' ? parseInt(e.target.value) : e.target.value;
    });
    
    return input;
  }

  createShortcutField(container, label, parentKey, shortcutKey, value) {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.style.marginBottom = '16px';
    
    row.createEl('label', { text: label }).style.display = 'block';
    
    const input = row.createEl('input', {
      type: 'text',
      value: value,
      placeholder: 'Example: Ctrl+Shift+N'
    });
    input.style.width = '100%';
    input.style.padding = '10px 14px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid var(--background-modifier-border)';
    input.style.backgroundColor = 'var(--background-primary)';
    input.style.color = 'var(--text-normal)';
    input.style.fontSize = '14px';
    input.style.boxSizing = 'border-box';
    
    input.addEventListener('change', (e) => {
      this.plugin.settings[parentKey][shortcutKey] = e.target.value;
    });
    
    return input;
  }
  
  createSliderField(container, label, key, value, min, max, step) {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.style.marginBottom = '16px';
    
    const labelRow = row.createDiv({ style: 'display: flex; justify-content: space-between;' });
    labelRow.createEl('label', { text: label });
    const valueSpan = labelRow.createEl('span', { text: value, cls: 'ai-slider-value' });
    valueSpan.style.fontWeight = '600';
    valueSpan.style.color = 'var(--interactive-accent)';
    
    const slider = row.createEl('input', {
      type: 'range',
      value: value,
      min: min,
      max: max,
      step: step
    });
    slider.style.width = '100%';
    slider.style.height = '6px';
    slider.style.borderRadius = '3px';
    slider.style.background = 'var(--background-modifier-border)';
    
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.plugin.settings[key] = val;
      valueSpan.textContent = val.toFixed(1);
    });
    
    return slider;
  }
  
  createCheckboxField(container, label, key, checked) {
    const row = container.createDiv({ cls: 'ai-settings-row checkbox' });
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '16px';
    
    const checkbox = row.createEl('input', {
      type: 'checkbox',
      checked: checked
    });
    checkbox.style.width = '18px';
    checkbox.style.height = '18px';
    checkbox.style.accentColor = 'var(--interactive-accent)';
    
    checkbox.addEventListener('change', (e) => {
      this.plugin.settings[key] = e.target.checked;
    });
    
    row.createEl('label', { text: label }).style.cursor = 'pointer';
    row.prepend(checkbox);
    
    return checkbox;
  }
  
  onClose() {
    this.contentEl.empty();
  }
}

// ==================== MAIN PLUGIN ====================

module.exports = class AIPlugin extends Plugin {
  async onload() {
    this.loadCSS();
    await this.loadSettings();
    
    const saved = await this.loadData();
    this._sessionManager = saved && saved.sessions ? new SessionManager(saved.sessions) : new SessionManager();
    if (!this._sessionManager.sessions.length) this._sessionManager.create('Default Conversation', '');

    this.apiManager = new APIManager(this);
    this.inNoteAI = new InNoteAIInteractions(this);
    this.networkManager = new NetworkManager(this);

    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon('brain', 'AI Assistant', () => {
      this.openSidebar();
    });

    this.addCommand({
      id: 'ai-open-sidebar',
      name: 'Open AI Assistant Sidebar',
      callback: async () => this.openSidebar()
    });
    
    this.addCommand({
      id: 'ai-reply-in-note',
      name: 'Stream AI response in current note',
      editorCallback: (editor) => this.replyInNote(editor)
    });

    this.addCommand({
      id: 'ai-new-conversation',
      name: 'New Conversation',
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "N" }],
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(ChatView);
        if (activeView) {
          activeView.createNewConversation();
        } else {
          const name = prompt('New conversation name:', `Conversation ${this._sessionManager.sessions.length + 1}`);
          if (name && name.trim()) {
            this._sessionManager.create(name.trim());
            this.saveState();
            new Notice(`✅ Created conversation: ${name}`);
          }
        }
      }
    });

    this.addCommand({
      id: 'ai-save-conversation',
      name: 'Save Current Conversation',
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "S" }],
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(ChatView);
        if (activeView) {
          activeView.saveCurrentConversation();
        } else {
          this.saveCurrentConversationFromAnywhere();
        }
      }
    });

    if (this.settings.autoCheckHealth) {
      setTimeout(() => this.checkHealthAndNotify(), 3000);
    }
  }

  loadCSS() {
    const styleEl = document.createElement('style');
    styleEl.id = 'ai-plugin-css';
    styleEl.textContent = `
      @keyframes ai-float-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      .ai-floating-menu {
        animation: ai-float-in 0.2s ease;
      }
      
      .ai-floating-btn:hover {
        transform: scale(1.1) !important;
        background: var(--interactive-accent-hover) !important;
      }
      
      .ai-token-counter {
        transition: all 0.3s ease;
      }
      
      .ai-token-counter:hover {
        transform: scale(1.05);
        box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      }
    `;
    document.head.appendChild(styleEl);
  }

  async checkHealthAndNotify() {
    const health = await this.apiManager.checkHealth();
    if (!health.ok) {
      new Notice(`⚠️ ${health.message}`);
    }
  }

  async saveCurrentConversationFromAnywhere() {
    const session = this._sessionManager.getActive();
    if (!session) {
      new Notice('No active conversation to save');
      return;
    }
    
    try {
      const content = this._sessionManager.exportToMarkdown(session);
      const folderPath = this.settings.conversationsFolder || 'AI Conversations';
      const fileName = `${session.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      
      const folderExists = await this.app.vault.adapter.exists(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
      
      await this.app.vault.create(fullPath, content);
      new Notice(`✅ Conversation saved to: ${fullPath}`);
    } catch (error) {
      console.error('Error saving conversation:', error);
      new Notice(`❌ Error saving conversation: ${error.message}`);
    }
  }

  async replyInNote(editor) {
    const selection = editor.getSelection().trim();
    const prompt = selection.length ? selection : editor.getValue();
    
    const s = this._sessionManager.getActive();
    if (s) {
      this._sessionManager.addMessage('user', prompt);
    }
    
    editor.replaceSelection("\n\n--- 🤖 AI Response ---\n\n");
    
    try {
      await this.apiManager.sendMessage({
        messages: s ? this._sessionManager.getMessagesForRequest() : [{ role: 'user', content: prompt }],
        temperature: this.settings.temperature,
        max_tokens: this.settings.max_tokens,
        stream: true
      }, {
        onChunk: (chunk) => {
          editor.replaceSelection(chunk);
        },
        timeoutMs: this.settings.timeoutMs
      });
      
      editor.replaceSelection("\n\n---\n\n");
      new Notice('✅ Response completed');
    } catch (e) {
      editor.replaceSelection(`\n\n❌ Error: ${e.message}\n\n`);
      new Notice('AI Error: ' + e.message);
    }
  }

  async openSidebar() {
    let leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) leaf = this.app.workspace.getRightLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async saveState() {
    await this.saveData({ ...this.settings, sessions: this._sessionManager.sessions });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() || {});
  }
  
  async saveSettings() { 
    await this.saveData(this.settings);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof ChatView) {
        leaf.view.updateTokenCounterVisibility();
        leaf.view._renderMessages();
      }
    });
  }

  onunload() {
    const styleEl = document.getElementById('ai-plugin-css');
    if (styleEl) {
      styleEl.remove();
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    if (this.networkManager) {
      this.networkManager.abortAllRequests();
    }
  }
};