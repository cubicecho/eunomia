/**
 * Chart color, assigned by the job it does.
 *
 * Categories are an identity encoding, so a category keeps its color wherever
 * it appears and whatever else is on screen: the user's own color when they
 * picked one, otherwise a fixed slot chosen by a stable hash of the category
 * id — never by rank, which would repaint the survivors every time a filter
 * changes the series count.
 *
 * The eight slots are the validated categorical set, stepped for this app's
 * card surface (#161b22) and kept in this order on purpose: the ordering is
 * what keeps adjacent slots apart under color-vision deficiency. Verified with
 * the palette validator against #161b22 — all eight pass the lightness band,
 * chroma floor, adjacent CVD separation (worst ΔE 8.4), normal-vision floor
 * (worst 19.3) and 3:1 contrast.
 */
export const CHART_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
] as const;

/** Uncategorized time is absence, not a ninth category — it stays neutral. */
export const UNCATEGORIZED_COLOR = '#8b949e';

/** Stable, order-independent slot for a category that has no color of its own. */
function slotFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CHART_COLORS[hash % CHART_COLORS.length] as string;
}

export function categoryColor(id: string | null, color: string | null): string {
  if (id === null) return UNCATEGORIZED_COLOR;
  return color ?? slotFor(id);
}
