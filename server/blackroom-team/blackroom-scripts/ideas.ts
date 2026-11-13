// Deterministic idea + script templates for Black Room videos (no LLM, no IO).
// Grounding comes from the analytics/competition teammates and Robert's style guide; the same
// inputs and seed always produce the same scripts, so tests and reruns are stable.
import { createHash } from "node:crypto";
import type { BlackRoomVideoStyleGuide } from "./style-guide";
import { violatesBlackRoomStyle } from "./style-guide";

export const BLACKROOM_SCRIPT_DURATIONS = [15, 30, 60] as const;
export type BlackRoomScriptDuration = (typeof BLACKROOM_SCRIPT_DURATIONS)[number];

export type BlackRoomScriptGrounding = {
  /** Best duration from Black Room's own analytics, when there is enough data. */
  bestDuration: BlackRoomScriptDuration | null;
  bestHour: string | null;
  analyticsNote: string | null;
  /** Competitor content that performs (public data). */
  competitorWinners: Array<{ competitor: string; title: string; views: number }>;
  competitionTakeaways: string[];
  /** Black Room's own upcoming events found by the competition watcher. */
  upcomingEvents: Array<{ name: string; startDate: string; location: string | null }>;
  sources: string[];
};

export const EMPTY_GROUNDING: BlackRoomScriptGrounding = {
  bestDuration: null, bestHour: null, analyticsNote: null, competitorWinners: [], competitionTakeaways: [], upcomingEvents: [], sources: [],
};

export type BlackRoomScriptBeat = { from: number; to: number; part: string; action: string; onScreenText: string };

export type BlackRoomVideoScript = {
  id: string;
  angle: string;
  title: string;
  durationSeconds: BlackRoomScriptDuration;
  language: "es" | "en";
  hook: string;
  beats: BlackRoomScriptBeat[];
  shotList: string[];
  caption: string;
  cta: string;
  hashtags: string[];
  suggestedPostHour: string | null;
  editingNotes: string[];
  /** Why this idea: the data it is grounded on (Spanish). */
  basis: string[];
  styleGuideApplied: boolean;
};

export type BlackRoomIdeaRequest = {
  count?: number;
  durations?: BlackRoomScriptDuration[];
  topic?: string | null;
  djName?: string | null;
  eventName?: string | null;
  language?: "es" | "en" | null;
  seed: string;
};

type Angle = {
  key: string;
  label: string;
  title: (v: Vars) => string;
  hooks: (v: Vars) => string[];
  core: (v: Vars) => string[];
  payoff: (v: Vars) => string;
  shots: (v: Vars) => string[];
  caption: (v: Vars) => string;
  needs?: (g: BlackRoomScriptGrounding) => boolean;
};

type Vars = { dj: string; event: string; eventDate: string; topic: string; competitorTitle: string; competitor: string };

const ANGLES: Angle[] = [
  {
    key: "drop", label: "El drop del DJ",
    title: (v) => `El drop de ${v.dj} que prendio la pista`,
    hooks: (v) => [`Espera el drop de ${v.dj}...`, "Asi suena Black Room a la 1 AM", "Sube el volumen en 3, 2, 1"],
    core: () => ["Build-up: plano cerrado de manos en la mezcladora", "Corte en seco al drop: plano general de la pista saltando", "Reaccion del publico en camara lenta"],
    payoff: () => "La pista entera explota con el drop",
    shots: (v) => [`Primer plano de ${v.dj} en cabina`, "Manos en la mezcladora / CDJ", "Plano general de la pista en el drop", "Caras del publico reaccionando", "Luces y humo (plano de recurso)"],
    caption: (v) => `${v.dj} en Black Room. Este drop no se explica, se siente.`,
  },
  {
    key: "behind", label: "Detras de la cabina",
    title: (v) => `Lo que nadie ve detras de la cabina con ${v.dj}`,
    hooks: () => ["Esto es lo que pasa detras de la cabina", "POV: estas en la cabina de Black Room", "Nadie ve esta parte de la noche"],
    core: (v) => [`${v.dj} preparando el set antes de abrir`, "Montaje rapido: luces, sonido, puerta abriendo", "Primer track de la noche y la pista llenandose"],
    payoff: () => "De sala vacia a pista llena",
    shots: (v) => ["Sala vacia antes de abrir", `${v.dj} revisando el set`, "Prueba de luces", "Fila en la puerta", "Pista llena (contraste)"],
    caption: () => "De sala vacia a pista llena. Asi se arma una noche en Black Room.",
  },
  {
    key: "crowd", label: "Reaccion del publico",
    title: () => "La reaccion del publico cuando suena ESTE track",
    hooks: () => ["Mira la reaccion cuando suena este track", "Nadie esperaba este cambio", "El momento exacto en que la pista se volvio loca"],
    core: () => ["Contexto: la pista tranquila", "El track entra: corte a caras y manos arriba", "Repeticion del mejor momento en camara lenta"],
    payoff: () => "El mejor momento repetido en camara lenta",
    shots: () => ["Pista tranquila (antes)", "Caras reaccionando (despues)", "Manos arriba", "Grupo cantando", "Camara lenta del pico"],
    caption: () => "Ese momento en que todos se saben la cancion. Black Room.",
  },
  {
    key: "event", label: "Anuncio del proximo evento",
    title: (v) => `${v.event}: lo que viene en Black Room`,
    hooks: (v) => [`${v.event} ya tiene fecha`, `Guarda la fecha: ${v.eventDate}`, "Esto es lo que viene en Black Room"],
    core: (v) => [`Fecha y lugar de ${v.event} en texto grande`, "Clips de la ultima noche como adelanto", "Quien toca: line-up en pantalla"],
    payoff: (v) => `Recordatorio final: ${v.event}, ${v.eventDate}`,
    shots: () => ["Mejores momentos de la ultima noche", "Flyer o line-up en pantalla", "DJ principal en cabina", "Publico en el pico de la noche"],
    caption: (v) => `${v.event} — ${v.eventDate}. Nos vemos en Black Room.`,
    needs: (g) => g.upcomingEvents.length > 0,
  },
  {
    key: "recap", label: "Resumen de la noche",
    title: () => "Lo que te perdiste anoche en Black Room",
    hooks: () => ["Si no viniste anoche, mira esto", "Anoche en Black Room", "Una noche en 30 segundos"],
    core: () => ["Llegada y puerta", "Pista llena y DJ en cabina", "El mejor momento de la noche"],
    payoff: () => "Cierre con la pista en su punto mas alto",
    shots: () => ["Puerta / llegada", "Pista llena", "DJ en cabina", "Mejor momento", "Salida con luces"],
    caption: () => "Lo que te perdiste anoche. La proxima no te la pierdes.",
  },
  {
    key: "competitor-format", label: "Formato que le funciona a la competencia",
    title: (v) => `Version Black Room de un formato que funciona: "${v.competitorTitle}"`,
    hooks: () => ["Todos hacen fiestas. Esto es Black Room", "Esto es lo que nos hace distintos", "Pensaste que ya lo habias visto todo"],
    core: (v) => [`Formato inspirado en "${v.competitorTitle}" (${v.competitor}), con contenido propio`, "Nuestro DJ y nuestra pista como protagonistas", "Detalle de marca: luces, cabina, logo"],
    payoff: () => "Remate con la identidad de Black Room",
    shots: () => ["Plano de marca (logo / cabina)", "DJ en cabina", "Pista llena", "Detalle de luces"],
    caption: () => "Hay fiestas y hay Black Room.",
    needs: (g) => g.competitorWinners.length > 0,
  },
  {
    key: "radio", label: "Radio Black Room: track de la semana",
    title: (v) => `Track de la semana en Radio Black Room con ${v.dj}`,
    hooks: () => ["El track que no paramos de poner esta semana", "Si te gusta este track, sigue Radio Black Room", "Este es el track de la semana"],
    core: (v) => [`${v.dj} presenta el track en cabina de radio`, "Fragmento del track con visual de ondas o cabina", "Pregunta al publico: lo pondrias en tu playlist?"],
    payoff: () => "Pregunta directa al publico para comentarios",
    shots: (v) => [`${v.dj} en cabina de radio`, "Primer plano de audifonos / micro", "Visual del track", "Logo de Radio Black Room"],
    caption: (v) => `Track de la semana en Radio Black Room con ${v.dj}. Lo pondrias en tu playlist?`,
  },
];

const DEFAULT_CTAS_ES = ["Sigue a Black Room para no perderte la proxima", "Comenta tu DJ favorito", "Guarda este video para la proxima noche", "Etiqueta a quien tienes que traer"];
const DEFAULT_CTAS_EN = ["Follow Black Room so you don't miss the next one", "Comment your favorite DJ", "Save this for the next night out", "Tag who you're bringing"];
const DEFAULT_HASHTAGS = ["#BlackRoom", "#nightlife", "#djset"];

function hash(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 12), 16);
}

function pick<T>(list: readonly T[], seed: string): T {
  return list[hash(seed) % list.length];
}

/** Beat timing per duration: hook in the first 2-3 seconds, CTA at the end. */
function beatPlan(duration: BlackRoomScriptDuration): Array<{ from: number; to: number; part: string }> {
  if (duration === 15) return [{ from: 0, to: 2, part: "hook" }, { from: 2, to: 6, part: "desarrollo" }, { from: 6, to: 10, part: "desarrollo" }, { from: 10, to: 13, part: "remate" }, { from: 13, to: 15, part: "cta" }];
  if (duration === 30) return [{ from: 0, to: 3, part: "hook" }, { from: 3, to: 10, part: "desarrollo" }, { from: 10, to: 17, part: "desarrollo" }, { from: 17, to: 24, part: "desarrollo" }, { from: 24, to: 27, part: "remate" }, { from: 27, to: 30, part: "cta" }];
  return [{ from: 0, to: 3, part: "hook" }, { from: 3, to: 15, part: "desarrollo" }, { from: 15, to: 30, part: "desarrollo" }, { from: 30, to: 45, part: "desarrollo" }, { from: 45, to: 54, part: "remate" }, { from: 54, to: 60, part: "cta" }];
}

function shortText(value: string, words = 6): string {
  return value.replace(/[:"]/g, "").split(/\s+/).slice(0, words).join(" ").toUpperCase();
}

function cleanVar(value: unknown, fallback: string, max = 60): string {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return text || fallback;
}

function orderDurations(request: BlackRoomIdeaRequest, grounding: BlackRoomScriptGrounding): BlackRoomScriptDuration[] {
  const requested = (request.durations || []).filter((d): d is BlackRoomScriptDuration => (BLACKROOM_SCRIPT_DURATIONS as readonly number[]).includes(d));
  const base = requested.length ? requested : [...BLACKROOM_SCRIPT_DURATIONS];
  if (!grounding.bestDuration || !base.includes(grounding.bestDuration)) return base;
  return [grounding.bestDuration, ...base.filter((d) => d !== grounding.bestDuration)];
}

export function buildBlackRoomVideoScripts(request: BlackRoomIdeaRequest, grounding: BlackRoomScriptGrounding, guide: BlackRoomVideoStyleGuide): BlackRoomVideoScript[] {
  const count = Math.max(1, Math.min(10, Math.floor(Number(request.count) || 3)));
  const durations = orderDurations(request, grounding);
  const language: "es" | "en" = request.language === "en" || (!request.language && guide.language === "en") ? "en" : "es";
  const event = grounding.upcomingEvents[0];
  const winner = grounding.competitorWinners[0];
  const vars: Vars = {
    dj: cleanVar(request.djName, "nuestro DJ"),
    event: cleanVar(request.eventName, event?.name || "La proxima noche"),
    eventDate: cleanVar(event?.startDate?.slice(0, 10), "pronto", 20),
    topic: cleanVar(request.topic, ""),
    competitorTitle: cleanVar(winner?.title, "", 80),
    competitor: cleanVar(winner?.competitor, "", 40),
  };
  const eligible = ANGLES.filter((angle) => !angle.needs || angle.needs(grounding));
  // Data-backed angles first (event, competitor format), then a seeded rotation of the rest.
  const dataBacked = eligible.filter((angle) => angle.needs);
  const rest = eligible.filter((angle) => !angle.needs).sort((a, b) => hash(`${request.seed}:${a.key}`) - hash(`${request.seed}:${b.key}`));
  const ordered = [...dataBacked, ...rest];
  const ctas = guide.ctas.length ? guide.ctas : language === "en" ? DEFAULT_CTAS_EN : DEFAULT_CTAS_ES;
  const hashtags = (guide.hashtags.length ? guide.hashtags : DEFAULT_HASHTAGS).slice(0, 6);
  const scripts: BlackRoomVideoScript[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = ordered[index % ordered.length];
    const durationSeconds = durations[index % durations.length];
    const seed = `${request.seed}:${index}:${angle.key}:${durationSeconds}`;
    const allowed = (hook: string) => !violatesBlackRoomStyle(hook, guide);
    const guideHooks = guide.hooks.filter(allowed);
    const angleHooks = angle.hooks(vars).filter(allowed);
    const hook = guideHooks.length && (!angleHooks.length || hash(`${seed}:guide`) % 2 === 0)
      ? pick(guideHooks, seed)
      : pick(angleHooks.length ? angleHooks : angle.hooks(vars), seed);
    const cta = pick(ctas, `${seed}:cta`);
    const core = angle.core(vars);
    let coreIndex = 0;
    const beats: BlackRoomScriptBeat[] = beatPlan(durationSeconds).map((slot) => {
      if (slot.part === "hook") return { ...slot, action: "Abrir con la imagen mas fuerte, sin intro ni logo", onScreenText: shortText(hook) };
      if (slot.part === "cta") return { ...slot, action: "Cierre con logo de Black Room y llamado a la accion", onScreenText: shortText(cta) };
      if (slot.part === "remate") return { ...slot, action: angle.payoff(vars), onScreenText: shortText(angle.payoff(vars), 5) };
      const action = core[coreIndex % core.length];
      coreIndex += 1;
      return { ...slot, action, onScreenText: shortText(action, 5) };
    });
    const topicLine = vars.topic ? ` Tema: ${vars.topic}.` : "";
    const caption = `${angle.caption(vars)}${topicLine} ${cta}.`.replace(/\s+/g, " ").replace(/\.\./g, ".").trim();
    const basis: string[] = [];
    if (grounding.bestDuration === durationSeconds) basis.push(`${durationSeconds}s es la duracion con mejores vistas en las analiticas de Black Room.`);
    if (angle.key === "event" && event) basis.push(`Evento propio detectado: ${event.name} (${event.startDate.slice(0, 10)}).`);
    if (angle.key === "competitor-format" && winner) basis.push(`A ${winner.competitor} le funciono "${winner.title}" (${winner.views} vistas publicas); se adapta el formato, no el contenido.`);
    if (grounding.analyticsNote) basis.push(grounding.analyticsNote);
    if (!basis.length) basis.push("Plantilla base de Black Room (todavia sin datos de rendimiento suficientes).");
    const editingNotes = [
      "Formato vertical 9:16 (1080x1920), 30 fps.",
      durationSeconds === 15 ? "Cortes cada 1-2 s; el drop o momento fuerte antes del segundo 3." : durationSeconds === 30 ? "Cortes cada 2-3 s; un momento fuerte cada 8-10 s." : "Cortes cada 3-4 s; sostener la tension hasta el climax.",
      "Subtitulos grandes centrados, maximo 6 palabras por pantalla.",
      ...guide.editing.slice(0, 4),
      ...guide.onScreenText.slice(0, 3),
    ];
    scripts.push({
      id: `idea-${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`,
      angle: angle.label,
      title: angle.title(vars),
      durationSeconds,
      language,
      hook,
      beats,
      shotList: angle.shots(vars),
      caption: violatesBlackRoomStyle(caption, guide) ? `${cta}.` : caption,
      cta,
      hashtags,
      suggestedPostHour: grounding.bestHour,
      editingNotes,
      basis,
      styleGuideApplied: guide.present,
    });
  }
  return scripts;
}

/** Compact prompt Robert can paste into his ChatGPT/Claude subscription to polish one script (no API spend). */
export function buildBlackRoomScriptHandoffPrompt(script: BlackRoomVideoScript, guide: BlackRoomVideoStyleGuide): string {
  const lines = [
    `Pule este guion de ${script.durationSeconds}s para Black Room (fiesta/radio nocturna, ${script.language === "en" ? "ingles" : "espanol"}).`,
    guide.tone.length ? `Tono: ${guide.tone.slice(0, 3).join("; ")}.` : "Tono: cercano, nocturno, energia alta, sin sonar a anuncio.",
    guide.banned.length ? `Nunca uses: ${guide.banned.slice(0, 8).join(", ")}.` : "",
    `Hook: ${script.hook}`,
    `Beats: ${script.beats.map((beat) => `${beat.from}-${beat.to}s ${beat.action}`).join(" | ")}`,
    `CTA: ${script.cta}`,
    "Devuelve: hook, beats con texto en pantalla (max 6 palabras), caption y CTA. Mismas duraciones.",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 900);
}
