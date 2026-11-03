import { useId } from "react";
import type { CarModel } from "@autovoyage/shared";

/** Original Cybertruck-inspired artwork; this decorative shape does not identify the owner's model. */
export function VehiclePhoto({ model, className = "", priority = false, caption = true }: {
  model?: Pick<CarModel, "id" | "brand" | "name">;
  className?: string;
  priority?: boolean;
  caption?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const electric = model?.brand === "比亚迪";
  const ref = (name: string) => `url(#${id}-${name})`;
  return (
    <figure className={`vehicle-photo vehicle-illustration ${electric ? "illustration-electric" : "illustration-silver"} ${className}`} data-priority={priority || undefined}>
      <svg viewBox="0 0 880 360" role="img" aria-label="Cybertruck 灵感的银色楔形皮卡插画，外观仅为示意" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="0.15" y2="1">
            <stop stopColor="#f1f8fc" /><stop offset=".42" stopColor="#bfced8" /><stop offset="1" stopColor="#7d98aa" />
          </linearGradient>
          <linearGradient id={`${id}-upper`} x1="0" y1="0" x2=".4" y2="1">
            <stop stopColor="#eaf5fa" /><stop offset="1" stopColor="#8da8bb" />
          </linearGradient>
          <linearGradient id={`${id}-hood`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#f5fbff" /><stop offset="1" stopColor="#b8cddc" />
          </linearGradient>
          <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2=".6">
            <stop stopColor="#9eb7c9" /><stop offset="1" stopColor="#638399" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#2f5b73" /><stop offset=".6" stopColor="#163c54" /><stop offset="1" stopColor="#0a2439" />
          </linearGradient>
          <linearGradient id={`${id}-glass-shine`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#d9f5ff" stopOpacity=".42" /><stop offset="1" stopColor="#b2d9ea" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-ground`}>
            <stop stopColor="#76c7e5" stopOpacity=".16" /><stop offset="1" stopColor="#76c7e5" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-shadow`} x="-20%" y="-100%" width="140%" height="300%"><feGaussianBlur stdDeviation="7" /></filter>
        </defs>

        <ellipse cx="444" cy="286" rx="340" ry="40" fill={ref("ground")} />
        <ellipse cx="443" cy="284" rx="303" ry="15" fill="#041b2c" opacity=".48" filter={ref("shadow")} />
        <path d="M133 282c121 43 494 43 617 0" fill="none" stroke="#78bdd7" strokeOpacity=".16" />

        {/* A single, continuous roof triangle gives the truck its familiar silhouette. */}
        <path d="m139 171 293-88 38-5 173 87 107 22-6 51-48 23-541-8-23-24Z" fill="#163344" stroke="#1d3e50" strokeWidth="3" strokeLinejoin="round" />
        <path d="m140 172 292-88 38-5-143 88Z" fill={ref("upper")} />
        <path d="m143 174 184-7 143-88-38 5-293 88Z" fill="#b7cbd7" />
        {/* Covered load bed, separate from the passenger cabin. */}
        <path d="m152 172 168-5 70-49-196 59Z" fill="#6b889a" />
        <path d="m161 174 155-4 66-45" fill="none" stroke="#d3e5ee" strokeWidth="2" strokeOpacity=".6" />
        <path d="m197 167 139-41m-105 40 144-43" fill="none" stroke="#3d6278" strokeOpacity=".4" />

        {/* Near-side cabin and the narrow far-side windshield plane. */}
        <path d="m327 167 109-76 151 74Z" fill={ref("steel")} />
        <path d="m341 159 91-62 9 62Z" fill={ref("glass")} stroke="#91acbd" strokeWidth="1.5" />
        <path d="m450 101 119 58H451Z" fill={ref("glass")} stroke="#91acbd" strokeWidth="1.5" />
        <path d="m345 157 86-59 6 30-86 31Zm108-51 74 36h-74Z" fill={ref("glass-shine")} />
        <path d="m470 79 173 86-54 1-150-77Z" fill="#294e64" />
        <path d="m473 87 149 75-31-1-139-70Z" fill="#102c41" />
        <path d="m481 91 130 66-23-1-126-62Z" fill="#79aec6" opacity=".2" />
        <path d="m439 90 31-11 173 86" fill="none" stroke="#d6e9f2" strokeWidth="2" />

        {/* Flat stainless panels and a high, unbroken belt line. */}
        <path d="m139 177 188-10 262-1 112 29-5 60-22 1-19-47-63-2-22 46-271-4-22-47-61-2-22 45-42-2-20-14Z" fill={ref("steel")} stroke="#d0e1e9" strokeWidth="1.25" />
        <path d="m141 178 187-8 260-1 110 29-550-3Z" fill="#eff8fc" opacity=".62" />
        <path d="m144 198 553 3-2 44-548-7Z" fill="#b4cbd9" opacity=".2" />
        <path d="m590 166 53-1 107 22-49 11Z" fill={ref("hood")} stroke="#dcecf4" strokeWidth="1.3" />
        <path d="m701 198 49-11-6 51-48 23Z" fill={ref("front")} stroke="#aec9d8" strokeWidth="1.2" />
        <path d="m142 199 555 3m-369-32-8 72m126-73 1 75m141-74-5 26" fill="none" stroke="#627f91" strokeWidth="1.4" strokeOpacity=".75" />
        <path d="m154 235 45 1m103 5 266 4" fill="none" stroke="#edf7fd" strokeOpacity=".48" strokeWidth="2" />
        <path d="m353 179 23 1m97 1 23 1" stroke="#637e90" strokeWidth="3" strokeLinecap="round" />
        <path d="m570 160 18-3 15 9-8 8-26-4Z" fill="#273f50" stroke="#b5cedd" strokeWidth="1.4" />
        <path d="m581 163 10 1 7 5-6 2-16-3Z" fill="#e2eff6" />

        {/* A continuous light strip and low bumper keep the nose visually simple. */}
        <path d="m699 203 48-11" stroke="#7bcbe4" strokeWidth="7" />
        <path d="m699 202 48-11" stroke="#effdff" strokeWidth="3" />
        <path d="m702 229 37-9-2 13-37 12Z" fill="#143244" />
        <path d="m699 246 43-14-4 12-41 17-24-4Z" fill="#173547" />
        <path d="m704 226 6-1m22-5 6-2" stroke="#d8f4ff" strokeWidth="2" />
        <path d="m136 181 10-1 1 15-10 1Z" fill="#ed9c8b" />
        <path d="m138 184 6-1" stroke="#ffe3d4" strokeWidth="2" />

        {/* Broad angular arches, with both tyres on the same ground plane. */}
        <path d="m191 246 24-49h63l25 49-14 12h-86Z" fill="#1b3342" stroke="#436071" strokeWidth="2" />
        <path d="m563 250 26-49h64l25 49-14 12h-88Z" fill="#1b3342" stroke="#436071" strokeWidth="2" />
        {[{ x: 247, y: 247 }, { x: 621, y: 251 }].map(({ x, y }) => (
          <g key={x} transform={`translate(${x} ${y})`}>
            <circle r="43" fill="#0a1c29" stroke="#263f4e" strokeWidth="3" />
            <circle r="35" fill="#172f3e" stroke="#597587" strokeWidth="1.5" />
            <path d="M0-30 26-15 26 15 0 30-26 15-26-15Z" fill="#496779" stroke="#8ba6b8" strokeWidth="1.2" />
            {[0, 60, 120, 180, 240, 300].map((angle) => (
              <path key={angle} d="m-5-28 10 0 4 18-9 5-9-5Z" fill="#a9c0cf" transform={`rotate(${angle})`} />
            ))}
            <circle r="10" fill="#203f52" stroke="#b9d2df" strokeWidth="1.5" />
            <circle r="3.5" fill="#8caabc" />
            <path d="M-34 13A36 36 0 0 0 25 26" fill="none" stroke="#607f91" strokeOpacity=".35" strokeWidth="2" />
          </g>
        ))}
        <path d="m191 247 24-49h63l25 49m260 4 26-49h64l25 49" fill="none" stroke="#b5ccd9" strokeOpacity=".5" strokeWidth="1.7" />
      </svg>
      {caption && <figcaption>Cybertruck 灵感插画 · 外观仅为示意</figcaption>}
    </figure>
  );
}
