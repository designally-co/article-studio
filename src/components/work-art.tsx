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
export type WorkArtKind = "reading" | "research" | "outline" | "writing";

const LINE = { stroke: "var(--ink-200)", strokeWidth: 4, strokeLinecap: "round" as const };
const ACCENT = "var(--accent)";

function Page() {
  return <rect x="40" y="8" width="80" height="84" rx="8" fill="var(--surface)" stroke="var(--ink-300)" strokeWidth="1.5" />;
}

export function WorkArt({ kind }: { kind: WorkArtKind }) {
  return (
    <svg viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" className="mx-auto block overflow-visible">
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
    </svg>
  );
}
