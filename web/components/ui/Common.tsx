import { useEffect } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";

export type StatusTone = "neutral" | "dark" | "success" | "info" | "warning" | "danger";

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  dot?: boolean;
}

export function StatusBadge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={"badge badge-" + tone + (dot ? " badge-dot" : "") + " " + className}
      {...props}
    >
      {children}
    </span>
  );
}

interface SummaryCardProps extends HTMLAttributes<HTMLElement> {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  tone?: "default" | "danger";
  icon?: ReactNode;
}

export function SummaryCard({
  label,
  value,
  description,
  tone = "default",
  icon,
  className = "",
  ...props
}: SummaryCardProps) {
  return (
    <article
      className={"summary-card" + (tone === "danger" ? " is-danger" : "") + " " + className}
      {...props}
    >
      <div className="summary-card-label">
        <span>{label}</span>
        {icon && <span className="summary-card-icon">{icon}</span>}
      </div>
      <strong className="summary-card-value">{value}</strong>
      {description && <p className="summary-card-description">{description}</p>}
    </article>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps {
  value: string;
  options: SegmentOption[];
  onChange: (value: string) => void;
  label: string;
  size?: "default" | "small";
}

export function SegmentedControl({
  value,
  options,
  onChange,
  label,
  size = "default",
}: SegmentedControlProps) {
  return (
    <div
      className={"segmented-control" + (size === "small" ? " is-small" : "")}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? "is-selected" : undefined}
          disabled={option.disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
  expandable?: boolean;
}

export function FilterChip({
  active = false,
  count,
  expandable = false,
  className = "",
  children,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      className={"filter-chip" + (active ? " is-active" : "") + " " + className}
      {...props}
    >
      {active && <Check aria-hidden="true" />}
      <span>{children}</span>
      {count !== undefined && <span className="filter-chip-count">{count}</span>}
      {expandable && <ChevronDown aria-hidden="true" />}
    </button>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      className="toggle"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

interface DataTableProps extends PropsWithChildren {
  headers: ReactNode;
  caption: string;
  minWidth?: number;
  empty?: boolean;
  emptyMessage?: string;
}

export function DataTable({
  headers,
  caption,
  minWidth = 760,
  empty = false,
  emptyMessage = "표시할 항목이 없습니다.",
  children,
}: DataTableProps) {
  return (
    <div className="data-table-wrap">
      <table className="data-table" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>{headers}</thead>
        <tbody>
          {empty ? (
            <tr>
              <td className="data-table-empty" colSpan={100}>{emptyMessage}</td>
            </tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={"empty-state" + (compact ? " is-compact" : "")}>
      {icon && <span className="empty-state-icon">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

interface OverlayProps extends PropsWithChildren {
  open: boolean;
  title: string;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
}

function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
}

interface ModalProps extends OverlayProps {
  size?: "small" | "default" | "large";
}

export function Modal({
  open,
  title,
  description,
  footer,
  onClose,
  size = "default",
  children,
}: ModalProps) {
  useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div className="overlay-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={"modal modal-" + size}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="overlay-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기"><X aria-hidden="true" /></button>
        </header>
        <div className="overlay-body">{children}</div>
        {footer && <footer className="overlay-footer">{footer}</footer>}
      </section>
    </div>
  );
}

interface SidePanelProps extends OverlayProps {
  width?: "default" | "wide";
}

export function SidePanel({
  open,
  title,
  description,
  footer,
  onClose,
  width = "default",
  children,
}: SidePanelProps) {
  useOverlay(open, onClose);
  if (!open) return null;

  return (
    <div className="overlay-backdrop side-panel-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className={"side-panel" + (width === "wide" ? " is-wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="side-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="overlay-header">
          <div>
            <h2 id="side-panel-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기"><X aria-hidden="true" /></button>
        </header>
        <div className="overlay-body">{children}</div>
        {footer && <footer className="overlay-footer">{footer}</footer>}
      </aside>
    </div>
  );
}
