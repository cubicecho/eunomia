/**
 * The product mark: the same 10:10 clockface the tray, the installer, and the
 * favicon use (geometry mirrored from apps/app/electron/scripts/gen-tray-icon.mjs —
 * change one, change both). Strokes in `currentColor`, so it takes the color of
 * whatever text it sits beside.
 */
export function ClockMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      className={className}
      role="img"
      aria-label="eunomia"
    >
      <circle cx="16" cy="16" r="13.44" strokeWidth="3.2" />
      <path d="M16 16 24.73 10.96M16 16 10.83 12.38" strokeWidth="3.52" strokeLinecap="round" />
    </svg>
  );
}
