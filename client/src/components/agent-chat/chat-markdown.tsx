import { Fragment, type ReactNode } from "react";

// Small, safe markdown subset for agent replies: paragraphs, headings, lists, **bold**, `code`,
// ``` blocks and http(s) links. Builds React elements only (no raw HTML is ever injected).
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0, match: RegExpExecArray | null, i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={k} className="rounded bg-white/10 px-1 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\((.+)\)$/.exec(token)!;
      out.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{label}</a>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) blocks.push(<p key={`p${blocks.length}`} className="whitespace-pre-wrap">{inline(para.join("\n"), `p${blocks.length}`)}</p>); para = []; };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`o${blocks.length}`} className="list-decimal space-y-0.5 pl-5">{items}</ol> : <ul key={`u${blocks.length}`} className="list-disc space-y-0.5 pl-5">{items}</ul>);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flushPara(); flushList();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push(<pre key={`c${blocks.length}`} className="overflow-x-auto rounded bg-black/60 p-2 font-mono text-xs">{code.join("\n")}</pre>);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) { flushPara(); flushList(); blocks.push(<p key={`h${blocks.length}`} className="font-semibold">{inline(heading[2], `h${blocks.length}`)}</p>); }
    else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ||= { ordered, items: [] };
      list.items.push((bullet || numbered)![1]);
    } else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return <div className="space-y-2 break-words text-sm leading-6">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
