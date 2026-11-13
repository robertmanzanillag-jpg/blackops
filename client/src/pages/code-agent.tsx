import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Code2, Send, Loader2, Sparkles, FileCode, Trash2, ArrowLeft, 
  FolderTree, Database, History, Undo, Play, Eye, Check, X,
  FileText, Table, Cpu, Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  codePreview?: CodePreview | null;
}

interface CodePreview {
  explanation: string;
  files: { path: string; content: string; action: 'create' | 'modify' }[];
  tables: { name: string; action: 'create' | 'modify'; columns?: any[] }[];
}

interface ChangeHistoryItem {
  filePath: string;
  description: string;
  timestamp: Date;
}

interface Template {
  id: string;
  name: string;
  description: string;
}

const SUGGESTIONS = [
  "Crea un módulo CRUD para 'notas'",
  "Agrega un campo 'categoria' a las tareas",
  "Crea un tracker de hábitos",
  "Haz un componente de estadísticas",
  "Crea endpoint para exportar datos",
  "Agrega una tabla de contactos",
];

export default function CodeAgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<CodePreview | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'chat' | 'files' | 'history'>('chat');
  const [projectStructure, setProjectStructure] = useState<string>("");
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (inputRef.current && activeTab === 'chat') {
      inputRef.current.focus();
    }
  }, [activeTab]);

  useEffect(() => {
    loadProjectStructure();
    loadChangeHistory();
    loadTemplates();
  }, []);

  const loadProjectStructure = async () => {
    try {
      const res = await fetch('/api/code/structure');
      const data = await res.json();
      if (data.success) {
        setProjectStructure(data.structure);
      }
    } catch (e) {
      console.error('Error loading structure:', e);
    }
  };

  const loadChangeHistory = async () => {
    try {
      const res = await fetch('/api/code/history');
      const data = await res.json();
      if (data.success) {
        setChangeHistory(data.history || []);
      }
    } catch (e) {
      console.error('Error loading history:', e);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/code/templates');
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
      }
    } catch (e) {
      console.error('Error loading templates:', e);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setPendingPreview(null);
    setPendingPrompt("");
  };

  const handleUndo = async () => {
    try {
      const res = await fetch('/api/code/undo', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ Cambio deshecho en: ${data.filePath}`,
          timestamp: new Date()
        }]);
        loadChangeHistory();
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${data.error}`,
          timestamp: new Date()
        }]);
      }
    } catch (e) {
      console.error('Error undoing:', e);
    }
  };

  const generateCode = async (prompt: string, preview: boolean = true) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/code/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, preview })
      });
      const data = await res.json();
      
      if (data.success) {
        if (preview) {
          setPendingPreview(data);
          setPendingPrompt(prompt);
          return data;
        }
        return data;
      } else {
        throw new Error(data.error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!pendingPrompt) return;
    
    setIsLoading(true);
    try {
      const res = await fetch('/api/code/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: pendingPrompt })
      });
      const data = await res.json();
      
      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Cambios aplicados:**\n\n${data.explanation}\n\n📁 Archivos: ${data.files?.length || 0}\n🗄️ Tablas: ${data.tables?.length || 0}`,
          timestamp: new Date()
        }]);
        loadChangeHistory();
        loadProjectStructure();
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Error: ${data.error}`,
          timestamp: new Date()
        }]);
      }
      
      setPendingPreview(null);
      setPendingPrompt("");
    } finally {
      setIsLoading(false);
    }
  };

  const cancelPreview = () => {
    setPendingPreview(null);
    setPendingPrompt("");
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '🚫 Cambios cancelados.',
      timestamp: new Date()
    }]);
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = (messageText || input).trim();
    if (!userMessage || isLoading) return;

    setInput("");
    setMessages(prev => [...prev, { 
      role: "user", 
      content: userMessage, 
      timestamp: new Date()
    }]);

    try {
      const data = await generateCode(userMessage, true);
      
      if (data && data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔍 **Vista previa:**\n\n${data.explanation || 'Cambios listos para aplicar'}`,
          timestamp: new Date(),
          codePreview: data
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Error generando código: ${data?.error || 'Error desconocido'}`,
          timestamp: new Date()
        }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${error.message}`,
        timestamp: new Date()
      }]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatMessage = (content: string) => {
    return content.split('\n').map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return <strong key={i} className="text-white">{line.slice(2, -2)}</strong>;
      }
      if (line.startsWith('- ')) {
        return <div key={i} className="ml-2">• {line.slice(2)}</div>;
      }
      if (line.startsWith('```')) {
        return null;
      }
      return <div key={i}>{line || <br />}</div>;
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]" data-testid="code-agent-page">
      <div className="flex h-screen">
        <div className="flex-1 flex flex-col">
          <div className="sticky top-0 z-10 bg-[#0a0a0a]/90 backdrop-blur border-b border-zinc-800/50 px-3 sm:px-4 py-2 sm:py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <Link href="/">
                  <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white h-8 w-8 sm:h-10 sm:w-10" data-testid="back-button">
                    <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Button>
                </Link>
                <div className="flex items-center gap-2">
                  <div className="p-1.5 sm:p-2 rounded-lg bg-gradient-to-br from-zinc-950/20 to-zinc-900/20">
                    <Code2 className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400" />
                  </div>
                  <div>
                    <h1 className="text-base sm:text-lg font-semibold text-white">Code Agent</h1>
                    <p className="text-[10px] sm:text-xs text-zinc-500 hidden sm:block">Vibe Coding con IA</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={handleUndo}
                  className="text-zinc-400 hover:text-white text-xs sm:text-sm px-2 sm:px-3"
                  data-testid="undo-button"
                >
                  <Undo className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">Deshacer</span>
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={clearChat}
                  className="text-zinc-400 hover:text-white h-8 w-8"
                  data-testid="clear-button"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            <div className="flex gap-1 mt-2 sm:mt-3 overflow-x-auto">
              <Button
                variant={activeTab === 'chat' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('chat')}
                className={cn(
                  "text-xs",
                  activeTab === 'chat' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                )}
                data-testid="tab-chat"
              >
                <Cpu className="w-3 h-3 mr-1" />
                Chat
              </Button>
              <Button
                variant={activeTab === 'files' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('files')}
                className={cn(
                  "text-xs",
                  activeTab === 'files' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                )}
                data-testid="tab-files"
              >
                <FolderTree className="w-3 h-3 mr-1" />
                Archivos
              </Button>
              <Button
                variant={activeTab === 'history' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('history')}
                className={cn(
                  "text-xs",
                  activeTab === 'history' ? 'bg-zinc-800 text-white' : 'text-zinc-400'
                )}
                data-testid="tab-history"
              >
                <History className="w-3 h-3 mr-1" />
                Historial
              </Button>
            </div>
          </div>

          {activeTab === 'chat' && (
            <>
              <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="mb-6"
                    >
                      <div className="p-4 rounded-2xl bg-gradient-to-br from-zinc-950/20 to-zinc-900/20 border border-white/10">
                        <Zap className="w-12 h-12 text-zinc-400" />
                      </div>
                    </motion.div>
                    <h2 className="text-xl font-semibold text-white mb-2">
                      Vibe Coding
                    </h2>
                    <p className="text-zinc-400 mb-6 max-w-sm">
                      Describe en español qué quieres crear o modificar. El agente generará el código automáticamente.
                    </p>
                    
                    <div className="w-full max-w-md">
                      <p className="text-xs text-zinc-500 mb-2">Sugerencias:</p>
                      <div className="grid grid-cols-2 gap-2">
                        {SUGGESTIONS.map((suggestion, i) => (
                          <motion.button
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.05 }}
                            onClick={() => sendMessage(suggestion)}
                            className="text-left px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800 hover:border-white/10 hover:bg-zinc-800/10 text-sm text-zinc-300 transition-all"
                            data-testid={`suggestion-${i}`}
                          >
                            <Sparkles className="w-3 h-3 inline mr-1 text-zinc-400" />
                            {suggestion}
                          </motion.button>
                        ))}
                      </div>
                      
                      {templates.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs text-zinc-500 mb-2">Templates:</p>
                          <div className="flex flex-wrap gap-2">
                            {templates.map((t) => (
                              <Button
                                key={t.id}
                                variant="outline"
                                size="sm"
                                className="text-xs border-zinc-700 hover:border-zinc-700"
                                onClick={() => sendMessage(`Usa el template ${t.id} para crear un ejemplo`)}
                                data-testid={`template-${t.id}`}
                              >
                                <FileCode className="w-3 h-3 mr-1" />
                                {t.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-3xl mx-auto">
                    <AnimatePresence>
                      {messages.map((message, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className={cn(
                            "flex",
                            message.role === "user" ? "justify-end" : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[85%] rounded-xl px-4 py-3",
                              message.role === "user"
                                ? "bg-zinc-800 text-white"
                                : "bg-zinc-800/50 border border-zinc-700/50 text-zinc-200"
                            )}
                          >
                            <div className="text-sm whitespace-pre-wrap">
                              {formatMessage(message.content)}
                            </div>
                            
                            {message.codePreview && (
                              <div className="mt-3 space-y-2">
                                {message.codePreview.files?.map((file, fi) => (
                                  <div key={fi} className="bg-zinc-900 rounded-lg p-2 border border-zinc-700">
                                    <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
                                      <FileText className="w-3 h-3" />
                                      <span className={file.action === 'create' ? 'text-zinc-400' : 'text-zinc-400'}>
                                        {file.action === 'create' ? '+ Crear:' : '~ Modificar:'}
                                      </span>
                                      <span className="text-zinc-400">{file.path}</span>
                                    </div>
                                    <pre className="text-xs text-zinc-400 overflow-x-auto max-h-32 overflow-y-auto">
                                      {file.content.slice(0, 500)}
                                      {file.content.length > 500 && '...'}
                                    </pre>
                                  </div>
                                ))}
                                
                                {message.codePreview.tables?.map((table, ti) => (
                                  <div key={ti} className="bg-zinc-900 rounded-lg p-2 border border-zinc-700">
                                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                                      <Table className="w-3 h-3" />
                                      <span className={table.action === 'create' ? 'text-zinc-400' : 'text-zinc-400'}>
                                        {table.action === 'create' ? '+ Crear tabla:' : '~ Modificar tabla:'}
                                      </span>
                                      <span className="text-zinc-400">{table.name}</span>
                                    </div>
                                  </div>
                                ))}
                                
                                <div className="flex gap-2 mt-2">
                                  <Button
                                    size="sm"
                                    onClick={applyChanges}
                                    disabled={isLoading}
                                    className="bg-zinc-800 hover:bg-zinc-800 text-white"
                                    data-testid="apply-changes"
                                  >
                                    <Check className="w-3 h-3 mr-1" />
                                    Aplicar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={cancelPreview}
                                    disabled={isLoading}
                                    className="border-zinc-600"
                                    data-testid="cancel-changes"
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            )}
                            
                            <div className="text-[10px] text-zinc-500 mt-1">
                              {message.timestamp.toLocaleTimeString()}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    
                    {isLoading && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            <span className="text-sm text-zinc-400">Generando código...</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="sticky bottom-0 bg-[#0a0a0a] border-t border-zinc-800/50 p-4">
                <div className="max-w-3xl mx-auto">
                  <div className="flex gap-2">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Describe qué quieres crear o modificar..."
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/50 resize-none"
                      rows={1}
                      disabled={isLoading}
                      data-testid="input-prompt"
                    />
                    <Button
                      onClick={() => sendMessage()}
                      disabled={!input.trim() || isLoading}
                      className="bg-zinc-800 hover:bg-zinc-800 text-white rounded-xl px-4"
                      data-testid="send-button"
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Send className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'files' && (
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-4">
                  <FolderTree className="w-5 h-5 text-zinc-400" />
                  <h2 className="text-lg font-semibold text-white">Estructura del Proyecto</h2>
                </div>
                <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                  {projectStructure || 'Cargando...'}
                </pre>
              </div>
            </ScrollArea>
          )}

          {activeTab === 'history' && (
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-2 mb-4">
                  <History className="w-5 h-5 text-zinc-400" />
                  <h2 className="text-lg font-semibold text-white">Historial de Cambios</h2>
                </div>
                
                {changeHistory.length === 0 ? (
                  <div className="text-center text-zinc-500 py-8">
                    No hay cambios registrados
                  </div>
                ) : (
                  <div className="space-y-2">
                    {changeHistory.slice().reverse().map((change, i) => (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <FileText className="w-4 h-4 text-zinc-400" />
                          <span className="text-white">{change.filePath}</span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-1">{change.description}</div>
                        <div className="text-[10px] text-zinc-600 mt-1">
                          {new Date(change.timestamp).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
