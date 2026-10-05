/**
 * A small drawing of what a wait is doing — reading, researching, planning,
 * writing — so the card has something moving that means something, not only
 * a bar.
 *
 * Minimal on purpose: a page, a few lines, one moving accent. Drawn with the
 * theme's tokens, animated with transform, opacity and stroke-dashoffset only
 * (globals.css, `.cs-art-*`), and still under reduced motion, where each
 * drawing rests in its finished state.
 */
export type WorkArtKind =
  | "reading"
  | "research"
  | "outline"
  | "writing"
  | "assemble"
  | "upload"
  | "send"
  | "paint"
  | "brief"
  | "photos"
  | "enlarge";

const LINE = { stroke: "var(--ink-200)", strokeWidth: 4, strokeLinecap: "round" as const };
const ACCENT = "var(--accent)";

/** A small picture: a frame, a sun and two hills. */
function Picture({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx="6" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />
      <circle cx={x + w * 0.72} cy={y + h * 0.3} r={Math.min(w, h) * 0.1} fill="var(--accent-soft)" />
      <path
        d={`M${x + 5} ${y + h - 5} L${x + w * 0.36} ${y + h * 0.5} L${x + w * 0.58} ${y + h * 0.75} L${x + w * 0.72} ${y + h * 0.62} L${x + w - 5} ${y + h - 5} Z`}
        fill="var(--ink-200)"
      />
    </>
  );
}

function Page() {
  return <rect x="40" y="8" width="80" height="84" rx="8" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />;
}

export function WorkArt({ kind, width = 160 }: { kind: WorkArtKind; width?: number }) {
  return (
    <svg
      viewBox="0 0 160 100"
      width={width}
      height={(width * 100) / 160}
      aria-hidden="true"
      className="mx-auto block overflow-visible"
    >
      {kind === "reading" && (
        <>
          <Page />
          {[26, 38, 50, 62, 74].map((y, i) => (
            <line key={y} x1="52" x2={[108, 100, 106, 94, 102][i]} y1={y} y2={y} {...LINE} />
          ))}
          {/* The reader's eye, moving down the page. */}
          <rect className="cs-art-scan" x="47" y="20" width="66" height="12" rx="4" fill={ACCENT} opacity="0.16" />
        </>
      )}

      {kind === "research" && (
        <>
          {/* Three sources, slightly fanned. */}
          {[
            { x: 14, y: 22, r: -6 },
            { x: 58, y: 14, r: 0 },
            { x: 102, y: 22, r: 6 },
          ].map((card) => (
            <g key={card.x} transform={`rotate(${card.r} ${card.x + 22} ${card.y + 32})`}>
              <rect x={card.x} y={card.y} width="44" height="64" rx="6" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />
              {[0, 1, 2].map((i) => (
                <line key={i} x1={card.x + 8} x2={card.x + [36, 30, 33][i]} y1={card.y + 16 + i * 11} y2={card.y + 16 + i * 11} {...LINE} strokeWidth={3} />
              ))}
            </g>
          ))}
          <g className="cs-art-search">
            <circle cx="80" cy="50" r="12" fill="var(--surface)" fillOpacity="0.6" stroke={ACCENT} strokeWidth="3" />
            <line x1="89" y1="59" x2="98" y2="68" stroke={ACCENT} strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </>
      )}

      {kind === "outline" && (
        <>
          <Page />
          {[28, 48, 68].map((y, i) => (
            <g key={y} className="cs-art-pop" style={{ animationDelay: `${i * 0.45}s` }}>
              <circle cx="55" cy={y} r="3.5" fill={ACCENT} />
              <line x1="64" x2={[106, 98, 102][i]} y1={y} y2={y} {...LINE} />
              <line x1="64" x2={[92, 96, 86][i]} y1={y + 9} y2={y + 9} {...LINE} strokeWidth={3} opacity="0.7" />
            </g>
          ))}
        </>
      )}

      {kind === "writing" && (
        <>
          <Page />
          {[24, 36, 48, 60].map((y, i) => (
            <line
              key={y}
              className="cs-art-write"
              style={{ animationDelay: `${i * 0.5}s` }}
              pathLength={1}
              x1="52"
              x2={[108, 102, 106, 88][i]}
              y1={y}
              y2={y}
              {...LINE}
              stroke={i === 3 ? "var(--ink-300)" : LINE.stroke}
            />
          ))}
          {/* The cursor, where the next line will start. */}
          <rect className="cs-art-caret" x="52" y="68" width="2.5" height="11" rx="1" fill={ACCENT} />
        </>
      )}

      {kind === "assemble" && (
        <>
          <Page />
          {/* The title, then the body, settling into place. */}
          <g className="cs-art-pop">
            <line x1="52" x2="96" y1="24" y2="24" stroke={ACCENT} strokeWidth="5" strokeLinecap="round" />
          </g>
          {[40, 52, 64, 76].map((y, i) => (
            <g key={y} className="cs-art-pop" style={{ animationDelay: `${(i + 1) * 0.3}s` }}>
              <line x1="52" x2={[108, 102, 106, 90][i]} y1={y} y2={y} {...LINE} />
            </g>
          ))}
        </>
      )}

      {kind === "upload" && (
        <>
          {/* The cover: a picture, and the arrow taking it up. */}
          <rect x="44" y="30" width="72" height="56" rx="8" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />
          <circle cx="96" cy="46" r="6" fill="var(--accent-soft)" />
          <path d="M50 80 L70 58 L84 72 L92 64 L110 80 Z" fill="var(--ink-200)" />
          <g className="cs-art-rise">
            <line x1="80" y1="22" x2="80" y2="4" stroke={ACCENT} strokeWidth="3.5" strokeLinecap="round" />
            <path d="M72 11 L80 3 L88 11" fill="none" stroke={ACCENT} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </>
      )}

      {kind === "send" && (
        <>
          {/* The Hub: a ring the page travels into. */}
          <circle cx="128" cy="50" r="20" fill="var(--accent-tint)" stroke={ACCENT} strokeWidth="2" />
          <circle cx="128" cy="50" r="7" fill={ACCENT} />
          <line x1="58" x2="100" y1="50" y2="50" stroke="var(--ink-200)" strokeWidth="2.5" strokeDasharray="2 6" strokeLinecap="round" />
          <g className="cs-art-travel">
            <rect x="14" y="30" width="32" height="40" rx="5" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />
            {[40, 48, 56].map((y, i) => (
              <line key={y} x1="20" x2={[40, 36, 38][i]} y1={y} y2={y} {...LINE} strokeWidth={3} />
            ))}
          </g>
        </>
      )}
      {kind === "paint" && (
        <>
          {/* A canvas taking colour, one stroke at a time. */}
          <rect x="34" y="10" width="92" height="80" rx="8" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />
          {[
            { d: "M48 32 C58 26, 70 36, 84 30 S104 26, 112 30", stroke: "var(--ink-200)", w: 7 },
            { d: "M46 52 C60 42, 74 58, 90 48 S108 44, 114 48", stroke: "var(--accent-soft)", w: 9 },
            { d: "M48 72 C62 62, 76 78, 92 66 S108 62, 112 66", stroke: ACCENT, w: 6 },
          ].map((stroke, i) => (
            <path
              key={i}
              className="cs-art-write"
              style={{ animationDelay: `${i * 0.5}s` }}
              pathLength={1}
              d={stroke.d}
              fill="none"
              stroke={stroke.stroke}
              strokeWidth={stroke.w}
              strokeLinecap="round"
            />
          ))}
        </>
      )}

      {kind === "brief" && (
        <>
          {/* The picture to be made, and its description being written. */}
          <Picture x={12} y={24} w={60} h={52} />
          {[32, 44, 56, 68].map((y, i) => (
            <line
              key={y}
              className="cs-art-write"
              style={{ animationDelay: `${i * 0.45}s` }}
              pathLength={1}
              x1="84"
              x2={[146, 138, 142, 120][i]}
              y1={y}
              y2={y}
              {...LINE}
            />
          ))}
          <rect className="cs-art-caret" x="84" y="74" width="2.5" height="10" rx="1" fill={ACCENT} />
        </>
      )}

      {kind === "photos" && (
        <>
          {/* Photographs, slightly fanned, and the search moving across them. */}
          {[
            { x: 14, y: 26, r: -6 },
            { x: 58, y: 18, r: 0 },
            { x: 102, y: 26, r: 6 },
          ].map((photo) => (
            <g key={photo.x} transform={`rotate(${photo.r} ${photo.x + 22} ${photo.y + 26})`}>
              <Picture x={photo.x} y={photo.y} w={44} h={52} />
            </g>
          ))}
          <g className="cs-art-search">
            <circle cx="80" cy="50" r="12" fill="var(--surface)" fillOpacity="0.6" stroke={ACCENT} strokeWidth="3" />
            <line x1="89" y1="59" x2="98" y2="68" stroke={ACCENT} strokeWidth="3.5" strokeLinecap="round" />
          </g>
        </>
      )}

      {kind === "enlarge" && (
        <>
          {/* The picture growing to fill the cover's frame. */}
          {[
            "M38 22 L38 10 L50 10",
            "M110 10 L122 10 L122 22",
            "M122 78 L122 90 L110 90",
            "M50 90 L38 90 L38 78",
          ].map((d) => (
            <path key={d} d={d} fill="none" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          <g className="cs-art-grow">
            <Picture x={44} y={16} w={72} h={68} />
          </g>
        </>
      )}
    </svg>
  );
}
