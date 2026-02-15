const { Plugin, ItemView, Modal, Notice, MarkdownView, MarkdownRenderer } = require('obsidian');

const VIEW_TYPE = 'ai-sidebar';

const DEFAULT_SETTINGS = {
  // ===  النموذج المحلي ===
  baseUrl: "http://127.0.0.1:8000",
  localModel: "qwen2.5-3b-instruct",
  localEndpoint: "/v1/chat/completions",
  
  // ===  عامة ===
  temperature: 0.7,
  max_tokens: 256,
  autoCheckHealth: true,
  timeoutMs: 120000,
  showTokenCounter: true,
  
  // === اختصارات ===
  shortcuts: {
    newConversation: 'Ctrl+Shift+N',
    saveConversation: 'Ctrl+Shift+S',
    settings: 'Ctrl+Shift+P'
  },
  
  // === مجلد المحادثات المحفوظة ===
  conversationsFolder: "AI Conversations",
  
  // === نظام APIs المتعدد ===
  currentMode: 'local', // 'local' أو 'cloud'
  cloudApiType: 'gemini', // 'openai', 'gemini', 'anthropic', 'custom'
  
  // ===  OpenAI ===
  openaiApiKey: "",
  openaiModel: "gpt-3.5-turbo",
  openaiEndpoint: "https://api.openai.com/v1/chat/completions",
  
  // ===  Gemini ===
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  geminiEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
  
  // ===  Anthropic (Claude) ===
  anthropicApiKey: "",
  anthropicModel: "claude-3-haiku-20240307",
  anthropicEndpoint: "https://api.anthropic.com/v1/messages",
  
  // ===  مخصصة ===
  customApiKey: "",
  customModel: "",
  customEndpoint: "",
  customHeaders: "{}",
  customBodyTemplate: '{"messages": {{messages}}, "model": "{{model}}"}'
};

// دالة مساعدة لقَص النص
function trimContent(text, maxChars = 4000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[تم قص المحتوى تلقائياً...]";
}

// ----- دالة تقدير التوكنات (تقريبية) -----
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ========== دوال الطلب العامة ==========
async function makeRequest(url, headers, body, streaming, opts) {
  if (streaming) {
    return handleStreamingRequest(url, headers, body, opts);
  } else {
    return handleNormalRequest(url, headers, body, opts);
  }
}

async function handleNormalRequest(url, headers, body, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 120000);

  try {
    console.log("Sending request to:", url);
    console.log("Request body:", body);

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error Response:", errorText);
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const data = await response.json();
    console.log("API Response:", data);
    
    // استخراج النص من مختلف الـ APIs
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return { final: data.choices[0].message.content };
    } else if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return { final: data.candidates[0].content.parts[0].text };
    } else if (data.content && data.content[0] && data.content[0].text) {
      return { final: data.content[0].text };
    } else if (data.message && data.message.content) {
      return { final: data.message.content };
    } else if (data.choices && data.choices[0] && data.choices[0].text) {
      return { final: data.choices[0].text };
    } else {
      console.warn("Unexpected response format:", data);
      return { final: JSON.stringify(data) };
    }
  } catch (error) {
    clearTimeout(timeout);
    console.error("Request failed:", error);
    throw error;
  }
}

async function handleStreamingRequest(url, headers, body, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 120000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: body,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            return { final: acc };
          }

          try {
            const parsed = JSON.parse(data);
            let text = '';
            if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) {
              text = parsed.choices[0].delta.content || '';
            } else if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content) {
              text = parsed.candidates[0].content.parts[0].text || '';
            } else if (parsed.content && parsed.content[0] && parsed.content[0].text) {
              text = parsed.content[0].text || '';
            } else if (parsed.message && parsed.message.content) {
              text = parsed.message.content || '';
            }

            if (text) {
              acc += text;
              if (opts.onChunk) {
                opts.onChunk(text);
              }
            }
          } catch (e) {
            console.error('Error parsing streaming chunk:', e);
          }
        }
      }
    }

    return { final: acc };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ---------------- SessionManager ----------------
class SessionManager {
  constructor(saved = []) {
    this.sessions = (saved && saved.length) ? saved : [];
    this.activeId = (this.sessions[0] && this.sessions[0].id) || null;
  }
  
  create(name = null, sys = "") {
    const id = Date.now().toString();
    const session = { 
      id, 
      name: name || `Session ${this.sessions.length+1}`, 
      systemPrompt: sys||"", 
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
    if (this.sessions.find(s=>s.id===id)) this.activeId = id;
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
    
    // تحويل الرسائل لتتضمن المحتوى الحقيقي (مع محتويات الملفات)
    return out.concat(recent.map(msg => {
      // إذا كان هناك مرفقات، دمج محتوياتها مع النص
      let fullContent = msg.content;
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(attachment => {
          fullContent += `\n\n[محتوى الملف: ${attachment.name}]\n${attachment.content}`;
        });
      }
      return {
        role: msg.role,
        content: fullContent
      };
    }));
  }

  // دالة لتصدير المحادثة كـ Markdown
  exportToMarkdown(session) {
    let content = `# ${session.name}\n\n`;
    content += `**تاريخ الإنشاء:** ${new Date(parseInt(session.id)).toLocaleString('ar-SA')}\n\n`;
    content += `**عدد الرسائل:** ${session.messages.length}\n\n`;
    
    if (session.systemPrompt) {
      content += `## نظام البرومت\n${session.systemPrompt}\n\n---\n\n`;
    }
    
    session.messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? ' المستخدم' : ' المساعد';
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ar-SA') : '';
      content += `###### ${role} (رسالة ${index + 1}) \n`;
      
      // عرض المرفقات بشكل منفصل
      if (msg.attachments && msg.attachments.length > 0) {
        content += `**+ المرفقات:**\n`;
        msg.attachments.forEach(attachment => {
          content += `- **${attachment.name}**\n`;
        });
        content += `\n`;
      }
      
      content += `${msg.content}\n\n`;
      content += `---\n\n`;
    });
    
    return content;
  }
}

// ========== APIManager - مدير APIs المركزي ==========
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
      throw new Error(`مزود API غير معروف: ${apiType}`);
    }
    
    return await provider.send(payload, opts);
  }
  
  async sendWithRetry(payload, opts, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.send(payload, opts);
      } catch (error) {
        lastError = error;
        
        // إذا كان خطأ 429، انتظر ثم حاول مرة أخرى
        if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Attempt ${attempt}/${maxRetries}: Waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // لأخطاء أخرى، أعد المحاولة مرة واحدة فقط
        if (attempt === 1 && !error.message.includes('400')) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }
  
  async checkHealth() {
    const mode = this.plugin.settings.currentMode;
    const apiType = mode === 'cloud' ? this.plugin.settings.cloudApiType : 'local';
    
    const provider = this.providers[apiType];
    return provider ? await provider.checkHealth() : false;
  }
}

// ========== OpenAI Provider ==========
class OpenAIProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "OpenAI";
    this.icon = "⭐";
  }
  
  async send(payload, opts) {
    const settings = this.plugin.settings;
    
    const url = settings.openaiEndpoint || "https://api.openai.com/v1/chat/completions";
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.openaiApiKey}`
    };
    
    const body = JSON.stringify({
      model: settings.openaiModel || "gpt-3.5-turbo",
      messages: payload.messages,
      temperature: payload.temperature || settings.temperature,
      max_tokens: payload.max_tokens || settings.max_tokens,
      stream: payload.stream || false
    });
    
    return makeRequest(url, headers, body, payload.stream, opts);
  }
  
  async checkHealth() {
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { 'Authorization': `Bearer ${this.plugin.settings.openaiApiKey}` }
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}

// ========== Gemini Provider ==========
class GeminiProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "Gemini";
    this.icon = "🟠";
    this.lastRequestTime = 0;
    this.requestQueue = [];
  }
  
  async send(payload, opts) {
    const settings = this.plugin.settings;
    const modelName = settings.geminiModel || "gemini-2.0-flash";
    
    // إضافة تأخير بين الطلبات لتجنب 429
    await this.throttleRequests();
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${settings.geminiApiKey}`;
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    const contents = this.convertToGeminiFormat(payload.messages);
    
    if (contents.length === 0) {
      throw new Error('لا توجد رسائل للإرسال');
    }
    
    const body = JSON.stringify({
      contents: contents,
      generationConfig: {
        temperature: payload.temperature || settings.temperature,
        maxOutputTokens: payload.max_tokens || settings.max_tokens,
        topP: 0.8,
        topK: 40
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    });
    
    console.log("Gemini Request:", { url, headers, body });
    
    try {
      const response = await makeRequest(url, headers, body, payload.stream, opts);
      this.lastRequestTime = Date.now();
      return response;
    } catch (error) {
      if (error.message.includes('429')) {
        throw new Error('الحد الأقصى للطلبات تم تجاوزه. يرجى الانتظار قليلاً قبل إعادة المحاولة.');
      }
      throw error;
    }
  }
  
  async throttleRequests() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = 2000;
    
    if (timeSinceLastRequest < minDelay) {
      const delay = minDelay - timeSinceLastRequest;
      console.log(`Throttling Gemini request: waiting ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  convertToGeminiFormat(messages) {
    const contents = [];
    let currentUserMessage = '';
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (contents.length === 0) {
          currentUserMessage = `[System: ${msg.content}]\n\n`;
        }
      } else if (msg.role === 'user') {
        const fullMessage = currentUserMessage + msg.content;
        contents.push({
          role: 'user',
          parts: [{ text: fullMessage }]
        });
        currentUserMessage = '';
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content }]
        });
      }
    }
    
    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents.push({
        role: 'model',
        parts: [{ text: '...' }]
      });
    }
    
    return contents;
  }
  
  async checkHealth() {
    try {
      const modelName = this.plugin.settings.geminiModel || "gemini-2.0-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}?key=${this.plugin.settings.geminiApiKey}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 429) {
        return { ok: false, message: 'الحد الأقصى للطلبات تم تجاوزه. يرجى الانتظار.' };
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        return { ok: false, message: `خطأ ${response.status}: ${errorText}` };
      }
      
      return { ok: true, message: 'الاتصال ناجح' };
    } catch (e) {
      console.error("Gemini Health Check Error:", e);
      return { ok: false, message: e.message };
    }
  }
}

// ========== Anthropic Provider ==========
class AnthropicProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "Anthropic";
    this.icon = "☁";
  }
  
  async send(payload, opts) {
    const settings = this.plugin.settings;
    
    const url = settings.anthropicEndpoint || "https://api.anthropic.com/v1/messages";
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': settings.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    };
    
    const body = JSON.stringify({
      model: settings.anthropicModel || "claude-3-haiku-20240307",
      messages: payload.messages,
      temperature: payload.temperature || settings.temperature,
      max_tokens: payload.max_tokens || settings.max_tokens,
      stream: payload.stream || false
    });
    
    return makeRequest(url, headers, body, payload.stream, opts);
  }
  
  async checkHealth() {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: 'HEAD',
        headers: { 'x-api-key': this.plugin.settings.anthropicApiKey }
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}

// ========== Custom Provider ==========
class CustomProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "Custom API";
    this.icon = "🔧";
  }
  
  async send(payload, opts) {
    const settings = this.plugin.settings;
    
    const url = settings.customEndpoint;
    const apiKey = settings.customApiKey;
    const model = settings.customModel;
    
    let headers = { 'Content-Type': 'application/json' };
    
    try {
      const customHeaders = JSON.parse(settings.customHeaders || '{}');
      headers = { ...headers, ...customHeaders };
    } catch (e) {
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }
    
    let bodyData = {
      model: model,
      messages: payload.messages,
      temperature: payload.temperature || settings.temperature || 0.7,
      max_tokens: payload.max_tokens || settings.max_tokens || 2048,
      stream: false
    };
    
    try {
      if (settings.customBodyTemplate && settings.customBodyTemplate.includes('{{')) {
        let bodyStr = settings.customBodyTemplate
          .replace('{{model}}', JSON.stringify(model))
          .replace('{{messages}}', JSON.stringify(payload.messages))
          .replace('{{temperature}}', (payload.temperature || settings.temperature || 0.7).toString())
          .replace('{{max_tokens}}', (payload.max_tokens || settings.max_tokens || 2048).toString());
        bodyData = JSON.parse(bodyStr);
      }
    } catch (e) {
      console.log("Using default body template:", e.message);
    }
    
    const body = JSON.stringify(bodyData);
    
    console.log("API Request to:", url);
    
    try {
      const response = await this.makeRequest(url, headers, body, false, opts);
      return response;
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }
  
  async makeRequest(url, headers, body, streaming, opts) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        const status = response.status;
        
        if (status === 402) {
          throw new Error(`رصيد الحساب غير كافي (402). يرجى شحن الرصيد أو استخدام مفتاح جديد.`);
        } else if (status === 429) {
          throw new Error(`تجاوز الحد المسموح (429). انتظر قليلاً وحاول مرة أخرى.`);
        } else if (status === 403) {
          throw new Error(`صلاحية المفتاح منتهية أو غير صحيح (403). تحقق من المفتاح.`);
        } else if (status === 401) {
          throw new Error(`مفتاح API غير صالح (401).`);
        } else {
          throw new Error(`HTTP ${status}: ${errorText.substring(0, 100)}`);
        }
      }

      const data = await response.json();
      
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
      } else {
        console.warn("Unexpected response format:", data);
        return { final: JSON.stringify(data).substring(0, 500) };
      }
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
  
  async checkHealth() {
    try {
      const testResponse = await this.send({
        messages: [{ role: "user", content: "اكتب كلمة 'نجاح'" }],
        temperature: 0.7,
        max_tokens: 10
      }, { timeoutMs: 15000 });
      
      return { 
        ok: true, 
        message: `✅ اتصال ناجح. الرد: "${testResponse.final.substring(0, 50)}"` 
      };
    } catch (error) {
      return { 
        ok: false, 
        message: `❌ ${error.message}` 
      };
    }
  }
}

// ========== Local AI Provider ==========
class LocalAIProvider {
  constructor(plugin) {
    this.plugin = plugin;
    this.name = "Local AI";
    this.icon = "🖥️";
  }
  
  async send(payload, opts) {
    const settings = this.plugin.settings;
    const base = settings.baseUrl.replace(/\/$/, "");
    const url = base + (settings.localEndpoint || '/v1/chat/completions');
    
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({
      model: settings.localModel,
      messages: payload.messages,
      temperature: payload.temperature || settings.temperature,
      max_tokens: payload.max_tokens || settings.max_tokens,
      stream: payload.stream || false
    });
    
    return makeRequest(url, headers, body, payload.stream, opts);
  }
  
  async checkHealth() {
    try {
      const base = this.plugin.settings.baseUrl.replace(/\/$/, "");
      const response = await fetch(base + '/health', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) return false;
      
      try {
        const data = await response.json();
        return data && (data.status === 'ok' || data.status === 'healthy' || data.ready === true);
      } catch {
        return response.ok;
      }
    } catch (e) {
      return false;
    }
  }
}

// ---------------- Prompt Modal ----------------
class PromptModal extends Modal {
  constructor(app, title = "Prompt", initial = "", onSubmit) {
    super(app);
    this.title = title;
    this.initial = initial;
    this.onSubmit = onSubmit;
  }
  
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.title });
    this.ta = contentEl.createEl('textarea');
    this.ta.style.width = '100%';
    this.ta.style.height = '160px';
    this.ta.value = this.initial;
    const row = contentEl.createEl('div', { cls: 'ai-btn-row' });
    const send = row.createEl('button', { text: 'Send' });
    const cancel = row.createEl('button', { text: 'Cancel' });
    send.addEventListener('click', ()=> {
      const v = this.ta.value.trim();
      if (!v) { new Notice("Prompt empty"); return; }
      this.onSubmit(v);
      this.close();
    });
    cancel.addEventListener('click', ()=> this.close());
  }
  
  onClose() { this.contentEl.empty(); }
}

// ---------------- Attach Modal ----------------
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
      text: '+ إرفاق ملفات',
      cls: 'ai-attach-title'
    });
    
    const searchRow = contentEl.createDiv({ cls: 'ai-search-row' });
    const searchInput = searchRow.createEl('input', {
      type: 'text',
      placeholder: 'ابحث عن ملف...'
    });
    searchInput.style.width = '100%';
    searchInput.style.padding = '8px 12px';
    searchInput.style.borderRadius = '6px';
    searchInput.style.border = '1px solid var(--background-modifier-border)';
    searchInput.style.backgroundColor = 'var(--background-secondary)';
    searchInput.style.color = 'var(--text-normal)';
    searchInput.style.fontSize = '14px';
    
    const container = contentEl.createDiv({ cls: 'ai-file-list-container' });
    
    const buttonRow = contentEl.createDiv({ cls: 'ai-attach-btn-row' });
    
    const sendSel = buttonRow.createEl('button', { 
      text: '+ إرفاق المحدد',
      cls: 'ai-attach-send-btn'
    });
    
    sendSel.addEventListener('click', async () => {
      const files = this.app.vault.getMarkdownFiles();
      const picked = files.filter(f => this.selected.has(f.path));
      if (picked.length === 0) {
        new Notice('لم يتم اختيار أي ملفات');
        return;
      }
      
      this.selectedFiles = picked;
      this.onSubmit('files', picked);
      this.close();
    });
    
    const cancel = buttonRow.createEl('button', { 
      text: 'إلغاء',
      cls: 'ai-attach-cancel-btn'
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
            'لا توجد ملفات تطابق البحث' : 
            'لا توجد ملفات markdown'
        });
        return;
      }
      
      filteredFiles.forEach((f, i) => {
        const row = container.createDiv({ cls: 'ai-file-row' });
        
        const checkboxContainer = row.createDiv({ cls: 'ai-checkbox-container' });
        const cb = checkboxContainer.createEl('input', { 
          type: 'checkbox',
          cls: 'ai-file-checkbox'
        });
        cb.checked = this.selected.has(f.path);
        cb.addEventListener('change', (e) => {
          if (e.target.checked) {
            this.selected.add(f.path);
          } else {
            this.selected.delete(f.path);
          }
        });
        
        const fileInfo = row.createDiv({ cls: 'ai-file-info' });
        const fileName = fileInfo.createEl('div', { 
          text: f.basename,
          cls: 'ai-file-name'
        });
        
        const filePath = fileInfo.createEl('div', { 
          text: f.path,
          cls: 'ai-file-path'
        });
        
        if (this.searchTerm.trim() && f.basename.toLowerCase().includes(this.searchTerm.toLowerCase())) {
          this.highlightText(fileName, f.basename, this.searchTerm);
        }
      });
    };
    
    searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value;
      renderFiles();
    });
    
    renderFiles();
  }
  
  highlightText(element, fullText, searchTerm) {
    const term = searchTerm.toLowerCase();
    const text = fullText;
    const index = text.toLowerCase().indexOf(term);
    
    if (index !== -1) {
      element.empty();
      
      const before = text.substring(0, index);
      if (before) {
        element.createSpan({ text: before });
      }
      
      const match = text.substring(index, index + term.length);
      const highlight = element.createSpan({ 
        text: match,
        cls: 'ai-search-highlight'
      });
      
      const after = text.substring(index + term.length);
      if (after) {
        element.createSpan({ text: after });
      }
    }
  }
  
  onClose() { 
    this.contentEl.empty(); 
  }
}

// ---------------- Chat Sidebar View ----------------
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
    this.containerEl.style.direction = 'rtl';
    this.containerEl.style.textAlign = 'right';

    // ---------- Top Bar ----------
    const topBar = this.containerEl.createDiv({ cls: 'ai-top-bar' });

    // زر الاختصارات
    this.shortcutsBtn = topBar.createEl('button', {
      cls: 'ai-shortcuts-btn',
      text: '⚡'
    });
    this.shortcutsBtn.title = 'اختصارات';

    this.modeToggleBtn = topBar.createEl('button', {
      cls: 'ai-mode-toggle',
      text: this.getProviderIcon()
    });
    this.modeToggleBtn.title = this.getProviderInfo();

    // إنشاء عداد التوكنات
    this.tokenCounter = topBar.createDiv({ 
      cls: 'ai-token-counter',
      text: '🔢 0/8192'
    });
    
    // تحديث عرض عداد التوكنات بناءً على الإعداد
    this.updateTokenCounterVisibility();

    const spacer = topBar.createDiv({ cls: 'ai-top-spacer' });

    this.settingsBtn = topBar.createEl('button', { 
      text: '⚙️', 
      cls: 'ai-settings-btn'
    });
    this.settingsBtn.title = 'الإعدادات';

    // إضافة مستمعي الأحداث
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

    // ---------- Chat Area ----------
    this.chatEl = this.containerEl.createDiv({ cls: 'ai-chat' });

    // ---------- Input Area ----------
    const inputWrap = this.containerEl.createDiv({ cls: 'ai-input-wrap' });
    
    this.inputEl = inputWrap.createEl('textarea', { 
      cls: 'ai-input',
      attr: { 
        placeholder: 'اكتب رسالة... (استخدم Shift+Enter للسطر الجديد)',
        rows: '2'
      }
    });

    this.attachBtn = inputWrap.createEl('button', { 
      text: '+', 
      cls: 'ai-attach-btn floating-btn'
    });
    this.attachBtn.title = 'إرفاق ملفات';

    this.sendBtn = inputWrap.createEl('button', { 
      text: '➤', 
      cls: 'ai-send-btn floating-btn' 
    });
    this.sendBtn.title = 'إرسال';

    // ---------- Event Listeners ----------
    this.sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._onSend();
    });
    
    this.attachBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this._onAttach();
    });
    
    // تعديل سلوك Enter ليكون لسطر جديد فقط
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter لإدخال سطر جديد
          return;
        } else {
          // Enter عادي يمنع السلوك الافتراضي ولا يرسل
          e.preventDefault();
        }
      }
    });

    this._renderMessages();
    this._streaming = true;
    
    // تحديث عداد التوكنات فقط إذا كان ممكناً
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
    
    const shortcuts = [
      { key: 'محادثة جديدة', shortcut: this.plugin.settings.shortcuts.newConversation, action: () => this.createNewConversation() },
      { key: 'حفظ المحادثة', shortcut: this.plugin.settings.shortcuts.saveConversation, action: () => this.saveCurrentConversation() },
      { key: 'الإعدادات', shortcut: this.plugin.settings.shortcuts.settings, action: () => {
        const settingsModal = new SettingsModal(this.app, this.plugin);
        settingsModal.open();
      }}
    ];
    
    shortcuts.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'shortcut-item';
      
      const keySpan = document.createElement('span');
      keySpan.className = 'shortcut-key';
      keySpan.textContent = item.key;
      
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'shortcut-value';
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
    
    menu.style.position = 'fixed';
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.zIndex = '9999';
    
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
    const name = prompt('اسم المحادثة الجديدة:');
    if (name) {
      this.plugin._sessionManager.create(name);
      this._renderMessages();
      this.plugin.saveState();
      new Notice(`تم إنشاء محادثة: ${name}`);
    }
  }

  async saveCurrentConversation() {
    const session = this.plugin._sessionManager.getActive();
    if (!session) {
      new Notice('لا توجد محادثة نشطة للحفظ');
      return;
    }
    
    try {
      const content = this.plugin._sessionManager.exportToMarkdown(session);
      const folderPath = this.plugin.settings.conversationsFolder || 'AI Conversations';
      const fileName = `${session.name.replace(/[\\/:*?"<>|]/g, '_')}.md`;
      const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      
      // إنشاء المجلد إذا لم يكن موجوداً
      const folderExists = await this.app.vault.adapter.exists(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
      
      // حفظ الملف
      await this.app.vault.create(fullPath, content);
      new Notice(`✅ تم حفظ المحادثة في: ${fullPath}`);
    } catch (error) {
      console.error('Error saving conversation:', error);
      new Notice(`❌ خطأ في حفظ المحادثة: ${error.message}`);
    }
  }

  getProviderIcon() {
    if (this.plugin.settings.currentMode === 'local') return '🖥️';
    
    const icons = {
      openai: '🎡',
      gemini: '🌀',
      anthropic: '☁️',
      custom: '⚙️'
    };
    return icons[this.plugin.settings.cloudApiType] || '☁️';
  }

  getProviderName() {
    if (this.plugin.settings.currentMode === 'local') return 'النموذج المحلي';
    
    const names = {
      openai: 'OpenAI',
      gemini: 'Google Gemini',
      anthropic: 'Anthropic Claude',
      custom: 'API مخصص'
    };
    return names[this.plugin.settings.cloudApiType] || 'السحابي';
  }

  getProviderInfo() {
    if (this.plugin.settings.currentMode === 'local') {
      return `${this.plugin.settings.localModel} - انقر للتبديل إلى السحابي`;
    } else {
      return `${this.getProviderName()} - انقر للتبديل إلى المحلي`;
    }
  }

  toggleAIMode() {
    this.plugin.settings.currentMode = 
      this.plugin.settings.currentMode === 'local' ? 'cloud' : 'local';
    
    this.modeToggleBtn.textContent = this.getProviderIcon();
    this.modeToggleBtn.title = this.getProviderInfo();
    
    this.plugin.saveSettings();
    new Notice(`تم التبديل إلى ${this.getProviderName()}`);
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
    
    let providerName = '';
    if (this.plugin.settings.currentMode === 'local') {
      providerName = '🖥️ محلي';
    } else {
      const apiType = this.plugin.settings.cloudApiType;
      const names = {
        openai: 'OpenAI',
        gemini: 'Gemini',
        anthropic: 'Claude',
        custom: '⚙️ custom'
      };
      providerName = names[apiType] || '☁️ سحابي';
    }
    
    if (this.tokenCounter) {
      this.tokenCounter.textContent = `${providerName} | 🔢 ${totalTokens}/${maxTokens}`;
      this.tokenCounter.title = `${providerName}\nالسياق: ${contextTokens} | الإدخال: ${estimatedTokens}`;
      
      if (totalTokens > maxTokens) {
        this.tokenCounter.style.color = 'var(--text-error)';
        this.tokenCounter.style.backgroundColor = 'rgba(var(--background-modifier-error-rgb), 0.2)';
      } else if (totalTokens > maxTokens * 0.8) {
        this.tokenCounter.style.color = 'var(--text-warning)';
        this.tokenCounter.style.backgroundColor = 'rgba(var(--background-modifier-warning-rgb), 0.2)';
        this._playWarningSound();
      } else {
        this.tokenCounter.style.color = 'var(--text-muted)';
        this.tokenCounter.style.backgroundColor = 'transparent';
      }
    }
  }

  _playWarningSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.error('Cannot play warning sound:', e);
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
    
    const bubble = msgContainer.createDiv({ cls: `ai-msg ${role}` });
    
    if (role === 'assistant') {
      MarkdownRenderer.render(this.app, text, bubble, '', this.plugin);
    } else {
      bubble.textContent = text;
      
      // عرض المرفقات بشكل جميل
      if (attachments && attachments.length > 0) {
        const attachmentsContainer = msgContainer.createDiv({ cls: 'ai-attachments-container' });
        attachmentsContainer.createEl('div', { 
          text: '+ المرفقات:', 
          cls: 'ai-attachments-title' 
        });
        
        attachments.forEach(attachment => {
          const attachmentEl = attachmentsContainer.createDiv({ cls: 'ai-attachment' });
          attachmentEl.createEl('div', { 
            text: `📄 ${attachment.name}`, 
            cls: 'ai-attachment-name' 
          });
        });
      }
    }
    
    this.chatEl.scrollTop = this.chatEl.scrollHeight;
    return bubble;
  }

  async _onAttach() {
    const modal = new AttachModal(this.app, async (choice, files) => {
      if (!files || !files.length) { 
        new Notice('لم يتم اختيار أي ملفات'); 
        return; 
      }
      
      // حفظ الملفات المختارة في pendingAttachments
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
          new Notice(`خطأ في قراءة الملف: ${f.path}`);
        }
      }
      
      // إضافة مؤشر في حقل الإدخال عن الملفات المرفقة
      const attachmentCount = this.pendingAttachments.length;
      if (attachmentCount > 0) {
        this.inputEl.value += `\n[مرفق ${attachmentCount} ملف${attachmentCount > 1 ? 'ات' : ''}]`;
        new Notice(`تم إعداد ${attachmentCount} ملف${attachmentCount > 1 ? 'ات' : ''} للإرفاق`);
      }
    });
    modal.open();
  }

  async _onSend() {
    const txt = this.inputEl.value.trim();
    if (!txt && this.pendingAttachments.length === 0) { 
      new Notice('الرسالة فارغة'); 
      return; 
    }
    
    let s = this.plugin._sessionManager.getActive();
    if (!s) { 
      this.plugin._sessionManager.create('محادثة جديدة');
      s = this.plugin._sessionManager.getActive();
    }
    
    // إضافة رسالة المستخدم مع المرفقات
    this.plugin._sessionManager.addMessage('user', txt, this.pendingAttachments);
    this.plugin.saveState();
    
    // عرض الرسالة مع المرفقات
    this._appendBubble('user', txt, this.pendingAttachments);
    
    // تنظيف
    this.inputEl.value = '';
    this.pendingAttachments = [];

    const messages = this.plugin._sessionManager.getMessagesForRequest();

    let acc = '';
    const loadingMsg = this._appendBubble('assistant', '⏳ جاري المعالجة...');
    
    try {
      let dots = 0;
      const loadingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        loadingMsg.textContent = '⏳ جاري المعالجة' + '.'.repeat(dots);
      }, 500);
      
      const result = await this.plugin.apiManager.sendMessage({
        messages: messages,
        temperature: this.plugin.settings.temperature,
        max_tokens: this.plugin.settings.max_tokens,
        stream: false
      }, {
        timeoutMs: this.plugin.settings.timeoutMs,
        retry: true
      });
      
      clearInterval(loadingInterval);
      
      const finalText = (result && result.final) ? result.final : acc;
      
      // تحديث الرسالة مع Markdown
      loadingMsg.empty();
      MarkdownRenderer.render(this.app, finalText, loadingMsg, '', this.plugin);
      this.plugin._sessionManager.addMessage('assistant', finalText);
      this.plugin.saveState();
      
    } catch (e) {
      console.error("Chat Error:", e);
      
      let errorMessage = 'حدث خطأ';
      if (e.message.includes('429')) {
        errorMessage = '🔴 تجاوز الحد الأقصى للطلبات. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.';
      } else if (e.message.includes('400')) {
        errorMessage = '🔴 طلب غير صالح. تحقق من مفتاح API وال.';
      } else if (e.message.includes('401')) {
        errorMessage = '🔴 مفتاح API غير صالح أو منتهي الصلاحية.';
      } else if (e.message.includes('timeout')) {
        errorMessage = '⏱️ تجاوز الوقت المحدد. تحقق من اتصال الإنترنت.';
      } else {
        errorMessage = `🔴 خطأ: ${e.message}`;
      }
      
      loadingMsg.textContent = errorMessage;
      new Notice(errorMessage);
    }
  }
}

// ---------------- Settings Modal ----------------
class SettingsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: '⚙️  Local AI' });
    
    const tabsContainer = contentEl.createDiv({ cls: 'ai-settings-tabs' });
    
    const localTab = tabsContainer.createEl('button', { 
      text: '🖥️ النموذج المحلي',
      cls: 'ai-tab-btn active'
    });
    
    const cloudTab = tabsContainer.createEl('button', { 
      text: '☁️ النموذج السحابي',
      cls: 'ai-tab-btn'
    });
    
    const generalTab = tabsContainer.createEl('button', { 
      text: '⚙️  عامة',
      cls: 'ai-tab-btn'
    });
    
    const shortcutsTab = tabsContainer.createEl('button', { 
      text: '⚡ اختصارات',
      cls: 'ai-tab-btn'
    });
    
    const conversationsTab = tabsContainer.createEl('button', { 
      text: '💬 المحادثات',
      cls: 'ai-tab-btn'
    });
    
    const contentContainer = contentEl.createDiv({ cls: 'ai-settings-content' });
    
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
    
    const saveBtn = buttonRow.createEl('button', { 
      text: '💾 حفظ',
      cls: 'ai-settings-save-btn'
    });
    
    const cancelBtn = buttonRow.createEl('button', { 
      text: '❌ إلغاء',
      cls: 'ai-settings-cancel-btn'
    });
    
    saveBtn.addEventListener('click', async () => {
      await this.plugin.saveSettings();
      new Notice('تم حفظ الإعدادات بنجاح!');
      this.close();
    });
    
    cancelBtn.addEventListener('click', () => this.close());
  }

  setActiveTab(activeTab, otherTabs) {
    activeTab.classList.add('active');
    otherTabs.forEach(tab => tab.classList.remove('active'));
  }
  
  showLocalSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: ' النموذج المحلي' });
    
    this.createInputField(section, 'عنوان الخادم المحلي (Base URL):', 'baseUrl', this.plugin.settings.baseUrl);
    this.createInputField(section, 'Endpoint:', 'localEndpoint', this.plugin.settings.localEndpoint || '/v1/chat/completions');
    this.createInputField(section, 'اسم النموذج المحلي:', 'localModel', this.plugin.settings.localModel);
    
    const testBtn = section.createEl('button', {
      text: '🔄 اختبار الاتصال بالخادم المحلي',
      cls: 'ai-test-btn'
    });
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'جاري الاختبار...';
      
      try {
        const health = await this.plugin.apiManager.checkHealth();
        if (health) {
          new Notice('✅ الاتصال بالخادم المحلي ناجح!');
        } else {
          new Notice('❌ فشل الاتصال بالخادم المحلي');
        }
      } catch (e) {
        new Notice('❌ خطأ في الاتصال: ' + e.message);
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🔄 اختبار الاتصال بالخادم المحلي';
      }
    });
  }
  
  showCloudSettings(container) {
    container.empty();
    
    const apiTypeSection = container.createDiv({ cls: 'ai-settings-section' });
    apiTypeSection.createEl('h3', { text: 'اختر نوع API السحابي' });

    this.createAPITypeSelector(apiTypeSection);

    const settingsContainer = container.createDiv({ cls: 'ai-api-settings-container' });
    this.showSpecificAPISettings(settingsContainer);
  }

  createAPITypeSelector(container) {
    const row = container.createDiv({ cls: 'ai-api-type-selector' });

    const providers = [
      { id: 'openai', name: 'OpenAI', icon: '🎡', color: 'blue' },
      { id: 'gemini', name: 'Gemini', icon: '🌀', color: 'orange' },
      { id: 'anthropic', name: 'Claude', icon: '☁️', color: 'purple' },
      { id: 'custom', name: 'مخصص', icon: '⚙️', color: 'gray' }
    ];

    providers.forEach(provider => {
      const btn = row.createEl('button', {
        cls: `ai-provider-btn ${this.plugin.settings.cloudApiType === provider.id ? 'active' : ''}`,
        text: `${provider.icon} ${provider.name}`
      });

      btn.dataset.provider = provider.id;
      btn.style.borderColor = `var(--${provider.color})`;

      btn.addEventListener('click', () => {
        this.plugin.settings.cloudApiType = provider.id;
        this.showSpecificAPISettings(document.querySelector('.ai-api-settings-container'));
        this.setActiveProvider(btn);
      });
    });
  }

  setActiveProvider(activeBtn) {
    const allBtns = activeBtn.parentElement.querySelectorAll('.ai-provider-btn');
    allBtns.forEach(btn => btn.classList.remove('active'));
    activeBtn.classList.add('active');
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
    section.createEl('h3', { text: 'OpenAI' });

    this.createInputField(section, 'مفتاح OpenAI API:', 'openaiApiKey', 
      this.plugin.settings.openaiApiKey, 'password');
    
    this.createInputField(section, 'اسم النموذج:', 'openaiModel', 
      this.plugin.settings.openaiModel || 'gpt-3.5-turbo');
    
    const testBtn = section.createEl('button', { text: '🔄 اختبار اتصال OpenAI', cls: 'ai-test-btn' });
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'جاري الاختبار...';
      const provider = new OpenAIProvider(this.plugin);
      const health = await provider.checkHealth();
      if (health) {
        new Notice('✅ اتصال OpenAI ناجح!');
      } else {
        new Notice('❌ فشل الاتصال بـ OpenAI');
      }
      testBtn.disabled = false;
      testBtn.textContent = '🔄 اختبار اتصال OpenAI';
    });
  }
  
  showGeminiSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: 'Google Gemini ' });
    
    this.createInputField(section, 'مفتاح Gemini API:', 'geminiApiKey', 
      this.plugin.settings.geminiApiKey, 'password');
    
    this.createInputField(section, 'اسم النموذج:', 'geminiModel', 
      this.plugin.settings.geminiModel || 'gemini-2.0-flash');
    
    const testBtn = section.createEl('button', {
      text: '🔄 اختبار اتصال Gemini',
      cls: 'ai-test-btn'
    });
    
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'جاري الاختبار...';
      
      const provider = new GeminiProvider(this.plugin);
      const health = await provider.checkHealth();
      
      if (health.ok) {
        new Notice('✅ اتصال Gemini ناجح!');
      } else {
        new Notice(`❌ ${health.message || 'فشل الاتصال بـ Gemini'}`);
      }
      
      testBtn.disabled = false;
      testBtn.textContent = '🔄 اختبار اتصال Gemini';
    });
  }

  showAnthropicSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: 'Anthropic Claude' });

    this.createInputField(section, 'مفتاح Anthropic API:', 'anthropicApiKey', 
      this.plugin.settings.anthropicApiKey, 'password');
    
    this.createInputField(section, 'اسم النموذج:', 'anthropicModel', 
      this.plugin.settings.anthropicModel || 'claude-3-haiku-20240307');
    
    const testBtn = section.createEl('button', { text: '🔄 اختبار اتصال Claude', cls: 'ai-test-btn' });
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'جاري الاختبار...';
      const provider = new AnthropicProvider(this.plugin);
      const health = await provider.checkHealth();
      if (health) {
        new Notice('✅ اتصال Claude ناجح!');
      } else {
        new Notice('❌ فشل الاتصال بـ Claude');
      }
      testBtn.disabled = false;
      testBtn.textContent = '🔄 اختبار اتصال Claude';
    });
  }

  showCustomSettings(container) {
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: '⚙️  API مخصص' });

    this.createInputField(section, 'مفتاح API:', 'customApiKey', this.plugin.settings.customApiKey, 'password');
    this.createInputField(section, 'اسم النموذج:', 'customModel', this.plugin.settings.customModel);
    this.createInputField(section, 'Endpoint:', 'customEndpoint', this.plugin.settings.customEndpoint);
    
    const row = section.createDiv({ cls: 'ai-settings-row' });
    row.createEl('label', { text: 'رؤوس HTTP (JSON):' });
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
    row2.createEl('label', { text: 'قالب الجسم (JSON):' });
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

    const testBtn = section.createEl('button', { text: '🔄 اختبار اتصال API المخصص', cls: 'ai-test-btn' });
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'جاري الاختبار...';
      const provider = new CustomProvider(this.plugin);
      const health = await provider.checkHealth();
      if (health.ok) {
        new Notice('✅ اتصال API المخصص ناجح!');
      } else {
        new Notice(`❌ ${health.message || 'فشل الاتصال بـ API المخصص'}`);
      }
      testBtn.disabled = false;
      testBtn.textContent = '🔄 اختبار اتصال API المخصص';
    });
  }

  showGeneralSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: ' عامة' });
    
    this.createSliderField(section, 'درجة الحرارة (Temperature):', 'temperature', this.plugin.settings.temperature, 0, 2, 0.1);
    this.createInputField(section, 'الحد الأقصى للتوكنات:', 'max_tokens', this.plugin.settings.max_tokens, 'number');
    this.createInputField(section, 'مجلد المحادثات المحفوظة:', 'conversationsFolder', this.plugin.settings.conversationsFolder || 'AI Conversations');
    this.createCheckboxField(section, 'فحص الاتصال تلقائيًا عند التشغيل:', 'autoCheckHealth', this.plugin.settings.autoCheckHealth);
    this.createCheckboxField(section, 'عرض عداد التوكنات:', 'showTokenCounter', this.plugin.settings.showTokenCounter);
    this.createInputField(section, 'مهلة الطلب (بالمللي ثانية):', 'timeoutMs', this.plugin.settings.timeoutMs, 'number');
  }

  showShortcutsSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: '⚡ اختصارات لوحة المفاتيح' });
    
    this.createShortcutField(section, 'محادثة جديدة:', 'shortcuts', 'newConversation', this.plugin.settings.shortcuts.newConversation);
    this.createShortcutField(section, 'حفظ المحادثة:', 'shortcuts', 'saveConversation', this.plugin.settings.shortcuts.saveConversation);
    this.createShortcutField(section, 'فتح الإعدادات:', 'shortcuts', 'settings', this.plugin.settings.shortcuts.settings);
    
    const info = section.createDiv({ cls: 'ai-shortcuts-info' });
    info.innerHTML = '<p><strong>ملاحظة:</strong> استخدم Ctrl للويندوز/Linux، Cmd للماك. مثال: Ctrl+Shift+N</p>';
  }

  showConversationsSettings(container) {
    container.empty();
    
    const section = container.createDiv({ cls: 'ai-settings-section' });
    section.createEl('h3', { text: 'إدارة المحادثات' });
    
    const sessionList = section.createDiv({ cls: 'ai-session-list' });
    const sessions = this.plugin._sessionManager.sessions;
    
    if (sessions.length === 0) {
      const emptyMsg = sessionList.createDiv({ 
        cls: 'ai-empty-sessions',
        text: 'لا توجد محادثات'
      });
    } else {
      sessions.forEach(session => {
        const sessionRow = sessionList.createDiv({ 
          cls: `ai-session-row ${this.plugin._sessionManager.activeId === session.id ? 'active' : ''}` 
        });
        
        const sessionInfo = sessionRow.createDiv({ cls: 'ai-session-info' });
        
        const nameSpan = sessionInfo.createEl('div', { 
          cls: 'ai-session-name',
          text: session.name 
        });
        
        const messageCount = sessionInfo.createEl('div', { 
          cls: 'ai-session-count',
          text: `(${session.messages.length} رسالة)` 
        });
        
        // أزرار الإدارة
        const sessionActions = sessionRow.createDiv({ cls: 'ai-session-actions' });
        
        const switchBtn = sessionActions.createEl('button', {
          text: 'تفعيل',
          cls: 'ai-session-action-btn'
        });
        switchBtn.addEventListener('click', () => {
          this.plugin._sessionManager.switchTo(session.id);
          this.plugin.saveState();
          this.showConversationsSettings(container);
          new Notice(`تم التبديل إلى محادثة: ${session.name}`);
          
          // تحديث العرض في الـ ChatView
          this.refreshChatViews();
        });
        
        const renameBtn = sessionActions.createEl('button', {
          text: 'تعديل',
          cls: 'ai-session-action-btn'
        });
        renameBtn.addEventListener('click', () => {
          const newName = prompt('الاسم الجديد:', session.name);
          if (newName && newName.trim()) {
            session.name = newName.trim();
            this.plugin.saveState();
            this.showConversationsSettings(container);
            new Notice('تم تحديث اسم المحادثة');
          }
        });
        
        const saveBtn = sessionActions.createEl('button', {
          text: '💾 حفظ',
          cls: 'ai-session-action-btn save'
        });
        saveBtn.addEventListener('click', async () => {
          await this.saveConversationToFile(session);
        });
        
        const deleteBtn = sessionActions.createEl('button', {
          text: 'حذف',
          cls: 'ai-session-action-btn delete'
        });
        deleteBtn.addEventListener('click', () => {
          if (confirm(`هل تريد حذف المحادثة "${session.name}"؟`)) {
            this.plugin._sessionManager.delete(session.id);
            this.plugin.saveState();
            this.showConversationsSettings(container);
            new Notice('تم حذف المحادثة');
            
            // تحديث العرض في الـ ChatView
            this.refreshChatViews();
          }
        });
      });
    }
    
    // زر إنشاء محادثة جديدة
    const newSessionSection = section.createDiv({ cls: 'ai-new-session-section' });
    
    const newSessionInput = newSessionSection.createEl('input', {
      type: 'text',
      placeholder: 'اسم المحادثة الجديدة',
      cls: 'ai-new-session-input'
    });
    
    const newSessionBtn = newSessionSection.createEl('button', {
      text: 'إنشاء محادثة جديدة',
      cls: 'ai-new-session-btn'
    });
    
    newSessionBtn.addEventListener('click', () => {
      const name = newSessionInput.value.trim();
      if (!name) {
        new Notice('يرجى إدخال اسم للمحادثة');
        return;
      }
      
      const newSession = this.plugin._sessionManager.create(name);
      this.plugin.saveState();
      this.showConversationsSettings(container);
      new Notice(`تم إنشاء محادثة: ${name}`);
      newSessionInput.value = '';
      
      // تحديث العرض في الـ ChatView
      this.refreshChatViews();
    });
    
    // زر حذف جميع المحادثات
    const clearAllSection = section.createDiv({ cls: 'ai-clear-all-section' });
    
    const clearAllBtn = clearAllSection.createEl('button', {
      text: '🗑️ حذف جميع المحادثات',
      cls: 'ai-clear-all-btn'
    });
    
    clearAllBtn.addEventListener('click', () => {
      if (confirm('هل تريد حذف جميع المحادثات؟ لا يمكن التراجع عن هذا الإجراء.')) {
        this.plugin._sessionManager.sessions = [];
        this.plugin._sessionManager.create('محادثة افتراضية');
        this.plugin.saveState();
        this.showConversationsSettings(container);
        new Notice('تم حذف جميع المحادثات');
        
        // تحديث العرض في الـ ChatView
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
      new Notice(`✅ تم حفظ المحادثة في: ${fullPath}`);
    } catch (error) {
      console.error('Error saving conversation:', error);
      new Notice(`❌ خطأ في حفظ المحادثة: ${error.message}`);
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
  
  createInputField(container, label, key, value, type = 'text') {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.createEl('label', { text: label });
    
    const input = row.createEl('input', {
      type: type,
      value: value,
      placeholder: label
    });
    
    input.addEventListener('change', (e) => {
      if (key === 'shortcuts') {
        const shortcutKey = this.currentShortcutKey;
        if (shortcutKey) {
          this.plugin.settings[key][shortcutKey] = e.target.value;
        }
      } else {
        this.plugin.settings[key] = type === 'number' ? parseInt(e.target.value) : e.target.value;
      }
    });
    
    return input;
  }

  createShortcutField(container, label, parentKey, shortcutKey, value) {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.createEl('label', { text: label });
    
    const input = row.createEl('input', {
      type: 'text',
      value: value,
      placeholder: 'مثال: Ctrl+Shift+N'
    });
    
    this.currentShortcutKey = shortcutKey;
    
    input.addEventListener('change', (e) => {
      this.plugin.settings[parentKey][shortcutKey] = e.target.value;
    });
    
    return input;
  }
  
  createSliderField(container, label, key, value, min, max, step) {
    const row = container.createDiv({ cls: 'ai-settings-row' });
    row.createEl('label', { text: `${label} ${value}` });
    
    const slider = row.createEl('input', {
      type: 'range',
      value: value,
      min: min,
      max: max,
      step: step
    });
    
    const valueDisplay = row.createEl('span', { 
      text: value,
      cls: 'ai-slider-value'
    });
    
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.plugin.settings[key] = val;
      valueDisplay.textContent = val;
    });
    
    return slider;
  }
  
  createCheckboxField(container, label, key, checked) {
    const row = container.createDiv({ cls: 'ai-settings-row checkbox' });
    
    const checkbox = row.createEl('input', {
      type: 'checkbox',
      checked: checked
    });
    
    checkbox.addEventListener('change', (e) => {
      this.plugin.settings[key] = e.target.checked;
    });
    
    row.createEl('label', { text: label });
    row.prepend(checkbox);
    
    return checkbox;
  }
  
  onClose() {
    this.contentEl.empty();
  }
}

// ---------------- Main plugin ----------------
module.exports = class AIPlugin extends Plugin {
  async onload() {
    this.loadCSS();
    await this.loadSettings();
    
    const saved = await this.loadData();
    this._sessionManager = saved && saved.sessions ? new SessionManager(saved.sessions) : new SessionManager();
    if (!this._sessionManager.sessions.length) this._sessionManager.create('محادثة افتراضية', '');

    this.apiManager = new APIManager(this);

    this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    this.addRibbonIcon('brain', 'Ask Ai', () => {
      const mdv = this.app.workspace.getActiveViewOfType(MarkdownView);
      const initial = mdv ? mdv.editor.getSelection() : '';
      const pm = new PromptModal(this.app, 'Send prompt to Local AI', initial, async (val) => {
        if (!val) return;
        const s = this._sessionManager.getActive();
        if (s) s.messages.push({ role: 'user', content: val });
        try {
          const res = await this.apiManager.sendMessage({
            messages: (this._sessionManager.getMessagesForRequest().concat([{ role: 'user', content: val }])),
            temperature: this.settings.temperature,
            max_tokens: this.settings.max_tokens,
            stream: false
          }, { timeoutMs: this.settings.timeoutMs });
          new Notice('Response: ' + (res.final ? res.final.slice(0,200) : '(no text)'));
        } catch (e) {
          new Notice('Local AI Error: ' + (e.message || String(e)));
        }
      });
      pm.open();
    });

    this.addCommand({
      id: 'ai-open-sidebar',
      name: 'Open AI Assistant Sidebar',
      callback: async ()=> this.openSidebar()
    });
    
    this.addCommand({
      id: 'ai-reply-note',
      name: 'Reply in current note (stream)',
      callback: async ()=> this.replyInNote()
    });

    // إضافة اختصارات لوحة المفاتيح
    this.addCommand({
      id: 'ai-new-conversation',
      name: 'New Conversation',
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "N" }],
      callback: () => {
        const activeView = this.app.workspace.getActiveViewOfType(ChatView);
        if (activeView) {
          activeView.createNewConversation();
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
        }
      }
    });

    if (this.settings.autoCheckHealth) {
      const ok = await this.apiManager.checkHealth();
      if (!ok) new Notice('Local AI unreachable at ' + this.settings.baseUrl);
    }
  }

  loadCSS() {
  const css = `
/* =============================================
   Local AI Sidebar - RTL Version
   ============================================= */

.ai-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  gap: 8px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  direction: rtl;
  text-align: right;
}

/* أزرار اختيار المزود */
.ai-api-type-selector {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.ai-provider-btn {
  flex: 1;
  min-width: 120px;
  padding: 12px;
  border-radius: 8px;
  border: 2px solid;
  background: var(--background-secondary);
  color: var(--text-normal);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.ai-provider-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.ai-provider-btn.active {
  background: var(--background-primary);
  border-width: 3px;
  font-weight: bold;
}

/*  API محددة */
.ai-api-settings-container {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---------- Top Bar ---------- */
.ai-sidebar .ai-top-bar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  height: 32px;
  width: 100%;
  margin: 0;
  padding: 0;
  gap: 8px;
}

.ai-sidebar .ai-top-spacer {
  flex: 1;
}

.ai-sidebar .ai-shortcuts-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: var(--text-normal);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.ai-sidebar .ai-shortcuts-btn:hover {
  background-color: var(--background-modifier-hover);
  transform: scale(1.1);
}

.ai-sidebar .ai-settings-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: var(--text-normal);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.ai-sidebar .ai-settings-btn:hover {
  background-color: var(--background-modifier-hover);
  transform: scale(1.1);
}

/* زر تبديل النموذج */
.ai-sidebar .ai-mode-toggle {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 20px;
  color: var(--text-normal);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.ai-sidebar .ai-mode-toggle:hover {
  background-color: var(--background-modifier-hover);
  transform: scale(1.1);
}

/* ---------- Chat Area ---------- */
.ai-sidebar .ai-chat {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  border-radius: 8px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  margin: 4px 0;
  display: flex;
  flex-direction: column;
  min-height: 200px;
}

.ai-sidebar .ai-chat::-webkit-scrollbar {
  width: 8px;
}

.ai-sidebar .ai-chat::-webkit-scrollbar-thumb {
  background: var(--background-modifier-border);
  border-radius: 4px;
}

/* حاوية الرسائل */
.ai-msg-container {
  margin-bottom: 16px;
  max-width: 88%;
}

.ai-msg-container.user {
  align-self: flex-start;
}

.ai-msg-container.assistant {
  align-self: flex-end;
}

/* ---------- Messages ---------- */
.ai-sidebar .ai-msg {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  position: relative;
}

.ai-sidebar .ai-msg.user {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-bottom-right-radius: 4px;
  border-bottom-left-radius: 12px;
}

.ai-sidebar .ai-msg.assistant {
  background: var(--background-secondary);
  color: var(--text-normal);
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 12px;
}

/* حاوية المرفقات */
.ai-attachments-container {
  margin-top: 8px;
  padding: 10px;
  background: rgba(var(--interactive-accent-rgb), 0.1);
  border-radius: 8px;
  border: 1px dashed var(--background-modifier-border);
}

.ai-attachments-title {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
  font-weight: 600;
}

.ai-attachment {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: var(--background-primary);
  border-radius: 6px;
  margin-bottom: 4px;
  border: 1px solid var(--background-modifier-border);
}

.ai-attachment:last-child {
  margin-bottom: 0;
}

.ai-attachment-name {
  font-size: 13px;
  color: var(--text-normal);
  margin-right: 8px;
}

/* دعم Markdown في الرسائل */
.ai-sidebar .ai-msg.assistant p {
  margin: 0.5em 0;
}

.ai-sidebar .ai-msg.assistant h1,
.ai-sidebar .ai-msg.assistant h2,
.ai-sidebar .ai-msg.assistant h3,
.ai-sidebar .ai-msg.assistant h4,
.ai-sidebar .ai-msg.assistant h5,
.ai-sidebar .ai-msg.assistant h6 {
  margin-top: 1em;
  margin-bottom: 0.5em;
}

.ai-sidebar .ai-msg.assistant code {
  background-color: var(--background-primary);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.ai-sidebar .ai-msg.assistant pre {
  background-color: var(--background-primary);
  padding: 10px;
  border-radius: 5px;
  overflow-x: auto;
}

.ai-sidebar .ai-msg.assistant ul,
.ai-sidebar .ai-msg.assistant ol {
  padding-right: 20px;
}

/* ---------- Input Area with Floating Buttons ---------- */
.ai-sidebar .ai-input-wrap {
  position: relative;
  width: 100%;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--background-modifier-border);
}

.ai-sidebar .ai-input {
  width: 100%;
  resize: vertical;
  padding: 12px;
  padding-bottom: 60px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
  color: var(--text-normal);
  font-size: 15px;
  font-family: inherit;
  min-height: 120px;
  max-height: 300px;
  line-height: 1.5;
  text-align: right;
  direction: rtl;
  box-sizing: border-box;
}

.ai-sidebar .ai-input:focus {
  outline: none;
  border-color: var(--interactive-accent);
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}

/* ---------- Floating Buttons ---------- */
.ai-sidebar .floating-btn {
  position: absolute;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  z-index: 100;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

/* زر الإرسال - دائري في الأسفل على اليسار */
.ai-sidebar .ai-send-btn {
  bottom: 15px;
  left: 15px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.ai-sidebar .ai-send-btn:hover {
  background: var(--interactive-accent-hover);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* زر الإرفاق - دائري فوق زر الإرسال */
.ai-sidebar .ai-attach-btn {
  bottom: 60px;
  left: 15px;
  background: var(--interactive-accent);
  color: var(--text-normal);
  border: 1px solid var(--background-modifier-border);
}

.ai-sidebar .ai-attach-btn:hover {
  background: var(--background-modifier-hover);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

/* ===== قائمة الاختصارات ===== */
.ai-shortcuts-menu {
  position: fixed !important;
  background: var(--background-primary) !important;
  border: 1px solid var(--background-modifier-border) !important;
  border-radius: 8px !important;
  padding: 10px !important;
  min-width: 200px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.2) !important;
  z-index: 9999 !important;
  backdrop-filter: blur(10px) !important;
  font-family: inherit !important;
}

.shortcut-item {
  padding: 8px 12px !important;
  cursor: pointer !important;
  font-size: 13px !important;
  color: var(--text-normal) !important;
  border-bottom: 1px solid var(--background-modifier-border) !important;
  transition: all 0.2s ease !important;
  text-align: right !important;
  direction: rtl !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
}

.shortcut-item:last-child {
  border-bottom: none !important;
}

.shortcut-item:hover {
  background: var(--background-modifier-hover) !important;
  color: var(--text-accent) !important;
}

.shortcut-key {
  font-weight: 600 !important;
}

.shortcut-value {
  font-family: monospace !important;
  font-size: 12px !important;
  color: var(--text-muted) !important;
  background: var(--background-secondary) !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  border: 1px solid var(--background-modifier-border) !important;
}

/* ===== Attach Modal Styles ===== */

/* العنوان في الوسط */
.ai-attach-title {
  text-align: center !important;
  margin: 0 0 20px 0 !important;
  padding: 0 !important;
  font-size: 18px !important;
  font-weight: 600 !important;
  color: var(--text-normal) !important;
}

/* صف البحث */
.ai-search-row {
  margin-bottom: 16px !important;
}

.ai-search-row input {
  width: 100% !important;
  padding: 10px 14px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background-color: var(--background-secondary) !important;
  color: var(--text-normal) !important;
  font-size: 14px !important;
  transition: all 0.2s ease !important;
}

.ai-search-row input:focus {
  outline: none !important;
  border-color: var(--interactive-accent) !important;
  box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb), 0.2) !important;
}

/* حاوية قائمة الملفات */
.ai-file-list-container {
  max-height: 300px !important;
  overflow-y: auto !important;
  border: 1px solid var(--background-modifier-border) !important;
  border-radius: 8px !important;
  padding: 8px !important;
  background-color: var(--background-secondary) !important;
  margin-bottom: 16px !important;
}

.ai-file-list-container::-webkit-scrollbar {
  width: 6px !important;
}

.ai-file-list-container::-webkit-scrollbar-thumb {
  background-color: var(--background-modifier-border) !important;
  border-radius: 3px !important;
}

/* صف الملف */
.ai-file-row {
  display: flex !important;
  align-items: center !important;
  padding: 10px 12px !important;
  border-radius: 6px !important;
  margin-bottom: 6px !important;
  background-color: var(--background-primary) !important;
  border: 1px solid var(--background-modifier-border) !important;
  transition: all 0.2s ease !important;
  cursor: pointer !important;
}

.ai-file-row:hover {
  background-color: var(--background-modifier-hover) !important;
  border-color: var(--interactive-accent) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
}

.ai-file-row:last-child {
  margin-bottom: 0 !important;
}

/* حاوية الـ checkbox */
.ai-checkbox-container {
  margin-left: 12px !important;
  flex-shrink: 0 !important;
}

.ai-file-checkbox {
  width: 18px !important;
  height: 18px !important;
  cursor: pointer !important;
  accent-color: var(--interactive-accent) !important;
}

/* معلومات الملف */
.ai-file-info {
  flex: 1 !important;
  min-width: 0 !important;
}

.ai-file-name {
  font-weight: 600 !important;
  font-size: 14px !important;
  color: var(--text-normal) !important;
  margin-bottom: 2px !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.ai-file-path {
  font-size: 12px !important;
  color: var(--text-muted) !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

/* رسالة عندما لا توجد ملفات */
.ai-empty-files {
  text-align: center !important;
  padding: 40px 20px !important;
  color: var(--text-muted) !important;
  font-size: 14px !important;
}

/* تظليل النص المطابق في البحث */
.ai-search-highlight {
  background-color: var(--text-highlight-bg) !important;
  color: var(--text-normal) !important;
  padding: 1px 3px !important;
  border-radius: 3px !important;
  font-weight: bold !important;
}

/* صف أزرار الإرسال والإلغاء */
.ai-attach-btn-row {
  display: flex !important;
  justify-content: center !important;
  gap: 12px !important;
  margin-top: 20px !important;
}

.ai-attach-send-btn {
  padding: 10px 24px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background-color: var(--interactive-accent) !important;
  color: var(--text-on-accent) !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
  min-width: 120px !important;
}

.ai-attach-send-btn:hover {
  background-color: var(--interactive-accent-hover) !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 12px rgba(var(--interactive-accent-rgb), 0.3) !important;
}

.ai-attach-cancel-btn {
  padding: 10px 24px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background-color: var(--background-secondary) !important;
  color: var(--text-normal) !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
  min-width: 120px !important;
}

.ai-attach-cancel-btn:hover {
  background-color: var(--background-modifier-hover) !important;
  border-color: var(--text-muted) !important;
}

/* token counter */
.ai-token-counter {
  font-size: 11px !important;
  font-weight: normal !important;
  padding: 4px 8px !important;
  border-radius: 12px !important;
  background: transparent !important;
  color: var(--text-muted) !important;
  border: 1px solid var(--background-modifier-border) !important;
  cursor: default !important;
  user-select: none !important;
  transition: all 0.3s ease !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 70px !important;
  height: 24px !important;
  direction: ltr !important;
}

.ai-token-counter:hover {
    transform: scale(1.05) !important;
    box-shadow: 0 2px 6px rgba(0,0,0,0.1) !important;
}

/* عداد التوكنات في الهيد بار */
.ai-sidebar .ai-top-bar {
    display: flex !important;
    justify-content: flex-start !important;
    align-items: center !important;
    height: 36px !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    gap: 8px !important;
}

.ai-sidebar .ai-top-spacer {
    flex: 1 !important;
}

/* علامات تبويب ال */
.ai-settings-tabs {
  display: flex !important;
  gap: 8px !important;
  margin-bottom: 20px !important;
  border-bottom: 1px solid var(--background-modifier-border) !important;
  padding-bottom: 10px !important;
  flex-wrap: wrap;
}

.ai-tab-btn {
  padding: 10px 16px !important;
  border: none !important;
  background: transparent !important;
  color: var(--text-muted) !important;
  cursor: pointer !important;
  border-radius: 6px !important;
  font-size: 14px !important;
  transition: all 0.2s ease !important;
  white-space: nowrap;
}

.ai-tab-btn:hover {
  background: var(--background-modifier-hover) !important;
  color: var(--text-normal) !important;
}

.ai-tab-btn.active {
  background: var(--interactive-accent) !important;
  color: var(--text-on-accent) !important;
  font-weight: 600 !important;
}

/* محتوى ال */
.ai-settings-content {
  max-height: 400px !important;
  overflow-y: auto !important;
  padding-right: 10px !important;
  margin-bottom: 20px !important;
}

.ai-settings-section {
  background: var(--background-secondary) !important;
  border-radius: 8px !important;
  padding: 20px !important;
  margin-bottom: 20px !important;
  border: 1px solid var(--background-modifier-border) !important;
}

.ai-settings-section h3 {
  margin-top: 0 !important;
  margin-bottom: 20px !important;
  color: var(--text-normal) !important;
  font-size: 16px !important;
}

/* صفوف ال */
.ai-settings-row {
  margin-bottom: 16px !important;
}

.ai-settings-row label {
  display: block !important;
  margin-bottom: 6px !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: var(--text-normal) !important;
}

.ai-settings-row input[type="text"],
.ai-settings-row input[type="password"],
.ai-settings-row input[type="number"] {
  width: 100% !important;
  padding: 10px 14px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background: var(--background-primary) !important;
  color: var(--text-normal) !important;
  font-size: 14px !important;
  box-sizing: border-box !important;
}

.ai-settings-row input:focus {
  outline: none !important;
  border-color: var(--interactive-accent) !important;
  box-shadow: 0 0 0 2px var(--interactive-accent-hover) !important;
}

/* Slider */
.ai-settings-row input[type="range"] {
  width: 100% !important;
  height: 6px !important;
  border-radius: 3px !important;
  background: var(--background-modifier-border) !important;
  outline: none !important;
  -webkit-appearance: none !important;
}

.ai-settings-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none !important;
  width: 20px !important;
  height: 20px !important;
  border-radius: 50% !important;
  background: var(--interactive-accent) !important;
  cursor: pointer !important;
}

.ai-slider-value {
  display: inline-block !important;
  margin-left: 10px !important;
  font-weight: 600 !important;
  color: var(--interactive-accent) !important;
  min-width: 40px !important;
}

/* Checkbox */
.ai-settings-row.checkbox {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
}

.ai-settings-row.checkbox input[type="checkbox"] {
  width: 18px !important;
  height: 18px !important;
  accent-color: var(--interactive-accent) !important;
}

.ai-settings-row.checkbox label {
  margin-bottom: 0 !important;
  cursor: pointer !important;
}

/* زر الاختبار */
.ai-test-btn {
  width: 100% !important;
  padding: 12px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background: var(--background-secondary) !important;
  color: var(--text-normal) !important;
  cursor: pointer !important;
  font-size: 14px !important;
  margin-top: 10px !important;
  transition: all 0.2s ease !important;
}

.ai-test-btn:hover {
  background: var(--background-modifier-hover) !important;
  border-color: var(--interactive-accent) !important;
}

.ai-test-btn:disabled {
  opacity: 0.6 !important;
  cursor: not-allowed !important;
}

/* معلومات الاختصارات */
.ai-shortcuts-info {
  background: var(--background-primary) !important;
  border-radius: 8px !important;
  padding: 12px !important;
  margin-top: 16px !important;
  border: 1px solid var(--background-modifier-border) !important;
  font-size: 12px !important;
  color: var(--text-muted) !important;
}

/* أزرار ال */
.ai-settings-btn-row {
  display: flex !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  padding-top: 20px !important;
  border-top: 1px solid var(--background-modifier-border) !important;
}

.ai-settings-save-btn {
  padding: 10px 24px !important;
  border-radius: 8px !important;
  border: none !important;
  background: var(--interactive-accent) !important;
  color: var(--text-on-accent) !important;
  cursor: pointer !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  transition: all 0.2s ease !important;
}

.ai-settings-save-btn:hover {
  background: var(--interactive-accent-hover) !important;
  transform: translateY(-1px) !important;
}

.ai-settings-cancel-btn {
  padding: 10px 24px !important;
  border-radius: 8px !important;
  border: 1px solid var(--background-modifier-border) !important;
  background: var(--background-secondary) !important;
  color: var(--text-normal) !important;
  cursor: pointer !important;
  font-size: 14px !important;
  transition: all 0.2s ease !important;
}

.ai-settings-cancel-btn:hover {
  background: var(--background-modifier-hover) !important;
}

/* ===== إدارة المحادثات في الإعدادات ===== */

.ai-session-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 16px;
  background-color: var(--background-secondary);
}

.ai-session-list::-webkit-scrollbar {
  width: 6px;
}

.ai-session-list::-webkit-scrollbar-thumb {
  background-color: var(--background-modifier-border);
  border-radius: 3px;
}

.ai-session-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 6px;
  background-color: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  transition: all 0.2s ease;
}

.ai-session-row:hover {
  background-color: var(--background-modifier-hover);
  border-color: var(--interactive-accent);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.ai-session-row.active {
  background-color: rgba(var(--interactive-accent-rgb), 0.1);
  border-color: var(--interactive-accent);
}

.ai-session-row:last-child {
  margin-bottom: 0;
}

.ai-session-info {
  flex: 1;
  min-width: 0;
}

.ai-session-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-normal);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-session-count {
  font-size: 12px;
  color: var(--text-muted);
}

.ai-session-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.ai-session-action-btn {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--background-modifier-border);
  background-color: var(--background-secondary);
  color: var(--text-normal);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.ai-session-action-btn:hover {
  background-color: var(--background-modifier-hover);
  border-color: var(--text-muted);
}

.ai-session-action-btn.save {
  background-color: rgba(46, 125, 50, 0.1);
  color: #2e7d32;
  border-color: #2e7d32;
}

.ai-session-action-btn.save:hover {
  background-color: rgba(46, 125, 50, 0.2);
}

.ai-session-action-btn.delete {
  background-color: rgba(var(--background-modifier-error-rgb), 0.1);
  color: var(--text-error);
  border-color: var(--text-error);
}

.ai-session-action-btn.delete:hover {
  background-color: rgba(var(--background-modifier-error-rgb), 0.2);
}

.ai-new-session-section {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.ai-new-session-input {
  flex: 1;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);
  color: var(--text-normal);
  font-size: 14px;
}

.ai-new-session-btn {
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid var(--background-modifier-border);
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ai-new-session-btn:hover {
  background-color: var(--interactive-accent-hover);
  transform: translateY(-1px);
}

.ai-clear-all-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--background-modifier-border);
}

.ai-clear-all-btn {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--text-error);
  background-color: rgba(var(--background-modifier-error-rgb), 0.1);
  color: var(--text-error);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ai-clear-all-btn:hover {
  background-color: rgba(var(--background-modifier-error-rgb), 0.2);
  transform: translateY(-1px);
}

.ai-empty-sessions {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 14px;
}

/* إخفاء عداد التوكنات إذا كان معطلاً */
.ai-token-counter[style*="display: none"] {
  display: none !important;
}

.ai-token-counter[style*="display: flex"] {
  display: flex !important;
}
  `;
  
  const styleEl = document.createElement('style');
  styleEl.id = 'ai-css';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
 }

  onunload() {
    const styleEl = document.getElementById('ai-css');
    if (styleEl) {
      styleEl.remove();
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async openSidebar() {
    let leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) leaf = this.app.workspace.getRightLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async replyInNote() {
    const mdv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mdv) { new Notice('Open a markdown file'); return; }
    const editor = mdv.editor;
    const selection = editor.getSelection().trim();
    const prompt = selection.length ? selection : editor.getValue();
    const s = this._sessionManager.getActive();
    if (s) s.messages.push({ role:'user', content: prompt });
    
    editor.replaceSelection("\n\n**AI response:**\n\n");
    try {
      await this.apiManager.sendMessage({
        messages: this._sessionManager.getMessagesForRequest().concat([{ role:'user', content: prompt }]),
        temperature: this.settings.temperature,
        max_tokens: this.settings.max_tokens,
        stream: true
      }, {
        onChunk: (chunk) => {
          editor.replaceSelection(chunk);
        }, timeoutMs: this.settings.timeoutMs
      });
      new Notice('Finished streaming into note');
    } catch (e) {
      new Notice('Local AI Error: ' + (e.message || String(e)));
    }
  }

  async checkHealth() {
    return await this.apiManager.checkHealth();
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
};