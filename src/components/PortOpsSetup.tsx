export default function PortOpsSetup() {
  return (
    <div className="port-ops-setup" role="status" aria-label="Port operations setup required">
      <strong>Port operations feed required</strong>
      <p>
        Connect a provider endpoint that returns berth assignments, terminal/berth utilization,
        service events, and queue status. AIS is not used as a substitute for port utilization.
      </p>
      <dl>
        <div><dt>Backend variable</dt><dd>PORT_EVENTS_URL</dd></div>
        <div><dt>Frontend route</dt><dd>/api/port-events</dd></div>
        <div><dt>Required arrays</dt><dd>portEvents, portUtilization, queueStatus</dd></div>
      </dl>
    </div>
  );
}
