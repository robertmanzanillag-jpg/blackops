// Every agent the office shows, as one chat directory (pure, no IO).
//
// Static agents come from their registries; KONG city desks and academy trainees come from the
// council state the server already persists, so the chat never lists an agent the office cannot
// ground in recorded data. Black Room and factory registries are only read here, never changed.

import { AGENT_CHAT_PROFILES, KONG_CITY_CATEGORY_WORDS, normalizeChatText, parseKongCityAgentId, type AgentChatProfile } from "./agent-chat-routing";
import { BLACKROOM_LEGACY_MEMBER_IDS, BLACKROOM_TEAM } from "./blackroom-team";
import { FACTORY_AGENTS } from "./factory-office-agents";
import { isSpecialistId, specialistTopicLabel, type CompanyState, type Trainee } from "./agent-company";

export type AgentChatGroup = "blackops" | "blackroom" | "kong-desk" | "kong-city" | "factory" | "academy";
export type AgentChatEntry = AgentChatProfile & {
  group: AgentChatGroup;
  /** Other ids the office uses for the same agent (e.g. the KONG team popup "Kong-Venues"). */
  legacyIds?: string[];
  cityId?: string;
  cityName?: string;
  category?: string;
  /** Orders can be recorded for it in the main company (KONG workers and trainees cannot). */
  orderable: boolean;
};
export const AGENT_CHAT_GROUP_LABELS: Record<AgentChatGroup, string> = {
  blackops: "BlackOps", blackroom: "Black Room", "kong-desk": "KONG central", "kong-city": "KONG ciudades", factory: "Fábrica de software", academy: "Academia",
};

export const KONG_CITY_CATEGORY_NAMES: Record<string, string> = {
  clubs: "Clubs", vip: "Mesas VIP", restaurants: "Restaurantes", events: "Eventos", sports: "Deportes", experiences: "Experiencias", media: "Fotos y media",
};
const KONG_DESKS: Array<AgentChatProfile & { legacyIds: string[] }> = [
  { id: "kong:KONG AI", name: "KONG AI", job: "Chat central de KONG: preguntas, herramientas internas y contexto de la app.", aliases: ["kong ai"], legacyIds: ["Kong-KONG AI"] },
  { id: "kong:Promoters + Mesas", name: "Promotores + Mesas", job: "Flujo comercial de KONG: promotores, mesas y seguimiento.", aliases: ["promoters + mesas", "promotores + mesas", "promotores y mesas", "promoters y mesas"], legacyIds: ["Kong-Promoters + Mesas"] },
  { id: "kong:Venues", name: "Venues", job: "Busca, revisa e importa eventos de venues para KONG.", aliases: ["venues kong", "kong venues"], legacyIds: ["Kong-Venues"] },
  { id: "kong:Kong Legal", name: "Kong Legal", job: "Revisión legal integrada en KONG; reporta al Legal / Compliance central.", aliases: ["kong legal", "legal de kong"], legacyIds: ["Kong-Kong Legal"] },
  { id: "kong-metrics", name: "Métricas KONG", job: "Métricas registradas de KONG (lectura de Metricool).", aliases: ["metricas kong", "kong metrics", "metricas de kong"], legacyIds: [] },
];
const BLACKROOM_LEGACY = new Set<string>(BLACKROOM_LEGACY_MEMBER_IDS);
const KONG_STATIC = new Set(["kong-videos"]);

const titleCase = (value: string) => value.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
/** "Contratado como Miami · clubs." (written by the KONG company when it hires a city desk). */
function cityNameFromCareer(company: CompanyState, id: string) {
  const memory = Array.isArray(company?.careers?.[id]?.memory) ? company.careers[id].memory : [];
  for (const entry of [...memory].reverse()) {
    const match = typeof entry?.text === "string" ? /^Contratado como (.+?) · [a-z]+\.?$/.exec(entry.text) : null;
    if (match) return match[1].trim().slice(0, 80);
  }
  return null;
}

export function kongCityEntry(id: string, cityName?: string | null): AgentChatEntry | null {
  const city = parseKongCityAgentId(id);
  if (!city) return null;
  const name = cityName || titleCase(city.cityId);
  const category = KONG_CITY_CATEGORY_NAMES[city.category];
  const plain = normalizeChatText(name);
  return {
    id, name: `${name} · ${category}`, group: "kong-city", orderable: false, cityId: city.cityId, cityName: name, category: city.category,
    job: `Puesto de ${category.toLowerCase()} de KONG en ${name}.`,
    aliases: [`${plain} ${normalizeChatText(category)}`, `${normalizeChatText(category)} ${plain}`, `${normalizeChatText(category)} en ${plain}`, ...KONG_CITY_CATEGORY_WORDS[city.category].slice(0, 2).map(word => `${word} ${plain}`)],
  };
}

type DirectoryState = { company: CompanyState; kongCompany: CompanyState; kongLastStatuses: Record<string, unknown> };
const activeTrainees = (company: CompanyState): Trainee[] => (Array.isArray(company?.trainees) ? company.trainees : []).filter(trainee => trainee && typeof trainee.id === "string").filter(trainee => !trainee.graduatedAt && !trainee.evaluationClosedAt);

export function buildAgentChatDirectory(state: DirectoryState): AgentChatEntry[] {
  const entries: AgentChatEntry[] = AGENT_CHAT_PROFILES.map(profile => ({
    ...profile, group: BLACKROOM_LEGACY.has(profile.id) ? "blackroom" : KONG_STATIC.has(profile.id) ? "kong-desk" : "blackops",
    orderable: !profile.id.startsWith("kong"),
  }));
  for (const agent of BLACKROOM_TEAM) {
    entries.push({ id: agent.id, name: agent.name, job: `${agent.role}. ${agent.description}`, aliases: [normalizeChatText(agent.name), agent.id.replace(/-/g, " ")], group: "blackroom", orderable: true });
  }
  for (const desk of KONG_DESKS) entries.push({ ...desk, group: "kong-desk", orderable: false });
  for (const agent of FACTORY_AGENTS) {
    entries.push({ id: agent.id, name: agent.name, job: `${agent.role} (etapa ${agent.stage} de la fábrica de software).`, aliases: [agent.id.replace(/-/g, " ")], group: "factory", orderable: true });
  }
  // KONG and the academy write these records; odd data skips that entry, it never breaks the directory.
  const safely = (work: () => void) => { try { work(); } catch { /* skip this entry */ } };
  const keys = (value: unknown) => value && typeof value === "object" ? Object.keys(value) : [];
  const cityIds = new Set([...keys(state.kongCompany?.careers), ...keys(state.kongLastStatuses)].filter(id => isAgentChatIdShape(id) && parseKongCityAgentId(id)));
  for (const id of [...cityIds].sort()) safely(() => {
    const entry = kongCityEntry(id, cityNameFromCareer(state.kongCompany, id));
    if (entry) entries.push(entry);
  });
  // Academy specialists ("Especialista en ...") already hired into the main company.
  for (const id of keys(state.company?.careers).filter(id => isAgentChatIdShape(id) && isSpecialistId(id)).sort()) safely(() => {
    const topic = specialistTopicLabel(id);
    entries.push({ id, name: `Especialista en ${topic}`, job: `Especialista de la academia para órdenes de ${topic}.`, aliases: [`especialista en ${normalizeChatText(topic)}`], group: "academy", orderable: false });
  });
  for (const [company, kong] of [[state.company, false], [state.kongCompany, true]] as const) {
    let trainees: Trainee[] = [];
    safely(() => { trainees = activeTrainees(company); });
    for (const trainee of trainees) safely(() => {
      const id = `trainee:${trainee.id}`;
      if (!isAgentChatIdShape(id) || typeof trainee.nickname !== "string") return;
      entries.push({ id, name: `${trainee.nickname} (aprendiz)`, group: "academy", orderable: false,
        job: `En formación para ${trainee.role}${kong ? " (KONG)" : ""}.`, aliases: [normalizeChatText(trainee.nickname)] });
    });
  }
  const seen = new Set<string>();
  return entries.filter(entry => !seen.has(entry.id) && seen.add(entry.id));
}

/** City display names for routing ("eventos en Buenos Aires" -> kong-city:buenos-aires:events). */
export function directoryCityNames(entries: readonly AgentChatEntry[]): Record<string, string> {
  return Object.fromEntries(entries.filter(entry => entry.cityId && entry.cityName).map(entry => [entry.cityId!, entry.cityName!]));
}

/** Ids are path parameters and title segments: printable, no separators the store uses. */
export const isAgentChatIdShape = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9:_+#. -]{1,120}$/.test(id) && !id.includes("|");

export function findAgentChatEntry(entries: readonly AgentChatEntry[], id: string) {
  return entries.find(entry => entry.id === id) || entries.find(entry => entry.legacyIds?.includes(id));
}
