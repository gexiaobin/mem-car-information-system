import { useId } from "react";
import type { Store } from "@autovoyage/shared";
import "./StoreIllustration.css";

/** Decorative service-station artwork. Store identity and type remain in visible text. */
export function StoreIllustration({ type, compact = false }: {
  type: Store["type"];
  compact?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const chain = type === "chain";
  const showroom = type === "4s";
  return (
    <svg className={`store-illustration${compact ? " store-illustration-compact" : ""}`} viewBox="0 0 176 144" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-fascia`} x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#003b70" /><stop offset="1" stopColor="#0068b5" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#9fd9e9" /><stop offset="1" stopColor="#d9f0f7" />
        </linearGradient>
      </defs>
      <circle cx="91" cy="74" r="58" fill="#e0f1f7" />
      <path d="M16 120c24-9 46-9 72-3s48 7 72-2" fill="none" stroke="#bbdee9" strokeWidth="2" />
      <ellipse cx="89" cy="126" rx="72" ry="7" fill="#c9e1eb" opacity=".65" />
      <path d="M144 44l16 10v64l-16 7z" fill="#85b6ca" />
      <path d="M23 46h121v77H23z" fill="#f8fcff" stroke="#b6d3e0" strokeWidth="1.5" />
      <path d="M18 37h129l16 10H34z" fill="#5297b8" />
      <rect x="18" y="37" width="130" height="22" rx="3" fill={`url(#${id}-fascia)`} />
      <path d="M18 58h130" stroke="#00a7c8" strokeWidth="4" />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        <path d="M37 51h20l-2-5H40zM41 46l2-3h9l3 3" />
        <path d="M40 51v3m14-3v3" />
      </g>
      <path d="M67 46h36m-36 6h24" stroke="#c4eafa" strokeWidth="2.5" strokeLinecap="round" />
      {showroom ? (
        <path d="M126 42l5 2v5c0 4-5 6-5 6s-5-2-5-6v-5z" fill="none" stroke="#bcecff" strokeWidth="1.8" />
      ) : chain ? (
        <g fill="#bcecff"><circle cx="120" cy="48" r="2.2" /><circle cx="127" cy="48" r="2.2" /><circle cx="134" cy="48" r="2.2" /></g>
      ) : (
        <path d="M121 45l4 4m0 0l5 5m-5-5l5-5" fill="none" stroke="#bcecff" strokeWidth="2.5" strokeLinecap="round" />
      )}
      <path d="M31 67h70v47H31z" fill="#123f61" />
      <path d="M34 69h64v42H34z" fill={`url(#${id}-glass)`} />
      <path d="M35 69v40m62-40v40" stroke="#0068b5" strokeWidth="4" />
      {!compact && <path d="M39 73h54m-54 6h54" stroke="#f8fcff" opacity=".7" strokeWidth="1.5" />}
      <path d="M42 108h48" stroke="#003b70" strokeWidth="3" strokeLinecap="round" />
      <path d="M45 103v10m42-10v10" stroke="#0068b5" strokeWidth="3" />
      <path d="M46 91l5-10h28l6 10 5 4v11H42V95z" fill="#f9fdff" stroke="#2e718f" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M52 83h25l4 8H48z" fill="#175475" />
      <path d="M47 96h7m24 0h7" stroke="#00a7c8" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M59 101h14" stroke="#175475" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="44" y="105" width="7" height="6" rx="2" fill="#123f61" />
      <rect x="81" y="105" width="7" height="6" rx="2" fill="#123f61" />
      <rect x="111" y="67" width="25" height="47" rx="1" fill={`url(#${id}-glass)`} stroke="#85b6ca" strokeWidth="1.5" />
      <path d="M113 92h21m-15-24l-6 11m19-11l-19 34" stroke="#fff" strokeWidth="2" opacity=".65" />
      <path d="M130 94v6" stroke="#397c9d" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 119h127v6H20z" fill="#88b9cb" />
      <path d="M16 125h137" stroke="#6099b2" strokeWidth="2" strokeLinecap="round" />
      {!compact && <g><path d="M154 103v19" stroke="#458aa8" strokeWidth="2" /><path d="M150 103c-7-7-3-15 2-14 6 1 3 8 3 8 4-5 10-1 7 4-2 3-6 3-8 2" fill="#00a7a8" /></g>}
    </svg>
  );
}
