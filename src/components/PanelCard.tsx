import type { PropsWithChildren } from "react";

export type PanelCardProps = PropsWithChildren<{
  title: string;
  tag?: string;
  className?: string;
  onFocus?: () => void;
}>;

export default function PanelCard({ title, tag, className = "", onFocus, children }: PanelCardProps) {
  return (
    <section className={`panel-card ${className}`.trim()}>
      <header className="panel-header">
        <h2 className="panel-title">{title}</h2>
        <div className="panel-actions">
          {tag && <span className="panel-tag">{tag}</span>}
          {onFocus && (
            <button type="button" className="panel-focus-button" onClick={onFocus}>
              Expand
            </button>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}
