import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Github, Send, Loader2, ArrowLeft, FolderTree, FileCode, 
  ChevronRight, ChevronDown, File, Folder, RefreshCw, 
  Check, X, GitCommit, Code2, Eye, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ownerOfficeStorageKey } from "@/lib/owner-office-storage";

interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  updated_at: string;
  language: string | null;
}

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha?: string;
}

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  filePreview?: {
    path: string;
    content: string;
    sha?: string;
  } | null;
}

const OFFICE_GITHUB_HANDOFF_KEY = "office.githubAgentHandoff";

export default function GitHubAgentPage() {
  const queryClient = useQueryClient();
  const ownerId = queryClient.getQueryData<{ user?: { id: string } }>(["auth-me"])?.user?.id;
  const handoffKey = ownerId ? ownerOfficeStorageKey(OFFICE_GITHUB_HANDOFF_KEY, ownerId) : null;
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; sha: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ path: string; content: string; sha?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestedRepo = new URLSearchParams(window.location.search).get("repo");
  const requestedTask = new URLSearchParams(window.location.search).get("task");
  const [handoffLoaded, setHandoffLoaded] = useState(false);

  useEffect(() => {
    checkConnection();
  }, []);

  useEffect(() => {
    if (!requestedRepo || selectedRepo || repos.length === 0) return;
    const repo = repos.find((item) => item.full_name === requestedRepo || item.name === requestedRepo);
    if (repo) {
      selectRepo(repo);
    }
  }, [requestedRepo, repos, selectedRepo]);

  useEffect(() => {
    if (!selectedRepo || handoffLoaded) return;

    let task = requestedTask || "";
    let sourceAgent = "Oficina";
    let sourceApp = selectedRepo.name;

    try {
      const rawHandoff = handoffKey ? window.localStorage.getItem(handoffKey) : null;
      if (rawHandoff) {
        const handoff = JSON.parse(rawHandoff) as {
          repo?: string;
          app?: string;
          agent?: string;
          task?: string;
        };
        if (handoff.repo === selectedRepo.full_name && handoff.task) {
          task = task || handoff.task;
          sourceAgent = handoff.agent || sourceAgent;
          sourceApp = handoff.app || sourceApp;
        }
      }
    } catch {
      // Ignore invalid local handoff data.
    }

    if (!task) return;

    setInput(task);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `📨 Solicitud recibida desde ${sourceAgent} para **${sourceApp}**:\n\n${task}\n\nSelecciona el archivo que quieres cambiar y te preparo una vista previa antes de hacer commit.`,
        timestamp: new Date(),
      },
    ]);
    setHandoffLoaded(true);
  }, [handoffLoaded, requestedTask, selectedRepo, handoffKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const checkConnection = async () => {
    try {
      const res = await fetch('/api/github/status');
      const data = await res.json();
      setIsConnected(data.connected);
      if (data.connected && data.user) {
        setUser(data.user);
        loadRepos();
      }
    } catch (e) {
      setIsConnected(false);
    }
  };

  const loadRepos = async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch('/api/github/repos');
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepos(data);
      }
    } catch (e) {
      console.error('Error loading repos:', e);
    } finally {
      setLoadingRepos(false);
    }
  };

  const selectRepo = async (repo: Repo) => {
    setSelectedRepo(repo);
    setCurrentPath("");
    setSelectedFile(null);
    loadFiles(repo, "");
    setMessages([{
      role: 'assistant',
      content: `📂 Repositorio **${repo.name}** seleccionado. Navega por los archivos o describe qué cambios quieres hacer.`,
      timestamp: new Date()
    }]);
  };

  const loadFiles = async (repo: Repo, path: string) => {
    setLoadingFiles(true);
    try {
      const [owner, repoName] = repo.full_name.split('/');
      const res = await fetch(`/api/github/repos/${owner}/${repoName}/contents?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const sorted = [...data].sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
        setCurrentPath(path);
      }
    } catch (e) {
      console.error('Error loading files:', e);
    } finally {
      setLoadingFiles(false);
    }
  };

  const openFile = async (file: FileItem) => {
    if (file.type === 'dir') {
      loadFiles(selectedRepo!, file.path);
      return;
    }

    setIsLoading(true);
    try {
      const [owner, repoName] = selectedRepo!.full_name.split('/');
      const res = await fetch(`/api/github/repos/${owner}/${repoName}/file?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        setSelectedFile({
          path: data.path,
          content: data.content,
          sha: data.sha
        });
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📄 Archivo **${file.name}** cargado. Describe qué cambios quieres hacer.`,
          timestamp: new Date(),
          filePreview: data
        }]);
      }
    } catch (e) {
      console.error('Error loading file:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const goUp = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    loadFiles(selectedRepo!, parts.join('/'));
  };

  const generateEdit = async (prompt: string) => {
    if (!selectedFile || !selectedRepo) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Primero selecciona un archivo para editar.',
        timestamp: new Date()
      }]);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/code/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Archivo: ${selectedFile.path}\n\nContenido actual:\n\`\`\`\n${selectedFile.content}\n\`\`\`\n\nCambio solicitado: ${prompt}\n\nGenera SOLO el contenido modificado del archivo, sin explicaciones.`,
          preview: true
        })
      });
      const data = await res.json();
      
      if (data.success && data.files?.[0]) {
        const newContent = data.files[0].content;
        setPendingEdit({
          path: selectedFile.path,
          content: newContent,
          sha: selectedFile.sha
        });
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `🔍 **Vista previa del cambio:**\n\n${data.explanation || 'Cambios listos para aplicar'}`,
          timestamp: new Date(),
          filePreview: { path: selectedFile.path, content: newContent }
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Error: ${data.error || 'No se pudo generar el cambio'}`,
          timestamp: new Date()
        }]);
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${e.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const applyEdit = async () => {
    if (!pendingEdit || !selectedRepo) return;

    setIsLoading(true);
    try {
      const [owner, repoName] = selectedRepo.full_name.split('/');
      const res = await fetch(`/api/github/repos/${owner}/${repoName}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: pendingEdit.path,
          content: pendingEdit.content,
          message: `Update ${pendingEdit.path} via BlackOps Code Agent`,
          sha: pendingEdit.sha
        })
      });
      const data = await res.json();

      if (data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Commit creado:**\n\n📝 ${pendingEdit.path}\n🔗 Commit: ${data.commit?.slice(0, 7) || 'success'}`,
          timestamp: new Date()
        }]);
        setSelectedFile({
          path: pendingEdit.path,
          content: pendingEdit.content,
          sha: data.file?.sha || ''
        });
        setPendingEdit(null);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Error al hacer commit: ${data.error}`,
          timestamp: new Date()
        }]);
      }
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Error: ${e.message}`,
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const cancelEdit = () => {
    setPendingEdit(null);
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

    await generateEdit(userMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (isConnected === null) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-4">
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 mb-6">
          <Github className="w-16 h-16 text-zinc-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">GitHub no conectado</h1>
        <p className="text-zinc-400 text-center mb-6 max-w-sm">
          Conecta tu cuenta de GitHub desde la configuración de Replit para usar esta función.
        </p>
        <Link href="/">
          <Button variant="outline" className="border-zinc-700">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al inicio
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]" data-testid="github-agent-page">
      <div className="flex flex-col md:flex-row h-screen">
        <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-zinc-800 flex flex-col max-h-[40vh] md:max-h-none">
          <div className="p-3 md:p-4 border-b border-zinc-800">
            <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-4">
              <Link href="/">
                <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white h-8 w-8 md:h-10 md:w-10" data-testid="back-button">
                  <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <div className="p-1.5 md:p-2 rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-800">
                  <Github className="w-4 h-4 md:w-5 md:h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-base md:text-lg font-semibold text-white">GitHub Agent</h1>
                  <p className="text-[10px] md:text-xs text-zinc-500">Edita tus repos con IA</p>
                </div>
              </div>
            </div>
            {user && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-zinc-900">
                <img src={user.avatar_url} alt={user.login} className="w-6 h-6 md:w-8 md:h-8 rounded-full" />
                <div>
                  <p className="text-xs md:text-sm text-white">{user.name || user.login}</p>
                  <p className="text-[10px] md:text-xs text-zinc-500 hidden sm:block">@{user.login}</p>
                </div>
              </div>
            )}
          </div>

          {!selectedRepo ? (
            <ScrollArea className="flex-1">
              <div className="p-2">
                <div className="flex items-center justify-between mb-2 px-2">
                  <p className="text-xs text-zinc-500 uppercase tracking-wide">Repositorios</p>
                  <Button variant="ghost" size="icon" onClick={loadRepos} className="h-6 w-6" data-testid="refresh-repos">
                    <RefreshCw className={cn("w-3 h-3 text-zinc-400", loadingRepos && "animate-spin")} />
                  </Button>
                </div>
                {loadingRepos ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                  </div>
                ) : repos.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <Folder className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                    <p className="text-sm text-zinc-400 mb-2">No tienes repositorios</p>
                    <p className="text-xs text-zinc-500">
                      Crea un repositorio en GitHub primero para poder editarlo desde aquí.
                    </p>
                  </div>
                ) : repos.map(repo => (
                  <button
                    key={repo.id}
                    onClick={() => selectRepo(repo)}
                    className="w-full text-left p-3 rounded-lg hover:bg-zinc-900 transition-colors mb-1"
                    data-testid={`repo-${repo.name}`}
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-zinc-400" />
                      <span className="text-sm text-white font-medium truncate">{repo.name}</span>
                      {repo.private && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">Private</span>}
                    </div>
                    {repo.description && (
                      <p className="text-xs text-zinc-500 mt-1 truncate">{repo.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      {repo.language && <span className="text-[10px] text-zinc-400">{repo.language}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="flex-1">
              <div className="p-2">
                <button
                  onClick={() => { setSelectedRepo(null); setFiles([]); setSelectedFile(null); }}
                  className="flex items-center gap-2 px-2 py-1 mb-2 text-xs text-zinc-400 hover:text-white"
                  data-testid="back-to-repos"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Cambiar repo
                </button>
                <div className="flex items-center gap-2 px-2 mb-2">
                  <Github className="w-4 h-4 text-white" />
                  <span className="text-sm text-white font-medium">{selectedRepo.name}</span>
                </div>
                {currentPath && (
                  <button
                    onClick={goUp}
                    className="flex items-center gap-2 px-2 py-1 mb-1 text-xs text-zinc-400 hover:text-white"
                    data-testid="go-up"
                  >
                    <ChevronRight className="w-3 h-3 rotate-180" />
                    ..
                  </button>
                )}
                {loadingFiles ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                  </div>
                ) : (
                  files.map(file => (
                    <button
                      key={file.path}
                      onClick={() => openFile(file)}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-900 transition-colors",
                        selectedFile?.path === file.path && "bg-zinc-900/20"
                      )}
                      data-testid={`file-${file.name}`}
                    >
                      {file.type === 'dir' ? (
                        <Folder className="w-4 h-4 text-zinc-400" />
                      ) : (
                        <FileCode className="w-4 h-4 text-zinc-400" />
                      )}
                      <span className="text-sm text-zinc-300 truncate">{file.name}</span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex-1 flex flex-col">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mb-6"
                >
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-zinc-700/20 to-zinc-800/20 border border-zinc-700/30">
                    <Code2 className="w-12 h-12 text-zinc-400" />
                  </div>
                </motion.div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  GitHub Code Agent
                </h2>
                <p className="text-zinc-400 mb-6 max-w-sm">
                  {selectedRepo 
                    ? "Selecciona un archivo y describe qué cambios quieres hacer. El agente generará el código y creará un commit."
                    : "Selecciona un repositorio de la lista para comenzar a editar archivos."}
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                <AnimatePresence>
                  {messages.map((message, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "p-4 rounded-xl",
                        message.role === "user"
                          ? "bg-zinc-900/10 border border-white/10 ml-12"
                          : "bg-zinc-900 border border-zinc-800 mr-12"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-1.5 rounded-lg flex-shrink-0",
                          message.role === "user" ? "bg-zinc-900/20" : "bg-zinc-800"
                        )}>
                          {message.role === "user" ? (
                            <Sparkles className="w-4 h-4 text-zinc-400" />
                          ) : (
                            <Github className="w-4 h-4 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-300 whitespace-pre-wrap">
                            {message.content.split('\n').map((line, j) => (
                              <div key={j}>
                                {line.startsWith('**') && line.endsWith('**') ? (
                                  <strong className="text-white">{line.slice(2, -2)}</strong>
                                ) : line}
                              </div>
                            ))}
                          </div>
                          {message.filePreview && (
                            <div className="mt-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
                              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                                <FileCode className="w-3 h-3" />
                                {message.filePreview.path}
                              </div>
                              <pre className="text-xs text-zinc-400 overflow-x-auto max-h-48 overflow-y-auto">
                                {message.filePreview.content.slice(0, 2000)}
                                {message.filePreview.content.length > 2000 && '...'}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {pendingEdit && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2 justify-center mt-4"
                  >
                    <Button
                      onClick={applyEdit}
                      disabled={isLoading}
                      className="bg-zinc-800 hover:bg-zinc-800"
                      data-testid="apply-changes"
                    >
                      <GitCommit className="w-4 h-4 mr-2" />
                      Hacer Commit
                    </Button>
                    <Button
                      onClick={cancelEdit}
                      disabled={isLoading}
                      variant="outline"
                      className="border-zinc-700"
                      data-testid="cancel-changes"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                  </motion.div>
                )}

                {isLoading && (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <div className="border-t border-zinc-800 p-4">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedFile ? `Describe qué cambios quieres en ${selectedFile.path}...` : "Selecciona un archivo primero..."}
                  disabled={!selectedFile || isLoading}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-500 resize-none focus:outline-none focus:ring-2 focus:ring-zinc-500/50 disabled:opacity-50"
                  rows={2}
                  data-testid="input-prompt"
                />
                <Button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || !selectedFile || isLoading}
                  className="bg-gradient-to-r from-zinc-700 to-zinc-800 hover:from-zinc-600 hover:to-zinc-700 px-4"
                  data-testid="send-button"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-zinc-600 mt-2 text-center">
                Los cambios se guardarán como commits en tu repositorio de GitHub
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
