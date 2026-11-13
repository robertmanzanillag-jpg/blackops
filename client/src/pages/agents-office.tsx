import { CompanyOffice } from "@/components/company-office/company-office";
import { SoftwareFactoryPanel } from "@/components/software-factory-panel";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ownerOfficeStorageKey } from "@/lib/owner-office-storage";
import { motion, MotionConfig } from "framer-motion";
import {
  ArrowLeft,
  BadgeDollarSign,
  Bot,
  BriefcaseBusiness,
  Clapperboard,
  Code2,
  X,
  Github,
  LineChart,
  Megaphone,
  MessageSquare,
  Monitor,
  MousePointerClick,
  Radio,
  Scale,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { OfficeConnectionsPanel } from "@/components/office-connections-panel";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { MonitoredProject } from "@shared/schema";
import { AgentsBuilding } from "@/components/agents-building/agents-building";
import { AgentsOfficeWorld } from "@/components/agents-world-office/agents-office-world";
import { useWorkspaceRole } from "@/lib/workspace-role";
import { KongSupervisorPanel } from "@/components/kong-supervisor-panel";
import { KongOperationsPanel } from "@/components/kong-operations-panel";
import type { AgentLiveStatus } from "@/lib/agent-live-status";

type GitHubOverview = Record<
  string,
  {
    error?: string;
    language?: string | null;
    html_url?: string;
    homepage?: string | null;
    pushed_at?: string | null;
    open_issues?: number | null;
    open_prs?: number | null;
  }
>;

const agents = [
  {
    id: "assistant",
    name: "Asistente",
    role: "Agenda y memoria",
    href: "/assistant",
    icon: Bot,
    station: "Recepcion",
    status: "Sin verificar",
    activity: "Función prevista: Recibiendo solicitudes y organizando agenda",
    shortAction: "Agenda",
    mode: "break",
    color: "from-sky-400 to-cyan-300",
    outfit: "bg-sky-500",
    hair: "bg-zinc-900",
    skin: "bg-amber-200",
    position: "left-[18%] top-[34%]",
    bubblePosition: "left-[10%] top-[11%]",
  },
  {
    id: "ceo",
    name: "CEO",
    role: "Prioridades y riesgos",
    href: "/ceo",
    icon: BriefcaseBusiness,
    station: "Sala principal",
    status: "Sin verificar",
    activity: "Función prevista: Definiendo prioridades del dia",
    shortAction: "Prioridades",
    mode: "break",
    color: "from-amber-300 to-orange-400",
    outfit: "bg-amber-500",
    hair: "bg-stone-800",
    skin: "bg-orange-200",
    position: "left-[38%] top-[33%]",
    bubblePosition: "left-[38%] top-[7%]",
  },
  {
    id: "revenue",
    name: "Revenue",
    role: "Deals y websites",
    href: "/revenue-engine",
    icon: BadgeDollarSign,
    station: "Deals + Websites",
    status: "Sin verificar",
    activity: "Función prevista: Buscando deals, creando landing pages y preparando websites de oportunidad",
    shortAction: "Deals",
    mode: "break",
    color: "from-emerald-300 to-sky-400",
    outfit: "bg-emerald-500",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[59%] top-[42%]",
    bubblePosition: "left-[51%] top-[12%]",
  },
  {
    id: "dropshipping",
    name: "Dropshipping CEO",
    role: "Shopify + social",
    href: "/dropshipping-ceo",
    icon: Store,
    station: "Dropshipping Lab",
    status: "Sin verificar",
    activity: "Función prevista: Buscando productos virales, margen, suppliers y contenido sin comprar inventario",
    shortAction: "Dropship",
    mode: "break",
    color: "from-emerald-200 to-lime-400",
    outfit: "bg-emerald-400",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[52%] top-[59%]",
    bubblePosition: "left-[44%] top-[30%]",
  },
  {
    id: "marketing-cmo",
    name: "Marketing CMO",
    role: "CMO global",
    href: "/marketing-command-center",
    icon: Megaphone,
    station: "Marketing HQ",
    status: "Sin verificar",
    activity: "Función prevista: Dirigiendo marketing para todos los clientes internos con skills, analytics, safety y aprendizaje separado",
    shortAction: "Marketing",
    mode: "break",
    color: "from-lime-300 to-emerald-400",
    outfit: "bg-lime-500",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[71%] top-[59%]",
    bubblePosition: "right-[22%] top-[38%]",
  },
  {
    id: "code",
    name: "Code",
    role: "Cambios locales",
    href: "/code-agent",
    icon: Code2,
    station: "Mesa tecnica",
    status: "Sin verificar",
    activity: "Función prevista: Trabajando cambios y revisando codigo",
    shortAction: "Codigo",
    mode: "break",
    color: "from-emerald-300 to-teal-400",
    outfit: "bg-emerald-500",
    hair: "bg-zinc-950",
    skin: "bg-amber-100",
    position: "left-[69%] top-[31%]",
    bubblePosition: "right-[12%] top-[12%]",
  },
  {
    id: "github",
    name: "GitHub",
    role: "Repos y PRs",
    href: "/github-agent",
    icon: Github,
    station: "Control de versiones",
    status: "Sin verificar",
    activity: "Función prevista: Mirando PRs, ramas y checks",
    shortAction: "PRs",
    mode: "break",
    color: "from-zinc-200 to-zinc-500",
    outfit: "bg-zinc-300",
    hair: "bg-zinc-900",
    skin: "bg-orange-100",
    position: "left-[81%] top-[31%]",
    bubblePosition: "right-[18%] top-[32%]",
  },
  {
    id: "claude-reviewer",
    name: "Claude Reviewer",
    role: "Segundo chequeo",
    href: "/github-agent",
    icon: Sparkles,
    station: "Dev + GitHub",
    status: "Sin verificar",
    activity: "Función prevista: Revisando cambios de Codex con criterio independiente antes de QA",
    shortAction: "Review",
    mode: "break",
    color: "from-orange-200 to-rose-300",
    outfit: "bg-orange-400",
    hair: "bg-stone-900",
    skin: "bg-amber-100",
    position: "left-[74%] top-[42%]",
    bubblePosition: "right-[8%] top-[22%]",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    role: "Inversiones",
    href: "/portfolio",
    icon: LineChart,
    station: "Pantalla de mercado",
    status: "Sin verificar",
    activity: "Función prevista: Analizando cartera y senales de mercado",
    shortAction: "Mercado",
    mode: "break",
    color: "from-lime-300 to-green-500",
    outfit: "bg-lime-500",
    hair: "bg-stone-700",
    skin: "bg-amber-200",
    position: "left-[18%] top-[60%]",
    bubblePosition: "left-[9%] top-[39%]",
  },
  {
    id: "radio",
    name: "Radio",
    role: "Black Room",
    href: "/radio",
    icon: Radio,
    station: "Cabina creativa",
    status: "Sin verificar",
    activity: "Función prevista: Preparando radio, flyers y calendario creativo",
    shortAction: "Radio",
    mode: "break",
    color: "from-fuchsia-300 to-rose-400",
    outfit: "bg-rose-500",
    hair: "bg-violet-950",
    skin: "bg-orange-200",
    position: "left-[36%] top-[90%]",
    bubblePosition: "right-[9%] top-[49%]",
  },
  {
    id: "clippers",
    name: "Clippers",
    role: "Clips virales",
    href: "/clippers",
    icon: Clapperboard,
    station: "War room social",
    status: "Sin verificar",
    activity: "Función prevista: Organizando cuentas, fuentes permitidas, drafts diarios y reportes de views",
    shortAction: "Clips",
    mode: "break",
    color: "from-amber-300 to-rose-400",
    outfit: "bg-amber-500",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[74%] top-[74%]",
    bubblePosition: "right-[28%] top-[47%]",
  },
  {
    id: "automations",
    name: "Autos",
    role: "Rutinas",
    href: "/automations",
    icon: Zap,
    station: "Rack operativo",
    status: "Sin verificar",
    activity: "Función prevista: Esperando el proximo job programado",
    shortAction: "Rutinas",
    mode: "break",
    color: "from-violet-300 to-indigo-400",
    outfit: "bg-indigo-500",
    hair: "bg-zinc-800",
    skin: "bg-amber-100",
    position: "left-[18%] top-[90%]",
    bubblePosition: "left-[36%] top-[44%]",
  },
  {
    id: "cybersecurity",
    name: "Cybersecurity",
    role: "Proteccion de apps",
    href: "/cybersecurity-agent",
    icon: ShieldAlert,
    station: "Security ops",
    status: "Sin verificar",
    activity: "Función prevista: Revisando apps, HTTPS, incidentes, repos y alertas por Telegram",
    shortAction: "Threats",
    mode: "break",
    color: "from-cyan-200 to-blue-400",
    outfit: "bg-cyan-500",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[84%] top-[71%]",
    bubblePosition: "right-[5%] top-[58%]",
  },
  {
    id: "app-qa",
    name: "App QA",
    role: "Paginas y clicks",
    href: "/app-qa-agent",
    icon: MousePointerClick,
    station: "QA lab",
    status: "Sin verificar",
    activity: "Función prevista: Entrando a paginas, revisando links, clicks esperados, APIs, errores e ideas de mejora",
    shortAction: "QA",
    mode: "break",
    color: "from-emerald-200 to-teal-400",
    outfit: "bg-emerald-500",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[76%] top-[84%]",
    bubblePosition: "right-[16%] top-[68%]",
  },
  {
    id: "legal",
    name: "Legal / Compliance",
    role: "Legal, privacidad y multas",
    href: "/legal-compliance",
    icon: Scale,
    station: "Legal desk",
    status: "Sin verificar",
    activity: "Función prevista: Revisando contratos, privacidad, copyright, terminos, riesgos regulatorios y alertas criticas",
    shortAction: "Legal",
    mode: "break",
    color: "from-violet-200 to-indigo-400",
    outfit: "bg-indigo-400",
    hair: "bg-zinc-950",
    skin: "bg-orange-100",
    position: "left-[87%] top-[91%]",
    bubblePosition: "right-[8%] top-[80%]",
  },
  {
    id: "control",
    name: "Control / Permisos",
    role: "Riesgos y aprobaciones",
    href: "/tools",
    icon: ShieldCheck,
    station: "Puerta segura",
    status: "Sin verificar",
    activity: "Función prevista: Revisando permisos y acciones sensibles",
    shortAction: "Permisos",
    mode: "break",
    color: "from-red-300 to-stone-300",
    outfit: "bg-red-500",
    hair: "bg-stone-900",
    skin: "bg-orange-100",
    position: "left-[87%] top-[74%]",
    bubblePosition: "right-[7%] top-[69%]",
  },
];

type Agent = (typeof agents)[number];
type AgentId = Agent["id"];
type OfficeContact = {
  id: string;
  name: string;
  role: string;
  station: string;
  status: string;
  statusSignal?: AgentLiveStatus;
  activity: string;
  href?: string;
  icon: Agent["icon"];
  color: string;
};
type ChatMessage = {
  role: "user" | "agent";
  text: string;
};
type OfficeFeedItem = {
  agent: AgentId;
  title: string;
  text: string;
  sharesWith: string;
};
type LearningSuggestion = {
  id: string;
  agent: AgentId;
  lesson: string;
  reason: string;
};
type SkillSuggestion = {
  id: string;
  agent: AgentId;
  skill: string;
  helpsWith: string;
  nextStep: string;
};
type LegalBridgeReport = {
  source: string;
  target: string;
  severity: "critico" | "revisar" | "info";
  title: string;
  text: string;
};
type LegalAppReport = {
  id: string;
  appName: string;
  repo: string;
  source?: "developer_health" | "projects" | "github";
  url?: string | null;
  ownerAgent?: string;
  scoutAgent?: string;
  operatingModel?: "central_review" | "app_scout_to_main";
  escalationPath?: string[];
  severity: "critico" | "revisar" | "info";
  summary: string;
  checks: string[];
  riskAreas?: string[];
  evidenceSources?: string[];
  nextAction: string;
  disclaimer?: string;
};
type LegalComplianceRun = {
  generatedAt: string;
  totalTargets: number;
  githubConnected: boolean;
  githubError: string | null;
  sourceErrors: string[];
  summary: {
    critico: number;
    revisar: number;
    info: number;
  };
  reports: LegalAppReport[];
};
type RoomConversation = {
  from: AgentId;
  text: string;
};
type RoomPresence = {
  agent: AgentId;
  position: string;
};
type OfficeRoom = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
type OfficeRoomConnection = {
  from: string;
  to: string;
};
type AgentLocationMap = Partial<Record<AgentId, string>>;
type AgentRoomOffsetMap = Partial<Record<AgentId, { x: number; y: number }>>;

const OFFICE_GITHUB_HANDOFF_KEY = "office.githubAgentHandoff";
const OFFICE_LAYOUT_KEY = "agentsOffice.roomLayout.v1";
const OFFICE_AGENT_LOCATIONS_KEY = "agentsOffice.agentLocations.v1";
const OFFICE_AGENT_OFFSETS_KEY = "agentsOffice.agentOffsets.v1";
const OFFICE_VIEW_KEY = "agentsOffice.view.v2";
type OfficeView = "world" | "building" | "office";
const AGENT_WALK_MS = 1800;
const defaultOfficeRooms: OfficeRoom[] = [
  { id: "reception", label: "Recepcion", x: 10, y: 19, w: 18, h: 29 },
  { id: "kong", label: "Kong", x: 29, y: 19, w: 22, h: 45 },
  { id: "deals", label: "Deals + Websites", x: 54, y: 27, w: 10, h: 29 },
  { id: "dev", label: "Dev + GitHub", x: 65, y: 19, w: 25, h: 43 },
  { id: "finance", label: "Finance", x: 10, y: 52, w: 18, h: 25 },
  { id: "dropshipping-lab", label: "Dropshipping Lab", x: 46, y: 58, w: 18, h: 20 },
  { id: "marketing-hq", label: "Marketing HQ", x: 65, y: 52, w: 15, h: 11 },
  { id: "meeting", label: "Meeting Room", x: 31, y: 65, w: 14, h: 17 },
  { id: "ops", label: "Ops", x: 10, y: 82, w: 18, h: 13 },
  { id: "black-room", label: "Black Room", x: 30, y: 84, w: 13, h: 12 },
  { id: "clippers", label: "Clippers", x: 68, y: 65, w: 12, h: 17 },
  { id: "security", label: "Cybersecurity", x: 82, y: 65, w: 12, h: 17 },
  { id: "legal", label: "Legal", x: 82, y: 84, w: 10, h: 12 },
  { id: "break-room", label: "Break Room", x: 45, y: 84, w: 24, h: 12 },
];
const officeRoomConnections: OfficeRoomConnection[] = [
  { from: "reception", to: "kong" },
  { from: "reception", to: "finance" },
  { from: "kong", to: "deals" },
  { from: "kong", to: "meeting" },
  { from: "deals", to: "dropshipping-lab" },
  { from: "deals", to: "dev" },
  { from: "dropshipping-lab", to: "marketing-hq" },
  { from: "marketing-hq", to: "clippers" },
  { from: "marketing-hq", to: "security" },
  { from: "marketing-hq", to: "legal" },
  { from: "dropshipping-lab", to: "security" },
  { from: "dropshipping-lab", to: "legal" },
  { from: "dev", to: "security" },
  { from: "finance", to: "ops" },
  { from: "meeting", to: "black-room" },
  { from: "meeting", to: "break-room" },
  { from: "meeting", to: "clippers" },
  { from: "clippers", to: "security" },
  { from: "security", to: "legal" },
  { from: "legal", to: "break-room" },
  { from: "ops", to: "black-room" },
  { from: "black-room", to: "break-room" },
];
const defaultAgentLocations: AgentLocationMap = {
  assistant: "reception",
  ceo: "kong",
  revenue: "deals",
  dropshipping: "dropshipping-lab",
  "marketing-cmo": "marketing-hq",
  code: "dev",
  github: "dev",
  "claude-reviewer": "dev",
  portfolio: "finance",
  radio: "black-room",
  clippers: "clippers",
  automations: "ops",
  cybersecurity: "security",
  "app-qa": "dev",
  legal: "legal",
  control: "security",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const agentById = agents.reduce<Record<AgentId, Agent>>((lookup, agent) => {
  lookup[agent.id] = agent;
  return lookup;
}, {} as Record<AgentId, Agent>);

function buildRadioAgentReply(contact: OfficeContact, message: string): string {
  const text = message.toLowerCase();
  const opener =
    contact.station.toLowerCase().includes("black room")
      ? "Black Room activo. "
      : `Estoy en ${contact.station}, Black Room activo. `;
  const asksForNext = "Dime fecha, venue, hora, DJ/artista y que asset tienes listo, y te lo devuelvo como plan de publicacion.";

  if (text.includes("hola") || text.includes("hey") || text.includes("buenas")) {
    return `${opener}Estoy aqui. Puedo ayudarte con evento, flyer, copy, calendario, DJs, video o recordatorios. ${asksForNext}`;
  }

  if (text.includes("publicar") || text.includes("caption") || text.includes("copy") || text.includes("instagram")) {
    return `${opener}Te puedo escribir el caption. Base recomendada: una linea con energia, fecha/venue, lineup o detalle fuerte, CTA para RSVP/DM, y hashtags minimos. Pasame el nombre del evento y te hago 2 versiones: elegante y agresiva.`;
  }

  if (text.includes("flyer") || text.includes("arte") || text.includes("diseño") || text.includes("diseno") || text.includes("post")) {
    return `${opener}Para el flyer haria esto: 1) confirmar lineup y venue, 2) definir formato IG post/story, 3) preparar copy corto, 4) revisar que fecha/hora/precio esten visibles, 5) dejarlo listo para publicar. Si me pasas los detalles, te escribo el copy y checklist.`;
  }

  if (text.includes("dj") || text.includes("lineup") || text.includes("slot") || text.includes("artista")) {
    return `${opener}Para DJs/slots necesito separar confirmados, pendientes y huecos. Mandame los nombres o horarios que tienes y te respondo con una lista tipo: confirmado, falta confirmar, mensaje para mandar y siguiente accion.`;
  }

  if (text.includes("calendario") || text.includes("calendar") || text.includes("fecha") || text.includes("evento")) {
    return `${opener}Lo organizo como calendario: fecha, venue, responsables, assets, posts pendientes y recordatorios. Si el evento ya existe, dime cual; si es nuevo, mandame fecha/hora/venue y lo convierto en tareas claras.`;
  }

  if (text.includes("video") || text.includes("reel") || text.includes("clip") || text.includes("tiktok")) {
    return `${opener}Para video/reel prepararia: hook de 2 segundos, nombre del evento visible, cortes rapidos, CTA final y version 9:16. Si tienes video base o flyer, dime cual y te armo instrucciones de edicion.`;
  }

  if (text.includes("que falta") || text.includes("pendiente") || text.includes("todo") || text.includes("checklist")) {
    return `${opener}Checklist Radio: confirmar fecha/venue, cerrar lineup, revisar flyer, escribir copy, preparar story, programar post, avisar a DJs/promoters y revisar el dia antes. Si me dices el evento, te marco exactamente que falta.`;
  }

  return `${opener}Si lo que quieres es "${message.trim()}", lo convierto en ejecucion de Radio. Mi siguiente paso seria armar: objetivo, asset necesario, copy, responsable y deadline. ${asksForNext}`;
}

function buildAgentReply(contact: OfficeContact, message: string): string {
  const text = message.toLowerCase();
  const opener = `Estoy en ${contact.station}. `;

  if (text.includes("oficina") || text.includes("sala") || text.includes("room") || text.includes("diseno") || text.includes("diseño")) {
    if (contact.name === "CEO") {
      return `${opener}Mi opinion: la oficina debe ayudarte a decidir rapido, no distraerte. Yo la dejaria con pocos rooms claros, nombres grandes, agentes separados y un panel de chat que no tape el mapa.`;
    }
    if (contact.name === "Code") {
      return `${opener}Lo puedo resolver desde UI: reducir elementos superpuestos, ordenar posiciones, hacer labels persistentes y probar que cada click abra el chat correcto.`;
    }
    if (contact.id === "control") {
      return `${opener}Desde control, lo importante es que no confundas roles. Si un agente no tiene trabajo real, mejor convertirlo en herramienta dentro de otro agente.`;
    }
  }

  if (contact.name === "Asistente") {
    return `${opener}Lo tomo contigo como tarea: primero aclaro que quieres lograr, luego lo convierto en pasos y te ayudo a moverlo al calendario o pendientes. Para empezar: dime fecha, prioridad y si depende de alguien.`;
  }
  if (contact.name === "CEO") {
    return `${opener}Lo miro como decision: impacto, urgencia y riesgo. Mi recomendacion inicial es separar esto en: que hay que decidir hoy, que puede esperar y que dato falta para no improvisar.`;
  }
  if (contact.name === "Revenue") {
    return `${opener}Lo convierto en pipeline: area, nicho, leads con evidencia, mockup, outreach en draft, propuesta y QA. Si falta un dato critico, pregunto antes de gastar o contactar.`;
  }
  if (contact.id === "dropshipping") {
    if (text.includes("stock") || text.includes("inventario") || text.includes("comprar")) {
      return `${opener}No compramos inventario para empezar. Trabajo con modelo conectado a supplier: investigo producto, margen, shipping y riesgo; solo pido aprobacion si hay que gastar, publicar, ordenar sample o contactar proveedor.`;
    }
    if (text.includes("producto") || text.includes("viral") || text.includes("tiktok")) {
      return `${opener}Mi siguiente batch es buscar productos virales con evidencia, margen mayor a 45%, shipping razonable y proveedor backup. Si pasa, lo dejo como launch draft, no publicado.`;
    }
    if (text.includes("budget") || text.includes("presupuesto") || text.includes("100")) {
      return `${opener}Profit Guard manda: budget inicial $100, no gasto mas de lo cobrado, y cualquier gasto va a approval. La meta operativa es llegar a $1k/mes sin quemar caja.`;
    }
    return `${opener}Dirijo Shopify + social sin inventario propio: Product Scout, Supplier Analyst, Profit Guard, Social Manager, Legal/Security y Learning Analyst. Puedo investigar y preparar drafts; dinero/publicacion/contacto pasan por aprobacion.`;
  }
  if (contact.id === "marketing-cmo") {
    if (text.includes("post") || text.includes("contenido") || text.includes("copy") || text.includes("reel")) {
      return `${opener}Marketing HQ prepara posts por cliente: hook, copy, visual brief, calendario, CTA y safety check. Nada se publica fuera del app hasta que conectes redes y apruebes autoposting para ese cliente.`;
    }
    if (text.includes("ads") || text.includes("anuncio") || text.includes("budget") || text.includes("presupuesto")) {
      return `${opener}Trabajo con presupuesto minimo por cliente. Primero organico, luego test pequeno solo si hay cash/senales y approval tuyo para gastar en ese proyecto.`;
    }
    if (text.includes("analitica") || text.includes("resultado") || text.includes("ventas") || text.includes("mejorar")) {
      return `${opener}Mi Analytics subagent compara posts, hooks, plataformas, clicks, ordenes y ROAS por cliente. Lo que funcione se repite; lo que no, se pausa y se convierte en aprendizaje separado.`;
    }
    return `${opener}Soy el CMO global: manejo Dropshipping, Revenue, Radio, Clippers, Kong y futuros clientes como una agencia interna. Cada cliente tiene budget, cuentas, metricas, calendario y approvals separados.`;
  }
  if (contact.name === "Code") {
    return `${opener}Lo reviso como problema tecnico.${text.includes("repo objetivo") ? " Voy a trabajar con el repo objetivo que seleccionaste, no con todos a la vez." : ""} Necesito: que pantalla falla, que esperabas, que paso realmente y si hay error visible. Con eso preparo un cambio pequeno y verificable.`;
  }
  if (contact.name === "GitHub") {
    return `${opener}Lo veo desde repos/PRs/checks.${text.includes("repo objetivo") ? " Ya tengo el repo objetivo seleccionado." : " Si hablas de un proyecto, dime cual repo o rama."} Yo revisaria estado remoto, cambios pendientes, issues y si hay CI fallando.`;
  }
  if (contact.id === "claude-reviewer") {
    return `${opener}Yo hago el segundo chequeo independiente: leo el objetivo, comparo el diff, busco riesgos que Codex pudo pasar por alto y dejo una lista corta de bloquear, corregir o aprobar. No publico ni despliego; reviso antes de App QA.`;
  }
  if (contact.name === "Portfolio") {
    return `${opener}Lo traduzco a lectura financiera: posicion, riesgo, noticia relevante y accion posible. Si me das ticker o captura, lo organizo como mantener, revisar o actuar.`;
  }
  if (contact.name === "Radio") {
    return buildRadioAgentReply(contact, message);
  }
  if (contact.name === "Clippers") {
    return `${opener}Lo manejo como sistema de clips: cuentas por categoria, fuentes con permiso, drafts diarios, programacion y reportes. Para escalar bien necesito conectar plataformas oficiales y una allowlist clara de videos/creadores.`;
  }
  if (contact.id === "legal") {
    return `${opener}Lo reviso como Legal / Compliance: privacidad, terminos, copyright, contratos, mensajes externos, datos de usuarios y riesgos de multa. Si encuentro algo critico, lo marco como alerta y recomiendo hablar con abogado real antes de ejecutar.`;
  }
  if (contact.name === "Autos") {
    return `${opener}Puedo convertir esto en una rutina. Dime cada cuanto debe correr, que condicion dispara la accion y como quieres que te avise si falla.`;
  }
  if (contact.id === "control") {
    return `${opener}Lo reviso como permisos y riesgo. Antes de ejecutar, confirmo: que accion se hara, que datos toca, si se puede deshacer y si necesita aprobacion tuya.`;
  }
  if (contact.name === "KONG AI") {
    return `${opener}Lo tomo como chat central de Kong. Puedo coordinar venues, promoters, mesas y contexto del app. Si el problema es operativo, dime si toca eventos, mesas o usuarios.`;
  }
  if (contact.name === "Promoters + Mesas") {
    return `${opener}Lo veo como flujo de promoters/mesas. Yo separaria: quien falta confirmar, que mesa/promoter esta pendiente y que mensaje hay que mandar.`;
  }
  if (contact.name === "Venues") {
    return `${opener}Lo reviso como venues/eventos. Si quieres resolverlo bien, dime venue, fecha aproximada y si hay una fuente donde mirar eventos nuevos.`;
  }

  if (text.includes("error") || text.includes("falla") || text.includes("problema")) {
    return `${opener}Voy a tratarlo como problema: dime que paso, donde paso y que resultado esperabas. Con eso preparo el siguiente paso desde mi area.`;
  }
  return `${opener}Entendido. Desde mi rol (${contact.role}) puedo ayudarte a ordenar esto, proponer el siguiente paso y decirte que dato necesito para resolverlo.`;
}

function buildAgentGreeting(contact: OfficeContact): string {
  if (contact.name === "CEO") return "Estoy aqui. Dime que decision o problema quieres ordenar y lo bajo a prioridades.";
  if (contact.id === "dropshipping") return "Dropshipping CEO activo. Empiezo sin stock: producto viral, proveedor, margen, contenido draft y approvals para dinero/publicacion.";
  if (contact.id === "marketing-cmo") return "Marketing HQ global activo. Manejo clientes internos separados, skills fuertes, learning loop, analytics y safety antes de publicar o gastar.";
  if (contact.name === "Code") return "Listo. Cuentame que quieres cambiar o que esta fallando y lo reviso como trabajo de codigo.";
  if (contact.name === "GitHub") return "Estoy mirando el lado de repos, PRs y branches. Dime que repo o cambio quieres revisar.";
  if (contact.id === "claude-reviewer") return "Estoy listo para doble chequeo. Pasame el PR, diff o repo objetivo y reviso riesgos, tests faltantes y puntos que Codex debe corregir.";
  if (contact.name === "Autos") return "Estoy listo para convertir algo repetitivo en una rutina o recordatorio.";
  if (contact.name === "Radio") return "Estoy en Black Room. Dime si hablamos de evento, flyer, calendario o media.";
  if (contact.name === "Clippers") return "Estoy en el war room social. Puedo preparar cuentas, drafts diarios, fuentes permitidas y reportes de views.";
  if (contact.id === "cybersecurity") return "Estoy monitoreando tus apps, HTTPS, incidentes, repos y señales raras. Puedo escanear y mandarte reporte por Telegram.";
  if (contact.id === "legal") return "Estoy aqui para revisar riesgos legales, privacidad, copyright, contratos y posibles multas antes de que algo se vuelva problema.";
  if (contact.id === "control") return "Estoy aqui para revisar permisos, riesgo y acciones sensibles antes de ejecutar.";
  if (contact.name === "KONG AI") return "Estoy conectado al contexto de Kong. Dime si el tema es eventos, mesas, promoters, venues o usuarios.";
  if (contact.name === "Promoters + Mesas") return "Estoy con promoters y mesas. Dime quien falta por confirmar o que seguimiento quieres hacer.";
  if (contact.name === "Venues") return "Estoy revisando venues/eventos. Dime venue, fecha o fuente y lo organizo.";
  return `Estoy aqui como ${contact.name}. Dime que necesitas resolver en mi area.`;
}

const officeThreads: Record<AgentId, { from: AgentId; to?: AgentId; text: string }[]> = {
  assistant: [
    { from: "assistant", to: "ceo", text: "Tengo la agenda y los pendientes de Robert listos para priorizar." },
    { from: "ceo", to: "assistant", text: "Perfecto. Dame lo urgente primero y deja espacio para trabajo profundo." },
    { from: "automations", to: "assistant", text: "Yo vigilo las rutinas y te aviso si algo necesita aprobacion." },
  ],
  ceo: [
    { from: "ceo", to: "portfolio", text: "Necesito lectura rapida: riesgo, oportunidad y algo que requiera accion." },
    { from: "portfolio", to: "ceo", text: "Estoy monitoreando mercado y cartera. Te paso solo senales utiles." },
    { from: "dropshipping", to: "ceo", text: "Estoy validando productos virales sin inventario y sin gasto hasta que Profit Guard lo permita." },
    { from: "marketing-cmo", to: "ceo", text: "Opero como agencia interna: clientes separados, skills fuertes, calendario, analytics y aprendizaje automatico." },
    { from: "control", to: "ceo", text: "Cualquier accion sensible pasa por permisos antes de ejecutarse." },
  ],
  dropshipping: [
    { from: "dropshipping", to: "revenue", text: "Estoy montando pipeline de productos: tendencia, proveedor, margen, contenido y approval." },
    { from: "marketing-cmo", to: "dropshipping", text: "Dropshipping es mi primer cliente interno: preparo brief, posts, calendario y test organico antes de gastar." },
    { from: "legal", to: "dropshipping", text: "Bloqueo claims, marcas, politicas de envio dudosas y promesas sin evidencia." },
    { from: "control", to: "dropshipping", text: "Dinero, publicacion, contacto y fulfillment pasan por aprobacion." },
  ],
  "marketing-cmo": [
    { from: "marketing-cmo", to: "dropshipping", text: "Recibo cada cliente con su marca, budget, canales, metricas y approvals; no mezclo datos entre proyectos." },
    { from: "legal", to: "marketing-cmo", text: "Reviso claims, copyright, marcas, politicas de plataforma y promesas antes de publicar." },
    { from: "control", to: "marketing-cmo", text: "Autoposting, ads, contacto externo y uso de credenciales quedan bloqueados por cliente hasta aprobacion clara." },
  ],
  code: [
    { from: "code", to: "github", text: "Tengo cambios locales. Necesito contexto de ramas y PRs antes de publicar." },
    { from: "github", to: "code", text: "Yo reviso estado remoto, checks y comentarios para que no subamos a ciegas." },
    { from: "code", to: "claude-reviewer", text: "Cuando Codex termine el parche, quiero un segundo chequeo independiente antes de pedir QA." },
    { from: "ceo", to: "code", text: "Mantengan cambios pequenos y verificados. Nada de ruido innecesario." },
  ],
  github: [
    { from: "github", to: "code", text: "Hay que mirar checks, diff y comentarios antes de cerrar cualquier PR." },
    { from: "code", to: "github", text: "Pasame el contexto y preparo el parche con el menor alcance posible." },
    { from: "claude-reviewer", to: "github", text: "Yo reviso el PR como segundo par de ojos: riesgos, tests faltantes, seguridad y claridad del rollback." },
    { from: "control", to: "github", text: "Push y PR siempre con confirmacion clara." },
  ],
  "claude-reviewer": [
    { from: "claude-reviewer", to: "code", text: "No compito con Codex: reviso su plan y diff con otra mirada para detectar omisiones." },
    { from: "claude-reviewer", to: "github", text: "Si hay PR, dejo el resumen de bloquear, corregir o aprobar antes de App QA." },
    { from: "app-qa", to: "claude-reviewer", text: "Cuando tu revision pasa, yo corro rutas, links, APIs, errores y mejoras como gate final." },
  ],
  portfolio: [
    { from: "portfolio", to: "ceo", text: "Estoy mirando posiciones, noticias y movimientos para avisar cuando importe." },
    { from: "ceo", to: "portfolio", text: "Traducelo a decision: mantener, revisar o actuar." },
    { from: "assistant", to: "portfolio", text: "Si Robert sube una captura, extraigo activos y la conecto contigo." },
  ],
  radio: [
    { from: "radio", to: "assistant", text: "Tengo flyers, DJs y calendario creativo en la mesa." },
    { from: "assistant", to: "radio", text: "Yo te ayudo a convertir fechas y notas en tareas concretas." },
    { from: "ceo", to: "radio", text: "Que se vea bien, pero que tambien salga a tiempo." },
  ],
  clippers: [
    { from: "clippers", to: "ceo", text: "Tengo meta de 1M views por cuenta por semana y necesito fuentes con permiso para escalar." },
    { from: "ceo", to: "clippers", text: "Prioriza momentum, reportes claros y crecimiento sin quemar cuentas." },
    { from: "control", to: "clippers", text: "Antes de autopostear, verifico permisos, credenciales oficiales y riesgo de strikes." },
  ],
  cybersecurity: [
    { from: "cybersecurity", to: "ceo", text: "Estoy revisando apps, HTTPS, incidentes y repos conectados. Te aviso por Telegram si hay riesgo alto." },
    { from: "github", to: "cybersecurity", text: "Te paso contexto de repos y cambios para cruzarlo con amenazas." },
    { from: "cybersecurity", to: "control", text: "Si detecto accion sensible o riesgo alto, lo marco antes de ejecutar." },
  ],
  "app-qa": [
    { from: "app-qa", to: "code", text: "Yo patrullo rutas, links, clicks esperados, health endpoints y errores antes de que algo llegue a produccion." },
    { from: "code", to: "app-qa", text: "Perfecto. Tus hallazgos me dicen donde tocar codigo y que verificar despues." },
    { from: "claude-reviewer", to: "app-qa", text: "Te mando solo PRs que ya tuvieron segundo chequeo para que tu gate encuentre comportamiento, no descuidos obvios." },
    { from: "app-qa", to: "cybersecurity", text: "Si una pagina cae o un health endpoint falla, te paso la senal para separar bug de riesgo." },
  ],
  legal: [
    { from: "legal", to: "ceo", text: "Estoy revisando riesgos legales: privacidad, copyright, terminos, contratos y posibles multas." },
    { from: "ceo", to: "legal", text: "Quiero alertas claras: critico, revisar pronto o bajo riesgo. Nada de ruido innecesario." },
    { from: "legal", to: "control", text: "Si una accion puede exponer datos, incumplir terminos o generar reclamo, la marco antes de ejecutar." },
  ],
  automations: [
    { from: "automations", to: "control", text: "Estoy listo para correr rutinas, pero necesito permisos cuando haya impacto real." },
    { from: "control", to: "automations", text: "Correcto. Automatiza lo repetible y pausa lo riesgoso." },
    { from: "assistant", to: "automations", text: "Yo convierto instrucciones de Robert en tareas claras para ti." },
  ],
  control: [
    { from: "control", to: "ceo", text: "Yo marco limites: aprobaciones, confianza y acciones sensibles." },
    { from: "ceo", to: "control", text: "Bien. Velocidad con criterio, no piloto automatico ciego." },
    { from: "github", to: "control", text: "Te consulto antes de push, PR o cambios con efecto externo." },
  ],
};

const breakRoomThreads: { from: AgentId; text: string }[] = [
  { from: "automations", text: "Estoy en break hasta que llegue el proximo job. Idea: mostrar un timeline de rutinas activas." },
  { from: "radio", text: "Podemos mejorar el studio con previews de flyers y eventos pendientes." },
  { from: "assistant", text: "Yo puedo resumir cada area al inicio del dia: que paso, que falta y quien necesita ayuda." },
];

const meetingRoomThreads: RoomConversation[] = [
  { from: "ceo", text: "Definamos prioridad: primero impacto, luego urgencia, luego quien ejecuta." },
  { from: "code", text: "Si una idea toca producto, la convierto en cambio pequeno y verificable." },
  { from: "github", text: "Yo reviso repos, PRs y checks antes de publicar para no romper produccion." },
  { from: "claude-reviewer", text: "Yo hago doble chequeo independiente: diff, riesgo, pruebas, seguridad y rollback antes de App QA." },
  { from: "revenue", text: "Traigo deals validados: fuente, margen, oferta y website necesario." },
  { from: "dropshipping", text: "Traigo productos virales validados por margen, supplier, shipping y contenido draft." },
  { from: "marketing-cmo", text: "Yo manejo marketing global como agencia interna: cada cliente con su calendario, metricas, skills y learning loop." },
  { from: "cybersecurity", text: "Yo reviso superficie de ataque: apps, dominios, HTTPS, incidents y Telegram alerts." },
  { from: "app-qa", text: "Yo convierto el app en mapa vivo: paginas, botones esperados, APIs, errores e ideas de mejora." },
];

const breakRoomPresence: RoomPresence[] = [
  { agent: "automations", position: "left-[50%] top-[89%]" },
  { agent: "radio", position: "left-[55%] top-[89%]" },
  { agent: "assistant", position: "left-[60%] top-[89%]" },
];

const meetingRoomPresence: RoomPresence[] = [
  { agent: "ceo", position: "left-[37%] top-[71%]" },
  { agent: "code", position: "left-[43%] top-[71%]" },
  { agent: "github", position: "left-[49%] top-[71%]" },
  { agent: "claude-reviewer", position: "left-[53%] top-[71%]" },
  { agent: "revenue", position: "left-[57%] top-[71%]" },
  { agent: "dropshipping", position: "left-[61%] top-[71%]" },
  { agent: "marketing-cmo", position: "left-[65%] top-[71%]" },
  { agent: "cybersecurity", position: "left-[69%] top-[71%]" },
  { agent: "app-qa", position: "left-[73%] top-[71%]" },
];

const officeFeed: OfficeFeedItem[] = [
  {
    agent: "assistant",
    title: "Daily standup",
    text: "Ordeno lo urgente del dia y aviso a CEO cuando algo necesita decision.",
    sharesWith: "CEO, Autos",
  },
  {
    agent: "revenue",
    title: "Aprendizaje de deals",
    text: "Cuando un deal aparece, necesito guardar fuente, margen posible, landing requerida y siguiente contacto.",
    sharesWith: "CEO, Code",
  },
  {
    agent: "dropshipping",
    title: "Dropshipping lab",
    text: "Valido productos virales sin stock: proveedor, margen, shipping, contenido y approvals.",
    sharesWith: "Revenue, Legal, Control",
  },
  {
    agent: "marketing-cmo",
    title: "Marketing HQ",
    text: "Coordino clientes internos separados: contenido, hooks, calendario, analytics, skills y tests organicos antes de pedir gasto o publicacion externa.",
    sharesWith: "CEO, Dropshipping, Revenue, Legal, Control",
  },
  {
    agent: "clippers",
    title: "Mejora de clips",
    text: "Los clips funcionan mejor si cada cuenta tiene nicho, fuente permitida y reporte semanal de views.",
    sharesWith: "Radio, Control",
  },
  {
    agent: "cybersecurity",
    title: "Security scan",
    text: "Reviso apps conectadas, HTTPS, incidentes abiertos, repos faltantes y health URLs criticas.",
    sharesWith: "CEO, GitHub, Control",
  },
  {
    agent: "app-qa",
    title: "Patrulla de producto",
    text: "Subagentes revisan paginas, links, clicks esperados, health endpoints, errores abiertos y mejoras por area.",
    sharesWith: "Code, Cybersecurity, CEO",
  },
  {
    agent: "claude-reviewer",
    title: "Segundo chequeo",
    text: "Reviso los cambios de Codex con otra mirada: objetivo, diff, pruebas, seguridad y rollback antes de App QA.",
    sharesWith: "Code, GitHub, App QA",
  },
  {
    agent: "legal",
    title: "Legal watch",
    text: "Reviso privacidad, copyright, terminos, contratos y mensajes externos para detectar riesgos antes de que escalen.",
    sharesWith: "CEO, Control",
  },
  {
    agent: "code",
    title: "Feedback tecnico",
    text: "Cada cambio debe terminar con build, vista previa y nota corta de lo que se modifico.",
    sharesWith: "GitHub, CEO",
  },
];

const learningSuggestions: LearningSuggestion[] = [
  {
    id: "deals-source-margin",
    agent: "revenue",
    lesson: "Antes de crear website para un deal, validar fuente, margen, publico y oferta.",
    reason: "Evita construir paginas para oportunidades flojas.",
  },
  {
    id: "dropshipping-no-inventory-profit-guard",
    agent: "dropshipping",
    lesson: "Dropshipping debe operar sin inventario, con sample opcional aprobado y Profit Guard antes de gastar.",
    reason: "Protege el budget inicial de $100 mientras el CEO busca productos virales rentables.",
  },
  {
    id: "marketing-cmo-organic-first",
    agent: "marketing-cmo",
    lesson: "Marketing debe separar clientes, budgets, cuentas, metricas y aprendizajes antes de pedir ads o autoposting.",
    reason: "Permite manejar hasta 20 clientes sin mezclar datos ni gastar antes de tener evidencia.",
  },
  {
    id: "clips-allowed-sources",
    agent: "clippers",
    lesson: "Clippers solo debe escalar con fuentes permitidas y reporte de rendimiento.",
    reason: "Protege cuentas y ayuda a repetir lo que si genera views.",
  },
  {
    id: "code-small-verified",
    agent: "code",
    lesson: "Code debe hacer cambios pequenos, con build y resumen claro antes de pasar a GitHub.",
    reason: "Reduce errores y hace que los demas agentes entiendan que cambio.",
  },
  {
    id: "claude-second-review",
    agent: "claude-reviewer",
    lesson: "Claude Reviewer debe revisar cada PR de Codex como segundo par de ojos antes del gate de App QA.",
    reason: "Aumenta la probabilidad de detectar omisiones, tests faltantes o riesgos de rollback antes de produccion.",
  },
  {
    id: "security-threat-briefs",
    agent: "cybersecurity",
    lesson: "Cybersecurity debe separar amenaza real de ruido: app caida, HTTPS faltante, incidente abierto o repo sin trazabilidad.",
    reason: "Permite mandar alertas por Telegram solo cuando hay algo accionable.",
  },
  {
    id: "legal-critical-alerts",
    agent: "legal",
    lesson: "Legal debe marcar como critico cualquier riesgo de multa, datos personales, copyright, contratos o terminos de plataforma.",
    reason: "Te avisa temprano cuando algo necesita revision antes de operar o publicar.",
  },
];

const skillSuggestions: SkillSuggestion[] = [
  {
    id: "assistant-intent-router",
    agent: "assistant",
    skill: "Intent Router",
    helpsWith: "Clasificar cada solicitud y mandarla al agente correcto: Code, GitHub, App QA, Marketing, Legal, Security o CEO.",
    nextStep: "Usarlo antes de crear tareas nuevas para evitar que varios agentes trabajen lo mismo.",
  },
  {
    id: "ceo-goal-planner",
    agent: "ceo",
    skill: "Goal Planner",
    helpsWith: "Convertir objetivos grandes en pasos pequenos, duenos, bloqueos, checks y decision final de Robert.",
    nextStep: "Activarlo cuando una solicitud tenga varias areas: codigo, marketing, legal, QA o deployment.",
  },
  {
    id: "code-visual-qa",
    agent: "code",
    skill: "Visual QA",
    helpsWith: "Revisar screenshots, detectar textos montados y validar que los cambios se vean bien antes de publicar.",
    nextStep: "Usarlo en cada cambio visual de la oficina, landing pages y dashboards.",
  },
  {
    id: "code-test-gap-finder",
    agent: "code",
    skill: "Test Gap Finder",
    helpsWith: "Detectar que prueba falta segun el diff: unit, API, seguridad, UI, build o smoke.",
    nextStep: "Correrlo antes de entregar cambios a GitHub o Claude Reviewer.",
  },
  {
    id: "github-ci-review",
    agent: "github",
    skill: "PR + CI Reviewer",
    helpsWith: "Leer diffs, checks, errores de build y resumir que falta para subir cambios sin romper produccion.",
    nextStep: "Activarlo cuando Code termine un cambio o cuando un repo tenga errores.",
  },
  {
    id: "github-diff-risk-scorer",
    agent: "github",
    skill: "Diff Risk Scorer",
    helpsWith: "Puntuar riesgo por archivos tocados, rutas, auth, pagos, datos, migraciones, deploy y tests faltantes.",
    nextStep: "Usarlo para decidir si basta test pequeno o si hay que correr QA completo y segundo review.",
  },
  {
    id: "claude-independent-review",
    agent: "claude-reviewer",
    skill: "Independent PR Review",
    helpsWith: "Hacer doble chequeo de Codex: objetivo contra diff, regresiones posibles, pruebas faltantes, seguridad y rollback.",
    nextStep: "Usarlo despues de abrir el PR y antes de correr App QA como gate final.",
  },
  {
    id: "revenue-deal-research",
    agent: "revenue",
    skill: "Deal Research",
    helpsWith: "Buscar oportunidades, validar margen, detectar nichos y decidir si vale la pena crear website.",
    nextStep: "Crear checklist para cada deal antes de construir landing o contactar.",
  },
  {
    id: "dropshipping-supplier-margin-scout",
    agent: "dropshipping",
    skill: "Supplier + Margin Scout",
    helpsWith: "Comparar AliExpress/DSers/CJ/Zendrop, calcular margen, shipping, backup supplier y riesgos antes de lanzar.",
    nextStep: "Usarlo antes de publicar producto, ordenar sample o gastar en marketing.",
  },
  {
    id: "marketing-cmo-content-analytics",
    agent: "marketing-cmo",
    skill: "Global Growth OS",
    helpsWith: "Audience research, oferta, hooks, brief creativo, calendario, UTMs, analytics, CRO, safety y learning loop por cliente.",
    nextStep: "Agregar clientes uno por uno y conectar redes oficiales solo cuando Robert apruebe autoposting por cliente.",
  },
  {
    id: "automations-loop-worker-guard",
    agent: "automations",
    skill: "Loop Worker Guard",
    helpsWith: "Revisar jobs recurrentes, ultimo resultado, costo, errores, permisos y si siguen aportando valor.",
    nextStep: "Antes de activar una rutina nueva, dejar objetivo, frecuencia, kill switch y approval claro.",
  },
  {
    id: "clippers-source-analytics",
    agent: "clippers",
    skill: "Source + Analytics Scout",
    helpsWith: "Encontrar fuentes permitidas, medir views por cuenta y aprender que formatos conviene repetir.",
    nextStep: "Conectar reportes semanales y allowlist de fuentes.",
  },
  {
    id: "assistant-memory-curator",
    agent: "assistant",
    skill: "Memory Curator",
    helpsWith: "Convertir feedback tuyo en reglas limpias, sin guardar ruido ni contradicciones.",
    nextStep: "Pedir aprobacion antes de guardar cualquier aprendizaje permanente.",
  },
  {
    id: "app-qa-browser-regression",
    agent: "app-qa",
    skill: "Browser Regression Scout",
    helpsWith: "Recorrer rutas, botones, links, APIs visibles y errores de consola despues de un cambio de producto.",
    nextStep: "Correrlo como gate final en cambios customer-facing antes de decir que esta listo.",
  },
  {
    id: "cybersecurity-attack-surface",
    agent: "cybersecurity",
    skill: "Attack Surface Mapper",
    helpsWith: "Mantener inventario de apps, dominios, health URLs, repos, webhooks y prioridades de riesgo.",
    nextStep: "Conectar cada app importante y correr scan automatico con alertas por Telegram.",
  },
  {
    id: "legal-compliance-monitor",
    agent: "legal",
    skill: "Compliance Monitor",
    helpsWith: "Vigilar privacidad, copyright, terminos de plataformas, contratos, mensajes externos y obligaciones que puedan causar multas.",
    nextStep: "Crear reportes semanales y alertas criticas cuando haya riesgo alto.",
  },
  {
    id: "control-permission-gatekeeper",
    agent: "control",
    skill: "Permission Gatekeeper",
    helpsWith: "Bloquear acciones sensibles: publicar, gastar, deployar, usar credenciales, contactar externos o tocar secretos.",
    nextStep: "Conectar cada accion sensible a pending approval antes de permitir ejecucion.",
  },
];

const legalBridgeReports: LegalBridgeReport[] = [
  {
    source: "Kong Legal",
    target: "Legal Main",
    severity: "revisar",
    title: "Scout de Kong",
    text: "Kong Legal no decide solo: observa venues, promoters, mensajes externos y terminos, y manda hallazgos al Legal Main.",
  },
  {
    source: "Legal Main",
    target: "Kong Legal",
    severity: "critico",
    title: "Alerta de multa o reclamo",
    text: "Legal Main consolida lo que mandan los scouts de apps y decide prioridad, bloqueo o revision humana.",
  },
  {
    source: "Kong Legal",
    target: "Control / Permisos",
    severity: "info",
    title: "Permisos operativos",
    text: "Cuando Kong Legal aprueba una accion, Control valida permisos antes de que el agente la ejecute.",
  },
  {
    source: "Dropshipping CEO",
    target: "Legal Main",
    severity: "revisar",
    title: "Ecommerce sin inventario",
    text: "Dropshipping debe revisar shipping, refunds, claims, marcas, supplier quality y terminos de plataforma antes de publicar o vender.",
  },
  {
    source: "Marketing CMO",
    target: "Legal Main",
    severity: "revisar",
    title: "Marketing global",
    text: "Marketing debe revisar claims, copyright, politicas de plataforma, assets externos, privacidad y approvals por cliente antes de publicar o gastar.",
  },
];

function buildLegalAppReport(project: MonitoredProject, overview?: GitHubOverview[string]): LegalAppReport {
  const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""} ${project.url || ""}`.toLowerCase();
  const checks = ["Privacidad y datos de usuarios", "Terminos visibles", "Riesgo de mensajes externos"];
  let summary = "Revision general de privacidad, terminos, permisos, contenido y riesgos operativos.";
  let nextAction = "Mantener reporte semanal y marcar cualquier cambio que toque usuarios, pagos, mensajes o contenido.";
  let severity: LegalAppReport["severity"] = "info";

  if (text.includes("kong")) {
    checks.push("Promoters, venues, mesas y eventos", "Contratos o acuerdos con terceros");
    summary = "Kong requiere vigilancia legal por venues, promoters, mensajes externos, usuarios y eventos.";
    nextAction = "Kong Legal envia cambios al Legal central; si hay datos personales, cobros, contratos o reclamos, escalar como revisar.";
    severity = "revisar";
  } else if (text.includes("black room") || text.includes("blackroom") || text.includes("br-website")) {
    checks.push("Copyright de flyers/media", "Uso de nombres, artistas, venues y contenido promocional");
    summary = "Black Room necesita revisar derechos de imagen, musica/media, flyers, eventos y textos publicos.";
    nextAction = "Antes de publicar assets o eventos, confirmar fuente permitida y copy sin promesas legales riesgosas.";
    severity = "revisar";
  } else if (text.includes("clip")) {
    checks.push("Derechos de uso de videos", "Reglas de plataforma y riesgo de strikes");
    summary = "Clippers puede tener riesgo alto si usa fuentes no permitidas o automatiza publicaciones sin permiso.";
    nextAction = "Crear allowlist de fuentes permitidas y bloquear autoposting si no hay permiso claro.";
    severity = "critico";
  } else if (text.includes("deal") || text.includes("website") || text.includes("revenue")) {
    checks.push("Claims de landing pages", "Formularios, leads y consentimiento");
    summary = "Deals + Websites debe revisar claims, formularios, consentimiento y politicas antes de publicar.";
    nextAction = "Agregar checklist legal a cada landing: privacidad, terminos, contacto, claims y tracking.";
    severity = "revisar";
  } else if (text.includes("dropship") || text.includes("shopify")) {
    checks.push("Shipping/refunds", "Claims de producto", "Supplier quality", "Terminos de plataforma");
    summary = "Dropshipping requiere copy honesto, politica de devoluciones clara y aprobacion antes de publicar o gastar.";
    nextAction = "Bloquear productos con claims de salud, marcas dudosas, shipping no verificable o proveedor sin backup.";
    severity = "revisar";
  }

  if (project.status === "offline" || project.status === "degraded") {
    checks.push("Estado tecnico con posible impacto a usuarios");
    severity = severity === "critico" ? "critico" : "revisar";
  }
  if (typeof overview?.open_prs === "number" && overview.open_prs > 0) {
    checks.push(`${overview.open_prs} PRs abiertos para revisar antes de publicar cambios legales`);
  }
  if (typeof overview?.open_issues === "number" && overview.open_issues > 0) {
    checks.push(`${overview.open_issues} issues abiertos que pueden contener riesgos o bugs visibles`);
  }
  if (overview?.error) {
    checks.push("GitHub no respondio completo; falta contexto legal del repo");
    severity = severity === "critico" ? "critico" : "revisar";
  }

  return {
    id: project.id,
    appName: project.name,
    repo: project.githubRepo || project.url || "sin repo detectado",
    severity,
    summary,
    checks,
    nextAction,
  };
}

const githubAppTeams = [
  {
    app: "Kong",
    repo: "robertmanzanillag-jpg/kong-nightlife",
    agents: [
      { name: "KONG AI", job: "Chat central", position: "left-[38%] top-[46%]", tone: "bg-[#3fb66f]" },
      { name: "Promoters + Mesas", job: "Outreach + Monday", position: "left-[34%] top-[52%]", tone: "bg-[#f1c36a]" },
      { name: "Venues", job: "Events", position: "left-[43%] top-[52%]", tone: "bg-[#60a5fa]" },
      { name: "Kong Legal", job: "Legal sync", position: "left-[47%] top-[45%]", tone: "bg-[#a78bfa]" },
    ],
  },
];

function OfficeDesk({ className, wide = false }: { className?: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        "absolute rounded-2xl border border-white/10 bg-[#151924] shadow-[0_22px_55px_rgba(0,0,0,0.42)]",
        wide ? "h-16 w-36" : "h-14 w-28",
        className
      )}
    >
      <div className="absolute inset-x-4 top-3 h-2 rounded-full bg-white/10" />
      <div className="absolute left-4 top-5 h-7 w-10 rounded-lg border border-cyan-300/25 bg-cyan-300/20 shadow-[0_0_22px_rgba(34,211,238,0.2)]" />
      <div className="absolute left-6 top-11 h-1.5 w-7 rounded-full bg-white/20" />
      <div className="absolute bottom-4 right-4 h-2 w-12 rounded-full bg-white/15" />
      <div className="absolute -bottom-3 left-5 h-4 w-2 rounded-b bg-slate-700" />
      <div className="absolute -bottom-3 right-5 h-4 w-2 rounded-b bg-slate-700" />
    </div>
  );
}

function Chair({ className }: { className?: string }) {
  return (
    <div className={cn("absolute h-8 w-7 rounded-xl border border-white/10 bg-[#2a3142] shadow-lg shadow-black/30", className)}>
      <div className="absolute left-1/2 top-6 h-7 w-1 -translate-x-1/2 rounded bg-slate-700" />
      <div className="absolute -bottom-2 left-1 h-1.5 w-5 rounded bg-slate-700" />
    </div>
  );
}

function OfficePlant({ className }: { className?: string }) {
  return (
    <div className={cn("absolute h-16 w-14", className)}>
      <div className="absolute bottom-0 left-5 h-6 w-6 border-2 border-[#594433] bg-[#8b6548]" />
      <div className="absolute bottom-5 left-6 h-8 w-2 bg-[#236229]" />
      <div className="absolute bottom-8 left-2 h-6 w-7 bg-[#2fa84f]" />
      <div className="absolute bottom-11 left-6 h-7 w-7 bg-[#71c837]" />
      <div className="absolute bottom-7 left-8 h-6 w-7 bg-[#247b39]" />
    </div>
  );
}

function AreaLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("absolute rounded-xl border border-cyan-300/20 bg-[#090d16]/92 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-cyan-100 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur", className)}>
      {children}
    </div>
  );
}

function Cubicle({
  className,
  label,
  tone = "bg-[#111827]/82",
}: {
  className?: string;
  label: string;
  tone?: string;
}) {
  return (
    <div className={cn("absolute rounded-[28px] border border-white/10 bg-[#0f1421]/74 shadow-[0_28px_80px_rgba(0,0,0,0.42)] backdrop-blur", tone, className)}>
      <AreaLabel className="-top-4 left-4 right-4 z-[60] truncate">{label}</AreaLabel>
      <div className="absolute inset-x-7 bottom-6 h-px bg-white/10" />
      <div className="absolute right-7 top-16 h-16 w-px bg-white/10" />
    </div>
  );
}

function RoomZone({
  label,
  style,
  editMode,
  onMoveStart,
  onResizeStart,
  onLabelChange,
}: {
  label: string;
  style: CSSProperties;
  editMode: boolean;
  onMoveStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onLabelChange: (label: string) => void;
}) {
  return (
    <div
      style={style}
      onPointerDown={editMode ? onMoveStart : undefined}
      className={cn(
        "absolute z-[12] rounded-[28px] border border-cyan-100/22 bg-[#07101d]/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur-[1px]",
        editMode && "z-[65] cursor-move ring-1 ring-cyan-200/45"
      )}
    >
      <div className="absolute inset-x-5 top-12 h-px bg-cyan-100/12" />
      <div className="absolute inset-y-5 left-5 w-px bg-cyan-100/10" />
      <div className="absolute left-1/2 top-[-12px] z-[90] max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-2xl border border-cyan-100/40 bg-[#02050d] px-3 py-1.5 text-center text-[10px] font-black uppercase leading-tight tracking-[0.12em] text-cyan-50 shadow-xl shadow-black/70">
        {editMode ? (
          <input
            value={label}
            onChange={(event) => onLabelChange(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="h-5 w-full min-w-24 bg-transparent text-center uppercase text-cyan-50 outline-none placeholder:text-cyan-100/40"
            aria-label={`Nombre de room ${label}`}
            placeholder="Room"
          />
        ) : (
          label
        )}
      </div>
      {editMode && (
        <button
          type="button"
          onPointerDown={onResizeStart}
          className="absolute bottom-1 right-1 z-[95] flex h-11 w-11 cursor-se-resize items-end justify-end rounded-br-[24px] rounded-tl-2xl border-b-2 border-r-2 border-cyan-100/70 bg-cyan-300/20 p-2 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35),0_12px_28px_rgba(0,0,0,0.55)] transition hover:bg-cyan-300/35"
          aria-label={`Arrastrar esquina para cambiar tamano de ${label}`}
          title="Arrastra esta esquina para agrandar o achicar"
        >
          <Scale className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function OfficeConnections({
  rooms,
  connections,
}: {
  rooms: OfficeRoom[];
  connections: OfficeRoomConnection[];
}) {
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[8] h-full w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <filter id="office-connection-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="office-tunnel-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.1)" />
          <stop offset="50%" stopColor="rgba(165,243,252,0.55)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0.1)" />
        </linearGradient>
      </defs>
      {connections.map((connection) => {
        const from = roomById.get(connection.from);
        const to = roomById.get(connection.to);
        if (!from || !to) return null;
        const x1 = from.x + from.w / 2;
        const y1 = from.y + from.h / 2;
        const x2 = to.x + to.w / 2;
        const y2 = to.y + to.h / 2;
        const cx = (x1 + x2) / 2;
        const tunnelPath = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
        const key = `${connection.from}-${connection.to}`;

        return (
          <g key={key}>
            <path
              d={tunnelPath}
              stroke="rgba(2,6,23,0.78)"
              strokeLinecap="round"
              strokeWidth="4.6"
              fill="none"
            />
            <path
              d={tunnelPath}
              stroke="rgba(125,211,252,0.2)"
              strokeLinecap="round"
              strokeWidth="3.1"
              fill="none"
            />
            <path
              d={tunnelPath}
              stroke="url(#office-tunnel-gradient)"
              strokeLinecap="round"
              strokeWidth="1.25"
              fill="none"
              filter="url(#office-connection-glow)"
            />
            <path
              d={tunnelPath}
              stroke="rgba(207,250,254,0.78)"
              strokeDasharray="1.2 2.2"
              strokeLinecap="round"
              strokeWidth="0.55"
              fill="none"
            />
            <circle cx={x1} cy={y1} r="0.72" fill="rgba(207,250,254,0.92)" />
            <circle cx={x2} cy={y2} r="0.72" fill="rgba(207,250,254,0.92)" />
          </g>
        );
      })}
    </svg>
  );
}

function Workstation({ className, wide = false }: { className?: string; wide?: boolean }) {
  return (
    <div className={cn("absolute", className)}>
      <OfficeDesk wide={wide} />
      <Chair className={wide ? "left-[62px] top-[62px]" : "left-[48px] top-[58px]"} />
    </div>
  );
}

function BreakRoom({ className }: { className?: string }) {
  return (
    <div className={cn("absolute border-4 border-[#334155] bg-[#0f172a]", className)}>
      <div className="absolute left-5 top-8 h-16 w-28 border-2 border-[#020617] bg-[#1f2937] shadow-[4px_4px_0_rgba(0,0,0,0.45)]" />
      <div className="absolute left-8 top-11 h-5 w-5 rounded-full bg-[#e5e7eb]" />
      <div className="absolute left-16 top-13 h-3 w-8 bg-[#84cc16]" />
      <div className="absolute right-6 top-7 h-20 w-10 border-2 border-[#475569] bg-[#111827]" />
      <div className="absolute right-8 top-11 h-3 w-6 bg-[#70e1f5]" />
      <div className="absolute left-8 bottom-5 h-9 w-16 border-2 border-[#353544] bg-[#5c5c6b]" />
      <div className="absolute left-28 bottom-5 h-9 w-16 border-2 border-[#353544] bg-[#5c5c6b]" />
    </div>
  );
}

function AgentPerson({
  agent,
  style,
  editMode,
  selected,
  walking,
  onMoveStart,
  onSelect,
}: {
  agent: Agent;
  style?: CSSProperties;
  editMode: boolean;
  selected: boolean;
  walking: boolean;
  onMoveStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onSelect: (agent: Agent) => void;
}) {
  const Icon = agent.icon;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(agent)}
      onPointerDown={editMode ? onMoveStart : undefined}
      style={style}
      className={cn(
        "absolute z-30 flex h-28 w-[72px] -translate-x-1/2 -translate-y-1/2 flex-col items-center",
        !style && agent.position,
        walking && !editMode && "z-[88] transition-[left,top] duration-[1800ms] ease-[cubic-bezier(0.2,0.9,0.25,1)]",
        editMode && "z-[85] cursor-grab active:cursor-grabbing"
      )}
      animate={{ y: walking ? [0, -7, 0, -4, 0] : selected ? [0, -7, 0] : [0, -3, 0] }}
      transition={{ duration: walking ? 0.62 : selected ? 2 : 3.4, repeat: Infinity, ease: "easeInOut" }}
      aria-label={`Ver agente ${agent.name}`}
      data-testid={`agent-avatar-${agent.id}`}
    >
      <span className={cn("absolute bottom-3 h-5 w-14 rounded-full bg-black/55 blur-md", walking && "w-16 bg-cyan-950/80")} />
      <span className="relative flex h-[84px] w-14 flex-col items-center [transform-style:preserve-3d]">
        <span
          className={cn(
            "absolute top-0 h-11 w-11 rounded-[22px] border border-white/30 bg-gradient-to-br shadow-[inset_6px_8px_14px_rgba(255,255,255,0.22),inset_-8px_-10px_16px_rgba(0,0,0,0.22),0_18px_34px_rgba(0,0,0,0.42)]",
            agent.color,
            selected && "ring-2 ring-cyan-100"
          )}
        >
          <span className="absolute left-1/2 top-[17px] h-3.5 w-7 -translate-x-1/2 rounded-full bg-[#04101d] shadow-[inset_0_0_10px_rgba(34,211,238,0.65),0_1px_4px_rgba(255,255,255,0.16)]">
            <span className="absolute left-2 top-1 h-1.5 w-1.5 rounded-full bg-cyan-100" />
            <span className="absolute right-2 top-1 h-1.5 w-1.5 rounded-full bg-cyan-100" />
          </span>
        </span>
        <span
          className={cn(
            "absolute top-9 h-12 w-12 rounded-[24px] border border-white/25 bg-gradient-to-br shadow-[inset_7px_8px_14px_rgba(255,255,255,0.18),inset_-8px_-12px_18px_rgba(0,0,0,0.2),0_20px_38px_rgba(0,0,0,0.45)]",
            agent.color
          )}
        >
          <span className="absolute -left-2.5 top-3 h-7 w-3 rounded-full border border-white/20 bg-inherit shadow-[inset_-4px_-6px_8px_rgba(0,0,0,0.18)]" />
          <span className="absolute -right-2.5 top-3 h-7 w-3 rounded-full border border-white/20 bg-inherit shadow-[inset_-4px_-6px_8px_rgba(0,0,0,0.18)]" />
          <span className="absolute left-1/2 top-3 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/65">
            <Icon className="h-2.5 w-2.5" />
          </span>
          <span className="absolute left-2 top-2 h-8 w-2 rounded-full bg-white/20 blur-[1px]" />
        </span>
        <span
          className={cn(
            "absolute top-[78px] left-4 h-4 w-2 origin-top rounded-b bg-[#0b1220] shadow-[2px_4px_8px_rgba(0,0,0,0.35)]",
            walking && "animate-[office-step-left_0.42s_ease-in-out_infinite]"
          )}
        />
        <span
          className={cn(
            "absolute top-[78px] right-4 h-4 w-2 origin-top rounded-b bg-[#0b1220] shadow-[2px_4px_8px_rgba(0,0,0,0.35)]",
            walking && "animate-[office-step-right_0.42s_ease-in-out_infinite]"
          )}
        />
      </span>
      <span className={cn("mt-1 max-w-20 truncate rounded-xl border px-2 py-0.5 text-[9px] font-semibold shadow-lg", selected ? "border-cyan-200 bg-cyan-100 text-slate-950" : "border-white/10 bg-[#070b12]/70 text-white/80")}>
        {agent.name}
      </span>
    </motion.button>
  );
}

function AgentSpeechBubble({
  agent,
  text,
  style,
  active,
  onClose,
}: {
  agent: Agent;
  text: string;
  style?: CSSProperties;
  active: boolean;
  onClose: () => void;
}) {
  return (
    <motion.div
      style={style}
      className={cn(
        "pointer-events-auto absolute z-[92] w-[210px] -translate-x-1/2 -translate-y-full rounded-lg border bg-[#050a12]/95 px-3 py-2 pr-9 text-left shadow-2xl shadow-black/60 backdrop-blur",
        active ? "border-cyan-100/70 text-cyan-50" : "border-white/15 text-zinc-200"
      )}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-white/10 text-cyan-50 transition hover:border-cyan-100/70 hover:bg-cyan-100 hover:text-slate-950"
        aria-label={`Cerrar chat de ${agent.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="mb-1 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full bg-gradient-to-br", agent.color)} />
        <p className="truncate text-[10px] font-black uppercase tracking-wide text-cyan-100">{agent.name}</p>
      </div>
      <p className="line-clamp-3 text-xs leading-4">{text}</p>
      <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-inherit bg-[#050a12]" />
    </motion.div>
  );
}

function AppAgentSprite({
  name,
  repo,
  status,
  position,
  connected,
}: {
  name: string;
  repo?: string | null;
  status?: string;
  position: string;
  connected: boolean;
}) {
  return (
    <Link href="/projects">
      <motion.button
        type="button"
        className={cn("absolute z-40 flex h-28 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center", position)}
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        data-testid={`app-agent-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        aria-label={`Abrir app agent ${name}`}
      >
        <span className="absolute bottom-3 h-4 w-14 rounded-full bg-black/45 blur-md" />
        <span className="relative flex h-20 w-14 flex-col items-center">
          <span className={cn("absolute top-0 h-10 w-10 rounded-[17px] border border-white/20 shadow-[inset_0_1px_10px_rgba(255,255,255,0.12),0_14px_28px_rgba(0,0,0,0.34)]", connected ? "bg-gradient-to-br from-lime-300 to-cyan-300" : "bg-gradient-to-br from-slate-400 to-slate-600")}>
            <span className="absolute left-1/2 top-4 h-3 w-6 -translate-x-1/2 rounded-full bg-[#07111f]">
              <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-200" />
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-200" />
            </span>
          </span>
          <span className={cn("absolute top-9 h-11 w-12 rounded-[19px] border border-white/20 shadow-[0_18px_36px_rgba(0,0,0,0.35)]", connected ? "bg-gradient-to-br from-cyan-300 to-emerald-300" : "bg-gradient-to-br from-slate-500 to-slate-700")}>
            <span className="absolute left-1/2 top-2.5 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-xl bg-black/20 text-slate-950">
              <Monitor className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="absolute top-[72px] left-4 h-4 w-1.5 rounded-b bg-[#101827]" />
          <span className="absolute top-[72px] right-4 h-4 w-1.5 rounded-b bg-[#101827]" />
        </span>
        <span className="mt-1 max-w-24 truncate rounded-full border border-white/10 bg-[#090d16]/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow-lg">
          {name}
        </span>
        <span
          className={cn(
            "mt-1 rounded-full border px-1.5 py-0.5 text-[9px] shadow-lg",
            status === "online" && "border-emerald-300/30 bg-emerald-300/15 text-emerald-200",
            status === "github" && "border-emerald-300/30 bg-emerald-300/15 text-emerald-200",
            status === "offline" && "border-red-300/30 bg-red-300/15 text-red-200",
            status === "degraded" && "border-amber-300/30 bg-amber-300/15 text-amber-200",
            (!status || status === "unknown") && "border-slate-300/20 bg-white/10 text-slate-300"
          )}
        >
          {connected ? status || "unknown" : "pendiente"}
        </span>
        {repo && <span className="mt-1 max-w-28 truncate text-[9px] text-slate-500">{repo}</span>}
      </motion.button>
    </Link>
  );
}

function GitHubTeamAgent({
  name,
  job,
  repo,
  position,
  tone,
  onSelect,
}: {
  name: string;
  job: string;
  repo: string;
  position: string;
  tone: string;
  onSelect: () => void;
}) {
  return (
      <motion.button
        type="button"
        onClick={onSelect}
        className={cn("absolute z-40 flex h-28 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center", position)}
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        aria-label={`${name} en ${repo}`}
        data-testid={`github-team-agent-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      >
        <span className="absolute bottom-3 h-4 w-14 rounded-full bg-black/45 blur-md" />
        <span className="relative flex h-20 w-14 flex-col items-center">
          <span className={cn("absolute top-0 h-10 w-10 rounded-[17px] border border-white/20 shadow-[inset_0_1px_10px_rgba(255,255,255,0.14),0_14px_28px_rgba(0,0,0,0.34)]", tone)} />
          <span className="absolute left-1/2 top-4 h-3 w-6 -translate-x-1/2 rounded-full bg-[#07111f]">
            <span className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-200" />
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-200" />
          </span>
          <span className={cn("absolute top-9 h-11 w-12 rounded-[19px] border border-white/20 shadow-[0_18px_36px_rgba(0,0,0,0.35)]", tone)}>
            <span className="absolute left-1/2 top-2.5 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-xl bg-black/20 text-slate-950">
              <Github className="h-3.5 w-3.5" />
            </span>
          </span>
          <span className="absolute top-[72px] left-4 h-4 w-1.5 rounded-b bg-[#101827]" />
          <span className="absolute top-[72px] right-4 h-4 w-1.5 rounded-b bg-[#101827]" />
        </span>
        <span className="mt-1 max-w-28 truncate rounded-full border border-white/10 bg-[#090d16]/90 px-2 py-0.5 text-[9px] font-semibold text-white shadow-lg">
          {name}
        </span>
      </motion.button>
  );
}

function RoomPresenceDot({ item, label }: { item: RoomPresence; label: string }) {
  const agent = agentById[item.agent];
  const Icon = agent.icon;

  return (
    <button
      type="button"
      className={cn("absolute z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", item.position)}
      aria-label={`${agent.name} en ${label}`}
    >
      <span className={cn("flex h-8 w-8 items-center justify-center rounded-full border border-white/25 bg-gradient-to-br text-zinc-950 shadow-lg shadow-black/40", agent.color)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="mt-1 max-w-16 truncate rounded-full border border-white/10 bg-black/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">
        {agent.name}
      </span>
    </button>
  );
}

function LiveAgentsOffice({ ownerId }: { ownerId: string }) {
  const workspace = useWorkspaceRole();
  const layoutKey = ownerOfficeStorageKey(OFFICE_LAYOUT_KEY, ownerId);
  const locationsKey = ownerOfficeStorageKey(OFFICE_AGENT_LOCATIONS_KEY, ownerId);
  const offsetsKey = ownerOfficeStorageKey(OFFICE_AGENT_OFFSETS_KEY, ownerId);
  const handoffKey = ownerOfficeStorageKey(OFFICE_GITHUB_HANDOFF_KEY, ownerId);
  const officeMapRef = useRef<HTMLDivElement | null>(null);
  const walkingTimersRef = useRef<Partial<Record<AgentId, number>>>({});
  // Agent-chat thread per popup contact: later messages continue the same conversation.
  const agentChatThreadsRef = useRef<Record<string, string>>({});
  const [selectedAgent, setSelectedAgent] = useState<Agent>(agents[0]);
  const [selectedContact, setSelectedContact] = useState<OfficeContact | null>(null);
  const [activeChatContact, setActiveChatContact] = useState<OfficeContact | null>(null);
  const [agentChats, setAgentChats] = useState<Record<string, ChatMessage[]>>({});
  const [directMessage, setDirectMessage] = useState("");
  const [editRooms, setEditRooms] = useState(false);
  const [kongWingRequest, setKongWingRequest] = useState(0);
  const openKongOffice = () => { changeOfficeView("world"); setKongWingRequest(value => value + 1); };
  const [officeView, setOfficeView] = useState<OfficeView>(() => {
    if (typeof window === "undefined") return "world";
    try {
      const stored = window.localStorage.getItem(OFFICE_VIEW_KEY);
      return stored === "office" || stored === "building" ? stored : "world";
    } catch {
      return "world";
    }
  });
  const changeOfficeView = (view: OfficeView) => {
    setOfficeView(view);
    if (view !== "office") setEditRooms(false);
    try {
      window.localStorage.setItem(OFFICE_VIEW_KEY, view);
    } catch {
      // Storage can be unavailable (private mode); the view still switches for this visit.
    }
  };
  const [walkingAgents, setWalkingAgents] = useState<Partial<Record<AgentId, boolean>>>({});
  const [closedConversationBubbles, setClosedConversationBubbles] = useState<Record<string, boolean>>({});
  const [officeRooms, setOfficeRooms] = useState<OfficeRoom[]>(() => {
    if (typeof window === "undefined") return defaultOfficeRooms;
    try {
      const stored = window.localStorage.getItem(layoutKey);
      if (!stored) return defaultOfficeRooms;
      const parsed = JSON.parse(stored) as OfficeRoom[];
      const roomById = new Map(parsed.map((room) => [room.id, room]));
      return defaultOfficeRooms.map((room) => ({ ...room, ...(roomById.get(room.id) || {}) }));
    } catch {
      return defaultOfficeRooms;
    }
  });
  const [agentLocations, setAgentLocations] = useState<AgentLocationMap>(() => {
    if (typeof window === "undefined") return defaultAgentLocations;
    try {
      const stored = window.localStorage.getItem(locationsKey);
      if (!stored) return defaultAgentLocations;
      return { ...defaultAgentLocations, ...(JSON.parse(stored) as AgentLocationMap) };
    } catch {
      return defaultAgentLocations;
    }
  });
  const [agentOffsets, setAgentOffsets] = useState<AgentRoomOffsetMap>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem(offsetsKey);
      return stored ? (JSON.parse(stored) as AgentRoomOffsetMap) : {};
    } catch {
      return {};
    }
  });
  const [targetRepo, setTargetRepo] = useState("workspace");
  const [lastRemoteTask, setLastRemoteTask] = useState("");
  const [sentMessages, setSentMessages] = useState<{ to: string; text: string }[]>([]);
  const [approvedLearning, setApprovedLearning] = useState<string[]>([]);
  const [approvedSkills, setApprovedSkills] = useState<string[]>([]);
  const [visibleNotes, setVisibleNotes] = useState({
    chat: true,
    reply: true,
    break: true,
  });
  const { data: projectsResponse = [] } = useQuery<MonitoredProject[] | { error?: string }>({
    queryKey: ["projects"],
    queryFn: () => fetch("/api/projects").then((response) => response.json()),
    refetchInterval: 30000,
  });
  const projects = Array.isArray(projectsResponse) ? projectsResponse : [];
  const { data: githubOverview = {} } = useQuery<GitHubOverview>({
    queryKey: ["projects-github-overview", projects.map((project) => project.githubRepo).filter(Boolean).join(",")],
    queryFn: () => fetch("/api/projects/github-overview").then((response) => response.json()),
    enabled: projects.some((project) => project.githubRepo),
    retry: false,
    refetchInterval: 60000,
  });
  const { data: legalCompliance, isError: legalComplianceError } = useQuery<LegalComplianceRun>({
    queryKey: ["legal-compliance-reports"],
    queryFn: () => fetch("/api/legal-compliance/reports").then((response) => response.json()),
    retry: false,
    refetchInterval: 60000,
  });
  useEffect(() => {
    try { window.localStorage.setItem(layoutKey, JSON.stringify(officeRooms)); } catch { /* Keep layout in memory when storage is unavailable. */ }
  }, [officeRooms]);
  useEffect(() => {
    try { window.localStorage.setItem(locationsKey, JSON.stringify(agentLocations)); } catch { /* Keep layout in memory when storage is unavailable. */ }
  }, [agentLocations]);
  useEffect(() => {
    try { window.localStorage.setItem(offsetsKey, JSON.stringify(agentOffsets)); } catch { /* Keep layout in memory when storage is unavailable. */ }
  }, [agentOffsets]);
  useEffect(() => {
    return () => {
      Object.values(walkingTimersRef.current).forEach((timer) => {
        if (timer) window.clearTimeout(timer);
      });
    };
  }, []);
  const conversation = officeThreads[selectedAgent.id];
  const activeIndex = useMemo(
    () => agents.findIndex((agent) => agent.id === selectedAgent.id) + 1,
    [selectedAgent]
  );
  const SelectedIcon = selectedAgent.icon;
  const connectedProjects = useMemo(() => {
    const projectText = (project: MonitoredProject) =>
      `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    const featured = projects.filter((project) => {
      const text = projectText(project);
      return text.includes("kong") || text.includes("black room") || text.includes("blackroom");
    });
    const rest = projects.filter((project) => !featured.some((item) => item.id === project.id));
    return [...featured, ...rest].slice(0, 6);
  }, [projects]);
  const kongProject = connectedProjects.find((project) => {
    const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    return text.includes("kong");
  });
  const blackRoomProject = connectedProjects.find((project) => {
    const text = `${project.name} ${project.description || ""} ${project.githubRepo || ""}`.toLowerCase();
    return text.includes("black room") || text.includes("blackroom");
  });
  const appAgentPositions = ["left-[21%] top-[86%]", "left-[30%] top-[86%]", "left-[39%] top-[86%]", "left-[48%] top-[86%]"];
  const appAgents = useMemo(() => {
    return connectedProjects
      .filter((project) => project.id !== kongProject?.id && project.id !== blackRoomProject?.id)
      .slice(0, 4)
      .map((project) => ({
        key: project.id,
        name: project.name,
        repo: project.githubRepo,
        status: project.status,
        connected: true,
      }));
  }, [blackRoomProject, connectedProjects, kongProject]);
  const totalVisibleAgents = agents.length + githubAppTeams.reduce((sum, team) => sum + team.agents.length, 0) + appAgents.length;
  const repoTargets = useMemo(() => {
    const remoteRepos = connectedProjects
      .filter((project) => project.githubRepo)
      .map((project) => ({
        id: project.githubRepo!,
        label: project.name,
        repo: project.githubRepo!,
      }));
    const fallbackRepos = [
      { id: "robertmanzanillag-jpg/kong-nightlife", label: "Kong", repo: "robertmanzanillag-jpg/kong-nightlife" },
      { id: "robertmanzanillag-jpg/br-website", label: "Black Room", repo: "robertmanzanillag-jpg/br-website" },
    ].filter((fallback) => !remoteRepos.some((repo) => repo.id === fallback.id));

    return [{ id: "workspace", label: "Este app", repo: "local workspace" }, ...remoteRepos, ...fallbackRepos];
  }, [connectedProjects]);
  const fallbackLegalAppReports = useMemo(
    () =>
      connectedProjects.map((project) =>
        buildLegalAppReport(project, project.githubRepo ? githubOverview[project.githubRepo] : undefined)
      ),
    [connectedProjects, githubOverview]
  );
  const legalReportsFromApi = Array.isArray(legalCompliance?.reports) ? legalCompliance.reports : [];
  const legalSummary = legalCompliance?.summary || { critico: 0, revisar: 0, info: 0 };
  const legalSourceErrors = Array.isArray(legalCompliance?.sourceErrors) ? legalCompliance.sourceErrors : [];
  const legalAppReports = legalReportsFromApi.length ? legalReportsFromApi : fallbackLegalAppReports;
  const walkingRoomShortcuts = useMemo(
    () =>
      ["meeting", "break-room"]
        .map((roomId) => officeRooms.find((room) => room.id === roomId))
        .filter((room): room is OfficeRoom => Boolean(room)),
    [officeRooms]
  );
  const selectedTarget = repoTargets.find((item) => item.id === targetRepo) || repoTargets[0];
  const getAgentStation = (agent: Agent) => {
    const roomId = agentLocations[agent.id] || defaultAgentLocations[agent.id];
    return officeRooms.find((room) => room.id === roomId)?.label || agent.station;
  };
  const baseContact = selectedContact || {
    id: selectedAgent.id,
    name: selectedAgent.name,
    role: selectedAgent.role,
    station: getAgentStation(selectedAgent),
    status: selectedAgent.status,
    activity: selectedAgent.activity,
    href: selectedAgent.href,
    icon: selectedAgent.icon,
    color: selectedAgent.color,
  };
  const contact =
    selectedContact && selectedContact.id in agentById
      ? { ...baseContact, station: getAgentStation(agentById[selectedContact.id as AgentId]) }
      : baseContact;
  const ContactIcon = contact.icon;
  const activeMessages = agentChats[contact.id] || [];
  const isChatOpen = activeChatContact?.id === contact.id;
  const roomOccupants = useMemo(() => {
    return agents.reduce<Record<string, AgentId[]>>((rooms, agent) => {
      const roomId = agentLocations[agent.id] || defaultAgentLocations[agent.id];
      if (!roomId) return rooms;
      rooms[roomId] = [...(rooms[roomId] || []), agent.id];
      return rooms;
    }, {});
  }, [agentLocations]);
  const getAgentRoomStyle = (agent: Agent): CSSProperties | undefined => {
    const roomId = agentLocations[agent.id] || defaultAgentLocations[agent.id];
    if (!roomId) return undefined;
    const room = officeRooms.find((item) => item.id === roomId);
    if (!room) return undefined;
    const manualOffset = agentOffsets[agent.id];
    if (manualOffset) {
      return {
        left: `${room.x + (room.w * manualOffset.x) / 100}%`,
        top: `${room.y + (room.h * manualOffset.y) / 100}%`,
      };
    }
    const occupants = roomOccupants[roomId] || [];
    const slot = Math.max(0, occupants.indexOf(agent.id));
    const columns = Math.max(1, Math.min(3, Math.floor(room.w / 8)));
    const row = Math.floor(slot / columns);
    const column = slot % columns;
    const x = room.x + (room.w * (column + 1)) / (columns + 1);
    const y = room.y + room.h * clamp(0.34 + row * 0.22, 0.34, 0.74);

    return { left: `${x}%`, top: `${y}%` };
  };
  const visibleConversationBubbles = (conversation || [])
    .slice(0, 3)
    .map((message, index) => {
      const speaker = agentById[message.from];
      const baseStyle = getAgentRoomStyle(speaker);
      const top = typeof baseStyle?.top === "string" ? baseStyle.top : undefined;
      const key = `${selectedAgent.id}-${message.from}-${index}`;

      return {
        key,
        agent: speaker,
        text: message.text,
        active: message.from === selectedAgent.id,
        style:
          baseStyle && top
            ? {
                ...baseStyle,
                top: `calc(${top} - ${94 + index * 22}px)`,
              }
            : baseStyle,
      };
    })
    .filter((bubble) => !closedConversationBubbles[bubble.key]);
  const closeAgentCard = () => {
    setSelectedContact(null);
    setActiveChatContact(null);
    setDirectMessage("");
  };
  const markAgentWalking = (agentId: AgentId) => {
    const currentTimer = walkingTimersRef.current[agentId];
    if (currentTimer) window.clearTimeout(currentTimer);

    setWalkingAgents((current) => ({ ...current, [agentId]: true }));
    walkingTimersRef.current[agentId] = window.setTimeout(() => {
      setWalkingAgents((current) => ({ ...current, [agentId]: false }));
      delete walkingTimersRef.current[agentId];
    }, AGENT_WALK_MS + 260);
  };
  const stopAgentWalking = (agentId: AgentId) => {
    const currentTimer = walkingTimersRef.current[agentId];
    if (currentTimer) window.clearTimeout(currentTimer);
    delete walkingTimersRef.current[agentId];
    setWalkingAgents((current) => ({ ...current, [agentId]: false }));
  };
  const moveAgentToRoom = (agentId: AgentId, roomId: string) => {
    markAgentWalking(agentId);
    window.requestAnimationFrame(() => {
      setAgentLocations((current) => ({ ...current, [agentId]: roomId }));
      setAgentOffsets((current) => ({ ...current, [agentId]: { x: 50, y: 50 } }));
    });
  };
  const renameRoom = (roomId: string, label: string) => {
    setOfficeRooms((current) =>
      current.map((room) => (room.id === roomId ? { ...room, label } : room))
    );
  };
  const openContactChat = (nextContact: OfficeContact) => {
    setSelectedContact(nextContact);
    setActiveChatContact(nextContact);
    setAgentChats((current) => {
      if (current[nextContact.id]?.length) return current;
      return {
        ...current,
        [nextContact.id]: [{ role: "agent", text: `Vista del rol; ejecución sin verificar. ${buildAgentGreeting(nextContact)}` }],
      };
    });
    setDirectMessage("");
  };
  const handleSendDirectMessage = () => {
    const text = directMessage.trim();
    if (!text) return;
    const pr = /^(?:consultar pr\s+)?(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*)$/i.exec(text);
    const radio = /^analizar horarios(?: de radio)?[.!]?$/i.test(text);
    const action = pr ? { action: "github_pull_request", prUrl: pr[1] } : radio ? { action: "radio_analysis" } : null;
    if (workspace.isPartner && (action || !workspace.canInteractWith(contact.id))) {
      // Partners ("socios") only chat with the Black Room team; owner data queries stay with Robert.
      const contactId = contact.id;
      setAgentChats(current => ({ ...current, [contactId]: [...(current[contactId] || []), { role: "user", text }, { role: "agent", text: "Solo Robert. Como socio puedes hablar y dar órdenes al equipo de Black Room." }] }));
      setDirectMessage("");
      return;
    }
    if (action) {
      const specialist = pr ? { id: "github", name: "GitHub" } : { id: "radio", name: "Radio" };
      const contactId = contact.id;
      const append = (messages: ChatMessage[]) => setAgentChats(current => ({ ...current, [contactId]: [...(current[contactId] || []), ...messages] }));
      const dispatch = contactId === specialist.id ? `${specialist.name} está consultando sus datos.` : `Derivé la consulta a ${specialist.name}. Esperando su resultado.`;
      append([{ role: "user", text }, { role: "agent", text: dispatch }]);
      setDirectMessage("");
      void apiRequest("POST", "/api/agents-office/contact-action", action)
        .then(response => response.json() as Promise<{ agentId: string; summary: string; checkedAt: string }>)
        .then(result => {
          if (result.agentId !== specialist.id || typeof result.summary !== "string" || !Number.isFinite(Date.parse(result.checkedAt))) throw new Error("Invalid receipt");
          append([{ role: "agent", text: `${result.summary} Comprobado ${new Date(result.checkedAt).toLocaleString()}.` }]);
        })
        .catch(() => append([{ role: "agent", text: `${specialist.name} no pudo completar la consulta. Puedes reintentar o abrir su herramienta.` }]));
      return;
    }
    const isDevReviewContact = contact.name === "Code" || contact.name === "GitHub" || contact.id === "claude-reviewer";
    const repoContext =
      isDevReviewContact && selectedTarget
        ? `\n\nRepo objetivo: ${selectedTarget.label} (${selectedTarget.repo}).`
        : "";
    const asksStatus = /^(?:¿\s*)?(?:estado|como estas|que estas haciendo|estas trabajando)(?:[?!.\s]*)$/i.test(text.normalize("NFD").replace(/\p{Diacritic}/gu, ""));
    const signal = contact.statusSignal;
    const reply = asksStatus
      ? signal ? `Última señal disponible: ${signal.label}. ${signal.detail ?? ""}`.trim() : `Mi función asignada es ${contact.role}. Esta conversación aún no tiene una señal de ejecución verificada.`
      : `Este chat no tiene una acción conectada para esa solicitud. Puedes pedir «analizar horarios de radio» o «consultar PR» seguido del enlace. Orientación local: ${buildAgentReply(contact, `${text}${repoContext}`)}`;
    if (!asksStatus && isDevReviewContact && targetRepo !== "workspace") {
      setLastRemoteTask(text);
      try { window.localStorage.setItem(
        handoffKey,
        JSON.stringify({
          repo: selectedTarget.repo,
          app: selectedTarget.label,
          agent: contact.name,
          task: text,
          createdAt: new Date().toISOString(),
        })
      ); } catch { /* Draft remains in memory; nothing is dispatched. */ }
    }
    if (!workspace.isPartner) {
      // Owner: the reply comes from the agent's recorded data (/api/agent-chat), never from local canned text.
      const contactId = contact.id;
      const append = (messages: ChatMessage[]) => setAgentChats(current => ({ ...current, [contactId]: [...(current[contactId] || []), ...messages] }));
      setActiveChatContact(contact);
      setSelectedContact(contact);
      append([{ role: "user", text }]);
      setDirectMessage("");
      const requestId = `ao${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      const threadId = agentChatThreadsRef.current[contactId];
      void apiRequest("POST", `/api/agent-chat/${encodeURIComponent(contactId)}/messages`, { text, requestId, ...(threadId ? { threadId } : {}) })
        .then(response => response.json() as Promise<{ thread?: { id: string }; messages: Array<{ role: string; text: string }>; handoff: { name: string } | null }>)
        .then(result => {
          if (result.thread?.id) agentChatThreadsRef.current[contactId] = result.thread.id;
          const answer = [...result.messages].reverse().find(message => message.role !== "user");
          append([{ role: "agent", text: `${answer?.text || "Sin respuesta registrada."}${result.handoff ? `\n\nPulsa «Chat completo» y luego «Hablar con ${result.handoff.name}».` : ""}` }]);
        })
        .catch(() => append([{ role: "agent", text: "No pude consultar los datos de este agente. Abre «Chat completo» para intentarlo de nuevo." }]));
      return;
    }
    setActiveChatContact(contact);
    setSelectedContact(contact);
    setAgentChats((current) => ({
      ...current,
      [contact.id]: [
        ...(current[contact.id] || []),
        { role: "user", text: repoContext ? `${text}\n${repoContext.trim()}` : text },
        { role: "agent", text: reply },
      ],
    }));
    setSentMessages((current) => [{ to: contact.name, text }, ...current].slice(0, 3));
    setDirectMessage("");
  };
  const handleSelectAgent = (agent: Agent, liveStatus?: AgentLiveStatus) => {
    setSelectedAgent(agent);
    setClosedConversationBubbles({});
    openContactChat({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      station: getAgentStation(agent),
      status: liveStatus ? liveStatus.label : agent.status,
      statusSignal: liveStatus,
      activity: liveStatus?.detail ? `${agent.activity}. Ahora: ${liveStatus.detail}` : agent.activity,
      href: agent.href,
      icon: agent.icon,
      color: agent.color,
    });
  };
  const openHref =
    (contact.name === "Code" || contact.name === "GitHub" || contact.id === "claude-reviewer") && targetRepo !== "workspace"
      ? `/github-agent?repo=${encodeURIComponent(targetRepo)}${lastRemoteTask ? `&task=${encodeURIComponent(lastRemoteTask)}` : ""}`
      : contact.href;
  const handleSelectTeamAgent = (team: (typeof githubAppTeams)[number], agent: (typeof githubAppTeams)[number]["agents"][number]) => {
    const activityByName: Record<string, string> = {
      "KONG AI": "Chat central de Kong: recibe preguntas, usa herramientas internas y coordina informacion de eventos, mesas, promoters y venues.",
      "Promoters + Mesas": "Gestiona el flujo comercial de Kong: outreach a promoters, seguimiento de mesas y recordatorios de lunes.",
      Venues: "Busca, revisa e importa eventos de venues para mantener Kong actualizado.",
      "Kong Legal": "Agente legal integrado en Kong: revisa venues, promoters, terminos, privacidad, mensajes externos y manda reportes al Legal / Compliance central.",
    };
    openContactChat({
      id: `${team.app}-${agent.name}`,
      name: agent.name,
      role: agent.job,
      station: team.app,
      status: "Guia local (sin backend propio)",
      activity: activityByName[agent.name] || `Trabaja en ${team.app} conectado al repo ${team.repo}.`,
      href: "/projects",
      icon: Github,
      color: "from-cyan-300 to-lime-300",
    });
  };
  const handleApproveLearning = (lessonId: string) => {
    setApprovedLearning((current) => (current.includes(lessonId) ? current : [...current, lessonId]));
  };
  const handleApproveSkill = (skillId: string) => {
    setApprovedSkills((current) => (current.includes(skillId) ? current : [...current, skillId]));
  };
  const startRoomEdit = (
    event: PointerEvent<HTMLElement>,
    roomId: string,
    mode: "move" | "resize"
  ) => {
    if (!editRooms || !officeMapRef.current) return;
    event.preventDefault();
    event.stopPropagation();

    const bounds = officeMapRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRoom = officeRooms.find((room) => room.id === roomId);
    if (!startRoom) return;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / bounds.width) * 100;
      const dy = ((moveEvent.clientY - startY) / bounds.height) * 100;

      setOfficeRooms((current) =>
        current.map((room) => {
          if (room.id !== roomId) return room;
          if (mode === "move") {
            return {
              ...room,
              x: clamp(startRoom.x + dx, 2, 96 - startRoom.w),
              y: clamp(startRoom.y + dy, 10, 96 - startRoom.h),
            };
          }

          return {
            ...room,
            w: clamp(startRoom.w + dx, 8, 92 - startRoom.x),
            h: clamp(startRoom.h + dy, 8, 92 - startRoom.y),
          };
        })
      );
    };
    const stopRoomEdit = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopRoomEdit);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopRoomEdit);
  };
  const startAgentEdit = (event: PointerEvent<HTMLButtonElement>, agentId: AgentId) => {
    if (!editRooms || !officeMapRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    stopAgentWalking(agentId);

    const bounds = officeMapRef.current.getBoundingClientRect();
    const currentRoomId = agentLocations[agentId] || defaultAgentLocations[agentId];

    const updateAgentPosition = (clientX: number, clientY: number) => {
      const x = clamp(((clientX - bounds.left) / bounds.width) * 100, 2, 96);
      const y = clamp(((clientY - bounds.top) / bounds.height) * 100, 10, 96);
      const targetRoom =
        officeRooms.find((room) => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) ||
        officeRooms.find((room) => room.id === currentRoomId);

      if (!targetRoom) return;
      const offsetX = clamp(((x - targetRoom.x) / targetRoom.w) * 100, 16, 84);
      const offsetY = clamp(((y - targetRoom.y) / targetRoom.h) * 100, 24, 82);

      setAgentLocations((current) => ({ ...current, [agentId]: targetRoom.id }));
      setAgentOffsets((current) => ({ ...current, [agentId]: { x: offsetX, y: offsetY } }));
    };

    updateAgentPosition(event.clientX, event.clientY);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      updateAgentPosition(moveEvent.clientX, moveEvent.clientY);
    };
    const stopAgentEdit = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopAgentEdit);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopAgentEdit);
  };
  const resetOfficeRooms = () => {
    Object.values(walkingTimersRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer);
    });
    walkingTimersRef.current = {};
    setWalkingAgents({});
    setOfficeRooms(defaultOfficeRooms);
    setAgentLocations(defaultAgentLocations);
    setAgentOffsets({});
  };

  return (
    <div className="h-screen overflow-hidden bg-[#05060a] text-foreground">
      <section className="relative h-full overflow-hidden bg-black bg-[linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:64px_64px,64px_64px]">
        <OfficeConnectionsPanel />
        <SoftwareFactoryPanel />
        <div className="absolute left-5 top-5 z-[95]">
          <Link href="/">
            <Button variant="ghost" size="icon" className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03]" data-testid="button-back-home">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        </div>

        <aside className="hidden">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10">
                <Bot className="h-5 w-5 text-cyan-200" />
              </span>
              <div>
                <p className="text-lg font-semibold tracking-[0.18em] text-white">ROBS</p>
                <p className="text-[10px] text-slate-500">Agentic Office</p>
              </div>
            </div>
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-3">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Explorer</p>
              <div className="space-y-2 text-xs">
                <p className="font-semibold text-slate-200">ROBS-WORKSPACE</p>
                <div className="pl-3 text-slate-400">
                  <p className="mb-1 text-slate-300">▾ agents</p>
                  {agents.slice(0, 6).map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => handleSelectAgent(agent)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left hover:bg-white/5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full bg-gradient-to-br", agent.color)} />
                        <span className="truncate">{agent.name.toLowerCase()}-agent</span>
                      </span>
                      <span className="text-cyan-300">?</span>
                    </button>
                  ))}
                  <p className="mt-3 text-slate-300">▾ workflows</p>
                  <p className="px-2 py-1">calendar.flow <span className="float-right text-emerald-300">✓</span></p>
                  <p className="px-2 py-1">github.flow <span className="float-right text-amber-300">•</span></p>
                  <p className="px-2 py-1">radio.flow <span className="float-right text-emerald-300">✓</span></p>
                </div>
              </div>
            </div>
        </aside>

        <div className="pointer-events-none absolute left-4 right-4 top-12 z-[75] flex items-start justify-start gap-4 sm:left-20 sm:top-5 lg:right-40 lg:items-center lg:justify-between [&_button]:pointer-events-auto [&_a]:pointer-events-auto [&_input]:pointer-events-auto">
            {/* Decorative search box: hidden below 1024px so the view toggle and the KONG buttons fit on screen. */}
            <div className="hidden h-12 min-w-[260px] flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-[#0c1018]/90 px-4 text-sm text-slate-400 shadow-xl shadow-black/30 backdrop-blur xl:flex xl:max-w-[620px]">
              <Sparkles className="h-4 w-4 text-cyan-200" />
              <span>Type a command or search...</span>
              <span className="ml-auto rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px]">⌘ K</span>
            </div>
            {/* On phones the row wraps to the left and leaves the top-right corner free for "Trabajo real". */}
            <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 lg:shrink-0 lg:justify-end">
              <div className="flex rounded-2xl border border-white/10 bg-[#0c1018]/90 p-1 shadow-xl shadow-black/30" role="group" aria-label="Vista de la oficina">
                {(["world", "building", "office"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => changeOfficeView(view)}
                    aria-pressed={officeView === view}
                    data-testid={`button-office-view-${view}`}
                    className={cn(
                      "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                      officeView === view ? "bg-cyan-100 text-slate-950" : "text-slate-300 hover:bg-white/10"
                    )}
                  >
                    {view === "world" ? "Oficina 3D" : view === "building" ? "Edificio" : "Clasica"}
                  </button>
                ))}
              </div>
              {/* One button for every view (3D, Edificio, Clasica and the no-WebGL fallback). */}
              <div data-testid="office-kong-supervisor-slot">
                <KongSupervisorPanel />
              </div>
              <button type="button" data-testid="office-open-kong" onClick={openKongOffice} className="rounded-xl border border-lime-300/35 bg-lime-400/10 px-3 py-2 text-xs font-semibold text-lime-100">
                Oficina KONG
              </button>
              <div data-testid="office-kong-operations-slot">
                <KongOperationsPanel />
              </div>
              {officeView === "office" && (
              <Button
                type="button"
                variant={editRooms ? "secondary" : "outline"}
                className="rounded-2xl border-white/10 bg-[#0c1018]/90 px-4 text-xs font-semibold text-white shadow-xl shadow-black/30"
                onClick={() => setEditRooms((current) => !current)}
              >
                {editRooms ? "Terminar edicion" : "Editar oficina"}
              </Button>
              )}
              {officeView === "office" && editRooms && (
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-xs text-slate-300"
                  onClick={resetOfficeRooms}
                >
                  Reset
                </Button>
              )}
            </div>
            <div className="hidden w-[260px] rounded-3xl border border-white/10 bg-[#0c1018]/92 p-4 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-white">System Overview</p>
                <span className="text-slate-500">•••</span>
              </div>
              <div className="relative h-28 rounded-2xl border border-white/10 bg-black/25">
                <div className="absolute inset-4 border border-dashed border-white/10" />
                {agents.slice(0, 6).map((agent, index) => (
                  <span
                    key={`overview-${agent.id}`}
                    className={cn("absolute h-3 w-3 rounded-full bg-gradient-to-br shadow-[0_0_18px_rgba(34,211,238,0.4)]", agent.color)}
                    style={{
                      left: `${18 + (index % 3) * 28}%`,
                      top: `${22 + Math.floor(index / 3) * 38}%`,
                    }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-emerald-300">{agents.length} agents active</p>
            </div>
        </div>

        <div className="hidden absolute bottom-5 left-20 right-5 z-[80] h-[116px] rounded-3xl border border-white/10 bg-[#0c1018]/94 p-4 shadow-2xl shadow-black/50 backdrop-blur lg:right-[360px]">
            <div className="mb-3 flex gap-6 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span className="text-white">Terminal</span>
              <span>Output</span>
              <span>Event log</span>
              <span>Problems <b className="rounded-full bg-cyan-300/15 px-1.5 text-cyan-200">2</b></span>
            </div>
            <div className="grid gap-4 text-xs text-slate-400 lg:grid-cols-[1fr_300px]">
              <div className="space-y-1 font-mono">
                <p><span className="text-slate-600">10:46:21</span> <span className="text-cyan-300">assistant-agent</span> [INFO] agenda synced</p>
                <p><span className="text-slate-600">10:46:23</span> <span className="text-emerald-300">github-agent</span> [SUCCESS] repo context loaded</p>
                <p><span className="text-slate-600">10:46:25</span> <span className="text-amber-300">radio-agent</span> [INFO] waiting for next task</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <p className="text-white">{selectedAgent.name}</p>
                <p className="mt-1 text-slate-500">{selectedAgent.activity}</p>
              </div>
            </div>
        </div>

        <div ref={officeMapRef} className="relative h-full min-h-[620px] w-full [perspective:1400px]">
          {officeView === "world" && (
            <AgentsOfficeWorld
              onOpenKongOffice={openKongOffice}
              kongWingRequest={kongWingRequest}
              agents={agents}
              kongTeam={githubAppTeams.find((team) => team.app === "Kong")?.agents ?? []}
              legal={{ data: legalCompliance, isError: legalComplianceError }}
              selectedAgentId={selectedContact?.id}
              onSelectAgent={(agentId, status) => {
                const agent = agentById[agentId as AgentId];
                if (agent) handleSelectAgent(agent, status);
              }}
              onSelectKongAgent={(name) => {
                const team = githubAppTeams.find((item) => item.app === "Kong");
                const member = team?.agents.find((item) => item.name === name);
                if (team && member) handleSelectTeamAgent(team, member);
              }}
              onOpenContact={(contact) =>
                openContactChat({
                  id: contact.id,
                  name: contact.name,
                  role: contact.role,
                  station: contact.department,
                  status: contact.status.label,
                  activity: [contact.description, contact.status.detail, ...(contact.status.problems || []).map((problem) => `Problema: ${problem}`)].filter(Boolean).join(". "),
                  href: contact.href,
                  icon: Bot,
                  color: contact.color,
                })
              }
            />
          )}
          {officeView === "building" && (
            <div className="absolute inset-0 overflow-y-auto px-4 pb-10 pt-24">
              <AgentsBuilding
                agents={agents}
                kongTeam={githubAppTeams.find((team) => team.app === "Kong")?.agents ?? []}
                legal={{ data: legalCompliance, isError: legalComplianceError }}
                selectedAgentId={selectedContact?.id}
                onSelectAgent={(agentId, status) => {
                  const agent = agentById[agentId as AgentId];
                  if (agent) handleSelectAgent(agent, status);
                }}
                onSelectKongAgent={(name) => {
                  const team = githubAppTeams.find((item) => item.app === "Kong");
                  const member = team?.agents.find((item) => item.name === name);
                  if (team && member) handleSelectTeamAgent(team, member);
                }}
              />
            </div>
          )}
          {officeView === "office" && (
          <>
          <div className="absolute left-[9%] top-[7%] h-[68%] w-[78%] [transform:rotateX(58deg)_rotateZ(-34deg)] [transform-style:preserve-3d]">
            <div className="absolute inset-0 rounded-[34px] border border-cyan-100/10 bg-[linear-gradient(145deg,#151f2c_0%,#0b1018_58%,#05070c_100%)] shadow-[0_90px_130px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.09)]" />
            <div className="absolute left-5 right-5 top-5 bottom-5 rounded-[28px] border border-cyan-100/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),radial-gradient(circle_at_35%_25%,rgba(34,211,238,0.16),transparent_32%)] bg-[size:54px_54px,54px_54px,auto]" />
            <div className="absolute -bottom-8 left-10 right-10 h-8 rounded-b-[28px] bg-[#05070c] shadow-[0_32px_70px_rgba(0,0,0,0.58)] [transform:rotateX(-82deg)] [transform-origin:top]" />
            <div className="absolute -right-8 bottom-10 top-10 w-8 rounded-r-[28px] bg-[#070b12] [transform:rotateY(82deg)] [transform-origin:left]" />
          </div>

          <div className="absolute left-[11%] top-[14%] h-[40%] w-[5%] -skew-y-6 rounded-l-3xl border-l border-t border-cyan-100/10 bg-gradient-to-b from-white/14 to-white/4 backdrop-blur" />
          <div className="absolute left-[13%] top-[12%] h-[7%] w-[68%] -skew-x-12 rounded-t-3xl border-x border-t border-cyan-100/10 bg-gradient-to-r from-white/13 via-white/6 to-white/12 backdrop-blur" />
          <div className="absolute right-[16%] top-[16%] h-[48%] w-[5%] skew-y-6 rounded-r-3xl border-r border-t border-cyan-100/10 bg-gradient-to-b from-white/12 to-white/4 backdrop-blur" />

          <OfficeConnections rooms={officeRooms} connections={officeRoomConnections} />
          {officeRooms.map((room) => (
            <RoomZone
              key={room.id}
              label={room.label}
              editMode={editRooms}
              style={{
                left: `${room.x}%`,
                top: `${room.y}%`,
                width: `${room.w}%`,
                height: `${room.h}%`,
              }}
              onMoveStart={(event) => startRoomEdit(event, room.id, "move")}
              onResizeStart={(event) => startRoomEdit(event, room.id, "resize")}
              onLabelChange={(label) => renameRoom(room.id, label)}
            />
          ))}
          {editRooms && (
            <div className="absolute left-[12%] top-[12%] z-[95] rounded-2xl border border-cyan-100/20 bg-black/90 px-4 py-3 text-xs text-cyan-50 shadow-2xl shadow-black/70 backdrop-blur">
              Arrastra cajas o agentes. Edita nombres en las etiquetas. Usa la esquina brillante de cada caja para estirarla.
            </div>
          )}

          <div className="absolute left-[13%] top-[25%] z-[5] text-left">
            <p className="max-w-[180px] text-xl font-black leading-6 tracking-[0.12em] text-white/90">ROBS AGENTIC OFFICE</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Command center</p>
          </div>

          <div className="absolute left-[31%] top-[35%] z-[3] h-20 w-[17%] rounded-[22px] border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-6 top-4 h-10 w-20 rounded-xl bg-cyan-200/18" />
            <div className="absolute right-4 top-5 h-8 w-10 rounded-xl bg-amber-200/16" />
          </div>
          <div className="absolute left-[56%] top-[41%] z-[3] h-14 w-[6%] rounded-[22px] border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-3 top-4 h-10 w-10 rounded-xl bg-emerald-200/18" />
            <div className="absolute right-3 top-5 h-7 w-7 rounded-xl bg-cyan-200/16" />
          </div>
          <div className="absolute left-[68%] top-[35%] z-[3] h-20 w-[18%] rounded-[22px] border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-5 top-4 h-10 w-16 rounded-xl bg-cyan-200/20" />
            <div className="absolute right-5 top-4 h-10 w-16 rounded-xl bg-white/10" />
            <div className="absolute bottom-4 left-8 right-8 h-2 rounded-full bg-white/12" />
          </div>
          <div className="absolute left-[12%] top-[66%] z-[3] h-10 w-[14%] rounded-2xl border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-4 top-3 h-4 w-12 rounded-full bg-lime-200/25" />
            <div className="absolute right-4 top-3 h-4 w-9 rounded-full bg-cyan-200/18" />
          </div>
          <div className="absolute left-[35%] top-[72%] z-[3] h-10 w-[24%] rounded-2xl border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-5 top-4 h-4 w-14 rounded-full bg-indigo-200/20" />
            <div className="absolute right-5 top-4 h-4 w-10 rounded-full bg-white/12" />
          </div>
          <div className="absolute left-[32%] top-[90%] z-[3] h-8 w-[9%] rounded-2xl border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-4 top-4 h-4 w-10 rounded-full bg-rose-200/22" />
            <div className="absolute right-4 top-4 h-4 w-8 rounded-full bg-amber-200/18" />
          </div>
          <div className="absolute left-[70%] top-[75%] z-[3] h-10 w-[7%] rounded-2xl border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-4 top-4 h-4 w-10 rounded-full bg-amber-200/24" />
            <div className="absolute right-4 top-4 h-4 w-8 rounded-full bg-rose-200/18" />
          </div>
          <div className="absolute left-[84%] top-[90%] z-[3] h-8 w-[6%] rounded-2xl border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-3 top-3 h-4 w-9 rounded-full bg-violet-200/24" />
            <div className="absolute right-3 top-3 h-4 w-7 rounded-full bg-white/14" />
          </div>
          <div className="absolute left-[48%] top-[89%] z-[3] h-10 w-[18%] rounded-[22px] border border-white/10 bg-[#101827]/70 shadow-xl shadow-black/35">
            <div className="absolute left-7 top-5 h-4 w-16 rounded-full bg-white/18" />
            <div className="absolute left-28 top-5 h-4 w-14 rounded-full bg-lime-200/24" />
            <div className="absolute right-8 top-4 h-6 w-10 rounded-xl bg-cyan-200/16" />
          </div>
          <OfficePlant className="left-[26%] top-[37%] z-[4]" />
          <OfficePlant className="left-[58%] top-[38%] z-[4]" />
          <OfficePlant className="right-[8%] top-[66%] z-[4]" />

          {agents.map((agent) => (
            <AgentPerson
              key={agent.id}
              agent={agent}
              style={getAgentRoomStyle(agent)}
              editMode={editRooms}
              selected={agent.id === selectedAgent.id}
              walking={Boolean(walkingAgents[agent.id])}
              onMoveStart={(event) => startAgentEdit(event, agent.id)}
              onSelect={handleSelectAgent}
            />
          ))}

          {visibleConversationBubbles.map((bubble) => (
            <AgentSpeechBubble
              key={bubble.key}
              agent={bubble.agent}
              text={bubble.text}
              style={bubble.style}
              active={bubble.active}
              onClose={() => setClosedConversationBubbles((current) => ({ ...current, [bubble.key]: true }))}
            />
          ))}

          {appAgents.map((appAgent, index) => (
            <AppAgentSprite
              key={appAgent.key}
              name={appAgent.name}
              repo={appAgent.repo}
              status={appAgent.status}
              connected={appAgent.connected}
              position={appAgentPositions[index] || "left-[82%] bottom-[17%]"}
            />
          ))}

          {githubAppTeams.flatMap((team) =>
            team.agents.map((agent) => (
              <GitHubTeamAgent
                key={`${team.app}-${agent.name}`}
                name={agent.name}
                job={agent.job}
                repo={team.repo}
                position={agent.position}
                tone={agent.tone}
                onSelect={() => handleSelectTeamAgent(team, agent)}
              />
            ))
          )}
          </>
          )}
          {selectedContact && (
            <div className="contents">
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  closeAgentCard();
                }}
                className="fixed right-8 top-28 z-[9999] flex h-11 w-11 items-center justify-center rounded-full border border-cyan-100/80 bg-cyan-100 text-slate-950 shadow-[0_0_24px_rgba(103,232,249,0.45),0_14px_32px_rgba(0,0,0,0.5)] transition hover:scale-105 hover:bg-white"
                aria-label="Cerrar ficha de agente"
                data-testid="button-close-agent-card"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="absolute right-6 top-5 z-[120] max-h-[calc(100vh-5rem)] w-[min(420px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-cyan-200/35 bg-zinc-950/96 p-4 text-white shadow-2xl shadow-black/70 backdrop-blur">
              <div className="flex items-start gap-3 pr-12">
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", contact.color)}>
                  <ContactIcon className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-cyan-200">Agente seleccionado</p>
                  <h2 className="mt-1 truncate text-xl font-semibold">{contact.name}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{contact.role}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Area</p>
                  <p className="mt-1 text-sm font-medium">{contact.station}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-black/35 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Estado</p>
                  <p className="mt-1 text-sm font-medium">{contact.status}</p>
                </div>
              </div>
              <div className="mt-2 rounded-md border border-white/10 bg-black/35 p-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Que hace</p>
                <p className="mt-1 text-sm leading-5 text-zinc-200">{contact.activity}</p>
              </div>
              {contact.id in agentById && (
                <div className="mt-2 rounded-md border border-cyan-200/15 bg-cyan-950/10 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-cyan-200/70">Mover agente a room</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {walkingRoomShortcuts.map((room) => (
                      <button
                        key={`walk-shortcut-${contact.id}-${room.id}`}
                        type="button"
                        onClick={() => moveAgentToRoom(contact.id as AgentId, room.id)}
                        className="rounded-md border border-cyan-200/25 bg-cyan-300/10 px-2 py-2 text-left text-[11px] font-semibold text-cyan-50 transition hover:border-cyan-100/60 hover:bg-cyan-300/20"
                      >
                        Caminar a {room.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                    {officeRooms.map((room) => (
                      <button
                        key={`move-${contact.id}-${room.id}`}
                        type="button"
                        onClick={() => moveAgentToRoom(contact.id as AgentId, room.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[10px] font-semibold transition",
                          (agentLocations[contact.id as AgentId] || defaultAgentLocations[contact.id as AgentId]) === room.id
                            ? "border-cyan-200 bg-cyan-100 text-slate-950"
                            : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                        )}
                      >
                        {room.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(contact.name === "Code" || contact.name === "GitHub" || contact.id === "claude-reviewer") && (
                <div className="mt-2 rounded-md border border-cyan-200/15 bg-cyan-950/15 p-3">
                  <label className="text-[10px] uppercase tracking-wide text-cyan-200" htmlFor="office-target-repo">
                    App / repo objetivo
                  </label>
                  <select
                    id="office-target-repo"
                    value={targetRepo}
                    onChange={(event) => setTargetRepo(event.target.value)}
                    className="mt-2 h-9 w-full rounded-md border border-white/10 bg-black px-2 text-sm text-white focus:border-cyan-200/50 focus:outline-none"
                    data-testid="select-office-target-repo"
                  >
                    {repoTargets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label} - {item.repo}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs leading-4 text-zinc-400">
                    {targetRepo === "workspace"
                      ? "Code aplica cambios locales; Claude Reviewer hace doble chequeo antes de App QA."
                      : "Para apps de GitHub, abre GitHub Agent con ese repo; Codex trabaja PR-first y Claude revisa antes de App QA."}
                  </p>
                </div>
              )}
              {isChatOpen && (
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-md border border-cyan-200/15 bg-black/40 p-3">
                  {activeMessages.map((message, index) => (
                    <div
                      key={`${contact.id}-${index}-${message.role}`}
                      className={cn(
                        "rounded-md px-3 py-2 text-sm leading-5",
                        message.role === "user"
                          ? "ml-8 bg-cyan-300/15 text-cyan-50"
                          : "mr-8 bg-white/[0.07] text-zinc-200"
                      )}
                    >
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                        {message.role === "user" ? "Tu" : contact.name}
                      </p>
                      {message.text}
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={directMessage}
                onChange={(event) => setDirectMessage(event.target.value)}
                placeholder={isChatOpen ? `Seguir hablando con ${contact.name}` : `Escribirle a ${contact.name}`}
                className="mt-3 min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/45 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-cyan-200/40 focus:outline-none"
                data-testid="textarea-office-agent-popup-message"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={handleSendDirectMessage}
                  className="h-10 flex-1 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white"
                  data-testid="button-office-agent-popup-send"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {isChatOpen ? "Responder" : "Abrir chat"}
                </Button>
                <Link href={`/agent-chat?agent=${encodeURIComponent(contact.id)}`}>
                  <Button type="button" variant="outline" className="h-10 rounded-full border-white/10 bg-black/40 px-4 text-white hover:bg-white/10" data-testid="button-office-agent-full-chat">
                    Chat completo
                  </Button>
                </Link>
                {openHref && (
                  <Link href={openHref}>
                    <Button type="button" variant="outline" className="h-10 rounded-full border-white/10 bg-black/40 px-4 text-white hover:bg-white/10">
                      Abrir
                  </Button>
                </Link>
              )}
              </div>
              </div>
            </div>
          )}
          </div>
        <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)_420px]">
          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-5">
            <div className="flex items-start gap-4">
              <div className={cn("flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br text-zinc-950", selectedAgent.color)}>
                <SelectedIcon className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Agente {activeIndex}</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">{selectedAgent.name}</h2>
                <p className="mt-1 text-sm text-zinc-400">{selectedAgent.role}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Estacion</p>
                <p className="mt-1 text-sm font-medium text-white">{getAgentStation(selectedAgent)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Estado</p>
                <p className="mt-1 text-sm font-medium text-white">{selectedAgent.status}</p>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-white/10 bg-black/35 p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Funcion actual</p>
              <p className="mt-1 text-sm font-medium text-white">{selectedAgent.activity}</p>
            </div>

            <Link href={selectedAgent.href}>
              <Button className="mt-5 h-11 w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-white">
                <SelectedIcon className="mr-2 h-4 w-4" />
                Entrar a {selectedAgent.name}
              </Button>
            </Link>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Notas de la oficina</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                Se pueden cerrar
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {visibleNotes.chat && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, chat: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar chat interno"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">Chat interno</p>
                  <p className="mt-2 text-sm font-medium leading-5">{conversation[0].text}</p>
                </div>
              )}
              {visibleNotes.reply && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, reply: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar respuesta"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">
                    {agentById[conversation[1].from].name} responde
                  </p>
                  <p className="mt-2 text-sm font-medium leading-5">{conversation[1].text}</p>
                </div>
              )}
              {visibleNotes.break && (
                <div className="relative rounded-lg border border-amber-200/30 bg-amber-100 p-4 pr-10 text-[#2d2018]">
                  <button
                    type="button"
                    onClick={() => setVisibleNotes((notes) => ({ ...notes, break: false }))}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-[#4d3424] bg-[#f1c36a] text-[#2d2018] hover:bg-[#ffd98b]"
                    aria-label="Cerrar break room"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-[#7a522a]">Break room catch-up</p>
                  <div className="mt-2 space-y-2">
                    {breakRoomThreads.map((item) => (
                      <p key={`${item.from}-${item.text}`} className="text-xs font-medium leading-4">
                        <span className="font-bold">{agentById[item.from].name}:</span> {item.text}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-lime-200" />
                <p className="text-sm font-medium text-zinc-300">Apps conectadas</p>
              </div>
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs text-zinc-400 hover:text-white">
                  Ver Apps
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-lime-300/20 bg-lime-950/20 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Kong</p>
                <p className="mt-1 truncate text-sm font-medium text-white">{kongProject?.name || "kong-nightlife"}</p>
                <p className="mt-1 text-xs text-lime-200">GitHub detectado</p>
              </div>
              <div className="rounded-lg border border-rose-300/20 bg-rose-950/20 p-3">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500">Black Room</p>
                <p className="mt-1 truncate text-sm font-medium text-white">{blackRoomProject?.name || "br-website"}</p>
                <p className="mt-1 text-xs text-rose-200">GitHub detectado</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {connectedProjects.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/10 bg-black/30 p-3 text-sm text-zinc-500">
                  Importa tus repos desde Apps para que esta oficina vea Kong, Black Room y el resto de proyectos.
                </p>
              ) : (
                connectedProjects.map((project) => {
                  const overview = project.githubRepo ? githubOverview[project.githubRepo] : undefined;
                  return (
                    <div key={project.id} className="rounded-lg border border-white/10 bg-black/35 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{project.name}</p>
                          <p className="mt-1 truncate text-xs text-zinc-500">{project.githubRepo || project.url}</p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            project.status === "online" && "bg-emerald-500/15 text-emerald-200",
                            project.status === "offline" && "bg-red-500/15 text-red-200",
                            project.status === "degraded" && "bg-amber-500/15 text-amber-200",
                            project.status === "unknown" && "bg-zinc-500/15 text-zinc-300"
                          )}
                        >
                          {project.status}
                        </span>
                      </div>
                      {project.githubRepo && (
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            <Github className="h-3 w-3" />
                            {overview?.language || "GitHub"}
                          </span>
                          {typeof overview?.open_prs === "number" && <span>{overview.open_prs} PRs</span>}
                          {typeof overview?.open_issues === "number" && <span>{overview.open_issues} issues</span>}
                          {overview?.pushed_at && <span>push {new Date(overview.pushed_at).toLocaleDateString("es-ES")}</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Office Feed</p>
              </div>
              <span className="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100">
                daily sync
              </span>
            </div>
            <div className="space-y-2">
              {officeFeed.map((item) => {
                const agent = agentById[item.agent];
                const Icon = agent.icon;
                return (
                  <button
                    key={`${item.agent}-${item.title}`}
                    type="button"
                    onClick={() => handleSelectAgent(agent)}
                    className="w-full rounded-lg border border-white/10 bg-black/35 p-3 text-left transition hover:border-cyan-200/25 hover:bg-cyan-300/5"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", agent.color)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{agent.name}</p>
                        <p className="truncate text-[11px] text-cyan-100/60">{item.title} / {item.sharesWith}</p>
                      </div>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{item.text}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-amber-200" />
              <p className="text-sm font-medium text-zinc-300">Break Room</p>
            </div>
            <div className="space-y-2">
              {breakRoomThreads.map((item) => {
                const agent = agentById[item.from];
                return (
                  <div key={`${item.from}-${item.text}`} className="rounded-lg border border-white/10 bg-black/35 p-3">
                    <p className="text-xs font-semibold text-white">{agent.name}</p>
                    <p className="mt-1 text-sm leading-5 text-zinc-300">{item.text}</p>
                  </div>
                );
              })}
              <div className="rounded-lg border border-emerald-200/15 bg-emerald-300/10 p-3">
                <p className="text-xs font-semibold text-emerald-100">Motivacion interna</p>
                <p className="mt-1 text-sm leading-5 text-emerald-50/85">
                  Cada agente comparte una mejora pequena para otro equipo antes de cerrar el dia.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-cyan-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Meeting Room</p>
              </div>
              <span className="rounded-full border border-cyan-200/15 bg-cyan-300/10 px-2 py-1 text-[11px] text-cyan-100">
                {meetingRoomPresence.length} reunidos
              </span>
            </div>
            <div className="space-y-2">
              {meetingRoomThreads.map((item) => {
                const agent = agentById[item.from];
                const Icon = agent.icon;
                return (
                  <button
                    key={`meeting-thread-${item.from}`}
                    type="button"
                    onClick={() => handleSelectAgent(agent)}
                    className="w-full rounded-lg border border-white/10 bg-black/35 p-3 text-left transition hover:border-cyan-200/25 hover:bg-cyan-300/5"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", agent.color)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <p className="text-xs font-semibold text-white">{agent.name} en reunion</p>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{item.text}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                <p className="text-sm font-medium text-zinc-300">Learning Board</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                {approvedLearning.length} aprobados
              </span>
            </div>
            <div className="space-y-2">
              {learningSuggestions.map((item) => {
                const agent = agentById[item.agent];
                const approved = approvedLearning.includes(item.id);
                return (
                  <div key={item.id} className={cn("rounded-lg border p-3", approved ? "border-emerald-300/25 bg-emerald-300/10" : "border-white/10 bg-black/35")}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white">{agent.name} aprende</p>
                        <p className="mt-1 text-sm leading-5 text-zinc-300">{item.lesson}</p>
                      </div>
                      <Button
                        type="button"
                        variant={approved ? "outline" : "secondary"}
                        size="sm"
                        onClick={() => handleApproveLearning(item.id)}
                        className={cn("h-8 shrink-0 rounded-full px-3 text-xs", approved && "border-emerald-300/30 bg-emerald-300/10 text-emerald-100")}
                        disabled={approved}
                      >
                        {approved ? "Aprobado" : "Aprobar"}
                      </Button>
                    </div>
                    <p className="text-xs leading-4 text-zinc-500">{item.reason}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-violet-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-200" />
                <p className="text-sm font-medium text-zinc-300">Skill Scout</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                {approvedSkills.length} skills aprobados
              </span>
            </div>
            <div className="space-y-2">
              {skillSuggestions.map((item) => {
                const agent = agentById[item.agent];
                const Icon = agent.icon;
                const approved = approvedSkills.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "rounded-lg border p-3",
                      approved ? "border-violet-300/30 bg-violet-300/10" : "border-white/10 bg-black/35"
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-2">
                        <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", agent.color)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">{agent.name} propone skill</p>
                          <p className="mt-1 text-sm font-medium text-violet-100">{item.skill}</p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant={approved ? "outline" : "secondary"}
                        size="sm"
                        onClick={() => handleApproveSkill(item.id)}
                        className={cn("h-8 shrink-0 rounded-full px-3 text-xs", approved && "border-violet-300/30 bg-violet-300/10 text-violet-100")}
                        disabled={approved}
                      >
                        {approved ? "Aprobado" : "Aprobar"}
                      </Button>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{item.helpsWith}</p>
                    <p className="mt-2 text-xs leading-4 text-zinc-500">Siguiente paso: {item.nextStep}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-indigo-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-indigo-200" />
                <p className="text-sm font-medium text-zinc-300">Legal Main + App Scouts</p>
              </div>
              <span className="rounded-full border border-indigo-200/15 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100">
                {legalCompliance?.totalTargets ?? legalAppReports.length} apps/repos revisados
              </span>
            </div>
            <div className="mb-3 grid gap-2 text-[11px] sm:grid-cols-3">
              <p className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-500">
                GitHub: <span className={legalCompliance?.githubConnected ? "text-emerald-200" : "text-amber-200"}>{legalCompliance?.githubConnected ? "conectado" : "manual"}</span>
              </p>
              <p className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-500">
                Critico: <span className="text-red-100">{legalReportsFromApi.length ? legalSummary.critico : legalAppReports.filter((report) => report.severity === "critico").length}</span>
              </p>
              <p className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-zinc-500">
                Revisar: <span className="text-amber-100">{legalReportsFromApi.length ? legalSummary.revisar : legalAppReports.filter((report) => report.severity === "revisar").length}</span>
              </p>
            </div>
            {legalSourceErrors.length ? (
              <p className="mb-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-2 text-[11px] leading-4 text-amber-100">
                Fuentes pendientes: {legalSourceErrors.slice(0, 2).join(" | ")}
              </p>
            ) : null}
            {legalAppReports.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 bg-black/30 p-3 text-sm text-zinc-500">
                Conecta apps/repos para que Legal / Compliance genere reportes por cada proyecto.
              </p>
            ) : (
              <div className="space-y-2">
                {legalAppReports.map((report) => (
                  <div key={report.id} className="rounded-lg border border-white/10 bg-black/35 p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{report.appName}</p>
                        <p className="mt-1 truncate text-[11px] text-zinc-500">{report.repo}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            report.severity === "critico" && "bg-red-300/15 text-red-100",
                            report.severity === "revisar" && "bg-amber-300/15 text-amber-100",
                            report.severity === "info" && "bg-cyan-300/15 text-cyan-100"
                          )}
                        >
                          {report.severity}
                        </span>
                        {report.source && (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-400">
                            {report.source}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{report.summary}</p>
                    <div className="mt-2 rounded-md border border-indigo-200/10 bg-indigo-300/5 px-2 py-2 text-[11px] leading-4 text-indigo-100">
                      <span className="font-semibold">{report.scoutAgent || "Legal Main"}</span>
                      {report.operatingModel === "app_scout_to_main" ? " observa esta app y escala al " : " revisa directo como "}
                      <span className="font-semibold">{report.ownerAgent || "Legal Main"}</span>
                      {report.escalationPath?.length ? ` · Ruta: ${report.escalationPath.join(" -> ")}` : ""}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {report.checks.slice(0, 4).map((check) => (
                        <p key={`${report.id}-${check}`} className="rounded-md border border-white/10 bg-zinc-950/60 px-2 py-1.5 text-xs leading-4 text-zinc-400">
                          {check}
                        </p>
                      ))}
                    </div>
                    {report.riskAreas && report.riskAreas.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {report.riskAreas.slice(0, 5).map((risk) => (
                          <span key={`${report.id}-${risk}`} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-500">
                            {risk}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 rounded-md border border-indigo-200/10 bg-indigo-300/10 px-2 py-2 text-xs leading-4 text-indigo-100">
                      Proxima accion: {report.nextAction}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-4 text-zinc-600">
              Nota: esto es monitoreo operativo y no reemplaza revision de un abogado real.
            </p>
          </div>

          <div className="rounded-lg border border-indigo-200/15 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-indigo-200" />
                <p className="text-sm font-medium text-zinc-300">Legal Sync</p>
              </div>
              <span className="rounded-full border border-indigo-200/15 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100">
                Kong conectado
              </span>
            </div>
            <div className="space-y-2">
              {legalBridgeReports.map((report) => (
                <div key={`${report.source}-${report.title}`} className="rounded-lg border border-white/10 bg-black/35 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{report.source} / {report.target}</p>
                      <p className="mt-1 text-sm font-medium text-indigo-100">{report.title}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        report.severity === "critico" && "bg-red-300/15 text-red-100",
                        report.severity === "revisar" && "bg-amber-300/15 text-amber-100",
                        report.severity === "info" && "bg-cyan-300/15 text-cyan-100"
                      )}
                    >
                      {report.severity}
                    </span>
                  </div>
                  <p className="text-sm leading-5 text-zinc-300">{report.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Send className="h-4 w-4 text-cyan-200" />
              <p className="text-sm font-medium text-zinc-300">Escribir directo</p>
            </div>
            <textarea
              value={directMessage}
              onChange={(event) => setDirectMessage(event.target.value)}
              placeholder={`Mensaje para ${contact.name}`}
              className="min-h-24 w-full resize-none rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
              data-testid="textarea-direct-agent-message"
            />
            <Button
              type="button"
              onClick={handleSendDirectMessage}
              className="mt-3 h-10 w-full rounded-full bg-zinc-100 text-zinc-950 hover:bg-white"
              data-testid="button-send-direct-agent-message"
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar a {contact.name}
            </Button>
            {sentMessages.length > 0 && (
              <div className="mt-3 space-y-2">
                {sentMessages.map((message, index) => (
                  <div key={`${message.to}-${message.text}-${index}`} className="rounded-md border border-white/10 bg-black/35 p-2 text-xs text-zinc-300">
                    <span className="font-medium text-white">{message.to}:</span> {message.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-zinc-300">Conversacion</p>
              </div>
              <span className="rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[11px] text-zinc-500">
                {agents.length} agentes
              </span>
            </div>

            <div className="space-y-3">
              {conversation.map((message, index) => {
                const SpeakerIcon = agentById[message.from].icon;
                return (
                  <div
                    key={`${message.from}-${index}`}
                    className="rounded-lg border border-white/10 bg-black/35 p-3"
                    data-testid={`agent-message-${index}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br text-zinc-950", agentById[message.from].color)}>
                        <SpeakerIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{agentById[message.from].name}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {message.to ? `para ${agentById[message.to].name}` : "en la oficina"}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm leading-5 text-zinc-300">{message.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-zinc-950/80 p-4">
            <p className="mb-3 text-sm font-medium text-zinc-300">Directorio</p>
            <div className="space-y-2">
              {agents.map((agent) => {
                const Icon = agent.icon;
                const active = agent.id === selectedAgent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setSelectedAgent(agent)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
                      active ? "border-white/25 bg-white/10" : "border-transparent hover:border-white/10 hover:bg-white/[0.04]"
                    )}
                    data-testid={`button-select-agent-${agent.id}`}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-zinc-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{agent.name}</span>
                      <span className="block truncate text-xs text-zinc-500">{agent.activity}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </section>
      </div>
  );
}

export default function AgentsOfficePage() {
  const queryClient = useQueryClient();
  const ownerId = queryClient.getQueryData<{ user?: { id: string } }>(["auth-me"])?.user?.id;
  const [showWorld, setShowWorld] = useState(false);
  const workspace = useWorkspaceRole();
  if (!ownerId) return <p role="alert">No se pudo verificar el propietario de la sesión.</p>;
  // Robert asked for the agents building as the main view: live status first, the Company World simulation below.
  return <div className="bg-[#080e18]">
    <MotionConfig reducedMotion="user"><LiveAgentsOffice key={ownerId} ownerId={ownerId} /></MotionConfig>
    {!workspace.isPartner && <section className="mx-4 my-8 rounded-xl border border-white/10 bg-slate-900 p-4 text-slate-200">
      <button type="button" aria-expanded={showWorld} aria-controls="company-world" onClick={() => setShowWorld(value => !value)} className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200">
        {showWorld ? "Ocultar" : "Abrir"} Company World · simulación de departamentos (sin gasto real)
      </button>
      <div id="company-world" hidden={!showWorld} className="mt-4">{showWorld && <CompanyOffice key={ownerId} ownerId={ownerId} />}</div>
    </section>}
  </div>;
}
