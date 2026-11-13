import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "tutorials", "dropshipping-ceo-tutorial");
mkdirSync(outDir, { recursive: true });

const W = 1280;
const H = 720;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrap(text, max = 58) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(lines, x, y, opts = {}) {
  const size = opts.size || 32;
  const fill = opts.fill || "#f6f7f9";
  const weight = opts.weight || 500;
  const gap = opts.gap || Math.round(size * 1.35);
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`)
    .join("\n");
}

function bulletList(items, x, y) {
  return items
    .map((item, index) => {
      const yy = y + index * 58;
      return `
        <circle cx="${x}" cy="${yy - 9}" r="6" fill="#12d692"/>
        ${textBlock(wrap(item, 64), x + 26, yy, { size: 26, fill: "#e7e8ec", gap: 34 })}
      `;
    })
    .join("\n");
}

function card(x, y, w, h, title, body, accent = "#12d692") {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#15151a" stroke="#282a32" stroke-width="2"/>
    <rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>
    <text x="${x + 26}" y="${y + 42}" font-size="24" font-weight="700" fill="#ffffff">${esc(title)}</text>
    ${textBlock(wrap(body, Math.floor((w - 52) / 13)), x + 26, y + 82, { size: 21, fill: "#b9bcc6", gap: 29 })}
  `;
}

const slides = [
  {
    title: "Dropshipping CEO",
    kicker: "Tutorial rapido",
    body: [
      "Este app es tu tablero para investigar productos, preparar lanzamientos y evitar gastar antes de tener aprobacion.",
      "La regla central: primero cobrar, luego comprar al proveedor, y solo gastar ads con Profit Guard."
    ],
    footer: "URL: robplanner.replit.app/dropshipping-ceo"
  },
  {
    title: "1. Lee el dashboard",
    body: [
      "Meta mensual: cuanto falta para llegar a $1,000.",
      "Cash cobrado: dinero real recibido.",
      "Gasto: lo usado del budget de $100.",
      "Ordenes, Shopify y Social: progreso operativo.",
      "Profit Guard decide si puedes gastar ahora."
    ],
    cards: [
      ["Cash", "No cuenta promesa: cuenta dinero cobrado.", "#7dd3fc"],
      ["Gasto", "Mantener $0 hasta producto + approval.", "#facc15"],
      ["Profit Guard", "Si dice $0 permitido, no activar ads.", "#12d692"]
    ]
  },
  {
    title: "2. Empieza cada dia aqui",
    body: [
      "Run CEO cycle: analiza el negocio y crea la siguiente orden.",
      "Run operating day: prepara trabajo diario sin publicar ni gastar solo porque si.",
      "Si aparece approval queue, resuelvela antes de avanzar."
    ],
    cards: [
      ["Run CEO cycle", "Usalo para investigar y decidir foco.", "#12d692"],
      ["Run operating day", "Usalo para preparar el dia operativo.", "#34d399"]
    ]
  },
  {
    title: "3. Productos",
    body: [
      "En Productos, usa Run Product Scout para buscar candidatos.",
      "Promote Candidate convierte uno bueno en producto real.",
      "Mira margen, shipping, riesgo legal, riesgo de calidad y si necesita sample."
    ],
    cards: [
      ["Buen producto", "Problema visible + margen alto + shipping razonable.", "#12d692"],
      ["No pasar", "Claims peligrosos, copia de marca, mala calidad o entrega lenta.", "#fb7185"]
    ]
  },
  {
    title: "4. Suppliers",
    body: [
      "AliExpress puede hacer el delivery, pero tu tienda sigue siendo responsable ante el cliente.",
      "Revisa rating, reviews, dias de envio, politica de returns y proveedor backup.",
      "Cuando haya orden pagada, compras 1 unidad al supplier y pones la direccion del cliente."
    ],
    cards: [
      ["Supplier principal", "Precio + envio + reviews aceptables.", "#7dd3fc"],
      ["Backup", "Otro proveedor por si el primero falla.", "#facc15"]
    ]
  },
  {
    title: "5. Launch",
    body: [
      "Build launch pack crea el paquete: Shopify preflight, contenido, campana y capital plan.",
      "Queue approvals envia las acciones que necesitan tu permiso.",
      "Sin approvals, el app se queda en draft/preflight."
    ],
    cards: [
      ["Draft primero", "Preparar no es lo mismo que publicar.", "#12d692"],
      ["Approvals", "Tu permiso antes de publicar, gastar o pedir sample.", "#facc15"]
    ]
  },
  {
    title: "6. Shopify",
    body: [
      "Shopify Preflight revisa si el producto esta listo.",
      "Create Shopify Draft crea o prepara el draft si las credenciales estan listas.",
      "No publiques producto externo hasta que el producto, supplier y policies esten aprobados."
    ],
    cards: [
      ["Preflight", "Chequeo antes de tocar tienda real.", "#7dd3fc"],
      ["Draft", "Pagina preparada, no necesariamente publicada.", "#12d692"]
    ]
  },
  {
    title: "7. Social y Campanas",
    body: [
      "Crea posts organicos primero para medir hooks sin gastar.",
      "Registra views, clicks, ordenes y revenue.",
      "Ads de $100 solo se preparan cuando hay approval, cash permitido y regla de kill-switch."
    ],
    cards: [
      ["Organic first", "TikTok, IG, Shorts, Pinterest: probar hooks.", "#12d692"],
      ["Paid test", "Micro-test controlado, no gasto completo de golpe.", "#facc15"]
    ]
  },
  {
    title: "8. Cuando llega una venta",
    body: [
      "En Orders registra la orden pagada.",
      "En Fulfillment preparas la compra al proveedor.",
      "Compras el producto despues de cobrar, agregas tracking y actualizas el pedido."
    ],
    cards: [
      ["Cliente paga", "Entra cash y se crea la orden.", "#12d692"],
      ["Proveedor envia", "AliExpress/DSers/CJ/Zendrop cumplen delivery.", "#7dd3fc"],
      ["Tu control", "Seguimiento, soporte y refund policy.", "#facc15"]
    ]
  },
  {
    title: "Tu rutina de arranque",
    body: [
      "1. Run CEO cycle.",
      "2. Productos: Run Product Scout y elegir 1 candidato.",
      "3. Suppliers: validar proveedor y backup.",
      "4. Launch: Build launch pack y Queue approvals.",
      "5. Social: preparar posts organicos.",
      "6. Solo ads cuando Profit Guard permita gastar."
    ],
    footer: "Primera meta: validar 1 producto sin comprar inventario."
  }
];

function renderSlide(slide, index) {
  const filename = `slide-${String(index + 1).padStart(2, "0")}`;
  const titleY = slide.kicker ? 246 : 190;
  const yStart = slide.kicker ? 325 : 278;
  const body = slide.body ? bulletList(slide.body, 88, yStart) : "";
  const cards = slide.cards
    ? slide.cards.map((args, i) => card(730, 218 + i * 142, 440, 112, ...args)).join("\n")
    : "";
  const footer = slide.footer
    ? `<text x="80" y="648" font-size="25" fill="#9ca3af">${esc(slide.footer)}</text>`
    : "";
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#08090b"/>
  <rect x="0" y="0" width="${W}" height="720" fill="#0b0b0f"/>
  <circle cx="1135" cy="85" r="118" fill="#0f513c" opacity="0.35"/>
  <circle cx="1080" cy="610" r="160" fill="#1f2937" opacity="0.24"/>
  <rect x="54" y="48" width="1172" height="624" rx="28" fill="#101116" stroke="#24262f" stroke-width="2"/>
  <rect x="80" y="76" width="58" height="58" rx="14" fill="#12d692"/>
  <text x="156" y="116" font-size="24" fill="#c7cad1">robplanner.replit.app/dropshipping-ceo</text>
  ${slide.kicker ? `<text x="80" y="184" font-size="28" font-weight="700" fill="#12d692">${esc(slide.kicker)}</text>` : ""}
  <text x="80" y="${titleY}" font-size="${slide.kicker ? 58 : 48}" font-weight="800" fill="#ffffff">${esc(slide.title)}</text>
  ${slide.kicker ? "" : `<line x1="80" y1="216" x2="520" y2="216" stroke="#12d692" stroke-width="4"/>`}
  ${body}
  ${cards}
  ${footer}
</svg>`;
  const svgPath = path.join(outDir, `${filename}.svg`);
  const pngPath = path.join(outDir, `${filename}.png`);
  writeFileSync(svgPath, svg.trim());
  execFileSync("magick", [svgPath, "-resize", `${W}x${H}!`, pngPath], { stdio: "inherit" });
  return pngPath;
}

const pngs = slides.map(renderSlide);
const concatPath = path.join(outDir, "slides.txt");
const concat = pngs
  .map((png, index) => `file '${png.replaceAll("'", "'\\''")}'\nduration ${index === 0 ? 8 : 12.5}`)
  .join("\n") + `\nfile '${pngs.at(-1).replaceAll("'", "'\\''")}'\n`;
writeFileSync(concatPath, concat);

const script = `# Dropshipping CEO - Guion del tutorial

1. Abre https://robplanner.replit.app/dropshipping-ceo.
2. Lee primero Profit Guard: si puede gastar ahora dice $0, no activamos ads.
3. Pulsa Run CEO cycle para que el agente decida el siguiente foco.
4. En Productos, corre Product Scout y promueve solo un candidato fuerte.
5. En Suppliers, valida proveedor, tiempos de envio, reviews y backup.
6. En Launch, usa Build launch pack y luego Queue approvals.
7. En Shopify, corre Preflight antes de crear o publicar drafts.
8. En Social y Campanas, prepara posts organicos y mide data antes de ads.
9. Cuando llegue una orden pagada, registrala en Orders y compra al proveedor desde Fulfillment.
10. Escala solo con ordenes reales, profit positivo, approvals limpias y Profit Guard.
`;
writeFileSync(path.join(outDir, "guion.md"), script);

const videoPath = path.join(outDir, "dropshipping-ceo-tutorial.mp4");
execFileSync("ffmpeg", [
  "-y",
  "-f", "concat",
  "-safe", "0",
  "-i", concatPath,
  "-vf", "fps=30,format=yuv420p",
  "-movflags", "+faststart",
  videoPath
], { stdio: "inherit" });

console.log(videoPath);
