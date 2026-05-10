import { useState, useEffect, useCallback } from "react"
import Dashboard from "./components/Dashboard"
import MachineDetail from "./components/MachineDetail"
import AlertsPanel from "./components/AlertsPanel"

// ── API Config ────────────────────────────────────────────────────────────────
// In production: set VITE_API_URL to your API Gateway URL
const API_BASE = import.meta.env.VITE_API_URL || ""

// ── Mock data for local dev (when API_BASE is empty) ─────────────────────────
function mockMachines() {
  const types = ["compressor","motor","pump","conveyor","generator"]
  const names = ["Compressor Unit A","Motor Drive B","Pump Station C","Conveyor Belt D","Generator Unit E"]
  const ids   = ["M001","M002","M003","M004","M005"]
  return ids.map((id, i) => ({
    id,
    name: names[i],
    type: types[i],
    status: i === 1 ? "CRITICAL" : i === 3 ? "WARNING" : "NORMAL",
    anomaly_score: i === 1 ? 0.62 : i === 3 ? 0.18 : Math.random() * 0.08,
    last_seen: new Date().toISOString(),
    sensors: {
      temperature: 60 + Math.random() * 20 + (i === 1 ? 25 : 0),
      vibration:   0.5 + Math.random() * 1.5 + (i === 1 ? 3 : 0),
      pressure:    80 + Math.random() * 40,
      rpm:         1500 + Math.random() * 500,
    },
  }))
}

function mockAlerts() {
  return [
    { alert_id:"a1", machine_id:"M002", machine_name:"Motor Drive B",   machine_type:"motor",
      severity:"CRITICAL", timestamp: new Date(Date.now()-120000).toISOString(),
      anomaly_score:0.62, fault_type:"overheating",
      breach_details: JSON.stringify(["temperature=96.2°C > 75°C"]), resolved:false },
    { alert_id:"a2", machine_id:"M004", machine_name:"Conveyor Belt D", machine_type:"conveyor",
      severity:"WARNING", timestamp: new Date(Date.now()-600000).toISOString(),
      anomaly_score:0.18, fault_type:"vibration_spike",
      breach_details: JSON.stringify([]), resolved:false },
    { alert_id:"a3", machine_id:"M001", machine_name:"Compressor Unit A",machine_type:"compressor",
      severity:"WARNING", timestamp: new Date(Date.now()-3600000).toISOString(),
      anomaly_score:0.12, fault_type:"none",
      breach_details: JSON.stringify([]), resolved:true },
  ]
}

function mockReadings(machineId) {
  return Array.from({length: 30}, (_, i) => ({
    reading_id: `r${i}`,
    machine_id: machineId,
    timestamp: new Date(Date.now() - i * 5000).toISOString(),
    sensors: {
      temperature: 65 + Math.sin(i * 0.3) * 8 + Math.random() * 3,
      vibration:   1.2 + Math.sin(i * 0.5) * 0.5 + Math.random() * 0.2,
      pressure:    110 + Math.cos(i * 0.4) * 15 + Math.random() * 5,
      rpm:         1550 + Math.sin(i * 0.2) * 50 + Math.random() * 20,
    },
    anomaly_score: Math.max(0, 0.05 + Math.sin(i * 0.7) * 0.04 + Math.random() * 0.02),
    severity: "NORMAL",
  }))
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path) {
  if (!API_BASE) return null   // use mock
  const r = await fetch(`${API_BASE}${path}`)
  if (!r.ok) throw new Error(`API ${r.status}`)
  return r.json()
}

export default function App() {
  const [page, setPage] = useState("dashboard")          // dashboard | machine | alerts
  const [selectedMachine, setSelectedMachine] = useState(null)
  const [machines, setMachines] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchData = useCallback(async () => {
    try {
      const [mData, aData] = await Promise.all([
        apiFetch("/machines"),
        apiFetch("/alerts?resolved=false"),
      ])
      setMachines(mData || mockMachines())
      setAlerts(aData  || mockAlerts())
      setLastRefresh(new Date())
    } catch {
      setMachines(mockMachines())
      setAlerts(mockAlerts())
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-refresh every 5 s
  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 5000)
    return () => clearInterval(t)
  }, [fetchData])

  const fetchReadings = useCallback(async (machineId) => {
    try {
      const data = await apiFetch(`/readings?machine_id=${machineId}&limit=50`)
      return data || mockReadings(machineId)
    } catch {
      return mockReadings(machineId)
    }
  }, [])

  const resolveAlert = useCallback(async (alertId) => {
    if (API_BASE) {
      await fetch(`${API_BASE}/alerts/${alertId}/resolve`, { method: "PUT" })
    }
    setAlerts(prev => prev.map(a => a.alert_id === alertId ? {...a, resolved: true} : a))
  }, [])

  const openMachine = (machine) => {
    setSelectedMachine(machine)
    setPage("machine")
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="app-root">
      <Navbar page={page} setPage={setPage}
              alertCount={alerts.filter(a => !a.resolved && a.severity === "CRITICAL").length}
              lastRefresh={lastRefresh} />

      {page === "dashboard" &&
        <Dashboard machines={machines} alerts={alerts} onSelectMachine={openMachine} />}
      {page === "machine" && selectedMachine &&
        <MachineDetail machine={selectedMachine} fetchReadings={fetchReadings}
                       onBack={() => setPage("dashboard")} />}
      {page === "alerts" &&
        <AlertsPanel alerts={alerts} onResolve={resolveAlert}
                     onSelectMachine={openMachine} machines={machines} />}
    </div>
  )
}

function Navbar({ page, setPage, alertCount, lastRefresh }) {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="brand-icon">⬡</span>
        <span className="brand-name">PredictMaint</span>
        <span className="brand-sub">Industrial IoT Platform</span>
      </div>
      <div className="navbar-links">
        {[
          { key: "dashboard", label: "Dashboard" },
          { key: "alerts",    label: "Alerts", badge: alertCount },
        ].map(({key, label, badge}) => (
          <button key={key} className={`nav-btn ${page === key ? "active" : ""}`}
                  onClick={() => setPage(key)}>
            {label}
            {badge > 0 && <span className="badge">{badge}</span>}
          </button>
        ))}
      </div>
      <div className="navbar-meta">
        <span className="pulse-dot" />
        <span className="refresh-time">
          Live · {lastRefresh.toLocaleTimeString()}
        </span>
      </div>
    </nav>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-hex">⬡</div>
      <p>Connecting to IoT sensors…</p>
    </div>
  )
}
