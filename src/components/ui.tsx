import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<"section">) {
  return (
    <section className={`card ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type Tone = "neutral" | "brand" | "positive" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]",
  brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  positive: "bg-[var(--color-positive-soft)] text-[var(--color-positive)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-[var(--color-ink-muted)]">{description}</p>
      {action}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">{hint}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: "danger" | "positive" | "warning" | "brand";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    danger: "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    positive:
      "border-[var(--color-positive)]/30 bg-[var(--color-positive-soft)] text-[var(--color-positive)]",
    warning: "border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    brand: "border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  } as const;

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role="status">
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <Link href={href} className={`btn btn-${variant}`}>
      {children}
    </Link>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {tone !== "neutral" ? <Badge tone={tone}>{sub}</Badge> : sub}
        </p>
      ) : null}
    </div>
  );
}
