import { useMemo } from "react"

const STATUS_COLOR = { NORMAL: "#00d48a", WARNING: "#f59e0b", CRITICAL: "#ef4444", UNKNOWN: "#6b7280" }
const STATUS_ICON  = { NORMAL: "●", WARNING: "▲", CRITICAL: "✕", UNKNOWN: "?" }

const TYPE_ICON = {
  compressor: "🔩", motor: "⚙️", pump: "💧", conveyor: "📦", generator: "⚡"
}

export default function Dashboard({ machines, alerts, onSelectMachine }) {
  const stats = useMemo(() => ({
    total:    machines.length,
    normal:   machines.filter(m => m.status === "NORMAL").length,
    warning:  machines.filter(m => m.status === "WARNING").length,
    critical: machines.filter(m => m.status === "CRITICAL").length,
    openAlerts: alerts.filter(a => !a.resolved).length,
  }), [machines, alerts])

  return (
    <main className="dashboard">
      {/* ── Summary Bar ── */}
      <section className="summary-bar">
        <StatCard label="Total Machines"  value={stats.total}    color="#60a5fa" />
        <StatCard label="Operational"     value={stats.normal}   color="#00d48a" />
        <StatCard label="Warning"         value={stats.warning}  color="#f59e0b" />
        <StatCard label="Critical"        value={stats.critical} color="#ef4444" pulse={stats.critical > 0} />
        <StatCard label="Open Alerts"     value={stats.openAlerts} color="#a78bfa" />
      </section>

      {/* ── Machine Grid ── */}
      <section className="section">
        <h2 className="section-title">Machine Status</h2>
        <div className="machine-grid">
          {machines.map(m => (
            <MachineCard key={m.id} machine={m} onClick={() => onSelectMachine(m)} />
          ))}
        </div>
      </section>

      {/* ── Recent Alerts ── */}
      <section className="section">
        <h2 className="section-title">Recent Alerts</h2>
        {alerts.filter(a => !a.resolved).length === 0
          ? <p className="empty-msg">No active alerts — all systems nominal</p>
          : <div className="alert-list">
              {alerts.filter(a => !a.resolved).slice(0, 5).map(a => (
                <AlertRow key={a.alert_id} alert={a} />
              ))}
            </div>
        }
      </section>
    </main>
  )
}

function StatCard({ label, value, color, pulse }) {
  return (
    <div className="stat-card" style={{"--accent": color}}>
      <span className={`stat-value ${pulse ? "pulse-text" : ""}`} style={{color}}>
        {value}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function MachineCard({ machine, onClick }) {
  const color   = STATUS_COLOR[machine.status] || "#6b7280"
  const score   = machine.anomaly_score || 0
  const pct     = Math.min(score * 300, 100)   // scale score to bar width

  const sensors = machine.sensors || {}

  return (
    <div className={`machine-card ${machine.status.toLowerCase()}`} onClick={onClick}
         style={{"--status-color": color}}>
      <div className="mc-header">
        <span className="mc-icon">{TYPE_ICON[machine.type] || "🔧"}</span>
        <div className="mc-info">
          <span className="mc-name">{machine.name}</span>
          <span className="mc-id">{machine.id} · {machine.type}</span>
        </div>
        <span className="mc-status-badge" style={{color, borderColor: color}}>
          {STATUS_ICON[machine.status]} {machine.status}
        </span>
      </div>

      {/* Sensor mini-readings */}
      <div className="mc-sensors">
        {sensors.temperature != null &&
          <SensorPill label="Temp"  value={`${sensors.temperature.toFixed(1)}°C`} />}
        {sensors.vibration != null &&
          <SensorPill label="Vib"   value={`${sensors.vibration.toFixed(2)}g`} />}
        {sensors.pressure != null && sensors.pressure > 0 &&
          <SensorPill label="Press" value={`${sensors.pressure.toFixed(0)} bar`} />}
        {sensors.rpm != null &&
          <SensorPill label="RPM"   value={sensors.rpm.toFixed(0)} />}
      </div>

      {/* Anomaly score bar */}
      <div className="mc-score-row">
        <span className="mc-score-label">Anomaly Score</span>
        <span className="mc-score-val">{score.toFixed(4)}</span>
      </div>
      <div className="mc-score-bar">
        <div className="mc-score-fill" style={{width: `${pct}%`, background: color}} />
      </div>

      {machine.last_seen &&
        <div className="mc-footer">
          Last seen {new Date(machine.last_seen).toLocaleTimeString()}
        </div>}
    </div>
  )
}

function SensorPill({ label, value }) {
  return (
    <div className="sensor-pill">
      <span className="sp-label">{label}</span>
      <span className="sp-value">{value}</span>
    </div>
  )
}

function AlertRow({ alert }) {
  const color = STATUS_COLOR[alert.severity] || "#6b7280"
  const breaches = (() => {
    try { return JSON.parse(alert.breach_details || "[]") } catch { return [] }
  })()

  return (
    <div className="alert-row" style={{"--alert-color": color}}>
      <span className="ar-severity" style={{color}}>{alert.severity}</span>
      <div className="ar-body">
        <span className="ar-machine">{alert.machine_name}</span>
        <span className="ar-detail">
          {alert.fault_type !== "none" ? alert.fault_type.replace("_"," ") : ""}
          {breaches.length > 0 ? ` · ${breaches[0]}` : ""}
        </span>
      </div>
      <span className="ar-time">
        {new Date(alert.timestamp).toLocaleTimeString()}
      </span>
    </div>
  )
}
