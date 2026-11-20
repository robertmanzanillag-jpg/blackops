import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

// Floating office panels the owner can drag (mouse, pen or touch). The panel keeps its
// default Tailwind position until it is moved; then it is placed with absolute left/top inside
// its offsetParent (the office map; `position: fixed` would not follow the viewport there because
// the map has a CSS perspective), clamped to the part of that container that is on screen, and
// the position is remembered per panel in localStorage.
// Storage can be unavailable (private mode, blocked site data): every access is guarded.

export type PanelOffset = { x: number; y: number };
/** v2: offsets are relative to the panel's container (v1 stored viewport offsets). */
const STORAGE_PREFIX = "agentsOffice.panelPosition.v2:";
const MARGIN = 8;
/**
 * Bottom band no floating panel may enter: the "Fábrica de software" button (bottom-left) and a
 * bottom-right chat launcher live there. 4.5rem = 72 px.
 */
export const PANEL_BOTTOM_RESERVE = 72;
/** A dragged panel may be placed as low as this much height above the reserved band; it then scrolls. */
export const PANEL_MIN_HEIGHT = 120;

/** Area the panel may occupy, in container coordinates (left/top default to 0). */
export type PanelArea = { width: number; height: number; left?: number; top?: number };

/**
 * Keeps at least `MARGIN` px of the panel inside the area (pure; tested). With `reserveBottom`
 * the bottom band of that height is off limits: the panel's top stays high enough that
 * `PANEL_MIN_HEIGHT` px fit above the band (the panel's max-height then shrinks to fit).
 */
export function clampPanelPosition(position: PanelOffset, size: { width: number; height: number }, area: PanelArea, reserveBottom = 0): PanelOffset {
  const left = area.left ?? 0;
  const top = area.top ?? 0;
  const usableHeight = Math.max(2 * MARGIN, area.height - reserveBottom);
  const minX = left + MARGIN;
  const minY = top + MARGIN;
  const maxX = Math.max(minX, left + area.width - size.width - MARGIN);
  const keptHeight = reserveBottom > 0 ? Math.min(size.height, PANEL_MIN_HEIGHT) : size.height;
  const maxY = Math.max(minY, top + usableHeight - Math.min(keptHeight, usableHeight - 2 * MARGIN) - MARGIN);
  return { x: Math.round(Math.min(Math.max(minX, position.x), maxX)), y: Math.round(Math.min(Math.max(minY, position.y), maxY)) };
}

/**
 * The visible part of the container (its padding box at `origin`, client coordinates) in container
 * coordinates; the whole container when none of it is on screen (pure; tested).
 */
export function visiblePanelArea(origin: { left: number; top: number }, container: { width: number; height: number }, viewport: { width: number; height: number }): Required<PanelArea> {
  const left = Math.max(0, -origin.left);
  const top = Math.max(0, -origin.top);
  const right = Math.min(container.width, viewport.width - origin.left);
  const bottom = Math.min(container.height, viewport.height - origin.top);
  if (right - left < 2 * MARGIN || bottom - top < 2 * MARGIN) return { left: 0, top: 0, width: container.width, height: container.height };
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Max height (px) a panel whose top edge is at `panelTop` (container coordinates) may take so it
 * ends `reserveBottom` px above the bottom of the visible area (pure; tested).
 */
export function availablePanelHeight(panelTop: number, area: Required<PanelArea>, reserveBottom = PANEL_BOTTOM_RESERVE): number {
  return Math.max(PANEL_MIN_HEIGHT / 2, Math.floor(area.top + area.height - reserveBottom - panelTop));
}

export function parseStoredPanelPosition(raw: string | null): PanelOffset | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PanelOffset> | null;
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y) } : null;
  } catch {
    return null;
  }
}

function readStored(id: string): PanelOffset | null {
  try { return parseStoredPanelPosition(window.localStorage.getItem(STORAGE_PREFIX + id)); } catch { return null; }
}
function writeStored(id: string, value: PanelOffset | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_PREFIX + id);
  } catch { /* Position stays for this visit only. */ }
}

/** Client-coordinate origin and size of the element's containing block (its offsetParent's padding box). */
function containerFrame(element: HTMLElement | null) {
  const parent = (element?.offsetParent as HTMLElement | null) ?? null;
  if (!parent) return { origin: { left: 0, top: 0 }, size: { width: window.innerWidth, height: window.innerHeight } };
  const rect = parent.getBoundingClientRect();
  return { origin: { left: rect.left + parent.clientLeft, top: rect.top + parent.clientTop }, size: { width: parent.clientWidth, height: parent.clientHeight } };
}

export function useDraggablePanel(id: string) {
  const ref = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<PanelOffset | null>(() => (typeof window === "undefined" ? null : readStored(id)));
  const [available, setAvailable] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null);

  const visibleArea = () => {
    const frame = containerFrame(ref.current);
    return visiblePanelArea(frame.origin, frame.size, { width: window.innerWidth, height: window.innerHeight });
  };
  const clampToContainer = useCallback((next: PanelOffset) => {
    const box = ref.current?.getBoundingClientRect();
    return clampPanelPosition(next, { width: box?.width ?? 320, height: box?.height ?? 200 }, visibleArea(), PANEL_BOTTOM_RESERVE);
  }, []);

  // Cap the panel's height (CSS variable --float-avail) so its bottom edge always stays above the
  // reserved bottom band, wherever it sits and however much content it has; the panel scrolls instead.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = availablePanelHeight(element.offsetTop, visibleArea());
      setAvailable(current => (current === next ? current : next));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const parent = element.offsetParent;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (parent) observer?.observe(parent);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [position?.x, position?.y]);

  // Re-clamp a remembered position when the window shrinks (rotating a phone, resizing).
  useEffect(() => {
    if (!position) return;
    const onResize = () => setPosition(current => (current ? clampToContainer(current) : current));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // Only (re)subscribe when dragging starts or stops being active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(position), clampToContainer]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    // Buttons and inputs inside the handle keep working as usual.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { pointerId: event.pointerId, dx: event.clientX - box.left, dy: event.clientY - box.top };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Older browsers drag without capture. */ }
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Read the container every move: the page may have scrolled since the drag started.
    const { origin } = containerFrame(ref.current);
    setPosition(clampToContainer({ x: event.clientX - current.dx - origin.left, y: event.clientY - current.dy - origin.top }));
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Capture already released. */ }
    setPosition(value => { if (value) writeStored(id, value); return value; });
  };
  const reset = () => { setPosition(null); writeStored(id, null); };

  const style = {
    ...(position ? { position: "absolute", left: position.x, top: position.y, right: "auto", bottom: "auto" } : {}),
    ...(available !== null ? { "--float-avail": `${available}px` } : {}),
  } as CSSProperties;
  const handleProps = {
    onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag,
    style: { touchAction: "none", cursor: "grab" } as CSSProperties,
    title: "Arrastra para mover este panel",
  };
  return { ref, style, handleProps, moved: Boolean(position), reset };
}
