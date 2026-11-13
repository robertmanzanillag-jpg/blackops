import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface ClaudeSkill {
  name: string;
  description: string;
  body: string;
  path: string;
}

const SKILLS_DIR = path.join(process.cwd(), ".claude", "skills");
const DEFAULT_MAX_SKILLS = 1;
const DEFAULT_MAX_BODY_CHARS = 900;
const DEFAULT_MAX_CONTEXT_CHARS = 2500;
const DEFAULT_MIN_SCORE = 8;
const DEFAULT_SKILL_CACHE_TTL_MS = 30_000;

let cachedSkills: { loadedAt: number; skills: ClaudeSkill[] } | null = null;

const MARKETING_TERMS = [
  "ad", "ads", "anuncio", "anuncios", "campaign", "campana", "campanas", "cac", "roas", "cpl", "ctr",
  "creative", "creatives", "creativo", "creativos", "hooks", "offer", "oferta", "landing", "funnel",
  "meta", "google ads", "youtube", "tiktok", "linkedin", "budget", "presupuesto", "metricool", "postear",
  "publicar", "programar", "caption", "copy", "marketing",
];

const DESIGN_TERMS = [
  "design", "diseno", "diseño", "ui", "ux", "pantalla", "layout", "brand", "branding", "visual",
  "flyer", "canva", "logo", "landing page", "creative", "creativo", "assets", "mockup", "prototype",
  "prototipo", "component", "frontend", "clips", "video", "videos",
];

function normalizeText(value = ""): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readPositiveInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function skillLimits() {
  return {
    maxSkills: readPositiveInt("BLACKOPS_SKILLS_MAX_ACTIVE", DEFAULT_MAX_SKILLS, 1, 6),
    maxBodyChars: readPositiveInt("BLACKOPS_SKILLS_MAX_BODY_CHARS", DEFAULT_MAX_BODY_CHARS, 400, 4000),
    maxContextChars: readPositiveInt("BLACKOPS_SKILLS_MAX_CONTEXT_CHARS", DEFAULT_MAX_CONTEXT_CHARS, 1200, 12000),
    minScore: readPositiveInt("BLACKOPS_SKILLS_MIN_SCORE", DEFAULT_MIN_SCORE, 1, 30),
    cacheTtlMs: readPositiveInt("BLACKOPS_SKILLS_CACHE_TTL_MS", DEFAULT_SKILL_CACHE_TTL_MS, 0, 300_000),
  };
}

export function extractFrontmatter(raw: string): { metadata: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { metadata: {}, body: raw.trim() };
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (parts) metadata[parts[1]] = parts[2].replace(/^["']|["']$/g, "").trim();
  }
  return { metadata, body: raw.slice(match[0].length).trim() };
}

function scoreSkill(skill: ClaudeSkill, message: string): number {
  const haystack = normalizeText(`${skill.name} ${skill.description} ${skill.body.slice(0, 800)}`);
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) return 0;
  const messageTerms = normalizedMessage.split(/\s+/).filter((term) => term.length > 2);
  let score = 0;

  for (const term of messageTerms) {
    if (haystack.includes(term)) score += 1;
  }
  for (const term of MARKETING_TERMS) {
    if (normalizedMessage.includes(term) && haystack.includes(term)) score += 4;
  }
  for (const term of DESIGN_TERMS) {
    if (normalizedMessage.includes(term) && haystack.includes(term)) score += 4;
  }
  if (/marketing|ads|creative|campaign|metricool/.test(haystack) && MARKETING_TERMS.some((term) => normalizedMessage.includes(term))) score += 8;
  if (/design|diseno|diseño|ui|ux|visual|brand|canva/.test(haystack) && DESIGN_TERMS.some((term) => normalizedMessage.includes(term))) score += 8;
  return score;
}

export function compactSkillBody(body: string, maxChars: number): string {
  const cleaned = body
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("!`") && !trimmed.startsWith("```");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) return cleaned;

  const prioritySections = cleaned
    .split(/(?=^##\s+)/m)
    .filter((section) => /purpose|operating|rules|intent|workflow|output|routing|instructions/i.test(section.slice(0, 120)))
    .join("\n\n")
    .trim();

  const candidate = prioritySections || cleaned;
  return candidate.length <= maxChars
    ? candidate
    : `${candidate.slice(0, maxChars - 80).trim()}\n\n[Skill truncated for token budget]`;
}

async function readClaudeSkills(): Promise<ClaudeSkill[]> {
  const { cacheTtlMs } = skillLimits();
  if (cachedSkills && Date.now() - cachedSkills.loadedAt < cacheTtlMs) {
    return cachedSkills.skills;
  }

  const entries = await readdir(SKILLS_DIR, { withFileTypes: true }).catch(() => []);
  const skills: ClaudeSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    const raw = await readFile(skillPath, "utf8").catch(() => null);
    if (!raw) continue;
    const { metadata, body } = extractFrontmatter(raw);
    skills.push({
      name: metadata.name || entry.name,
      description: metadata.description || "",
      body,
      path: path.relative(process.cwd(), skillPath).replace(/\\/g, "/"),
    });
  }

  cachedSkills = { loadedAt: Date.now(), skills };
  return skills;
}

export async function buildClaudeSkillContext(message?: string): Promise<string> {
  const skills = await readClaudeSkills();
  if (skills.length === 0) return "";
  const limits = skillLimits();

  const scored = skills
    .map((skill) => ({ skill, score: scoreSkill(skill, message || "") }))
    .filter((item) => item.score >= limits.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limits.maxSkills);

  if (scored.length === 0) return "";

  const blocks = scored.map(({ skill, score }) => [
    `### ${skill.name} (score ${score})`,
    skill.description ? `Trigger: ${skill.description}` : "",
    "",
    compactSkillBody(skill.body, limits.maxBodyChars),
  ].filter(Boolean).join("\n"));

  return [
    "## Claude Skills Active For This Message",
    "Use only the selected local skill guidance below. Do not mention skills unless useful. Skills do not grant tools; use existing BlackOps routes, approvals, and integrations.",
    ...blocks,
  ].join("\n\n").slice(0, limits.maxContextChars);
}

export async function listClaudeSkillNames(): Promise<string[]> {
  return (await readClaudeSkills()).map((skill) => skill.name);
}
