import { useState, useEffect, useCallback } from "react"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts"

const SENSOR_CONFIG = [
  { key: "temperature", label: "Temperature (°C)", color: "#f97316", unit: "°C",  warn: 85,  crit: 95  },
  { key: "vibration",   label: "Vibration (g)",    color: "#a78bfa", unit: "g",   warn: 3.0, crit: 4.5 },
  { key: "pressure",    label: "Pressure (bar)",   color: "#38bdf8", unit: "bar", warn: 140, crit: 160 },
  { key: "rpm",         label: "RPM",              color: "#00d48a", unit: "",    warn: null, crit: null },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="ct-time">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{color: p.color}}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(2) : p.value}</strong>
        </p>
      ))}
    </div>
  )
}

export default function MachineDetail({ machine, fetchReadings, onBack }) {
  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSensor, setActiveSensor] = useState("temperature")

  const load = useCallback(async () => {
    const data = await fetchReadings(machine.id)
    // Sort ascending for chart, format timestamps
    const sorted = [...data].reverse().map(r => ({
      ...r,
      time: new Date(r.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}),
    }))
    setReadings(sorted)
    setLoading(false)
  }, [machine.id, fetchReadings])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const latest      = readings[readings.length - 1]
  const sensorCfg   = SENSOR_CONFIG.find(s => s.key === activeSensor)
  const chartData   = readings.map(r => ({
    time:  r.time,
    value: r.sensors?.[activeSensor] ?? 0,
    score: r.anomaly_score * 100,
  }))

  return (
    <main className="machine-detail">
      <button className="back-btn" onClick={onBack}>← Back to Dashboard</button>

      <div className="md-header">
        <div>
          <h1 className="md-title">{machine.name}</h1>
          <p className="md-sub">{machine.id} · {machine.type} · {machine.status}</p>
        </div>
        <StatusBadge status={machine.status} />
      </div>

      {/* Latest sensor values */}
      {latest && (
        <div className="sensor-cards">
          {SENSOR_CONFIG.map(s => {
            const val = latest.sensors?.[s.key]
            if (val == null || (s.key === "pressure" && val === 0)) return null
            const warn = s.warn && val >= s.warn
            const crit = s.crit && val >= s.crit
            return (
              <div key={s.key}
                   className={`sensor-card ${activeSensor === s.key ? "active" : ""}`}
                   style={{"--sc-color": s.color}}
                   onClick={() => setActiveSensor(s.key)}>
                <span className="sc-label">{s.label.split(" ")[0]}</span>
                <span className={`sc-value ${crit ? "text-critical" : warn ? "text-warning" : ""}`}
                      style={{color: crit ? "#ef4444" : warn ? "#f59e0b" : s.color}}>
                  {val.toFixed(s.key === "rpm" ? 0 : 2)}{s.unit}
                </span>
                {(warn || crit) && <span className="sc-flag">{crit ? "CRIT" : "WARN"}</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* Sensor selector + chart */}
      <div className="chart-section">
        <div className="chart-selector">
          {SENSOR_CONFIG.map(s => (
            <button key={s.key}
                    className={`cs-btn ${activeSensor === s.key ? "active" : ""}`}
                    style={activeSensor === s.key ? {"--cs-color": s.color} : {}}
                    onClick={() => setActiveSensor(s.key)}>
              {s.label.split(" ")[0]}
            </button>
          ))}
        </div>

        <div className="chart-box">
          <h3 className="chart-title">{sensorCfg?.label} — Last 50 readings</h3>
          {loading
            ? <div className="chart-loading">Loading sensor data…</div>
            : <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{top:5, right:20, left:0, bottom:5}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}}
                         interval={Math.floor(chartData.length / 6)} />
                  <YAxis tick={{fill:"#64748b",fontSize:11}} />
                  <Tooltip content={<CustomTooltip />} />
                  {sensorCfg?.warn &&
                    <ReferenceLine y={sensorCfg.warn} stroke="#f59e0b" strokeDasharray="4 4"
                                   label={{value:"WARN", fill:"#f59e0b", fontSize:10}} />}
                  {sensorCfg?.crit &&
                    <ReferenceLine y={sensorCfg.crit} stroke="#ef4444" strokeDasharray="4 4"
                                   label={{value:"CRIT", fill:"#ef4444", fontSize:10}} />}
                  <Line type="monotone" dataKey="value" stroke={sensorCfg?.color || "#60a5fa"}
                        dot={false} strokeWidth={2} name={sensorCfg?.label} />
                </LineChart>
              </ResponsiveContainer>
          }
        </div>

        {/* Anomaly score chart */}
        <div className="chart-box" style={{marginTop:"1rem"}}>
          <h3 className="chart-title">Anomaly Score (×100)</h3>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData} margin={{top:5, right:20, left:0, bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}}
                     interval={Math.floor(chartData.length / 6)} />
              <YAxis domain={[0, 100]} tick={{fill:"#64748b",fontSize:11}} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={10} stroke="#f59e0b" strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="#ef4444" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="score" stroke="#a78bfa"
                    dot={false} strokeWidth={2} name="Score×100" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </main>
  )
}

function StatusBadge({ status }) {
  const colors = { NORMAL:"#00d48a", WARNING:"#f59e0b", CRITICAL:"#ef4444", UNKNOWN:"#6b7280" }
  const c = colors[status] || "#6b7280"
  return (
    <div className="status-badge-lg" style={{color:c, borderColor:c}}>
      {status === "CRITICAL" && <span className="pulse-ring" style={{borderColor:c}} />}
      {status}
    </div>
  )
}
