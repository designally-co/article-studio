import type { CSSProperties } from "react";

/* The disc version (`Mark`) is gone with the old sign-in page, the one place it
   stood; the flat mark below is the only mark the product draws now. */

/**
 * The mark with no disc under it — the D in ink, the full stop in the accent.
 *
 * The chrome version, and the platform's own reasoning applies here unchanged:
 * on a rail whose other controls are small and quiet, a disc filled solid
 * orange is the heaviest thing on the screen, and it is fuller than its
 * neighbours besides — the mark takes 56% of its disc where an icon takes 45%.
 *
 * It is the same artwork, not a second asset. `designally-mark.png` is a white
 * D. on transparency, so it cannot simply be recoloured — but it splits: the
 * drawing holds exactly two runs of ink with a gap between them at 73.79% of
 * the width. Two layers masked by the same file and clipped either side of
 * that gap give each its own colour, and the drawing stays the drawing.
 *
 * `Mark` keeps the disc and is still right where it stands alone with nothing
 * to be heavy beside — the sign-in page.
 */
export function FlatMark({
  size = 32,
  decorative = false,
}: {
  size?: number;
  /** Beside the `Wordmark`, which already says the name once. */
  decorative?: boolean;
}) {
  return (
    <span
      className="dmark shrink-0"
      style={{ "--dmark-w": `${size}px` } as CSSProperties}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Designally"}
      aria-hidden={decorative || undefined}
    >
      <i className="dm-d" />
      <i className="dm-dot" />
    </span>
  );
}

/**
 * The wordmark — DESIGNALLY. in caps, the final logo supplied on 15 October
 * 2026. It stands wherever "Designally" was set as the caps eyebrow (the rail,
 * the drawer) and on the sign-in plate. Square slots keep `FlatMark`: there is
 * no square version of this drawing.
 *
 * Drawn inline, in the flat mark's two colours (`.dwordmark` in globals.css):
 * the letters in charcoal, the stop in the mark orange. The white outline the
 * export left around the Y is dropped. Set the width; the height follows the
 * drawing's 739 x 79.06.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`dwordmark ${className}`}
      viewBox="0 0 739 79.06"
      role="img"
      aria-label="Designally"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M58.73,5.77c-6.92-3.23-15.1-4.87-24.32-4.87H0v76.56h34.42c9.14,0,17.27-1.67,24.18-4.98,6.87-3.28,12.25-7.87,15.98-13.63,3.73-5.75,5.62-12.39,5.62-19.73s-1.87-14.1-5.55-19.85c-3.69-5.75-9.04-10.29-15.9-13.5ZM50.5,54.92c-4.37,3.68-10.42,5.54-18,5.54h-9.87V17.55h9.87c7.57,0,13.63,1.88,18,5.6,4.43,3.77,6.67,9.14,6.67,15.97s-2.25,12.07-6.68,15.8ZM91.53,77.77L149.88,77.77L149.88,62.57L116.73,62.57L115.54,62.57L115.54,61.38L115.54,47.16L115.54,45.97L116.73,45.97L145.84,45.97L145.84,31.67L116.73,31.67L115.54,31.67L115.54,30.48L115.54,17.6L115.54,16.41L116.73,16.41L149.88,16.41L149.88,1.22L91.53,1.22L91.53,77.77ZM313.85,48.75h25.39l-.91,1.74c-3.87,7.41-10.41,11.16-19.42,11.16-7.53,0-13.38-1.92-17.38-5.7-4.02-3.8-6.06-9.36-6.06-16.54,0-6.41,1.9-11.6,5.65-15.43,3.76-3.84,8.94-5.79,15.41-5.79,3.49,0,6.58.61,9.18,1.81,2.44,1.12,4.43,2.72,5.93,4.76h24.25c-1.88-7.35-6.13-13.28-12.66-17.63-7.02-4.67-16.04-7.04-26.83-7.04-8.6,0-16.28,1.69-22.83,5.02-6.52,3.32-11.63,8-15.2,13.93-3.58,5.93-5.39,12.79-5.39,20.38s1.81,14.56,5.39,20.49c3.57,5.93,8.71,10.61,15.26,13.93,6.59,3.33,14.29,5.02,22.89,5.02,7.05,0,13.42-1.17,18.91-3.47,7.57-3.17,12.39-7.59,13.68-8.86l.13-.13c5.05-5.02,7.95-12.06,7.95-19.33v-11.89h-43.35v13.58ZM420.84,44.25L420.84,48.24L418.66,44.9L390.02,1.22L370.08,1.22L370.08,76.97L389.47,76.97L389.47,34.5L389.47,30.55L391.65,33.84L420.29,76.97L440.24,76.97L440.24,1.22L420.84,1.22L420.84,44.25ZM479.29,1.76l-30.01,75.75h22.22l4.29-11.96.28-.79h31.78l.28.79,4.29,11.96h22.34L504.89,1.76h-25.6ZM501.12,50.53h-19.87l.57-1.59,9.03-25.27,1.11-3.12,1.13,3.11,9.15,25.27.58,1.6h-1.7ZM668.97,77.49L668.97,48.7L639.86,1.12L664.66,1.12L680.19,29.82L695.71,1.12L720.15,1.12L690.93,48.89L690.93,71.01L690.85,71.01L690.85,77.49L668.97,77.49ZM564.29,60.17v-1.19s-.2-57.65-.2-57.65l-20.36.07c.06,25.16.11,50.31.17,75.47h.09c16.97,0,33.94,0,50.91,0v-16.71h-29.43s-1.19,0-1.19,0ZM624.87,60.6v-1.19s-.2-57.65-.2-57.65l-20.36.07c.06,25.16.11,50.31.17,75.47h.09c16.97,0,33.94,0,50.91,0v-16.71h-29.43s-1.19,0-1.19,0ZM240.96,1.35h19.71v76.56h-19.71ZM223.23,44.6c-2.56-2.9-5.64-5.19-9.18-6.8-3.63-1.66-8.32-3.36-13.96-5.07-3.84-1.2-6.79-2.22-8.78-3.02-2.06-.83-3.82-1.84-5.23-3-1.6-1.32-2.41-2.93-2.41-4.8,0-2.17.75-3.88,2.22-5.09,1.41-1.15,3.21-1.73,5.35-1.73,2.72,0,5,.69,6.79,2.05,1.6,1.22,2.56,2.95,2.86,5.16h0v2.36h24.83c.06-2.28-.15-6.9-2.91-11.57-.46-.78-2.25-3.87-6.52-6.81-6.02-4.16-14.24-6.27-24.41-6.27-6.29,0-12,.92-16.95,2.74-4.88,1.79-8.74,4.45-11.48,7.9-2.71,3.41-4.08,7.58-4.08,12.38s1.26,8.57,3.73,11.44c2.55,2.97,5.59,5.25,9.03,6.79,3.55,1.58,8.29,3.25,14.09,4.96,5.57,1.59,9.68,3.06,12.21,4.36,2.86,1.48,4.32,3.63,4.35,6.4.02,2.02-.85,3.87-2.47,5.07-1.73,1.28-3.96,1.93-6.63,1.93-2.82,0-5.17-.73-6.99-2.17-.73-.58-1.33-1.29-1.82-2.12-.8-1.38-1.1-3-1.1-4.59v-3.19h-24.59v3.11c0,.41.01.81.05,1.21.22,2.22.89,5.68,3.06,9.24.63,1.04,2.54,4.17,7.15,7.19,6.49,4.24,14.95,6.4,25.14,6.4,6.7,0,12.58-1.07,17.47-3.17,4.84-2.08,8.58-4.94,11.12-8.5,2.52-3.53,3.8-7.58,3.8-12.04s-1.25-7.96-3.72-10.76Z"
        fill="currentColor"
      />
      <ellipse cx="722.79" cy="60.57" rx="16.21" ry="16.4" fill="var(--wordmark-dot)" />
    </svg>
  );
}
