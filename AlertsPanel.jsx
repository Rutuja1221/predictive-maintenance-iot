import { useState } from "react"

const STATUS_COLOR = { NORMAL:"#00d48a", WARNING:"#f59e0b", CRITICAL:"#ef4444" }

export default function AlertsPanel({ alerts, onResolve, onSelectMachine, machines }) {
  const [filter, setFilter] = useState("active")   // active | all

  const displayed = alerts
    .filter(a => filter === "all" ? true : !a.resolved)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

  const critCount = alerts.filter(a => !a.resolved && a.severity === "CRITICAL").length
  const warnCount = alerts.filter(a => !a.resolved && a.severity === "WARNING").length

  return (
    <main className="alerts-panel">
      <div className="ap-header">
        <h1 className="ap-title">Maintenance Alerts</h1>
        <div className="ap-summary">
          <span className="aps-chip critical">{critCount} Critical</span>
          <span className="aps-chip warning">{warnCount} Warning</span>
        </div>
      </div>

      <div className="ap-filter">
        {["active","all"].map(f => (
          <button key={f} className={`filter-btn ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}>
            {f === "active" ? "Active Alerts" : "All Alerts"}
          </button>
        ))}
      </div>

      {displayed.length === 0
        ? <div className="empty-alerts">
            <span className="ea-icon">✓</span>
            <p>No {filter === "active" ? "active " : ""}alerts — systems running normally</p>
          </div>
        : <div className="alert-cards">
            {displayed.map(a => (
              <AlertCard key={a.alert_id} alert={a}
                         onResolve={() => onResolve(a.alert_id)}
                         onViewMachine={() => {
                           const m = machines.find(m => m.id === a.machine_id)
                           if (m) onSelectMachine(m)
                         }} />
            ))}
          </div>
      }
    </main>
  )
}

function AlertCard({ alert, onResolve, onViewMachine }) {
  const color = STATUS_COLOR[alert.severity] || "#6b7280"
  const breaches = (() => {
    try { return JSON.parse(alert.breach_details || "[]") } catch { return [] }
  })()

  const age = Math.round((Date.now() - new Date(alert.timestamp)) / 60000)
  const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age/60)}h ${age%60}m ago`

  return (
    <div className={`alert-card ${alert.resolved ? "resolved" : ""}`}
         style={{"--ac-color": color}}>
      <div className="ac-stripe" style={{background: color}} />

      <div className="ac-body">
        <div className="ac-top">
          <span className="ac-severity" style={{color}}>{alert.severity}</span>
          <span className="ac-machine">{alert.machine_name}</span>
          <span className="ac-id">({alert.machine_id})</span>
          {alert.resolved && <span className="ac-resolved-tag">RESOLVED</span>}
        </div>

        <div className="ac-details">
          {alert.fault_type !== "none" && (
            <span className="ac-fault">
              Fault: <strong>{alert.fault_type.replace(/_/g," ")}</strong>
            </span>
          )}
          {breaches.map((b, i) => (
            <span key={i} className="ac-breach">{b}</span>
          ))}
          <span className="ac-score">
            Anomaly score: <strong>{Number(alert.anomaly_score).toFixed(4)}</strong>
          </span>
        </div>

        <div className="ac-footer">
          <span className="ac-time">{ageStr} · {new Date(alert.timestamp).toLocaleString()}</span>
          <div className="ac-actions">
            <button className="ac-btn view" onClick={onViewMachine}>View Machine</button>
            {!alert.resolved &&
              <button className="ac-btn resolve" onClick={onResolve}>Resolve</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
