function decodeDescription(description: string): string {
  return description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function cleanDjName(value: string): string | null {
  const cleaned = value
    .replace(/^[-–—:.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || /^(tba|open|empty|vacio|vacío|pending|pendiente)$/i.test(cleaned)) {
    return null;
  }

  return cleaned;
}

export function parseRadioDescription(description: string | null): { slot7: string | null; slot8: string | null; slot9: string | null } {
  if (!description) {
    return { slot7: null, slot8: null, slot9: null };
  }

  const cleanDesc = decodeDescription(description);
  let slot7: string | null = null;
  let slot8: string | null = null;
  let slot9: string | null = null;

  const normalized = cleanDesc.replace(/\r?\n/g, " ");
  // Locate all headings first: an empty slot must not consume the next heading.
  const markers = [...normalized.matchAll(/(?<!\S)([789])(?=[\s:.\-–—]|$|(?:pm|p\.m\.)(?=[\s:.\-–—]|$))(?:[ \t]*:[ \t]*00)?(?:[ \t]*(?:pm|p\.m\.))?[ \t]*(?:[:.\-–—])?[ \t]*/gi)];
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const start = marker.index! + marker[0].length;
    const end = markers[index + 1]?.index ?? normalized.length;
    const djName = cleanDjName(normalized.slice(start, end));
    const hour = Number(marker[1]);
    if (hour === 7) slot7 = djName;
    else if (hour === 8) slot8 = djName;
    else if (hour === 9) slot9 = djName;
  }

  return { slot7, slot8, slot9 };
}

