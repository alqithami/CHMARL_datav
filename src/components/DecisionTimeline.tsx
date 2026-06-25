import type { TimelineEvent } from "@/data/chmarlData";

export type DecisionTimelineProps = {
  events: TimelineEvent[];
};

export default function DecisionTimeline({ events }: DecisionTimelineProps) {
  return (
    <div className="timeline">
      {events.map((event) => (
        <article key={event.time + event.title} className="timeline-item">
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
