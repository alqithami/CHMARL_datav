import type { PropsWithChildren } from "react";

export type PanelCardProps = PropsWithChildren<{
  title: string;
  tag?: string;
  className?: string;
}>;

export default function PanelCard({ title, tag, className = "", children }: PanelCardProps) {
  return (
    <section className={`panel-card ${className}`.trim()}>
      <header className="panel-header">
        <h2 className="panel-title">{title}</h2>
        {tag && <span className="panel-tag">{tag}</span>}
      </header>
      {children}
    </section>
  );
}
