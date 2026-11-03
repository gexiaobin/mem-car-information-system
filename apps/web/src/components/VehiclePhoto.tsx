import { useId } from "react";
import type { CarModel } from "@autovoyage/shared";

/** Original vector artwork; the silhouette is decorative, not a model-identification image. */
export function VehiclePhoto({ model, className = "", priority = false, caption = true }: {
  model?: Pick<CarModel, "id" | "brand" | "name">;
  className?: string;
  priority?: boolean;
  caption?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const electric = model?.brand === "比亚迪";
  const paint = electric
    ? { light: "#edf9ff", mid: "#b0d4ef", dark: "#507da4", edge: "#d5eeff" }
    : { light: "#f5f9ff", mid: "#c4d2e6", dark: "#6a83a5", edge: "#e2edff" };
  const ref = (name: string) => `url(#${id}-${name})`;
  return (
    <figure className={`vehicle-photo vehicle-illustration ${electric ? "illustration-electric" : "illustration-silver"} ${className}`} data-priority={priority || undefined}>
      <svg viewBox="0 0 880 360" role="img" aria-label="数字车库通用轿车插画，外观仅为示意" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`${id}-paint`} x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stopColor={paint.light} /><stop offset=".48" stopColor={paint.mid} /><stop offset="1" stopColor={paint.dark} /></linearGradient>
          <linearGradient id={`${id}-hood`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={paint.light} /><stop offset=".65" stopColor={paint.mid} /><stop offset="1" stopColor={paint.dark} /></linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#99c5e4" /><stop offset=".38" stopColor="#35516c" /><stop offset="1" stopColor="#10243e" /></linearGradient>
          <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2=".7"><stop stopColor={paint.mid} /><stop offset="1" stopColor={paint.dark} /></linearGradient>
          <radialGradient id={`${id}-rim`}><stop stopColor="#a9bed7" /><stop offset=".35" stopColor="#e6f0fb" /><stop offset=".75" stopColor="#5c738f" /><stop offset="1" stopColor="#152638" /></radialGradient>
          <radialGradient id={`${id}-glow`}><stop stopColor="#6cafff" stopOpacity=".24" /><stop offset="1" stopColor="#6cafff" stopOpacity="0" /></radialGradient>
          <filter id={`${id}-shadow`} x="-40%" y="-100%" width="180%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        <ellipse cx="463" cy="274" rx="340" ry="63" fill={ref("glow")} />
        <ellipse cx="448" cy="270" rx="290" ry="25" fill="#041022" opacity=".58" filter={ref("shadow")} />
        <ellipse cx="454" cy="277" rx="339" ry="41" fill="none" stroke="#76a7df" strokeOpacity=".16" />
        <ellipse cx="454" cy="278" rx="381" ry="55" fill="none" stroke="#76a7df" strokeOpacity=".08" />
        <g transform="translate(5 -6)">
          <path d="M145 197Q156 181 206 169L280 125Q325 95 402 95Q449 93 499 120L573 157 681 172Q726 179 741 202L737 224Q729 241 691 249L168 240Q142 231 139 215Z" fill="#102137" stroke="#192c43" strokeWidth="3" />
          <path d="M187 177 279 128Q327 97 402 98Q451 98 496 122L575 158 490 172 310 162Z" fill={ref("paint")} />
          <path d="M227 165 291 126Q312 112 341 107L328 155Q273 156 227 165Z" fill={ref("glass")} stroke="#b6d1eb" strokeWidth="2" />
          <path d="M352 106Q408 100 446 113L494 135 530 154 348 157Z" fill={ref("glass")} stroke="#b6d1eb" strokeWidth="2" />
          <path d="m418 106 12 52M341 107l-13 49" stroke="#344b66" strokeWidth="4" />
          <path d="M490 133Q535 143 570 159L519 171 450 158Z" fill="#152d46" stroke="#83abc9" strokeWidth="1.5" />
          <path d="M358 113Q399 107 440 120L485 143 354 148Z" fill="#deeffb" opacity=".12" />
          <path d="M146 194Q166 180 210 172L312 161Q404 154 502 168L655 190Q674 197 677 212L671 238 640 247Q638 192 591 192T536 241L286 236Q284 185 238 182T191 232L162 228Q145 222 146 194Z" fill={ref("paint")} stroke={paint.edge} strokeOpacity=".4" />
          <path d="M503 164 569 153Q634 158 686 177L722 190Q693 207 658 207L641 194Z" fill={ref("hood")} />
          <path d="M657 198Q698 187 721 188Q740 194 741 211Q741 230 723 239L677 253 654 244Q667 226 661 210Z" fill={ref("front")} />
          <path d="M163 205Q343 196 524 211M302 168Q297 194 300 224M445 169Q452 196 451 230" fill="none" stroke="#253e60" strokeWidth="1.5" strokeOpacity=".4" />
          <path d="M157 194Q311 158 498 178L645 201" fill="none" stroke={paint.light} strokeWidth="2.5" strokeOpacity=".8" />
          <path d="m190 227 315 12 30-1M683 242q26-8 45-20" fill="none" stroke="#d3e8ff" strokeWidth="2" strokeOpacity=".48" />
          <path d="m341 179 21 1m93 8 18 2" stroke="#526d8e" strokeWidth="3" strokeLinecap="round" />
          <path d="M519 163q7-9 16-8l22 7q7 4 6 9l-29 1Z" fill={paint.light} stroke={paint.dark} strokeWidth="1.5" />
          <path d="M667 202Q695 189 724 193" fill="none" stroke="#93dcff" strokeWidth="7" strokeLinecap="round" />
          <path d="M669 200Q698 190 725 193" fill="none" stroke="#f0fcff" strokeWidth="3" strokeLinecap="round" />
          <path d="M686 222q20-4 43-15l-3 14q-15 12-44 16Z" fill="#20394f" /><path d="m692 227 29-11" stroke="#7ca4c2" strokeWidth="1.5" />
          <path d="m145 194 18-5 1 7-19 5" fill="#e89b9b" />
          <path d="m168 216 10 4m473-7 7 5" stroke="#c7e9ff" strokeWidth="2" strokeLinecap="round" />
          {[{ x: 239, y: 230, sx: .85 }, { x: 591, y: 242, sx: .88 }].map(({ x, y, sx }) => <g key={x} transform={`translate(${x} ${y}) scale(${sx} 1)`}>
            <ellipse rx="46" ry="49" fill="#091424" /><ellipse rx="38" ry="41" fill="#18283b" stroke="#3b5069" strokeWidth="2" /><ellipse rx="31" ry="34" fill={ref("rim")} />
            {[0, 60, 120].map(angle => <g key={angle} transform={`rotate(${angle})`}><path d="m-3-29 8 2-2 22-5 1Zm1 35 5 1 2 22-8 2Z" fill="#e2eaf5" stroke="#8196b2" strokeWidth=".8" /></g>)}
            <ellipse rx="9" ry="10" fill="#7187a4" stroke="#dce8f6" strokeWidth="2" /><ellipse rx="3.5" ry="4" fill="#cbdcf0" />
          </g>)}
          <path d="m538 194 10-1m104 15 6-2" stroke={paint.light} strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>
      {caption && <figcaption>车型示意 · 具体年款配置以档案为准</figcaption>}
    </figure>
  );
}
