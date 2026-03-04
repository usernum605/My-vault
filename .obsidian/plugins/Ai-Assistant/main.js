const { Plugin, ItemView, Modal, Notice, MarkdownView, MarkdownRenderer, setIcon } = require('obsidian');

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
  customBodyTemplate: '{"messages": {{messages}}, "model": "{{model}}"}',
  inputPosition: "bottom"
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

      // Process complete lines
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;
        
        const text = processor(line);
        if (text && text.trim().length > 0) {
          accumulatedText += text;
          // Call onChunk immediately for each piece of actual content
          onChunk(text);
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const text = processor(buffer);
      if (text && text.trim().length > 0) {
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
  // Handle SSE format: data: {...}
  if (line.startsWith('data: ')) {
    const data = line.slice(6).trim();
    if (data === '[DONE]') return '';
    
    try {
      const parsed = JSON.parse(data);
      
      // Skip chunks with null content or empty content
      if (parsed.finish_reason === 'stop') return '';
      
      // Ollama format
      if (parsed.message?.content) {
        const content = parsed.message.content;
        // Only return if there's actual content
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      // OpenAI-compatible format with delta
      if (parsed.choices?.[0]?.delta?.content) {
        const content = parsed.choices[0].delta.content;
        // Only return if there's actual content
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      // Standard message format
      if (parsed.choices?.[0]?.message?.content) {
        const content = parsed.choices[0].message.content;
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      // Text format
      if (parsed.choices?.[0]?.text) {
        const content = parsed.choices[0].text;
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      // Simple response format
      if (parsed.response) {
        const content = parsed.response;
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      if (parsed.content) {
        const content = parsed.content;
        if (content && content.trim().length > 0) {
          return content;
        }
        return '';
      }
      
      // If we can't find content but have choices with delta, check if it has content
      if (parsed.choices?.[0]?.delta) {
        const delta = parsed.choices[0].delta;
        if (delta.content && delta.content.trim().length > 0) {
          return delta.content;
        }
        return '';
      }
      
    } catch (e) {
      // If parsing fails, return the raw data if it looks like actual text
      if (data.length > 0 && !data.startsWith('{') && !data.startsWith('[') && 
          data !== 'null' && data !== 'undefined') {
        return data;
      }
    }
    return '';
  }
  
  // Handle plain text streaming (some local servers)
  if (!line.startsWith('{') && !line.startsWith('[') && line.length > 0 &&
      line !== 'null' && line !== 'undefined') {
    return line;
  }
  
  // Try to parse as JSON even without data: prefix
  try {
    const parsed = JSON.parse(line);
    
    // Skip if it's just metadata
    if (parsed.finish_reason === 'stop') return '';
    
    if (parsed.message?.content) {
      const content = parsed.message.content;
      if (content && content.trim().length > 0) return content;
    }
    if (parsed.response) {
      const content = parsed.response;
      if (content && content.trim().length > 0) return content;
    }
    if (parsed.content) {
      const content = parsed.content;
      if (content && content.trim().length > 0) return content;
    }
    if (parsed.choices?.[0]?.delta?.content) {
      const content = parsed.choices[0].delta.content;
      if (content && content.trim().length > 0) return content;
    }
    if (parsed.choices?.[0]?.message?.content) {
      const content = parsed.choices[0].message.content;
      if (content && content.trim().length > 0) return content;
    }
    if (parsed.choices?.[0]?.text) {
      const content = parsed.choices[0].text;
      if (content && content.trim().length > 0) return content;
    }
  } catch {
    // Ignore parsing errors
  }
  
  return '';
}

  processOpenAIChunk(line) {
    if (!line.startsWith('data: ')) return '';
    const data = line.slice(6).trim();
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
    // تصفية أي جلسات مؤقتة قد تكون وردت من التخزين (احتياطي)
    this.sessions = (saved && saved.length) ? saved.filter(s => !s.isTemporary) : [];
    this.activeId = (this.sessions[0] && this.sessions[0].id) || null;
  }
  
  create(name = null, sys = "") {
    this.deleteTemporary(); // حذف أي محادثة مؤقتة موجودة
    const id = Date.now().toString();
    const session = { 
      id, 
      name: name || `Session ${this.sessions.length + 1}`, 
      systemPrompt: sys || "", 
      messages: [],
      isTemporary: false
    };
    this.sessions.push(session);
    this.activeId = id;
    return session;
  }
  
  createTemporary(name = null) {
    this.deleteTemporary(); // حذف أي مؤقتة سابقة
    const id = Date.now().toString() + '_temp';
    const session = {
      id,
      name: name || 'Temporary Chat',
      systemPrompt: "",
      messages: [],
      isTemporary: true
    };
    this.sessions.push(session);
    this.activeId = id;
    return session;
  }
  
  deleteTemporary() {
    const tempSession = this.sessions.find(s => s.isTemporary);
    if (tempSession) {
      this.sessions = this.sessions.filter(s => !s.isTemporary);
      if (this.activeId === tempSession.id) {
        this.activeId = this.sessions.length ? this.sessions[0].id : null;
      }
    }
  }
  
  delete(id) {
    this.sessions = this.sessions.filter(s => s.id !== id);
    if (this.activeId === id) {
      this.activeId = (this.sessions[0] && this.sessions[0].id) || null;
    }
  }
  
  switchTo(id) {
    const targetSession = this.sessions.find(s => s.id === id);
    if (targetSession) {
      // إذا كانت الجلسة النشطة الحالية مؤقتة وتختلف عن الهدف، احذف المؤقتة
      const currentActive = this.getActive();
      if (currentActive && currentActive.isTemporary && currentActive.id !== id) {
        this.deleteTemporary(); // هذا سيحذف المؤقتة فقط، الهدف لا يزال موجوداً
      }
      this.activeId = id;
    }
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
    let content = `---\nThe Topic: \n- ${session.name}\n- Ai Conversations\n---\n`;
    content += `# ${session.name}\n\n`
    content += `**Created:** ${new Date(parseInt(session.id)).toLocaleString()}\n\n`;
    content += `**Messages:** ${session.messages.length}\n\n`;
    
    if (session.systemPrompt) {
      content += `## System Prompt\n${session.systemPrompt}\n\n---\n\n`;
    }
    
    session.messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      content += `###### ${role} (Message ${index + 1}) ${time ? '- ' + time : ''}\n\n`;
      
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

  supportsStreaming() {
    return true;
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

  async sendStreamingRequest(url, headers, body, opts, requestId) {
    const response = await this.networkManager.fetchWithRetry(url, {
      method: 'POST',
      headers,
      body,
      timeout: opts.timeoutMs
    }, requestId);

    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    const accumulatedText = await this.streamingHandler.handleStreamingResponse(
      response,
      (chunk) => {
        if (opts.onChunk) {
          opts.onChunk(chunk);
        }
      },
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
      max_tokens: payload.max_tokens || this.plugin.settings.max_tokens,
      stream: payload.stream || false
    };

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
                return { ok: true, message: '✓ Service is healthy' };
              }
            } catch {
              return { ok: true, message: '✓ Service is reachable' };
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
          return { ok: true, message: '✓ Service is responding' };
        }
      } catch {
        // Ignore
      }
      
      return { ok: false, message: '⨉ Local AI service is not reachable' };
    } catch (error) {
      return { ok: false, message: `⨉ ${error.message}` };
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
        return { ok: false, message: '⨉ Invalid API key' };
      }
      
      return { ok: response.ok, message: response.ok ? '✓ Connected to OpenAI' : `⨉ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `⨉ ${e.message}` };
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
        return { ok: false, message: '⨉ Invalid API key' };
      }
      
      if (response.status === 429) {
        return { ok: false, message: '⏳ Rate limit exceeded. Please wait.' };
      }
      
      return { ok: response.ok, message: response.ok ? '✓ Connected to Gemini' : `⨉ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `⨉ ${e.message}` };
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
        return { ok: false, message: '⨉ Invalid API key' };
      }
      
      return { ok: response.ok, message: response.ok ? '✓ Connected to Anthropic' : `⨉ Error ${response.status}` };
    } catch (e) {
      return { ok: false, message: `⨉ ${e.message}` };
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
        message: `✓ Connection successful. Response: "${testResponse.final.substring(0, 50)}..."` 
      };
    } catch (error) {
      return { 
        ok: false, 
        message: `⨉ ${error.message}` 
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
  
  // Ensure stream is set to true in the payload if we want streaming
  if (opts.onChunk) {
    payload.stream = true;
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
    if (this.plugin.settings.currentMode === 'local') return 'monitor-speaker';
    return 'server';
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
  
  async onOpen() {  // <-- هذا خطأ، هذه دالة PromptModal وليست ChatView
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
    cls: 'ai-shortcuts-btn'
  });
  setIcon(this.shortcutsBtn, 'command');
  this.styleButton(this.shortcutsBtn);
  this.shortcutsBtn.title = 'Shortcuts';

  this.modeToggleBtn = topBar.createEl('button', {
    cls: 'ai-mode-toggle'
  });
  setIcon(this.modeToggleBtn, this.getProviderIcon());
  this.styleButton(this.modeToggleBtn);
  this.modeToggleBtn.title = this.getProviderInfo();

  // زر المحادثة المؤقتة
  this.tempChatBtn = topBar.createEl('button', {
    cls: 'ai-temp-chat-btn'
  });
  setIcon(this.tempChatBtn, 'message-square-dashed');
  this.styleButton(this.tempChatBtn);
  this.tempChatBtn.title = 'New Temporary Chat (unsaved)';

  this.tokenCounter = topBar.createDiv({ 
    cls: 'ai-token-counter'
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
  this.tokenCounter.style.gap = '4px';
  this.tokenCounter.style.minWidth = '70px';
  this.tokenCounter.style.height = '24px';
  
  const tokenIcon = this.tokenCounter.createSpan();
  setIcon(tokenIcon, 'binary');
  tokenIcon.style.display = 'flex';
  
  const tokenText = this.tokenCounter.createSpan();
  tokenText.textContent = '0/8192';
  
  this.updateTokenCounterVisibility();

  const spacer = topBar.createDiv({ cls: 'ai-top-spacer' });
  spacer.style.flex = '1';

  this.settingsBtn = topBar.createEl('button', { 
    cls: 'ai-settings-btn'
  });
  setIcon(this.settingsBtn, 'settings');
  this.styleButton(this.settingsBtn);
  this.settingsBtn.title = 'Settings';

  // الأحداث
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

  this.tempChatBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    this.createTemporaryChat();
  });

  // التحقق من موقع الإدخال المفضل
  const inputPosition = this.plugin.settings.inputPosition || 'bottom';
  
  if (inputPosition === 'bottom') {
    // الترتيب الافتراضي: المحادثة في الأعلى، الإدخال في الأسفل
    await this.createChatArea();
    await this.createInputArea();
  } else {
    // الترتيب المعكوس: الإدخال في الأعلى، المحادثة في الأسفل
    await this.createInputArea();
    await this.createChatArea();
  }

  this._renderMessages();
  this._streaming = true;
  
  if (this.plugin.settings.showTokenCounter) {
    this.inputEl.addEventListener('input', () => this._updateTokenCounter());   
    setTimeout(() => this._updateTokenCounter(), 100);
  }
}

// دالة جديدة لإنشاء منطقة المحادثة
async createChatArea() {
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
}

// دالة جديدة لإنشاء منطقة الإدخال
async createInputArea() {
  const inputWrap = this.containerEl.createDiv({ cls: 'ai-input-wrap' });
  inputWrap.style.position = 'relative';
  inputWrap.style.width = '100%';
  inputWrap.style.marginTop = 'auto';
  inputWrap.style.paddingTop = '8px';
  inputWrap.style.borderTop = '1px solid var(--background-modifier-border)';
  
  this.inputEl = inputWrap.createEl('textarea', { 
    cls: 'ai-input',
    attr: { 
      placeholder: 'Type a message... (Shift+Enter send)',
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
  this.styleFloatingButton(this.attachBtn);
  this.attachBtn.style.bottom = '60px';
  this.attachBtn.title = 'Attach files';

  this.sendBtn = inputWrap.createEl('button', { 
    text: '➤', 
    cls: 'ai-send-btn floating-btn' 
  });
  this.styleFloatingButton(this.sendBtn);
  this.sendBtn.style.bottom = '15px';
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
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      this._onSend();
    }
    // Enter alone creates a new line (default)
  });
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
      editor.replaceRange(`\n\n⨉ Error: ${error.message}\n\n`, editor.getCursor());
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

  // أزرار الهيدر (كما هي)
  this.shortcutsBtn = topBar.createEl('button', {
    cls: 'ai-shortcuts-btn'
  });
  setIcon(this.shortcutsBtn, 'command');
  this.styleButton(this.shortcutsBtn);
  this.shortcutsBtn.title = 'Shortcuts';

  this.modeToggleBtn = topBar.createEl('button', {
    cls: 'ai-mode-toggle'
  });
  setIcon(this.modeToggleBtn, this.getProviderIcon());
  this.styleButton(this.modeToggleBtn);
  this.modeToggleBtn.title = this.getProviderInfo();

  this.tempChatBtn = topBar.createEl('button', {
    cls: 'ai-temp-chat-btn'
  });
  setIcon(this.tempChatBtn, 'message-square-dashed');
  this.styleButton(this.tempChatBtn);
  this.tempChatBtn.title = 'New Temporary Chat (unsaved)';

  this.tokenCounter = topBar.createDiv({ 
    cls: 'ai-token-counter'
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
  this.tokenCounter.style.gap = '4px';
  this.tokenCounter.style.minWidth = '70px';
  this.tokenCounter.style.height = '24px';
  
  const tokenIcon = this.tokenCounter.createSpan();
  setIcon(tokenIcon, 'binary');
  tokenIcon.style.display = 'flex';
  
  const tokenText = this.tokenCounter.createSpan();
  tokenText.textContent = '0/8192';
  
  this.updateTokenCounterVisibility();

  const spacer = topBar.createDiv({ cls: 'ai-top-spacer' });
  spacer.style.flex = '1';

  this.settingsBtn = topBar.createEl('button', { 
    cls: 'ai-settings-btn'
  });
  setIcon(this.settingsBtn, 'settings');
  this.styleButton(this.settingsBtn);
  this.settingsBtn.title = 'Settings';

  // الأحداث
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

  this.tempChatBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    this.createTemporaryChat();
  });

  // التحقق من موقع الإدخال المفضل
  const inputPosition = this.plugin.settings.inputPosition || 'bottom';
  
  if (inputPosition === 'bottom') {
    // الترتيب الافتراضي: المحادثة في الأعلى، الإدخال في الأسفل
    await this.createChatArea();
    await this.createInputArea();
  } else {
    // الترتيب المعكوس: الإدخال في الأعلى، المحادثة في الأسفل
    await this.createInputArea();
    await this.createChatArea();
  }

  this._renderMessages();
  this._streaming = true;
  
  if (this.plugin.settings.showTokenCounter) {
    this.inputEl.addEventListener('input', () => this._updateTokenCounter());   
    setTimeout(() => this._updateTokenCounter(), 100);
  }
}

// دالة جديدة لإنشاء منطقة المحادثة
async createChatArea() {
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
}

// دالة جديدة لإنشاء منطقة الإدخال
async createInputArea() {
  const inputWrap = this.containerEl.createDiv({ cls: 'ai-input-wrap' });
  inputWrap.style.position = 'relative';
  inputWrap.style.width = '100%';
  inputWrap.style.marginTop = 'auto';
  inputWrap.style.paddingTop = '8px';
  inputWrap.style.borderTop = '1px solid var(--background-modifier-border)';
  
  this.inputEl = inputWrap.createEl('textarea', { 
    cls: 'ai-input',
    attr: { 
      placeholder: 'Type a message... (Shift+Enter send)',
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
  this.styleFloatingButton(this.attachBtn);
  this.attachBtn.style.bottom = '60px';
  this.attachBtn.title = 'Attach files';

  this.sendBtn = inputWrap.createEl('button', { 
    text: '➤', 
    cls: 'ai-send-btn floating-btn' 
  });
  this.styleFloatingButton(this.sendBtn);
  this.sendBtn.style.bottom = '15px';
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
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      this._onSend();
    }
  });
}
  
  async refreshLayout() {
  // حفظ المرجع للعناصر الحالية
  const oldChatEl = this.chatEl;
  const oldInputWrap = this.inputEl?.parentElement;
  
  // إزالة العناصر القديمة
  if (oldChatEl) oldChatEl.remove();
  if (oldInputWrap) oldInputWrap.remove();
  
  // إعادة إنشاء حسب الإعداد الجديد
  const inputPosition = this.plugin.settings.inputPosition || 'bottom';
  
  if (inputPosition === 'bottom') {
    await this.createChatArea();
    await this.createInputArea();
  } else {
    await this.createInputArea();
    await this.createChatArea();
  }
  
  // إعادة عرض الرسائل
  this._renderMessages();
  }

  // دوال مساعدة لتنسيق الأزرار
  styleButton(btn) {
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.color = 'var(--text-normal)';
    btn.style.padding = '4px 8px';
    btn.style.borderRadius = '4px';
    btn.style.width = '32px';
    btn.style.height = '32px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
  }

  styleFloatingButton(btn) {
    btn.style.position = 'absolute';
    btn.style.width = '36px';
    btn.style.height = '36px';
    btn.style.borderRadius = '50%';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.fontSize = '16px';
    btn.style.zIndex = '100';
    btn.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
    btn.style.right = '15px';
    btn.style.background = 'var(--interactive-accent)';
    btn.style.color = 'var(--text-on-accent)';
  }

  // دالة إنشاء محادثة مؤقتة
  createTemporaryChat() {
    this.plugin._sessionManager.createTemporary('Temporary Chat');
    this._renderMessages();
    this.plugin.saveState(); // لا يحفظ المؤقتة، فقط الجلسات العادية
    new Notice('Temporary chat created (will be deleted when switching or closing)');
  }

  createNewConversation() {
    const name = prompt('New conversation name:', `Conversation ${this.plugin._sessionManager.sessions.length + 1}`);
    if (name && name.trim()) {
      this.plugin._sessionManager.create(name.trim());
      this._renderMessages();
      this.plugin.saveState();
      new Notice(`✓ Created conversation: ${name}`);
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
        const baseName = session.name.replace(/[\\/:*?"<>|]/g, '_');
        
        // Ensure folder exists
        const folderExists = await this.app.vault.adapter.exists(folderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(folderPath);
        }
        
        // Get unique file path
        const fullPath = await this.plugin.getUniqueFilePath(folderPath, baseName, 'md');
        
        await this.app.vault.create(fullPath, content);
        new Notice(`✓ Conversation saved to: ${fullPath}`);
    } catch (error) {
        console.error('Error saving conversation:', error);
        new Notice(`⨉ Error saving conversation: ${error.message}`);
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
    
    this.modeToggleBtn.empty();
    setIcon(this.modeToggleBtn, this.getProviderIcon());
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
      this.tokenCounter.empty();
      const tokenIcon = this.tokenCounter.createSpan();
      setIcon(tokenIcon, 'binary');
      tokenIcon.style.display = 'flex';
      
      const tokenText = this.tokenCounter.createSpan();
      tokenText.textContent = `${totalTokens}/${maxTokens}`;
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
        new Notice(`✓ ${attachmentCount} file${attachmentCount > 1 ? 's' : ''} ready to attach`);
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
    
    // Add user message with attachments
    this.plugin._sessionManager.addMessage('user', txt, this.pendingAttachments);
    this.plugin.saveState();
    
    // Display user message
    this._appendBubble('user', txt, this.pendingAttachments);
    
    // Clear input and attachments
    this.inputEl.value = '';
    const currentAttachments = [...this.pendingAttachments];
    this.pendingAttachments = [];

    const messages = this.plugin._sessionManager.getMessagesForRequest();

    let acc = '';
    let hasReceivedContent = false;
    
    // Create an empty message container for streaming
    const msgContainer = this.chatEl.createDiv({ cls: `ai-msg-container assistant` });
    msgContainer.style.marginBottom = '16px';
    msgContainer.style.maxWidth = '88%';
    msgContainer.style.alignSelf = 'flex-end';
    
    const streamingMsg = msgContainer.createDiv({ cls: `ai-msg assistant` });
    streamingMsg.style.padding = '12px 16px';
    streamingMsg.style.borderRadius = '12px 12px 12px 4px';
    streamingMsg.style.background = 'var(--background-secondary)';
    streamingMsg.style.color = 'var(--text-normal)';
    streamingMsg.style.lineHeight = '1.5';
    streamingMsg.style.whiteSpace = 'pre-wrap';
    streamingMsg.style.wordBreak = 'break-word';
    streamingMsg.style.fontSize = '14px';
    streamingMsg.textContent = ''; // Start empty
    
    try {
      const result = await this.plugin.apiManager.sendMessage({
        messages: messages,
        temperature: this.plugin.settings.temperature,
        max_tokens: this.plugin.settings.max_tokens,
        stream: true
      }, {
        onChunk: (chunk) => {
          // Only process non-empty chunks
          if (chunk && chunk.trim().length > 0) {
            acc += chunk;
            hasReceivedContent = true;
            streamingMsg.textContent = acc;
            this.chatEl.scrollTop = this.chatEl.scrollHeight;
          }
        },
        timeoutMs: this.plugin.settings.timeoutMs
      });
      
      const finalText = (result && result.final) ? result.final : acc;
      
      // If we never received any content but have a final result
      if (!hasReceivedContent && finalText) {
        streamingMsg.textContent = finalText;
      }
      
      // If we received content, render it with Markdown
      if (hasReceivedContent || finalText) {
        const displayText = finalText || acc;
        streamingMsg.empty();
        MarkdownRenderer.render(this.app, displayText, streamingMsg, '', this.plugin);
        
        // Add assistant message to history
        this.plugin._sessionManager.addMessage('assistant', displayText, currentAttachments);
        this.plugin.saveState();
      } else {
        // If no content at all, show an error
        streamingMsg.textContent = '⨉ No response received';
      }
      
    } catch (e) {
      console.error("Chat Error:", e);
      
      let errorMessage = '⨉ Error occurred';
      if (e.message.includes('429')) {
        errorMessage = '⏳ Rate limit exceeded. Please wait a moment and try again Or Try changing the model.';
      } else if (e.message.includes('401') || e.message.includes('403')) {
        errorMessage = '🔐 Authentication failed. Please check your API key.';
      } else if (e.message.includes('timeout')) {
        errorMessage = '⏱️ Request timed out. Check your internet connection.';
      } else if (e.message.includes('fetch') || e.message.includes('Failed to fetch')) {
        errorMessage = '🌐 Cannot connect to Local AI. Please check if the server is running at ' + this.plugin.settings.baseUrl;
      } else {
        errorMessage = `⨉ Error: ${e.message}`;
      }
      
      streamingMsg.textContent = errorMessage;
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
    contentEl.style.minWidth = '100%';
    contentEl.style.maxWidth = '100%';
    
    const h2 = contentEl.createEl('h2');
    h2.style.display = 'flex';
    h2.style.alignItems = 'center';
    const h2Icon = h2.createSpan();
    setIcon(h2Icon, 'settings');
    h2Icon.style.marginRight = '8px';
    h2.appendChild(document.createTextNode('AI Assistant Settings'));
    
    const tabsContainer = contentEl.createDiv({ cls: 'ai-settings-tabs' });
    tabsContainer.style.display = 'flex';
    tabsContainer.style.gap = '8px';
    tabsContainer.style.marginBottom = '20px';
    tabsContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
    tabsContainer.style.paddingBottom = '10px';
    tabsContainer.style.flexWrap = 'wrap';
    
    const localTab = tabsContainer.createEl('button', { cls: 'ai-tab-btn active' });
    const localIcon = localTab.createSpan();
    setIcon(localIcon, 'monitor-speaker');
    localIcon.style.marginRight = '6px';
    localIcon.style.display = 'inline-flex';
    localTab.appendChild(document.createTextNode('Local Model'));
    
    const cloudTab = tabsContainer.createEl('button', { cls: 'ai-tab-btn' });
    const cloudIcon = cloudTab.createSpan();
    setIcon(cloudIcon, 'server');
    cloudIcon.style.marginRight = '6px';
    cloudIcon.style.display = 'inline-flex';
    cloudTab.appendChild(document.createTextNode('Cloud Model'));
    
    const generalTab = tabsContainer.createEl('button', { cls: 'ai-tab-btn' });
    const generalIcon = generalTab.createSpan();
    setIcon(generalIcon, 'settings');
    generalIcon.style.marginRight = '6px';
    generalIcon.style.display = 'inline-flex';
    generalTab.appendChild(document.createTextNode('General'));
    
    const shortcutsTab = tabsContainer.createEl('button', { cls: 'ai-tab-btn' });
    const shortcutsIcon = shortcutsTab.createSpan();
    setIcon(shortcutsIcon, 'command');
    shortcutsIcon.style.marginRight = '6px';
    shortcutsIcon.style.display = 'inline-flex';
    shortcutsTab.appendChild(document.createTextNode('Shortcuts'));
    
    const conversationsTab = tabsContainer.createEl('button', { cls: 'ai-tab-btn' });
    const convIcon = conversationsTab.createSpan();
    setIcon(convIcon, 'message-square');
    convIcon.style.marginRight = '6px';
    convIcon.style.display = 'inline-flex';
    conversationsTab.appendChild(document.createTextNode('Conversations'));
    
    [localTab, cloudTab, generalTab, shortcutsTab, conversationsTab].forEach(tab => {
      tab.style.padding = '10px 16px';
      tab.style.border = 'none';
      tab.style.background = 'transparent';
      tab.style.color = 'var(--text-muted)';
      tab.style.cursor = 'pointer';
      tab.style.borderRadius = '6px';
      tab.style.fontSize = '14px';
      tab.style.display = 'flex';
      tab.style.alignItems = 'center';
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
    
    const saveBtn = buttonRow.createEl('button', { cls: 'ai-settings-save-btn' });
    const saveIcon = saveBtn.createSpan();
    setIcon(saveIcon, 'save');
    saveIcon.style.marginRight = '6px';
    saveIcon.style.display = 'inline-flex';
    saveIcon.style.verticalAlign = 'middle';
    const saveText = saveBtn.createSpan();
    saveText.textContent = 'Save';
    saveText.style.verticalAlign = 'middle';
    
    saveBtn.style.padding = '10px 24px';
    saveBtn.style.borderRadius = '8px';
    saveBtn.style.border = 'none';
    saveBtn.style.background = 'var(--interactive-accent)';
    saveBtn.style.color = 'var(--text-on-accent)';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.fontSize = '14px';
    saveBtn.style.fontWeight = '600';
    
    const cancelBtn = buttonRow.createEl('button', { cls: 'ai-settings-cancel-btn' });
    const cancelIcon = cancelBtn.createSpan();
    setIcon(cancelIcon, 'x');
    cancelIcon.style.marginRight = '6px';
    cancelIcon.style.display = 'inline-flex';
    cancelIcon.style.verticalAlign = 'middle';
    const cancelText = cancelBtn.createSpan();
    cancelText.textContent = 'Cancel';
    cancelText.style.verticalAlign = 'middle';
    
    cancelBtn.style.padding = '10px 24px';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.border = '1px solid var(--background-modifier-border)';
    cancelBtn.style.background = 'transparent';
    cancelBtn.style.color = 'var(--text-normal)';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.fontSize = '14px';
    
    saveBtn.addEventListener('click', async () => {
      await this.plugin.saveSettings();
      new Notice('✓ Settings saved successfully!');
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
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'monitor-speaker');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Local Model Configuration'));
    
    this.createInputField(section, 'Base URL:', 'baseUrl', this.plugin.settings.baseUrl, 'text', 'http://127.0.0.1:11434');
    this.createInputField(section, 'Endpoint:', 'localEndpoint', this.plugin.settings.localEndpoint, 'text', '/v1/chat/completions');
    this.createInputField(section, 'Model Name:', 'localModel', this.plugin.settings.localModel, 'text', 'llama2');
    
    const testBtn = section.createEl('button', { cls: 'ai-test-btn' });
    const testIcon = testBtn.createSpan();
    setIcon(testIcon, 'refresh-cw');
    testIcon.style.marginRight = '6px';
    testIcon.style.display = 'inline-flex';
    testIcon.style.verticalAlign = 'middle';
    const testText = testBtn.createSpan();
    testText.textContent = 'Test Connection';
    testText.style.verticalAlign = 'middle';
    
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
          new Notice('✓ ' + health.message);
        } else {
          new Notice('⨉ ' + health.message);
        }
      } catch (e) {
        new Notice('⨉ Error: ' + e.message);
      } finally {
        testBtn.disabled = false;
        testBtn.empty();
        const icon = testBtn.createSpan();
        setIcon(icon, 'refresh-cw');
        icon.style.marginRight = '6px';
        icon.style.display = 'inline-flex';
        icon.style.verticalAlign = 'middle';
        const text = testBtn.createSpan();
        text.textContent = 'Test Connection';
        text.style.verticalAlign = 'middle';
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
    
    const h3 = apiTypeSection.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'server');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Cloud Provider Selection'));

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
      { id: 'openai', name: 'OpenAI', icon: 'cpu' },
      { id: 'gemini', name: 'Gemini', icon: 'sparkles' },
      { id: 'anthropic', name: 'Claude', icon: 'cloud' },
      { id: 'custom', name: 'Custom', icon: 'settings' }
    ];

    providers.forEach(provider => {
      const btn = row.createEl('button', {
        cls: `ai-provider-btn ${this.plugin.settings.cloudApiType === provider.id ? 'active' : ''}`
      });
      
      const iconSpan = btn.createSpan();
      setIcon(iconSpan, provider.icon);
      iconSpan.style.marginRight = '6px';
      iconSpan.style.display = 'inline-flex';
      iconSpan.style.verticalAlign = 'middle';
      
      const textSpan = btn.createSpan();
      textSpan.textContent = provider.name;
      textSpan.style.verticalAlign = 'middle';
      
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
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'cpu');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('OpenAI Configuration'));

    this.createInputField(section, 'API Key:', 'openaiApiKey', 
      this.plugin.settings.openaiApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'openaiModel', 
      this.plugin.settings.openaiModel, 'text', 'gpt-3.5-turbo');
    
    this.createInputField(section, 'Custom Endpoint (optional):', 'openaiEndpoint', 
      this.plugin.settings.openaiEndpoint, 'text', 'https://api.openai.com/v1/chat/completions');
    
    const testBtn = section.createEl('button', { cls: 'ai-test-btn' });
    const testIcon = testBtn.createSpan();
    setIcon(testIcon, 'refresh-cw');
    testIcon.style.marginRight = '6px';
    testIcon.style.display = 'inline-flex';
    testIcon.style.verticalAlign = 'middle';
    const testText = testBtn.createSpan();
    testText.textContent = 'Test Connection';
    testText.style.verticalAlign = 'middle';
    
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
      testBtn.empty();
      const icon = testBtn.createSpan();
      setIcon(icon, 'refresh-cw');
      icon.style.marginRight = '6px';
      icon.style.display = 'inline-flex';
      icon.style.verticalAlign = 'middle';
      const text = testBtn.createSpan();
      text.textContent = 'Test Connection';
      text.style.verticalAlign = 'middle';
    });
  }
  
  showGeminiSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'sparkles');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Google Gemini Configuration (Non-Streaming)'));
    
    this.createInputField(section, 'API Key:', 'geminiApiKey', 
      this.plugin.settings.geminiApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'geminiModel', 
      this.plugin.settings.geminiModel, 'text', 'gemini-1.5-flash');
    
    const testBtn = section.createEl('button', { cls: 'ai-test-btn' });
    const testIcon = testBtn.createSpan();
    setIcon(testIcon, 'refresh-cw');
    testIcon.style.marginRight = '6px';
    testIcon.style.display = 'inline-flex';
    testIcon.style.verticalAlign = 'middle';
    const testText = testBtn.createSpan();
    testText.textContent = 'Test Connection';
    testText.style.verticalAlign = 'middle';
    
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
      testBtn.empty();
      const icon = testBtn.createSpan();
      setIcon(icon, 'refresh-cw');
      icon.style.marginRight = '6px';
      icon.style.display = 'inline-flex';
      icon.style.verticalAlign = 'middle';
      const text = testBtn.createSpan();
      text.textContent = 'Test Connection';
      text.style.verticalAlign = 'middle';
    });
  }

  showAnthropicSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'cloud');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Anthropic Claude Configuration'));

    this.createInputField(section, 'API Key:', 'anthropicApiKey', 
      this.plugin.settings.anthropicApiKey, 'password');
    
    this.createInputField(section, 'Model:', 'anthropicModel', 
      this.plugin.settings.anthropicModel, 'text', 'claude-3-haiku-20240307');
    
    const testBtn = section.createEl('button', { cls: 'ai-test-btn' });
    const testIcon = testBtn.createSpan();
    setIcon(testIcon, 'refresh-cw');
    testIcon.style.marginRight = '6px';
    testIcon.style.display = 'inline-flex';
    testIcon.style.verticalAlign = 'middle';
    const testText = testBtn.createSpan();
    testText.textContent = 'Test Connection';
    testText.style.verticalAlign = 'middle';
    
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
      testBtn.empty();
      const icon = testBtn.createSpan();
      setIcon(icon, 'refresh-cw');
      icon.style.marginRight = '6px';
      icon.style.display = 'inline-flex';
      icon.style.verticalAlign = 'middle';
      const text = testBtn.createSpan();
      text.textContent = 'Test Connection';
      text.style.verticalAlign = 'middle';
    });
  }

  showCustomSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'settings');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Custom API Configuration'));

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

    const testBtn = section.createEl('button', { cls: 'ai-test-btn' });
    const testIcon = testBtn.createSpan();
    setIcon(testIcon, 'refresh-cw');
    testIcon.style.marginRight = '6px';
    testIcon.style.display = 'inline-flex';
    testIcon.style.verticalAlign = 'middle';
    const testText = testBtn.createSpan();
    testText.textContent = 'Test Connection';
    testText.style.verticalAlign = 'middle';
    
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
      testBtn.empty();
      const icon = testBtn.createSpan();
      setIcon(icon, 'refresh-cw');
      icon.style.marginRight = '6px';
      icon.style.display = 'inline-flex';
      icon.style.verticalAlign = 'middle';
      const text = testBtn.createSpan();
      text.textContent = 'Test Connection';
      text.style.verticalAlign = 'middle';
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
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'settings');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('General Settings'));
    
    this.createSliderField(section, 'Temperature:', 'temperature', this.plugin.settings.temperature, 0, 2, 0.1);
    this.createInputField(section, 'Max Tokens:', 'max_tokens', this.plugin.settings.max_tokens, 'number', '2048');
    this.createInputField(section, 'Conversations Folder:', 'conversationsFolder', this.plugin.settings.conversationsFolder, 'text', 'AI Conversations');
    this.createInputField(section, 'Timeout (ms):', 'timeoutMs', this.plugin.settings.timeoutMs, 'number', '120000');
    this.createCheckboxField(section, 'Auto-check health on startup:', 'autoCheckHealth', this.plugin.settings.autoCheckHealth);
    this.createCheckboxField(section, 'Show token counter:', 'showTokenCounter', this.plugin.settings.showTokenCounter);
    this.createInputPositionSelector(section);
  }

  showShortcutsSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.style.background = 'var(--background-secondary)';
    section.style.borderRadius = '8px';
    section.style.padding = '20px';
    section.style.marginBottom = '20px';
    section.style.border = '1px solid var(--background-modifier-border)';
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'command');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Keyboard Shortcuts'));
    
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
    
    const h3 = section.createEl('h3');
    h3.style.display = 'flex';
    h3.style.alignItems = 'center';
    const h3Icon = h3.createSpan();
    setIcon(h3Icon, 'message-square');
    h3Icon.style.marginRight = '8px';
    h3.appendChild(document.createTextNode('Conversation Management'));
    
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
        
        const nameSpan = sessionInfo.createEl('div', { cls: 'ai-session-name' });
        if (session.isTemporary) {
          const tempIcon = nameSpan.createSpan();
          setIcon(tempIcon, 'message-square-dashed');
          tempIcon.style.marginRight = '6px';
          tempIcon.style.display = 'inline-flex';
          tempIcon.style.verticalAlign = 'middle';
          const textSpan = nameSpan.createSpan();
          textSpan.textContent = session.name;
          textSpan.style.verticalAlign = 'middle';
          
          sessionRow.style.backgroundColor = 'rgba(255, 193, 7, 0.1)';
        } else {
          nameSpan.textContent = session.name;
        }
        
        nameSpan.style.fontWeight = '600';
        nameSpan.style.fontSize = '14px';
        nameSpan.style.color = session.isTemporary ? '#ffb74d' : 'var(--text-normal)';
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
        
        const saveBtn = sessionActions.createEl('button', { cls: 'ai-session-action-btn save' });
        const saveIcon = saveBtn.createSpan();
        setIcon(saveIcon, 'save');
        saveIcon.style.marginRight = '4px';
        saveIcon.style.display = 'inline-flex';
        saveIcon.style.verticalAlign = 'middle';
        const saveText = saveBtn.createSpan();
        saveText.textContent = 'Save';
        saveText.style.verticalAlign = 'middle';
        
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
    
    const newSessionBtn = newSessionSection.createEl('button', { cls: 'ai-new-session-btn' });
    const newIcon = newSessionBtn.createSpan();
    setIcon(newIcon, 'plus');
    newIcon.style.marginRight = '6px';
    newIcon.style.display = 'inline-flex';
    newIcon.style.verticalAlign = 'middle';
    const newText = newSessionBtn.createSpan();
    newText.textContent = 'New Conversation';
    newText.style.verticalAlign = 'middle';
    
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
      new Notice(`✓ Created conversation: ${name}`);
      newSessionInput.value = '';
      this.refreshChatViews();
    });
    
    const clearAllSection = section.createDiv({ cls: 'ai-clear-all-section' });
    clearAllSection.style.marginTop = '16px';
    clearAllSection.style.paddingTop = '16px';
    clearAllSection.style.borderTop = '1px solid var(--background-modifier-border)';
    
    const clearAllBtn = clearAllSection.createEl('button', { cls: 'ai-clear-all-btn' });
    const clearIcon = clearAllBtn.createSpan();
    setIcon(clearIcon, 'trash-2');
    clearIcon.style.marginRight = '6px';
    clearIcon.style.display = 'inline-flex';
    clearIcon.style.verticalAlign = 'middle';
    const clearText = clearAllBtn.createSpan();
    clearText.textContent = 'Delete All Conversations';
    clearText.style.verticalAlign = 'middle';
    
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
        const baseName = session.name.replace(/[\\/:*?"<>|]/g, '_');
        
        const folderExists = await this.app.vault.adapter.exists(folderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(folderPath);
        }
        
        const fullPath = await this.plugin.getUniqueFilePath(folderPath, baseName, 'md');
        
        await this.app.vault.create(fullPath, content);
        new Notice(`✓ Conversation saved to: ${fullPath}`);
    } catch (error) {
        console.error('Error saving conversation:', error);
        new Notice(`⨉ Error saving conversation: ${error.message}`);
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
  
  createInputPositionSelector(container) {
  const row = container.createDiv({ cls: 'ai-settings-row' });
  row.style.marginBottom = '16px';
  row.style.padding = '12px';
  row.style.background = 'var(--background-primary)';
  row.style.borderRadius = '8px';
  row.style.border = '1px solid var(--background-modifier-border)';
  
  const label = row.createEl('label', { text: 'Input Field Position:' });
  label.style.display = 'block';
  label.style.marginBottom = '8px';
  label.style.fontWeight = '600';
  
  const optionsRow = row.createDiv({ style: 'display: flex; gap: 20px;' });
  
  // خيار الأسفل (افتراضي)
  const bottomOption = optionsRow.createDiv({ style: 'display: flex; align-items: center; gap: 6px;' });
  const bottomRadio = bottomOption.createEl('input', {
    type: 'radio',
    name: 'inputPosition',
    value: 'bottom',
    attr: { id: 'input-bottom' }
  });
  bottomRadio.checked = this.plugin.settings.inputPosition === 'bottom';
  bottomRadio.addEventListener('change', (e) => {
    if (e.target.checked) {
      this.plugin.settings.inputPosition = 'bottom';
    }
  });
  
  const bottomLabel = bottomOption.createEl('label', { 
    text: 'Bottom',
    attr: { for: 'input-bottom' }
  });
  bottomLabel.style.cursor = 'pointer';
  
  // خيار الأعلى
  const topOption = optionsRow.createDiv({ style: 'display: flex; align-items: center; gap: 6px;' });
  const topRadio = topOption.createEl('input', {
    type: 'radio',
    name: 'inputPosition',
    value: 'top',
    attr: { id: 'input-top' }
  });
  topRadio.checked = this.plugin.settings.inputPosition === 'top';
  topRadio.addEventListener('change', (e) => {
    if (e.target.checked) {
      this.plugin.settings.inputPosition = 'top';
    }
  });
  
  const topLabel = topOption.createEl('label', { 
    text: 'Top',
    attr: { for: 'input-top' }
  });
  topLabel.style.cursor = 'pointer';
  
  const previewDiv = row.createDiv({ 
    style: 'margin-top: 12px; padding: 8px; background: var(--background-secondary); border-radius: 6px; font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 8px;' 
  });
  }
  
  onClose() {
    this.contentEl.empty();
  }
}

// ==================== MAIN PLUGIN ====================

module.exports = class AIPlugin extends Plugin {
  async getUniqueFilePath(folderPath, baseName, extension = 'md') {
    let counter = 1;
    let fileName = `${baseName}.${extension}`;
    let fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
    
    if (await this.app.vault.adapter.exists(fullPath)) {
        new Notice(`File already exists, copy from conversation '${fileName}'`);
        
        while (await this.app.vault.adapter.exists(fullPath)) {
            fileName = `${baseName} (${counter}).${extension}`;
            fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
            counter++;
        }
    }
    
    return fullPath;
  }
  async onload() {
    this.loadCSS();
    await this.loadSettings();
    
    const saved = await this.loadData();
    // تمرير الجلسات المحفوظة إلى SessionManager، وسيقوم بتصفية المؤقتة تلقائياً
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
            new Notice(`✓ Created conversation: ${name}`);
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
        const baseName = session.name.replace(/[\\/:*?"<>|]/g, '_');
        
        const folderExists = await this.app.vault.adapter.exists(folderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(folderPath);
        }
        
        const fullPath = await this.getUniqueFilePath(folderPath, baseName, 'md');
        
        await this.app.vault.create(fullPath, content);
        new Notice(`✓ Conversation saved to: ${fullPath}`);
    } catch (error) {
        console.error('Error saving conversation:', error);
        new Notice(`⨉ Error saving conversation: ${error.message}`);
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
      new Notice('✓ Response completed');
    } catch (e) {
      editor.replaceSelection(`\n\n⨉ Error: ${e.message}\n\n`);
      new Notice('AI Error: ' + e.message);
    }
  }

  async openSidebar() {
    let leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) leaf = this.app.workspace.getRightLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // دالة حفظ الحالة: نحفظ فقط الجلسات غير المؤقتة
  async saveState() {
    const nonTemporarySessions = this._sessionManager.sessions.filter(s => !s.isTemporary);
    await this.saveData({ ...this.settings, sessions: nonTemporarySessions });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() || {});
  }
  
  async saveSettings() { 
  await this.saveData(this.settings);
  this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
    if (leaf.view instanceof ChatView) {
      leaf.view.updateTokenCounterVisibility();
      leaf.view.refreshLayout(); 
    }
  });
  }

  onunload() {
    // حذف أي محادثة مؤقتة عند إغلاق البرنامج المساعد
    if (this._sessionManager) {
      this._sessionManager.deleteTemporary();
    }
    const styleEl = document.getElementById('ai-plugin-css');
    if (styleEl) {
      styleEl.remove();
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    if (this.networkManager) {
      this.networkManager.abortAllRequests();
    }
  }
}