import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  X,
  AlertCircle,
  LoaderCircle,
  ArrowUpRight,
  CarFront,
} from "lucide-react";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? "brand-inverse" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path
            d="m7 21 9-16 9 16M11 15h10M4 25c4-4 7 4 12 0s8 2 12-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="brand-type">
        云程<span>AUTOVOYAGE</span>
      </span>
    </div>
  );
}
export function CarArt({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`car-art ${className}`}
      viewBox="0 0 680 280"
      role="img"
      aria-label="银蓝色汽车插画"
    >
      <defs>
        <linearGradient id="car-body" x1="0" y1="0" x2="0.3" y2="1">
          <stop stopColor="#eff8ff" />
          <stop offset=".42" stopColor="#a4bfd8" />
          <stop offset="1" stopColor="#446a90" />
        </linearGradient>
        <linearGradient id="car-glass" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#102b4c" />
          <stop offset="1" stopColor="#41698b" />
        </linearGradient>
        <linearGradient id="car-hood">
          <stop stopColor="#a1bad1" />
          <stop offset="1" stopColor="#d7e6f3" />
        </linearGradient>
      </defs>
      <ellipse cx="337" cy="240" rx="285" ry="17" fill="#000" opacity=".12" />
      <path
        d="m92 158 52-19 75-67c13-11 31-18 49-18h133c25 0 44 8 63 22l77 58 63 14c19 4 30 14 32 31l4 29-17 15H75l-8-15 5-32c2-8 9-14 20-18Z"
        fill="url(#car-body)"
        stroke="#bdd1e1"
        strokeWidth="2"
      />
      <path
        d="m170 137 65-56c9-7 23-11 36-11h123c20 0 36 5 51 16l59 46-334 5Z"
        fill="url(#car-glass)"
      />
      <path d="m301 70-12 64M402 73l24 60" stroke="#b5c9dc" strokeWidth="8" />
      <path d="m94 155 76-18 336-5 95 23-28 18-454 6Z" fill="url(#car-hood)" />
      <path
        d="m87 183 44 4M552 166l55 8-3 14-50-2Z"
        fill="#e5f8ff"
        stroke="#f5fbff"
        strokeWidth="3"
      />
      <path d="m86 210 32-6h445l48-10-6 17-23 13H90Z" fill="#1b3d5e" />
      <path
        d="m203 145 1 58M420 143l9 59M225 156h19M445 150h19"
        stroke="#527b9d"
        strokeWidth="2.5"
      />
      <path d="m482 130-11 16 23 2 8-11Z" fill="#7299b8" />
      <g fill="#162c40" stroke="#344d62" strokeWidth="5">
        <circle cx="181" cy="214" r="38" />
        <circle cx="510" cy="211" r="38" />
      </g>
      <g fill="#b6c9d9" stroke="#e4eef5" strokeWidth="2">
        <circle cx="181" cy="214" r="24" />
        <circle cx="510" cy="211" r="24" />
      </g>
      <g stroke="#516a7f" strokeWidth="5">
        <path d="m181 191 0 46m-23-23h46m-39-16 32 32m-32 0 32-32M510 188v46m-23-23h46m-39-16 32 32m-32 0 32-32" />
      </g>
      <g fill="#e4eef5">
        <circle cx="181" cy="214" r="7" />
        <circle cx="510" cy="211" r="7" />
      </g>
    </svg>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button className="icon-btn" aria-label="关闭窗口" onClick={onClose}>
          <X size={21} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function ErrorBox({ message }: { message?: string }) {
  return message ? (
    <div className="feedback feedback-error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Loading({ label = "正在加载，请稍候…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={23} className="spin" aria-hidden="true" />
      {label}
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <CarFront size={30} aria-hidden="true" />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {action && (
        <button className="text-btn" onClick={onAction}>
          {action}
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
export function DemoTag() {
  return <span className="badge badge-demo">演示数据</span>;
}
export const dateText = (value: string | null | undefined, withTime = false) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      }).format(new Date(value))
    : "待补充";
export const dateInput = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const localTimeInput = (date = new Date()) =>
  `${dateInput(date)}T${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
export const asDateTime = (value: string) => `${value}:00+08:00`;
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试";
export const stopSubmit = (event: FormEvent) => event.preventDefault();
