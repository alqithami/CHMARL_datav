import type { TimelineEvent } from "@/data/chmarlData";

export type DecisionTimelineProps = {
  events: TimelineEvent[];
};

export default function DecisionTimeline({ events }: DecisionTimelineProps) {
  const visibleEvents = events.slice(0, 8);

  if (visibleEvents.length === 0) {
    return (
      <div className="timeline-empty-state">
        <strong>No CH-MARL decision events</strong>
        <span>Connect a runtime CH-MARL log to populate hierarchy, action, reward, and constraint decisions.</span>
      </div>
    );
  }

  return (
    <div className="timeline decision-timeline">
      {visibleEvents.map((event, index) => (
        <article key={`${event.time}-${event.title}-${index}`} className="timeline-item">
          <div className="timeline-time">{event.time}</div>
          <div>
            <div className="timeline-title">{event.title}</div>
            <div className="timeline-body">{event.body}</div>
          </div>
        </article>
      ))}
    </div>
  );
}
