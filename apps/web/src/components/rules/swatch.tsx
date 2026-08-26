/** The dot that ties a category name to the color it gets in the charts. */
export function Swatch({ color }: { color: string }) {
  return (
    <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
  );
}
