const NETWORK_BY_FILENAME = [
  { pattern: /^tiktok-posts_.+\.csv$/i, network: "tiktok" },
  { pattern: /^facebook-(?:posts|reels)_.+\.csv$/i, network: "facebook" },
  { pattern: /^youtube-published-videos-posts_.+\.csv$/i, network: "youtube" },
];

function cleanHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function cleanNumber(value) {
  const normalized = String(value ?? "").replace(/[,\s]/g, "");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanSeconds(value) {
  const raw = String(value ?? "").trim();
  if (/^\d+:\d{2}(?::\d{2})?$/.test(raw)) {
    const parts = raw.split(":").map(Number);
    if (parts.slice(1).some((part) => part >= 60)) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
  }
  return cleanNumber(value);
}

function first(row, names) {
  const normalizedRow = new Map(Object.entries(row).map(([key, value]) => [
    String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value,
  ]));
  for (const name of names) {
    const value = row[name] ?? normalizedRow.get(String(name).toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function isoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw);
  const normalized = local ? `${local[1]}T${local[2]}:${local[3] || "00"}` : raw;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? normalized : undefined;
}

export function parseMetricoolCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = (rows.shift() || []).map(cleanHeader);
  return rows
    .filter((values) => values.some((value) => String(value).trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function classifyMetricoolCsv(filename) {
  return NETWORK_BY_FILENAME.find(({ pattern }) => pattern.test(String(filename || "")))?.network || null;
}

export function extractMetricoolCsvSamples(filename, text) {
  const network = classifyMetricoolCsv(filename);
  if (!network) return null;
  const samples = new Map();
  for (const row of parseMetricoolCsv(text)) {
    const id = network === "tiktok"
      ? first(row, ["URL", "Link"])
      : network === "facebook"
        ? first(row, ["PostLink", "Reel Link"])
        : first(row, ["videoId", "watchUrl"]);
    const views = network === "tiktok"
      ? cleanNumber(first(row, ["Views"]))
      : network === "facebook"
        ? cleanNumber(first(row, ["VideoViews", "Video Views"]))
        : cleanNumber(first(row, ["views"]));
    if (!id || views == null) continue;
    const durationSeconds = cleanSeconds(first(row, ["Duration", "Video duration", "Video duration (seconds)"]));
    const optionalMetric = (names) => cleanNumber(first(row, names));
    const likes = optionalMetric(["Likes", "Reactions"]);
    const comments = optionalMetric(["Comments"]);
    const shares = optionalMetric(["Shares"]);
    const reach = optionalMetric(["Reach"]);
    const impressions = optionalMetric(["Impressions"]);
    const averageWatchSeconds = cleanSeconds(first(row, ["Avg. time watched (Seconds)", "Average watch time", "Average view duration", "Avg. views duration", "Average time watched"]));
    const rawCompletion = first(row, ["Completion rate", "Watched full video percentage", "Average percentage viewed"]);
    const completionRate = cleanNumber(rawCompletion.replace(/%$/, ""));
    const engagements = [likes, comments, shares].reduce((total, value) => total + (value || 0), 0);
    const engagementRate = views > 0 && engagements > 0 ? engagements / views : undefined;
    const references = [...new Set(Object.values(row).flatMap((value) => String(value).match(/\bBR-[a-f0-9]{12}\b/g) || []))];
    samples.set(id, {
      id,
      ...(references.length === 1 ? { learningReference: references[0] } : {}),
      views: Math.floor(views),
      publishedAt: isoDate(first(row, ["Date", "publishedAt"])),
      ...(durationSeconds != null && durationSeconds > 0
        ? { durationSeconds: Math.min(86_400, Math.round(durationSeconds)) }
        : {}),
      ...(likes != null ? { likes: Math.floor(likes) } : {}),
      ...(comments != null ? { comments: Math.floor(comments) } : {}),
      ...(shares != null ? { shares: Math.floor(shares) } : {}),
      ...(reach != null ? { reach: Math.floor(reach) } : {}),
      ...(impressions != null ? { impressions: Math.floor(impressions) } : {}),
      ...(averageWatchSeconds != null ? { averageWatchSeconds } : {}),
      ...(completionRate != null ? { completionRate: completionRate > 1 || rawCompletion.endsWith("%") ? completionRate / 100 : completionRate } : {}),
      ...(engagementRate != null ? { engagementRate } : {}),
    });
  }
  return { network, samples: [...samples.values()] };
}
