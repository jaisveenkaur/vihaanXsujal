import { useEffect, useState, useRef, useMemo, Component } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

if (typeof window !== 'undefined') {
  window.L = L
}
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Check,
  ChevronDown,
  Compass,
  Cpu,
  Download,
  Droplets,
  Eye,
  FileSpreadsheet,
  FileText,
  Flame,
  Gauge,
  Info,
  LayoutDashboard,
  Lock,
  Map as MapIcon,
  MapPin,
  Menu,
  Navigation,
  Power,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  SlidersHorizontal,
  Unlock,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { auth, db, firebaseReady } from './firebase'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import sujalLogo from './assets/sujal_monochrome_symbol_white.svg'
import './App.css'

// --- Mock / Seed Data exactly matching design specifications ---

const ALERTS_DATA = [
  {
    id: 'ALT-101',
    severity: 'High',
    type: 'Measured excursion',
    title: 'Measured turbidity 5.8 NTU exceeds configured operating limit 5.0 NTU',
    node: 'SJ-01 · River View inlet',
    time: '27 Oct 2026 10:32:15 IST',
    status: 'Open',
    triageScore: '78/100',
    detail: 'Turbidity excursion above operating limit (5.8 NTU measured vs 5.0 NTU limit).',
    actionSteps: [
      'Verify inlet sensor calibration and confirm household supply connection.',
      'Review telemetry packet completeness and confirm node heartbeat.',
      'Escalate to field support if turbidity remains above 5.0 NTU.',
    ],
  },
  {
    id: 'ALT-102',
    severity: 'High',
    type: 'Device / data quality',
    title: 'Device/data quality intermittent telemetry, 92% packet completeness last hour',
    node: 'SJ-01 · River View inlet',
    time: '27 Oct 2026 10:31:48 IST',
    status: 'Open',
    triageScore: '81/100',
    detail: '92% packet completeness in the last hour. Missing packets are not measured water values.',
    actionSteps: [
      'Confirm node heartbeat and radio link.',
      'Inspect packet gaps before interpreting trends.',
      'Check power supply voltage and antenna connection.',
    ],
  },
  {
    id: 'ALT-103',
    severity: 'Review',
    type: 'AI interpretation',
    title: 'AI interpretation of rising turbidity and incomplete telemetry',
    node: 'SJ-01 · River View inlet',
    time: '27 Oct 2026 10:31:12 IST',
    status: 'Open',
    triageScore: '42/100',
    detail: 'Rising turbidity with incomplete telemetry. Inference from Gemini, not a verified physical finding.',
    actionSteps: [
      'Compare source readings, calibration and packet gaps.',
      'Operator review is required before manual action.',
    ],
  },
]

const MONTHLY_DATASETS = [
  { month: 'October 2026', range: '01–27 Oct', status: 'Current / Partial', samples: '1,248', complete: '82%', missing: '18%', archived: false },
  { month: 'September 2026', range: '01–30 Sep', status: 'Closed · Pending transfer', samples: '2,880', complete: '100%', missing: '0%', archived: false },
  { month: 'August 2026', range: '01–31 Aug', status: 'Closed', samples: '2,880', complete: '100%', missing: '0%', archived: false },
  { month: 'July 2026', range: '01–31 Jul', status: 'Closed · Available', samples: '44,640', complete: '98.7%', missing: '1.3%', archived: true, filename: 'SJ-01_2026-07.csv', days: '31 / 31', missingReadings: '580 / 45,220', size: '~3.8 MB', date: '03 Aug 2026 00:14 IST' },
  { month: 'June 2026', range: '01–30 Jun', status: 'Closed · Available', samples: '43,200', complete: '99.2%', missing: '0.8%', archived: true, filename: 'SJ-01_2026-06.csv', days: '30 / 30', missingReadings: '340 / 43,540', size: '~3.6 MB', date: '02 Jul 2026 00:10 IST' },
  { month: 'May 2026', range: '01–31 May', status: 'Closed · Minor gaps', samples: '43,804', complete: '94.1%', missing: '5.9%', archived: true, filename: 'SJ-01_2026-05.csv', days: '31 / 31', missingReadings: '2,610 / 46,414', size: '~3.7 MB', date: '03 Jun 2026 00:18 IST' },
  { month: 'April 2026', range: '01–30 Apr', status: 'Closed', samples: '2,880', complete: '92%', missing: '8%', archived: true, filename: 'SJ-01_2026-04.csv', days: '30 / 30', missingReadings: '240 / 3,120', size: '~1.1 MB', date: '02 May 2026 00:12 IST' },
]

const TELEMETRY_LOGS = [
  { id: 'EVT-2026-1027-0009', time: '10:31:04 IST', node: 'SJ-01', type: 'DATA QUALITY', status: 'INCOMPLETE', payload: 'Telemetry gap detected — 92% packet completeness over last hour', score: 81 },
  { id: 'EVT-2026-1027-0008', time: '10:30:47 IST', node: 'SJ-01', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 5.8 NTU exceeds SJ-01 configured limit 5.0 NTU', score: 78 },
  { id: 'EVT-2026-1027-0007', time: '10:29:58 IST', node: 'SJ-01', type: 'AI INTERPRET', status: 'PENDING REVIEW', payload: 'AI model flagged multi-parameter correlation; turbidity rise + MQ5 stable', score: 42 },
  { id: 'EVT-2026-1027-0006', time: '10:28:30 IST', node: 'SJ-01', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 5.6 NTU · pH 7.2 · Temp 24.5 °C · MQ5 0.66 V', score: 12 },
  { id: 'EVT-2026-1027-0005', time: '10:25:00 IST', node: 'SJ-01', type: 'DATA QUALITY', status: 'DROPPED', payload: '3 consecutive packets dropped (seq 0x4A1C-0x4A1E). Uplink RSSI -92 dBm', score: 55 },
  { id: 'EVT-2026-1027-0004', time: '10:20:01 IST', node: 'SJ-01', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 4.9 NTU · pH 7.1 · Temp 24.5 °C · MQ5 0.65 V', score: 10 },
  { id: 'EVT-2026-1027-0003', time: '10:00:00 IST', node: 'SJ-01', type: 'SYSTEM', status: 'ACKNOWLEDGED', payload: 'Configured operating limit updated: 4.5 -> 5.0 NTU by illustrative operator', score: 8 },
  { id: 'EVT-2026-1027-0002', time: '09:50:15 IST', node: 'SJ-01', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 4.7 NTU · pH 7.0 · Temp 24.1 °C · MQ5 0.64 V', score: 11 },
  { id: 'EVT-2026-1027-0001', time: '09:31:02 IST', node: 'SJ-01', type: 'SYSTEM', status: 'ACKNOWLEDGED', payload: 'Device boot complete. Firmware v3.1.7. Sensor self-test passed.', score: 6 },
]

// --- React Error Boundary ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI Error Caught by ErrorBoundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', background: '#111726', color: '#f1f5f9', borderRadius: 10, margin: 24, border: '1px solid #1b253b' }}>
          <div className="badge-pill orange" style={{ marginBottom: 14 }}>Display Notice</div>
          <h2 style={{ marginBottom: 8 }}>Unable to load view</h2>
          <p style={{ color: '#8c8884', fontSize: 13, marginBottom: 18 }}>{this.state.error?.message || 'A display error occurred'}</p>
          <button className="btn-action-primary" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}>
            Reload Application
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// --- NASA GIBS Realtime Satellite Map Component ---
function NasaSatelliteMap({ nodes, selectedNode, onSelectNode, currentLayer, showOverlays, liveState, onMapClick, adminOverrides }) {
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const baseLayersRef = useRef({})
  const labelsLayerRef = useRef(null)
  const markersLayerRef = useRef(null)
  const boundsLayerRef = useRef(null)
  const markersRef = useRef({})
  const [mapError, setMapError] = useState(null)

  useEffect(() => {
    if (!mapContainerRef.current) return undefined

    try {
      // Fix default Leaflet icon paths in Vite
      if (L.Icon && L.Icon.Default && L.Icon.Default.prototype._getIconUrl) {
        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        })
      }

      // Clean up residual Leaflet ID to prevent initialization collision
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
      if (mapContainerRef.current._leaflet_id) {
        mapContainerRef.current._leaflet_id = null
        delete mapContainerRef.current._leaflet_id
      }

      const defaultLat = selectedNode?.lat || 28.6139
      const defaultLon = selectedNode?.lon || 77.2090

      const map = L.map(mapContainerRef.current, {
        center: [defaultLat, defaultLon],
        zoom: 16,
        minZoom: 2,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: true,
      })
      mapInstanceRef.current = map

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      // 1. High-Res Street & River Hybrid Satellite (Esri World Imagery)
      const streetSatLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: '&copy; Esri & OpenStreetMap',
        }
      )

      // 2. NASA Realtime VIIRS TrueColor (Suomi-NPP) - Latest available daily composite
      const viirsLayer = L.tileLayer(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
        {
          maxNativeZoom: 9,
          maxZoom: 19,
          tileSize: 256,
          subdomains: 'abc',
          attribution: '&copy; <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA EOSDIS GIBS</a>',
        }
      )

      // 3. NASA Terra MODIS TrueColor - Daily multispectral reflectance
      const terraLayer = L.tileLayer(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
        {
          maxNativeZoom: 9,
          maxZoom: 19,
          tileSize: 256,
          subdomains: 'abc',
          attribution: '&copy; <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA Terra MODIS</a>',
        }
      )

      // 4. NASA Earth at Night (Black Marble) - Night lights observation
      const nightLayer = L.tileLayer(
        'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_BlackMarble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
        {
          maxNativeZoom: 8,
          maxZoom: 19,
          tileSize: 256,
          subdomains: 'abc',
          attribution: '&copy; <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA Black Marble</a>',
        }
      )

      // 5. Clean Oceanic Cyber SCADA Dark Map (CartoDB Dark Matter)
      const cartoDarkLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
          maxZoom: 20,
          subdomains: 'abcd',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        }
      )

      baseLayersRef.current = {
        'street-sat': streetSatLayer,
        'carto-dark': cartoDarkLayer,
        'nasa-viirs': viirsLayer,
        'nasa-terra': terraLayer,
        'nasa-night': nightLayer,
      }

      const activeBase = baseLayersRef.current[currentLayer] || streetSatLayer
      activeBase.addTo(map)

      // Transparent street, waterway & place labels overlay (100% free, no API key required)
      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          zIndex: 600,
          attribution: '&copy; Esri & OpenStreetMap',
        }
      )
      labelsLayerRef.current = labels
      if (showOverlays) {
        labels.addTo(map)
      }

      // Initialize dedicated LayerGroups for dynamic markers and bounds
      const markersGroup = L.layerGroup().addTo(map)
      markersLayerRef.current = markersGroup

      const boundsGroup = L.layerGroup().addTo(map)
      boundsLayerRef.current = boundsGroup

      // Map click handler to place or reposition node
      map.on('click', (e) => {
        if (onMapClick) {
          onMapClick(e.latlng.lat, e.latlng.lng)
        }
      })

      // Invalidate size on load and on resize
      const timers = [
        setTimeout(() => map.invalidateSize(), 50),
        setTimeout(() => map.invalidateSize(), 200),
        setTimeout(() => map.invalidateSize(), 600),
      ]

      const handleResize = () => map.invalidateSize()
      window.addEventListener('resize', handleResize)

      return () => {
        timers.forEach(clearTimeout)
        window.removeEventListener('resize', handleResize)
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove()
          mapInstanceRef.current = null
        }
      }
    } catch (err) {
      console.error('NasaSatelliteMap error:', err)
      setTimeout(() => setMapError(err.message || 'Error initializing satellite map engine'), 0)
    }
  }, [])

  // Dynamic Markers & Perimeter Updates
  useEffect(() => {
    try {
      const map = mapInstanceRef.current
      const markersGroup = markersLayerRef.current
      const boundsGroup = boundsLayerRef.current
      if (!map || !markersGroup || !boundsGroup || !nodes) return

      markersGroup.clearLayers()
      boundsGroup.clearLayers()
      markersRef.current = {}

      nodes.forEach((node) => {
        const isSelected = selectedNode?.id === node.id
        const pinColor = isSelected
          ? '#0ea5e9'
          : node.id === 'SJ-01'
          ? '#10b981'
          : node.simulated
          ? '#a855f7'
          : node.color === 'green'
          ? '#10b981'
          : node.color === 'amber'
          ? '#f59e0b'
          : '#64748b'

        const customIcon = L.divIcon({
          className: 'custom-nasa-pin',
          iconSize: [80, 50],
          iconAnchor: [40, 36],
          html: `
            <div class="nasa-pin-wrapper ${isSelected ? 'selected' : ''}">
              <div class="nasa-pin-tag">${node.id}${isSelected ? ' ★' : ''}</div>
              <div class="nasa-pin-core" style="background:${pinColor}">
                <div class="nasa-pin-center"></div>
                ${isSelected ? '<div class="nasa-pin-pulse"></div>' : ''}
              </div>
            </div>
          `,
        })

        const marker = L.marker([node.lat, node.lon], { icon: customIcon }).addTo(markersGroup)
        marker.on('click', () => {
          onSelectNode(node)
        })

        marker.bindPopup(`
          <div class="nasa-popup">
            <div class="popup-title"><b>${node.id}</b> · ${node.name}</div>
            <div class="popup-sub">GPS: ${node.lat.toFixed(5)}° N, ${node.lon.toFixed(5)}° E</div>
            <div class="popup-status">Status: <b>${node.status}</b></div>
            ${node.id === 'SJ-01' ? `
              <div class="popup-metrics">
                <span>Turb: <b>${adminOverrides?.turbidityOverride ? `${adminOverrides.turbidityValue.toFixed(1)} NTU [OVR]` : `${liveState?.sensor_data?.turbidity_sensor?.value ?? 5.8} NTU`}</b></span>
                <span>pH: <b>${adminOverrides?.phOverride ? `${adminOverrides.phValue.toFixed(2)} [OVR]` : `${liveState?.sensor_data?.ph_sensor?.value ?? 7.2}`}</b></span>
                <span>MQ-5: <b>${adminOverrides?.mq5Override ? `${adminOverrides.mq5Value.toFixed(2)} V [OVR]` : `${liveState?.sensor_data?.mq5_sensor?.voltage ?? 0.66} V`}</b></span>
              </div>
            ` : node.simulated ? `
              <div class="popup-metrics">
                <span>Turb: <b>${node.turbidity ?? 3.2} NTU</b></span>
                <span>pH: <b>${node.ph ?? 7.1}</b></span>
                <span>MQ-5: <b>${node.mq5 ?? 0.58} V</b></span>
              </div>
              <button onclick="window.__showNearestLiveNode && window.__showNearestLiveNode()" style="margin-top:8px;width:100%;background:linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%);color:#fff;border:none;padding:5px 8px;border-radius:4px;font-size:10px;cursor:pointer;font-weight:600;display:flex;align-items:center;justify-content:center;gap:4px;">
                📍 Show Nearest Live Node
              </button>
            ` : ''}
          </div>
        `, { className: 'dark-leaflet-popup' })

        markersRef.current[node.id] = marker
      })

      // Add accuracy perimeter & site boundary around selected node
      if (selectedNode) {
        L.circle([selectedNode.lat, selectedNode.lon], {
          radius: selectedNode.accuracy ? Math.max(selectedNode.accuracy * 2, 25) : 35,
          color: '#35aa83',
          weight: 1.5,
          dashArray: '3, 4',
          fillColor: '#35aa83',
          fillOpacity: 0.12,
        }).addTo(boundsGroup)

        const dLat = 0.0022
        const dLon = 0.0032
        const siteBounds = [
          [selectedNode.lat - dLat, selectedNode.lon - dLon],
          [selectedNode.lat + dLat, selectedNode.lon + dLon],
        ]
        L.rectangle(siteBounds, {
          color: '#2c94bd',
          weight: 1.5,
          dashArray: '4, 4',
          fillColor: '#2c94bd',
          fillOpacity: 0.06,
        }).addTo(boundsGroup)
      }
    } catch (e) {
      console.warn('Marker render error:', e)
    }
  }, [nodes, selectedNode?.id, selectedNode?.lat, selectedNode?.lon, liveState, adminOverrides])

  // Switch base layers
  useEffect(() => {
    try {
      const map = mapInstanceRef.current
      if (!map || !baseLayersRef.current) return
      Object.keys(baseLayersRef.current).forEach((key) => {
        const layer = baseLayersRef.current[key]
        if (!layer) return
        if (key === currentLayer) {
          if (!map.hasLayer(layer)) layer.addTo(map)
        } else {
          if (map.hasLayer(layer)) map.removeLayer(layer)
        }
      })
    } catch (e) {
      console.warn('Layer switch error:', e)
    }
  }, [currentLayer])

  // Switch overlays
  useEffect(() => {
    try {
      const map = mapInstanceRef.current
      const labels = labelsLayerRef.current
      if (!map || !labels) return
      if (showOverlays) {
        if (!map.hasLayer(labels)) labels.addTo(map)
      } else {
        if (map.hasLayer(labels)) map.removeLayer(labels)
      }
    } catch (e) {
      console.warn('Overlay switch error:', e)
    }
  }, [showOverlays])

  // Pan to selected node
  useEffect(() => {
    try {
      const map = mapInstanceRef.current
      if (!map || !selectedNode) return
      map.flyTo([selectedNode.lat, selectedNode.lon], Math.max(map.getZoom(), 16), { animate: true, duration: 0.8 })
      const marker = markersRef.current[selectedNode.id]
      if (marker) {
        marker.openPopup()
      }
    } catch (e) {
      console.warn('Pan error:', e)
    }
  }, [selectedNode?.id, selectedNode?.lat, selectedNode?.lon])

  if (mapError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 640, background: '#080b11', color: '#f1f5f9', gap: 12 }}>
        <div className="badge-pill orange">Satellite Engine Notice</div>
        <p style={{ color: '#94a3b8', fontSize: '13px' }}>{mapError}</p>
        <button className="btn-action-primary" onClick={() => setMapError(null)}>Retry Map Connection</button>
      </div>
    )
  }

  return (
    <div
      ref={mapContainerRef}
      id="nasa-leaflet-map"
      style={{
        width: '100%',
        height: '100%',
        minHeight: '640px',
        position: 'relative',
        background: '#080b11',
      }}
    />
  )
}

// --- SVG Chart Component ---
function AreaTrendChart({ dataPoints, minVal, maxVal, color = '#2c94bd', showExcursion = false, excursionLimit = 5.0, yLabels = [] }) {
  const width = 360
  const height = 130
  const padL = 36
  const padR = 14
  const padT = 12
  const padB = 24

  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const valRange = maxVal - minVal || 1
  const coords = dataPoints.map((pt, i) => {
    const x = dataPoints.length === 1 ? padL + plotW / 2 : padL + (i * plotW) / (dataPoints.length - 1)
    const y = padT + plotH - ((pt.val - minVal) / valRange) * plotH
    return { x, y, val: pt.val, time: pt.time }
  })

  const pathD = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.y.toFixed(1)}`, '')
  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`

  // Excursion line Y
  const excY = padT + plotH - ((excursionLimit - minVal) / valRange) * plotH

  return (
    <div className="chart-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        {yLabels.map((yl) => {
          const yPos = padT + plotH - ((yl - minVal) / valRange) * plotH
          return (
            <g key={yl}>
              <line x1={padL} y1={yPos} x2={width - padR} y2={yPos} stroke="#1b253b" strokeDasharray="2,3" />
              <text x={padL - 6} y={yPos + 3} fill="#64748b" fontSize="9" textAnchor="end">
                {yl}
              </text>
            </g>
          )
        })}

        {/* Excursion threshold line if applicable */}
        {showExcursion && excY >= padT && excY <= padT + plotH && (
          <line x1={padL} y1={excY} x2={width - padR} y2={excY} stroke="#e06836" strokeDasharray="3,3" strokeWidth="1.2" />
        )}

        {/* Shaded Area */}
        <path d={areaD} fill={`url(#grad-${color.replace('#', '')})`} />

        {/* Line Curve */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Last Point Bullet */}
        {coords.length > 0 && (
          <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="3.5" fill={color} />
        )}

        {/* Time X-axis labels */}
        {coords.map((c, i) => {
          if (i === 0 || i === Math.floor(coords.length / 3) || i === Math.floor((coords.length * 2) / 3) || i === coords.length - 1) {
            return (
              <text key={i} x={c.x} y={height - 6} fill="#78736d" fontSize="9" textAnchor={i === 0 ? 'start' : i === coords.length - 1 ? 'end' : 'middle'}>
                {c.time}
              </text>
            )
          }
          return null
        })}
      </svg>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Water Quality Monitor')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState(ALERTS_DATA[0])
  const [alertsList, setAlertsList] = useState(ALERTS_DATA)
  const [selectedMonth, setSelectedMonth] = useState(MONTHLY_DATASETS[3]) // July 2026 default
  const [filterMonthTab, setFilterMonthTab] = useState('October 2026')
  const [selectedLogEvent, setSelectedLogEvent] = useState(TELEMETRY_LOGS[0])
  const [logFilter, setLogFilter] = useState('All Types')
  const [user, setUser] = useState(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const triggerToast = (msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3500)
  }
  const [liveState, setLiveState] = useState(null)
  const [liveReadings, setLiveReadings] = useState([])
  const [liveAlerts, setLiveAlerts] = useState(null)
  const [liveCommands, setLiveCommands] = useState([])
  const [firestoreError, setFirestoreError] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  // Live Device Location State (persisted to localStorage)
  const [deviceLocation, setDeviceLocation] = useState(() => {
    try {
      const saved = localStorage.getItem('sujal_live_device_location')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
          return parsed
        }
      }
    } catch {
      // Ignore storage read error
    }
    return {
      lat: 28.6139,
      lon: 77.2090,
      accuracy: 4,
      source: 'Default Field Site',
      address: 'River View inlet · North River District',
    }
  })
  const [isLocating, setIsLocating] = useState(false)
  const [showCoordModal, setShowCoordModal] = useState(false)
  const [manualLat, setManualLat] = useState(() => deviceLocation?.lat ? deviceLocation.lat.toString() : '28.6139')
  const [manualLon, setManualLon] = useState(() => deviceLocation?.lon ? deviceLocation.lon.toString() : '77.2090')
  const [manualAddress, setManualAddress] = useState(() => deviceLocation?.address || 'River View inlet')
  const [selectedMapNodeId, setSelectedMapNodeId] = useState('SJ-01')
  const [mapLayer, setMapLayer] = useState('street-sat')
  const [showMapOverlays, setShowMapOverlays] = useState(true)

  // Admin & Operator Authentication State
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
    try {
      return sessionStorage.getItem('sujal_admin_auth') === 'true'
    } catch {
      return false
    }
  })
  const [adminAuthOpen, setAdminAuthOpen] = useState(false)
  const [adminAuthEmail, setAdminAuthEmail] = useState('operator@sujal.com')
  const [adminAuthPassword, setAdminAuthPassword] = useState('')
  const [adminAuthError, setAdminAuthError] = useState('')

  // Hardware Manual Overrides & Component Toggles State
  const [adminOverrides, setAdminOverrides] = useState({
    turbidityOverride: false,
    turbidityValue: 5.8,
    phOverride: false,
    phValue: 7.2,
    mq5Override: false,
    mq5Value: 0.66,
    tempOverride: false,
    tempValue: 24.6,
    tankLevelOverride: false,
    tankLevelValue: 84,
    flowOverride: false,
    flowValue: 18.5,
    mainValve: 'OPEN',
    dosingPump: 'STOPPED',
    dosingMode: 'AUTO',
    flushValve: 'CLOSED',
    uvSterilizer: 'ACTIVE',
    buzzerAlarm: 'SILENCED',
    telemetryRate: '10s',
    loraChannel: 'Channel 1 (915.0 MHz)',
    simulationMode: false,
  })

  // Dispatched commands log for the admin console
  const [adminCommandLogs, setAdminCommandLogs] = useState([
    { id: 'CMD-9021', time: '10:32:00 IST', target: 'MAIN_VALVE', action: 'OPEN', status: 'ACKNOWLEDGED', operator: 'operator@sujal.com' },
    { id: 'CMD-9020', time: '10:15:30 IST', target: 'UV_CHAMBER', action: 'ARM_ACTIVE', status: 'ACKNOWLEDGED', operator: 'operator@sujal.com' },
    { id: 'CMD-9019', time: '09:48:12 IST', target: 'TELEMETRY_BUS', action: 'RATE_10S', status: 'ACKNOWLEDGED', operator: 'operator@sujal.com' },
  ])

  const cmdCounterRef = useRef(9022)
  const handleAdminCommand = (target, action, payload = {}) => {
    cmdCounterRef.current += 1
    const newLog = {
      id: `CMD-${cmdCounterRef.current}`,
      time: new Date().toLocaleTimeString('en-IN', { hour12: false }) + ' IST',
      target,
      action,
      status: 'DISPATCHED_TO_ESP32',
      operator: 'operator@sujal.com',
      ...payload,
    }
    setAdminCommandLogs((prev) => [newLog, ...prev.slice(0, 14)])
    triggerToast(`⚡ ${target}: Commanded to ${action}`)

    if (user && db) {
      addDoc(collection(db, 'devices', 'SUJAL_01', 'commands'), {
        command: `ADMIN_${target}_${action}`,
        target,
        action,
        status: 'pending',
        requested_by: 'operator@sujal.com',
        created_at: serverTimestamp(),
        ...payload,
      }).catch((e) => console.debug('Firestore command queue note:', e))
    }
  }

  const resetAllOverrides = () => {
    setAdminOverrides({
      turbidityOverride: false,
      turbidityValue: 5.8,
      phOverride: false,
      phValue: 7.2,
      mq5Override: false,
      mq5Value: 0.66,
      tempOverride: false,
      tempValue: 24.6,
      tankLevelOverride: false,
      tankLevelValue: 84,
      flowOverride: false,
      flowValue: 18.5,
      mainValve: 'OPEN',
      dosingPump: 'STOPPED',
      dosingMode: 'AUTO',
      flushValve: 'CLOSED',
      uvSterilizer: 'ACTIVE',
      buzzerAlarm: 'SILENCED',
      telemetryRate: '10s',
      loraChannel: 'Channel 1 (915.0 MHz)',
      simulationMode: false,
    })
    handleAdminCommand('SYSTEM_BUS', 'RESET_TO_AUTO_HARDWARE')
    triggerToast('🔄 All sensor and actuator overrides reset to Hardware Auto.')
  }

  // Dynamic Map Nodes centered around the live device location
  const dynamicMapNodes = useMemo(() => {
    const baseLat = deviceLocation.lat
    const baseLon = deviceLocation.lon
    return [
      {
        id: 'SJ-01',
        name: deviceLocation.address || 'River View inlet · Main Station',
        status: `Live · ${deviceLocation.source || 'GPS Lock'}`,
        lat: baseLat,
        lon: baseLon,
        color: 'green',
        selected: true,
        accuracy: deviceLocation.accuracy || 4,
        source: deviceLocation.source || 'Live GPS',
        isLive: true,
        simulated: false,
      },
      {
        id: 'SIM-02',
        name: 'Canal Distribution Post (Simulated)',
        status: 'Simulated Node',
        lat: Number((baseLat + 0.0035).toFixed(5)),
        lon: Number((baseLon - 0.0028).toFixed(5)),
        color: 'purple',
        accuracy: 6,
        isLive: false,
        simulated: true,
        temp: 23.8,
        ph: 7.10,
        turbidity: 3.2,
        mq5: 0.58,
      },
      {
        id: 'SIM-03',
        name: 'Reservoir Outflow Tank (Simulated)',
        status: 'Simulated Node',
        lat: Number((baseLat - 0.0028).toFixed(5)),
        lon: Number((baseLon - 0.0035).toFixed(5)),
        color: 'purple',
        accuracy: 8,
        isLive: false,
        simulated: true,
        temp: 24.2,
        ph: 7.35,
        turbidity: 2.9,
        mq5: 0.62,
      },
      {
        id: 'SIM-04',
        name: 'Eastern Treatment Line (Simulated)',
        status: 'Simulated Node',
        lat: Number((baseLat + 0.0022).toFixed(5)),
        lon: Number((baseLon + 0.0031).toFixed(5)),
        color: 'purple',
        accuracy: 7,
        isLive: false,
        simulated: true,
        temp: 24.5,
        ph: 6.95,
        turbidity: 4.1,
        mq5: 0.65,
      },
      {
        id: 'SIM-05',
        name: 'South Sludge Siphon (Simulated)',
        status: 'Simulated Node',
        lat: Number((baseLat - 0.0021).toFixed(5)),
        lon: Number((baseLon + 0.0032).toFixed(5)),
        color: 'amber',
        accuracy: 10,
        isLive: false,
        simulated: true,
        temp: 25.1,
        ph: 6.80,
        turbidity: 6.4,
        mq5: 0.72,
      },
      {
        id: 'SIM-06',
        name: 'West Agricultural Bypass (Simulated)',
        status: 'Simulated Node',
        lat: Number((baseLat + 0.0015).toFixed(5)),
        lon: Number((baseLon - 0.0042).toFixed(5)),
        color: 'purple',
        accuracy: 9,
        isLive: false,
        simulated: true,
        temp: 23.9,
        ph: 7.15,
        turbidity: 3.1,
        mq5: 0.55,
      },
    ]
  }, [deviceLocation])

  const selectedMapNode = useMemo(() => {
    return dynamicMapNodes.find((n) => n.id === selectedMapNodeId) || dynamicMapNodes[0]
  }, [dynamicMapNodes, selectedMapNodeId])

  const setSelectedMapNode = (nodeOrId) => {
    if (typeof nodeOrId === 'string') {
      setSelectedMapNodeId(nodeOrId)
    } else if (nodeOrId && nodeOrId.id) {
      setSelectedMapNodeId(nodeOrId.id)
    }
  }

  // Auto-sync hardware GPS telemetry when received from ESP32 via Firestore
  useEffect(() => {
    const loc = liveState?.location || liveState?.gps
    if (!loc) return undefined
    const lat = typeof loc.lat === 'number' ? loc.lat : typeof loc.latitude === 'number' ? loc.latitude : null
    const lon = typeof loc.lon === 'number' ? loc.lon : typeof loc.longitude === 'number' ? loc.longitude : typeof loc.lng === 'number' ? loc.lng : null
    if (lat !== null && lon !== null) {
      const roundedLat = Number(lat.toFixed(5))
      const roundedLon = Number(lon.toFixed(5))
      const timer = setTimeout(() => {
        setDeviceLocation((prev) => {
          if (prev.lat === roundedLat && prev.lon === roundedLon) return prev
          const next = {
            lat: roundedLat,
            lon: roundedLon,
            accuracy: loc.accuracy || 3,
            source: 'ESP32 Hardware GPS',
            address: loc.address || 'ESP32 Live Site Station',
          }
          try {
            localStorage.setItem('sujal_live_device_location', JSON.stringify(next))
          } catch {
            // Ignore storage write error
          }
          return next
        })
        setManualLat(roundedLat.toString())
        setManualLon(roundedLon.toString())
      }, 0)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [liveState])

  // Detect live physical GPS location using browser Geolocation API
  const detectLiveLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      triggerToast('Browser geolocation is not available on this device.')
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newLoc = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lon: Number(pos.coords.longitude.toFixed(5)),
          accuracy: Math.round(pos.coords.accuracy || 4),
          source: 'Live Browser GPS',
          address: 'Physical Device Deployment Site',
        }
        setDeviceLocation(newLoc)
        setManualLat(newLoc.lat.toString())
        setManualLon(newLoc.lon.toString())
        try {
          localStorage.setItem('sujal_live_device_location', JSON.stringify(newLoc))
        } catch {
      // Ignore storage read error
    }
        setIsLocating(false)
        triggerToast(`📍 Live GPS Locked: ${newLoc.lat}° N, ${newLoc.lon}° E (±${newLoc.accuracy}m)`)
      },
      (err) => {
        setIsLocating(false)
        console.warn('Geolocation error:', err)
        triggerToast(`GPS error: ${err.message}. You can set coordinates manually.`)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    )
  }

  // Handle clicking on map to reposition SJ-01
  const handleMapClick = (lat, lon) => {
    const roundedLat = Number(lat.toFixed(5))
    const roundedLon = Number(lon.toFixed(5))
    const newLoc = {
      ...deviceLocation,
      lat: roundedLat,
      lon: roundedLon,
      accuracy: 3,
      source: 'Interactive Map Pinpoint',
      address: 'Field Point Selection',
    }
    setDeviceLocation(newLoc)
    setManualLat(roundedLat.toString())
    setManualLon(roundedLon.toString())
    try {
      localStorage.setItem('sujal_live_device_location', JSON.stringify(newLoc))
    } catch {
      // Ignore storage read error
    }
    triggerToast(`📍 SJ-01 repositioned to ${roundedLat}° N, ${roundedLon}° E`)
  }

  // Global helper for simulated node popups to switch to nearest live node
  useEffect(() => {
    window.__showNearestLiveNode = () => {
      setSelectedMapNodeId('SJ-01')
      triggerToast('📍 Switched to Nearest Live Node: SJ-01')
    }
    return () => {
      delete window.__showNearestLiveNode
    }
  }, [])

  useEffect(() => {
    if (!firebaseReady) return undefined
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        setLiveState(null)
        setLiveReadings([])
        setLiveAlerts(null)
        setLiveCommands([])
        setFirestoreError('')
      }
    })
  }, [])

  useEffect(() => {
    if (!firebaseReady || !user || !db) return undefined
    const device = doc(db, 'devices', 'SUJAL_01')
    const unsubscribers = [
      onSnapshot(doc(device, 'state', 'latest'), (snapshot) => setLiveState(snapshot.exists() ? snapshot.data() : null), (error) => setFirestoreError(error.message)),
      onSnapshot(query(collection(device, 'readings'), orderBy('recorded_at', 'desc'), limit(60)), (snapshot) => setLiveReadings(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse()), (error) => setFirestoreError(error.message)),
      onSnapshot(query(collection(device, 'alerts'), orderBy('updated_at', 'desc'), limit(30)), (snapshot) => setLiveAlerts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setFirestoreError(error.message)),
      onSnapshot(query(collection(device, 'commands'), orderBy('created_at', 'desc'), limit(10)), (snapshot) => setLiveCommands(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => setFirestoreError(error.message)),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [user])

  const handleAcknowledgeAlert = async (id) => {
    if (user && db && liveAlerts) {
      try {
        await updateDoc(doc(db, 'devices', 'SUJAL_01', 'alerts', id), {
          status: 'acknowledged', acknowledged_by: user.uid,
          acknowledged_at: serverTimestamp(), updated_at: serverTimestamp(),
        })
        triggerToast(`Alert ${id} acknowledged.`)
      } catch (error) { triggerToast(`Could not acknowledge alert: ${error.message}`) }
      return
    }
    setAlertsList((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'Acknowledged', severity: 'Resolved' } : a))
    )
    triggerToast(`Alert ${id} acknowledged.`)
  }

  const queueDeviceCommand = async (command, value) => {
    if (!user && !isAdminAuthenticated) { setLoginOpen(true); return }
    setCommandBusy(true)
    try {
      const fields = command === 'SET_CHANNEL' ? { selected_channel: value } : { mode: value }
      if (user && db) {
        await addDoc(collection(db, 'devices', 'SUJAL_01', 'commands'), {
          command, status: 'pending', requested_by: user.uid, created_at: serverTimestamp(), ...fields,
        })
      }
      handleAdminCommand(
        command === 'SET_CHANNEL' ? 'BRANCH_CHANNEL' : 'DEVICE_MODE',
        command === 'SET_CHANNEL' ? `SWITCH_BRANCH_${value}` : `SET_${value}`,
        fields
      )
      triggerToast(`${command === 'SET_CHANNEL' ? `Branch ${value}` : `Mode ${value}`} command queued for ESP32.`)
    } catch (error) { triggerToast(`Command was not queued: ${error.message}`) }
    finally { setCommandBusy(false) }
  }

  const downloadCsvMock = (name) => {
    const headers = ['recorded_at', 'device_id', 'sequence', 'temperature_c', 'ph', 'turbidity_ntu', 'mq5_voltage', 'inlet_flow_lpm', 'channel_a_flow_lpm', 'channel_b_flow_lpm', 'selected_channel', 'mode']
    const rows = liveReadings.map((item) => [
      item.recorded_at?.toDate?.().toISOString() || '', item.device_id || 'SUJAL_01', item.sequence ?? '',
      item.sensor_data?.temperature_sensor?.value ?? '', item.sensor_data?.ph_sensor?.value ?? '',
      item.sensor_data?.turbidity_sensor?.value ?? '', item.sensor_data?.mq5_sensor?.voltage ?? '',
      item.sensor_data?.flow_sensors?.inlet?.flow_rate_lpm ?? '', item.sensor_data?.flow_sensors?.channel_a?.flow_rate_lpm ?? '',
      item.sensor_data?.flow_sensors?.channel_b?.flow_rate_lpm ?? '', item.selected_channel || '', item.mode || '',
    ])
    const escapeCsv = (value) => `"${String(value).replaceAll('"', '""')}"`
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv || `${headers.join(',')}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  // --- Screens ---

  // 1. Water Quality Monitor Screen
  const renderMonitorScreen = () => {
    const sensors = liveState?.sensor_data
    const reading = (value, digits = 1) => typeof value === 'number' ? value.toFixed(digits) : '—'
    const temp = adminOverrides.tempOverride ? adminOverrides.tempValue : sensors?.temperature_sensor?.value
    const ph = adminOverrides.phOverride ? adminOverrides.phValue : sensors?.ph_sensor?.value
    const turbidity = adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : sensors?.turbidity_sensor?.value
    const gas = adminOverrides.mq5Override ? adminOverrides.mq5Value : sensors?.mq5_sensor?.voltage
    const livePoints = (key) => liveReadings.map((item) => {
      const val = key(item)
      const date = item.recorded_at?.toDate?.()
      return typeof val === 'number' ? { val, time: date ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '' } : null
    }).filter(Boolean).slice(-12)
    const demoTempPoints = [
      { time: '09:00', val: 24.1 },
      { time: '09:30', val: 24.3 },
      { time: '10:00', val: 24.4 },
      { time: '10:32', val: 24.6 },
    ]
    const demoPhPoints = [
      { time: '09:00', val: 7.0 },
      { time: '09:30', val: 7.1 },
      { time: '10:00', val: 7.25 },
      { time: '10:32', val: 7.2 },
    ]
    const demoTurbPoints = [
      { time: '09:00', val: 4.1 },
      { time: '09:30', val: 4.7 },
      { time: '10:00', val: 5.2 },
      { time: '10:32', val: 5.8 },
    ]
    const demoMq5Points = [
      { time: '09:00', val: 0.64 },
      { time: '09:30', val: 0.65 },
      { time: '10:00', val: 0.67 },
      { time: '10:32', val: 0.66 },
    ]
    const packPoints = [
      { time: '09:00', val: 100 },
      { time: '09:30', val: 98 },
      { time: '10:00', val: 89 },
      { time: '10:32', val: 92 },
    ]
    const tempPoints = livePoints((item) => item.sensor_data?.temperature_sensor?.value)
    const phPoints = livePoints((item) => item.sensor_data?.ph_sensor?.value)
    const turbPoints = livePoints((item) => item.sensor_data?.turbidity_sensor?.value)
    const mq5Points = livePoints((item) => item.sensor_data?.mq5_sensor?.voltage)
    const chartData = (points, demo, currentValue) => points.length ? points : liveState && typeof currentValue === 'number' ? [{ time: 'Now', val: currentValue }] : demo

    return (
      <div className="view-container">
        {/* Header */}
        <header className="view-header">
          <div>
            <h1 className="view-title">Water Quality Monitor</h1>
            <p className="view-subtitle">
              {liveState ? `SUJAL_01 · Live device telemetry · Sequence ${liveState.sequence ?? '—'}` : 'Demo preview · waiting for authenticated live telemetry'}
            </p>
          </div>
          <div className="header-right-meta">
            <span className="node-chip">
              <i className="chip-icon-drop" />
              SUJAL_01 <small>{liveState ? 'Firestore live state' : 'Demo preview'}</small>
            </span>
            <button className="btn-secondary-flat" onClick={() => setActiveTab('Profile')}>
              <Settings2 size={14} /> Profile
            </button>
          </div>
        </header>

        {/* Row 1: 4 Key Metric Cards */}
        <div className="metrics-grid-4">
          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">Temperature</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <div className="metric-huge">
              {reading(temp)} <span className="unit">°C</span>
            </div>
            <div className="metric-foot">Illustrative demo reading</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">pH</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <div className="metric-huge">
              {reading(ph, 2)} <span className="unit">pH</span>
            </div>
            <div className="metric-foot">Calibration status unverified</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">Turbidity</span>
              <span className="badge-pill orange">● Excursion</span>
            </div>
            <div className="metric-huge text-orange">
              {reading(turbidity)} <span className="unit">NTU</span>
            </div>
            <div className="metric-foot text-orange">Sensor reading · not a potability determination</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">MQ Sensor</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <div className="metric-huge">
              {reading(gas, 2)} <span className="unit">V</span>
            </div>
            <div className="metric-foot">Illustrative demo reading</div>
          </div>
        </div>

        {/* Real-time Visual Trend Charts Grid */}
        <div className="charts-grid-2x2 top-gap">
          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">Temperature</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(tempPoints, demoTempPoints, temp)} minVal={18} maxVal={26} color="#0ea5e9" yLabels={[18, 20, 22, 24, 26]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">pH</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(phPoints, demoPhPoints, ph)} minVal={6.0} maxVal={8.0} color="#0ea5e9" yLabels={[6.0, 6.5, 7.0, 7.5, 8.0]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">Turbidity</span>
              <span className="badge-pill orange">● Excursion</span>
            </div>
            <AreaTrendChart dataPoints={chartData(turbPoints, demoTurbPoints, turbidity)} minVal={0} maxVal={8} color="#f97316" showExcursion excursionLimit={5.0} yLabels={[0, 2, 4, 6, 8]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">MQ Sensor</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(mq5Points, demoMq5Points, gas)} minVal={0.4} maxVal={0.8} color="#0ea5e9" yLabels={[0.4, 0.5, 0.6, 0.7, 0.8]} />
          </div>
        </div>

        {/* Row 4: Bottom 2 Cards (Alerts & Completeness) */}
        <div className="bottom-split-grid">
          <div className="card alert-summary-panel">
            <div className="card-top">
              <span className="diag-heading">Alerts</span>
              <span className="badge-pill red">● 3 open</span>
            </div>
            <div className="alerts-compact-stack">
              <div className="alert-item-compact">
                <div className="alert-dot-title">
                  <span className="dot-red" />
                  <div>
                    <b>Turbidity excursion</b>
                    <small>SJ-01 · 5.8 NTU exceeds illustrative node limit 5.0 NTU</small>
                  </div>
                </div>
                <span className="badge-pill red">● High</span>
              </div>

              <div className="alert-item-compact">
                <div className="alert-dot-title">
                  <span className="dot-amber" />
                  <div>
                    <b>Intermittent telemetry</b>
                    <small>92% packet completeness over last hour · review connectivity</small>
                  </div>
                </div>
                <span className="badge-pill amber">● High</span>
              </div>

              <div className="alert-item-compact">
                <div className="alert-dot-title">
                  <span className="dot-purple" />
                  <div>
                    <b>AI interpretation awaiting review</b>
                    <small>Illustrative Gemini response flagged elevated turbidity and incomplete telemetry</small>
                  </div>
                </div>
                <span className="badge-pill purple">● Review</span>
              </div>
            </div>
          </div>

          <div className="card completeness-panel">
            <div className="card-top">
              <span className="diag-heading">Packet completeness</span>
              <span className="badge-pill amber">● 92%</span>
            </div>
            <AreaTrendChart dataPoints={packPoints} minVal={60} maxVal={100} color="#e6a23c" yLabels={[60, 70, 80, 90, 100]} />
          </div>
        </div>
      </div>
    )
  }

  // 2. Alerts Queue Screen
  const renderAlertsScreen = () => {
    const displayedAlerts = liveAlerts ? liveAlerts.map((item) => ({
      ...item,
      severity: item.severity === 'high' ? 'High' : 'Review',
      type: item.id === 'turbidity-excursion' ? 'Measured excursion' : 'Device / data quality',
      node: 'SUJAL_01 · SuJal device',
      time: item.updated_at?.toDate?.().toLocaleString('en-IN') || 'Live',
      status: item.status || 'open', triageScore: '—',
      actionSteps: [item.detail || 'Review current sensor and actuator readings.'],
    })) : alertsList
    const currentAlert = displayedAlerts.find((item) => item.id === selectedAlert.id) || displayedAlerts[0] || ALERTS_DATA[0]
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="view-title">Alerts queue</h1>
            <p className="view-subtitle">3 open items · 2 high-priority operational alerts · 1 AI review</p>
          </div>
          <div className="header-right-meta">
            <span className="badge-pill red">● 2 high alerts</span>
            <button className="btn-secondary-flat" onClick={() => setActiveTab('Profile')}>
              Change in profile <ChevronDown size={14} />
            </button>
          </div>
        </header>

        {/* Hero Selected Alert Card */}
        <div className="card hero-alert-card">
          <div className="hero-alert-header">
            <div>
              <div className="hero-node-title">{currentAlert.node}</div>
              <p className="hero-node-sub">
                24 River View Lane, North River district · Provisional nearest-node mapping · Household supply connection not confirmed
              </p>
            </div>
            <div className="hero-right-meta">
              <span className="badge-pill blue">
                <Radio size={12} /> Selected alert
              </span>
              <span className="snapshot-timestamp">Snapshot 27 Oct 2026 10:32:15 IST</span>
            </div>
          </div>

          <div className="hero-triage-row">
            <div className="triage-stat">
              <small>Measured turbidity</small>
              <b>5.8 NTU</b>
              <span>Exceeds configured operating limit 5.0 NTU</span>
            </div>
            <div className="triage-stat">
              <small>Packet completeness</small>
              <b>92%</b>
              <span>Last hour telemetry</span>
            </div>
            <div className="triage-stat">
              <small>Operational triage</small>
              <b className="text-orange">{currentAlert.triageScore}</b>
              <span>Illustrative prioritization score</span>
            </div>
          </div>

          <div className="hero-bottom-grid">
            <div className="latest-measurements-col">
              <div className="col-subheading">Latest node measurements</div>
              <div className="measurements-pill-row">
                <div className="m-box">
                  <small>Temperature</small>
                  <b>24.6°C</b>
                </div>
                <div className="m-box">
                  <small>pH</small>
                  <b>7.2</b>
                </div>
                <div className="m-box">
                  <small>Turbidity</small>
                  <b className="text-orange">5.8 NTU</b>
                </div>
                <div className="m-box">
                  <small>MQ5</small>
                  <b>0.66 V</b>
                </div>
                <div className="m-box">
                  <small>Salinity</small>
                  <b>0.32 ppt</b>
                </div>
              </div>

              <div className="hero-actions-row">
                <button className="btn-action-primary" onClick={() => handleAcknowledgeAlert(currentAlert.id)}>
                  <Check size={14} /> Acknowledge
                </button>
                <button className="btn-action-secondary" onClick={() => triggerToast('Opening review panel...')}>
                  <Eye size={14} /> Review
                </button>
                <button className="btn-action-danger" onClick={() => triggerToast('Escalated to engineering team.')}>
                  <AlertTriangle size={14} /> Escalate
                </button>
              </div>
            </div>

            <div className="actionable-steps-card">
              <div className="col-subheading">Actionable operator next steps</div>
              <ul className="actionable-checklist">
                {currentAlert.actionSteps.map((step, i) => (
                  <li key={i}>
                    <span className="step-dot" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Operational Alert Queue Table */}
        <div className="card table-card top-gap">
          <div className="table-header-split">
            <div>
              <h2>Operational alert queue</h2>
              <p>3 open items · 2 high-priority operational alerts · 1 AI review</p>
            </div>
            <div className="filter-count-pills">
              <span className="badge-pill muted">3 open</span>
              <span className="badge-pill red">2 high</span>
              <span className="badge-pill purple">1 review</span>
            </div>
          </div>

          <div className="table-responsive">
            <table className="sujal-table">
              <tbody>
                {displayedAlerts.map((alt) => (
                  <tr
                    key={alt.id}
                    className={`alert-row-item ${currentAlert.id === alt.id ? 'active-row' : ''}`}
                    onClick={() => setSelectedAlert(alt)}
                  >
                    <td className="w-severity">
                      <span className={`badge-pill ${alt.severity === 'High' ? 'red' : 'purple'}`}>
                        {alt.severity}
                      </span>
                    </td>
                    <td className="w-category">
                      <div className="cat-cell">
                        <AlertTriangle size={14} className={alt.severity === 'High' ? 'text-red' : 'text-purple'} />
                        <span>{alt.type}</span>
                      </div>
                    </td>
                    <td className="w-desc">
                      <b>{alt.title}</b>
                    </td>
                    <td className="w-node">
                      <span className="cell-node-id">{alt.node}</span>
                    </td>
                    <td className="w-time">{alt.time}</td>
                    <td className="w-status">
                      <span className="status-open-dot">● {alt.status}</span>
                    </td>
                    <td className="w-score">
                      <span className="score-val">📊 {alt.triageScore}</span>
                    </td>
                    <td className="w-btn">
                      <button
                        className="btn-sm-action"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleAcknowledgeAlert(alt.id)
                        }}
                      >
                        <Check size={13} /> Acknowledge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // 3. Records & Highlights Screen
  const renderRecordsScreen = () => {
    const currentSelectedDs = MONTHLY_DATASETS.find((m) => m.month === filterMonthTab) || MONTHLY_DATASETS[0]
    const tempReading = adminOverrides.tempOverride
      ? `${adminOverrides.tempValue.toFixed(1)}`
      : (liveState?.sensor_data?.temperature_sensor?.value ? `${liveState.sensor_data.temperature_sensor.value}` : '24.6')
    const phReading = adminOverrides.phOverride
      ? `${adminOverrides.phValue.toFixed(2)}`
      : (liveState?.sensor_data?.ph_sensor?.value ? `${liveState.sensor_data.ph_sensor.value}` : '7.2')
    const turbReading = adminOverrides.turbidityOverride
      ? adminOverrides.turbidityValue
      : (liveState?.sensor_data?.turbidity_sensor?.value ?? 5.8)
    const mq5Reading = adminOverrides.mq5Override
      ? `${adminOverrides.mq5Value.toFixed(2)}`
      : (liveState?.sensor_data?.mq5_sensor?.voltage ? `${liveState.sensor_data.mq5_sensor.voltage}` : '0.66')

    return (
      <div className="view-container records-page-view">
        <header className="view-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="view-title">Records & Highlights</h1>
              <span className="badge-pill blue">● SCADA ARCHIVE</span>
            </div>
            <p className="view-subtitle">
              {liveReadings.length
                ? `Unified telemetry datasets, parameter highlights, and raw sensor records for SJ-01 · ${liveReadings.length} latest live packets loaded.`
                : 'Monthly sensor datasets, key parameter highlights, and raw telemetry browser for SJ-01.'}
            </p>
          </div>
          <button className="btn-secondary-flat" onClick={() => setActiveTab('Profile')}>
            Change in Profile
          </button>
        </header>

        <div className="card node-context-bar">
          <div className="bar-left">
            <b>SJ-01 · River View inlet</b>
            <span>24 River View Lane, North River District · Provisional nearest-node mapping</span>
          </div>
          <div className="bar-meta-row">
            <span>Sequence {liveState?.sequence ?? '0x4A2F'}</span>
            <span>Commanded channel: {liveState?.selected_channel || 'A'}</span>
            <span className={`badge-pill ${liveState ? 'green' : 'blue'}`}>{liveState ? '● Live Telemetry' : '● Node Active'}</span>
          </div>
        </div>

        {/* Selected Month Highlights Section */}
        <div className="card records-highlights-panel top-gap">
          <div className="table-header-split">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={18} className="text-blue" />
                <h2 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>Key Telemetry Highlights · {filterMonthTab}</h2>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                Aggregated parameter highlights, excursion tracking, and compliance metrics
              </p>
            </div>
            <div className="filter-count-pills">
              <span className={`badge-pill ${currentSelectedDs.complete === '100%' ? 'green' : currentSelectedDs.archived ? 'muted' : 'orange'}`}>
                ● {currentSelectedDs.status}
              </span>
              <span className="badge-pill blue">
                {currentSelectedDs.samples} Samples
              </span>
              <span className="badge-pill green">
                {currentSelectedDs.complete} Complete
              </span>
            </div>
          </div>

          {/* 4 Metric Highlight Cards */}
          <div className="metrics-grid-4 top-gap">
            <div className="card metric-card">
              <span className="card-lbl">Temperature Highlight</span>
              <div className="metric-huge">
                {tempReading} <span className="unit">°C</span>
              </div>
              <span className="badge-pill blue">● Avg: 24.5 °C · Normal</span>
            </div>

            <div className="card metric-card">
              <span className="card-lbl">pH Level Highlight</span>
              <div className="metric-huge">
                {phReading} <span className="unit">pH</span>
              </div>
              <span className="badge-pill green">● Neutral · Normal range</span>
            </div>

            <div className="card metric-card">
              <span className="card-lbl">Turbidity Highlight</span>
              <div className={`metric-huge ${turbReading > 5.0 ? 'text-orange' : 'text-green'}`}>
                {typeof turbReading === 'number' ? turbReading.toFixed(1) : turbReading} <span className="unit">NTU</span>
              </div>
              <span className={`badge-pill ${turbReading > 5.0 ? 'orange' : 'green'}`}>
                {turbReading > 5.0 ? '● Peak: Exceeds 5.0 NTU limit' : '● Optimal clarity'}
              </span>
            </div>

            <div className="card metric-card">
              <span className="card-lbl">MQ Sensor Highlight</span>
              <div className="metric-huge">
                {mq5Reading} <span className="unit">V</span>
              </div>
              <span className="badge-pill blue">● Gas baseline: 0.65 V</span>
            </div>
          </div>

          {/* Highlights KPI Bar */}
          <div className="highlights-kpi-bar top-gap">
            <div className="m-box" style={{ background: 'var(--card-inner)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <small style={{ color: 'var(--muted)', fontSize: '10px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Packet Completeness</small>
              <b style={{ fontSize: '15px', color: '#10b981', display: 'block', marginTop: 4 }}>{currentSelectedDs.complete}</b>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: 2 }}>
                Missing: {currentSelectedDs.missing}
              </span>
            </div>

            <div className="m-box" style={{ background: 'var(--card-inner)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <small style={{ color: 'var(--muted)', fontSize: '10px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Operational Excursions</small>
              <b style={{ fontSize: '15px', color: '#f59e0b', display: 'block', marginTop: 4 }}>2 Incidents</b>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: 2 }}>
                Turbidity &gt; 5.0 NTU operating threshold
              </span>
            </div>

            <div className="m-box" style={{ background: 'var(--card-inner)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <small style={{ color: 'var(--muted)', fontSize: '10px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Average Branch Flow</small>
              <b style={{ fontSize: '15px', color: '#0ea5e9', display: 'block', marginTop: 4 }}>18.5 L/min</b>
              <span style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginTop: 2 }}>
                Dual-channel pneumatic bypass active
              </span>
            </div>

            <div className="m-box" style={{ background: 'var(--card-inner)', padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <small style={{ color: 'var(--muted)', fontSize: '10px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>CSV Data Export</small>
              <b style={{ fontSize: '12px', color: '#fff', display: 'block', marginTop: 4 }}>SJ-01_{filterMonthTab.replace(' ', '_')}.csv</b>
              <span
                style={{ fontSize: '11px', color: '#38bdf8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}
                onClick={() => downloadCsvMock(`SJ-01_${filterMonthTab.replace(' ', '_')}.csv`)}
              >
                <Download size={11} /> Download Month CSV
              </span>
            </div>
          </div>
        </div>

        {/* Month Picker Row */}
        <div className="month-tabs-row top-gap">
          <div className="month-tabs-left">
            {MONTHLY_DATASETS.map((m) => (
              <button
                key={m.month}
                className={`btn-month-pill ${filterMonthTab === m.month ? 'selected' : ''}`}
                onClick={() => setFilterMonthTab(m.month)}
              >
                {m.month}
              </button>
            ))}
          </div>
          <div className="month-tabs-right">
            <span>Newest first</span>
            <span className="badge-pill muted">IST</span>
          </div>
        </div>

        {/* Month-Organized Datasets Grid */}
        <div className="month-cards-grid top-gap">
          {MONTHLY_DATASETS.map((ds) => (
            <div key={ds.month} className="card dataset-card">
              <div className="ds-header">
                <span className={`ds-badge ${ds.complete === '100%' ? 'green' : ds.archived ? 'muted' : 'blue'}`}>
                  {ds.archived ? 'Archived' : ds.complete === '100%' ? 'Complete' : 'Current'}
                </span>
                <b>{ds.month}</b>
                <small>{ds.range}</small>
              </div>
              <div className="ds-stats-triplet">
                <div>
                  <small>Samples</small>
                  <b>{ds.samples}</b>
                </div>
                <div>
                  <small>Complete</small>
                  <b>{ds.complete}</b>
                </div>
                <div>
                  <small>Missing</small>
                  <b>{ds.missing}</b>
                </div>
              </div>
              <div className="ds-foot">
                <span className="badge-pill muted">{ds.archived ? 'Archived' : ds.status}</span>
                <button className="btn-csv-export" onClick={() => downloadCsvMock(`SJ-01_${ds.month.replace(' ', '_')}.csv`)}>
                  <Download size={13} /> CSV
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Preview Table */}
        <div className="card table-card top-gap">
          <div className="table-header-split">
            <div>
              <h2>Preview for {filterMonthTab}</h2>
              <p>Latest reading 27 Oct 2026 10:32:15 IST</p>
            </div>
            <div className="filter-count-pills">
              <span className="badge-pill muted">{currentSelectedDs.samples} samples</span>
              <span className="badge-pill green">{currentSelectedDs.complete} complete</span>
            </div>
          </div>

          <div className="table-responsive">
            <table className="sujal-table">
              <thead>
                <tr>
                  <th>Timestamp (IST)</th>
                  <th>Temp</th>
                  <th>pH</th>
                  <th>Turbidity</th>
                  <th>MQ5 Gas</th>
                  <th>Channel A / B flow</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(liveReadings.length ? [...liveReadings].reverse().slice(0, 20).map((item) => {
                  const date = item.recorded_at?.toDate?.()
                  const val = (value, unit = '') => typeof value === 'number' ? `${value} ${unit}`.trim() : '—'
                  const turb = item.sensor_data?.turbidity_sensor?.value
                  return { t: date?.toLocaleString('en-IN') || '—', temp: val(item.sensor_data?.temperature_sensor?.value, '°C'), ph: val(item.sensor_data?.ph_sensor?.value), turb: val(turb, 'NTU'), mq5: val(item.sensor_data?.mq5_sensor?.voltage, 'V'), flow: `${val(item.sensor_data?.flow_sensors?.channel_a?.flow_rate_lpm)} / ${val(item.sensor_data?.flow_sensors?.channel_b?.flow_rate_lpm)} L/min`, status: turb > 5 ? 'Above 5 NTU demo threshold' : 'Sensor value only' }
                }) : [
                  { t: '27 Oct 2026 10:32:15', temp: '24.6 °C', ph: '7.2', turb: '5.8 NTU', mq5: '0.66 V', sal: '0.32 ppt' },
                  { t: '27 Oct 2026 10:31:15', temp: '24.5 °C', ph: '7.2', turb: '5.7 NTU', mq5: '0.66 V', sal: '0.32 ppt' },
                  { t: '27 Oct 2026 10:30:15', temp: '24.5 °C', ph: '7.2', turb: '5.6 NTU', mq5: '0.66 V', sal: '0.32 ppt' },
                  { t: '27 Oct 2026 10:29:15', temp: '24.4 °C', ph: '7.2', turb: '5.6 NTU', mq5: '0.66 V', sal: '0.32 ppt' },
                  { t: '27 Oct 2026 10:28:15', temp: '24.4 °C', ph: '7.2', turb: '5.5 NTU', mq5: '0.66 V', sal: '0.32 ppt' },
                ]).map((row, i) => (
                  <tr key={i}>
                    <td>{row.t}</td>
                    <td>{row.temp}</td>
                    <td>{row.ph}</td>
                    <td className="text-orange">{row.turb}</td>
                    <td>{row.mq5}</td>
                    <td>{row.flow || row.sal || 'Illustrative'}</td>
                    <td>
                      <span className={`badge-pill ${row.status?.includes('Above') || row.turb?.startsWith('5.') ? 'amber' : 'green'}`}>{row.status || 'Illustrative data'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer-actions">
            <small>{liveReadings.length ? `Live data · ${liveReadings.length} most recent readings` : 'Illustrative preview · waiting for Firestore telemetry'}</small>
            <button className="btn-action-primary" onClick={() => downloadCsvMock(`SJ-01_${filterMonthTab.replace(' ', '_')}.csv`)}>
              <Download size={14} /> Download CSV
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 4. Archive Screen
  const renderArchiveScreen = () => {
    const archMonth = selectedMonth || MONTHLY_DATASETS[3]

    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="view-title">
              Archive <span className="badge-historical">HISTORICAL</span>
            </h1>
            <p className="view-subtitle">Closed monthly datasets · retained sensor exports</p>
          </div>
          <div className="header-right-meta">
            <span className="node-chip">
              ● 24 River View Lane, North River District · SJ-01 · River View Inlet <small>Provisional</small>
            </span>
            <button className="btn-secondary-flat" onClick={() => setActiveTab('Profile')}>
              Change
            </button>
          </div>
        </header>

        {/* Filter Toolbar */}
        <div className="archive-filters-bar top-gap">
          <div className="filter-group">
            <label>Filter:</label>
            <span className="select-pill">Year <b>2026 ▾</b></span>
            <span className="select-pill">Node <b>SJ-01 ▾</b></span>
            <span className="select-pill">Status <b>All Closed ▾</b></span>
          </div>
          <span className="archive-counter">3 archived months · 1 partial</span>
        </div>

        {/* 2-Column Archive Layout */}
        <div className="archive-split-grid top-gap">
          {/* Left Column: Months list */}
          <div className="archive-left-col">
            <div className="section-label">2026 — ARCHIVED MONTHS</div>
            <div className="archived-cards-stack">
              {MONTHLY_DATASETS.filter((m) => m.archived).map((m) => (
                <div
                  key={m.month}
                  className={`card archive-month-row ${archMonth.month === m.month ? 'selected-archive' : ''}`}
                  onClick={() => setSelectedMonth(m)}
                >
                  <div className="archive-badge-box">
                    <span>{m.month.slice(0, 3).toUpperCase()}</span>
                    <small>2026</small>
                  </div>
                  <div className="archive-row-info">
                    <b>{m.month}</b>
                    <small className="text-green">● Closed · Available</small>
                    <div className="archive-row-meta">
                      <span>{m.range}</span>
                      <span>{m.samples} readings</span>
                      <span className="badge-pill green">{m.complete} complete</span>
                      <span>5 parameters</span>
                    </div>
                    <code className="file-code">{m.filename}</code>
                  </div>
                  <div className="archive-row-btns">
                    {archMonth.month === m.month && <span className="badge-pill blue">Selected</span>}
                    <button
                      className="btn-csv-export"
                      onClick={(e) => {
                        e.stopPropagation()
                        downloadCsvMock(m.filename)
                      }}
                    >
                      <Download size={13} /> CSV
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="records-callout-box top-gap">
              <small>Months below are in Records & Highlights (recent/partial) — not archived</small>
              <div className="records-sub-row">
                <div>
                  <b>October 2026</b>
                  <small>● Current · Partial (27 days collected)</small>
                </div>
                <button className="btn-secondary-flat" onClick={() => setActiveTab('Records & Highlights')}>
                  In Records
                </button>
              </div>
              <div className="records-sub-row">
                <div>
                  <b>September 2026</b>
                  <small>● Closed · Pending archive transfer</small>
                </div>
                <button className="btn-secondary-flat" onClick={() => setActiveTab('Records & Highlights')}>
                  In Records
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Month Detail */}
          <div className="archive-right-col">
            <div className="card archive-detail-panel">
              <div className="archive-detail-head">
                <span className="month-avatar">{archMonth.month.slice(0, 3).toUpperCase()}</span>
                <div>
                  <h2>{archMonth.month}</h2>
                  <small>Archive Detail</small>
                </div>
                <span className="badge-pill green">● Closed · Available</span>
              </div>

              <div className="detail-stat-triplet top-gap">
                <div>
                  <b>{archMonth.samples}</b>
                  <small>Total Readings</small>
                </div>
                <div>
                  <b className="text-green">{archMonth.complete}</b>
                  <small>Completeness</small>
                </div>
                <div>
                  <b>5</b>
                  <small>Parameters</small>
                </div>
              </div>

              <div className="coverage-section top-gap">
                <div className="sec-title">COVERAGE & QUALITY</div>
                <div className="coverage-row">
                  <span>Date range</span>
                  <b>{archMonth.range} 2026</b>
                </div>
                <div className="coverage-row">
                  <span>Days covered</span>
                  <b>{archMonth.days}</b>
                </div>
                <div className="coverage-row">
                  <span>Missing readings</span>
                  <b>{archMonth.missingReadings}</b>
                </div>
                <div className="coverage-row">
                  <span>Data quality</span>
                  <b className="text-green">● Good</b>
                </div>
                <div className="coverage-row">
                  <span>Sensor node</span>
                  <b>SJ-01 · River View Inlet</b>
                </div>
              </div>

              <div className="parameters-captured top-gap">
                <div className="sec-title">PARAMETERS CAPTURED</div>
                <div className="param-pills">
                  <span>pH</span>
                  <span>Turbidity (NTU)</span>
                  <span>Temperature (°C)</span>
                  <span>MQ-5 (V)</span>
                  <span>Salinity (ppt)</span>
                </div>
              </div>

              <div className="export-metadata top-gap">
                <div className="sec-title">EXPORT</div>
                <div className="coverage-row">
                  <span>Filename</span>
                  <code>{archMonth.filename}</code>
                </div>
                <div className="coverage-row">
                  <span>Format</span>
                  <b>CSV · UTF-8 · comma-delimited</b>
                </div>
                <div className="coverage-row">
                  <span>Est. size</span>
                  <b>{archMonth.size}</b>
                </div>
                <div className="coverage-row">
                  <span>Archived on</span>
                  <b>{archMonth.date}</b>
                </div>

                <button className="btn-download-full top-gap" onClick={() => downloadCsvMock(archMonth.filename)}>
                  <Download size={15} /> Download {archMonth.filename}
                </button>
                <small className="illus-footnote">ⓘ Illustrative sample data only · not actual stored datasets</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 5. Telemetry Ingest Log Screen
  const renderLogScreen = () => {
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <div className="title-with-pill">
              <h1 className="view-title">Telemetry Ingest Log</h1>
              <span className="badge-pill green">● STREAMING</span>
              <span className="badge-pill blue">LIVE</span>
            </div>
            <p className="view-subtitle">SJ-01 · River View Inlet · 24 River View Lane, North River District · Provisional nearest-node mapping</p>
          </div>
          <span className="snapshot-timestamp">Snapshot 27 Oct 2026 10:32:15 IST</span>
        </header>

        {/* Telemetry Parameter Metric Strip */}
        <div className="card log-metrics-strip top-gap">
          <div className="l-metric">
            <small>Temperature</small>
            <b>24.6 °C</b>
          </div>
          <div className="l-metric">
            <small>pH</small>
            <b>7.2</b>
          </div>
          <div className="l-metric">
            <small>Turbidity</small>
            <b className="text-orange">5.8 NTU <small className="badge-pill orange">EXCURSION</small></b>
          </div>
          <div className="l-metric">
            <small>MQ5 Gas</small>
            <b>0.66 V</b>
          </div>
          <div className="l-metric">
            <small>Salinity</small>
            <b>0.32 ppt</b>
          </div>
          <div className="l-metric">
            <small>Last-hour Packet Completeness</small>
            <b className="text-amber">92% <small className="badge-pill amber">INTERMITTENT</small></b>
          </div>
        </div>

        {/* Filter Pills Toolbar */}
        <div className="log-filters-row top-gap">
          <div className="filter-pill-cluster">
            {['All Types', 'Measurement', 'Data Quality', 'AI Interpretation', 'System'].map((type) => (
              <button
                key={type}
                className={`btn-filter-pill ${logFilter === type ? 'active' : ''}`}
                onClick={() => setLogFilter(type)}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="filter-pill-cluster">
            <button className="btn-filter-pill">≥ 75 High</button>
            <button className="btn-filter-pill">50–74 Elevated</button>
            <button className="btn-filter-pill">&lt; 50 Low</button>
          </div>

          <div className="filter-pill-cluster">
            <button className="btn-filter-pill">Last 1h</button>
            <button className="btn-filter-pill">Last 6h</button>
            <button className="btn-filter-pill active">Last 24h</button>
            <span className="count-txt">10 events</span>
          </div>
        </div>

        {/* 2-Column Log View */}
        <div className="log-split-grid top-gap">
          {/* Left: Events table */}
          <div className="card table-card log-table-card">
            <div className="table-responsive">
              <table className="sujal-table log-table">
                <thead>
                  <tr>
                    <th>TIMESTAMP</th>
                    <th>NODE</th>
                    <th>EVENT TYPE</th>
                    <th>INGEST STATUS</th>
                    <th>PAYLOAD / READINGS</th>
                    <th>SEVERITY</th>
                  </tr>
                </thead>
                <tbody>
                  {TELEMETRY_LOGS.map((evt) => (
                    <tr
                      key={evt.id}
                      className={`log-row ${selectedLogEvent.id === evt.id ? 'active-log' : ''}`}
                      onClick={() => setSelectedLogEvent(evt)}
                    >
                      <td className="t-time">{evt.time}</td>
                      <td><span className="cell-node-id">{evt.node}</span></td>
                      <td>
                        <span className={`badge-pill ${evt.type === 'DATA QUALITY' ? 'amber' : evt.type === 'AI INTERPRET' ? 'purple' : evt.type === 'SYSTEM' ? 'muted' : 'orange'}`}>
                          {evt.type}
                        </span>
                      </td>
                      <td>
                        <span className={`badge-pill ${evt.status === 'INGESTED' ? 'green' : evt.status === 'INCOMPLETE' ? 'red' : 'muted'}`}>
                          {evt.status}
                        </span>
                      </td>
                      <td className="t-payload">{evt.payload}</td>
                      <td>
                        <span className={`score-badge ${evt.score >= 75 ? 'score-high' : evt.score >= 50 ? 'score-mid' : 'score-low'}`}>
                          {evt.score}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: Event Detail */}
          <div className="card log-detail-panel">
            <div className="detail-panel-head">
              <div>
                <h2>Event Detail</h2>
                <code>{selectedLogEvent.id}</code>
              </div>
              <span className="score-badge-large">{selectedLogEvent.score}</span>
            </div>

            <div className="detail-tags-row top-gap">
              <span className="badge-pill amber">{selectedLogEvent.type}</span>
              <span className="badge-pill red">{selectedLogEvent.status}</span>
            </div>

            <div className="detail-keyvals top-gap">
              <div><span>Timestamp</span><b>27 Oct 2026 · {selectedLogEvent.time}</b></div>
              <div><span>Node</span><b>SJ-01 · River View Inlet</b></div>
              <div><span>Address</span><b>24 River View Lane, North River District</b></div>
              <div><span>Mapping Status</span><b>Provisional — supply connection unconfirmed</b></div>
              <div><span>Ingest Status</span><b className="text-red">{selectedLogEvent.status}</b></div>
              <div><span>Packet Completeness</span><b>92% (last 60 min)</b></div>
              <div><span>Missing Packets</span><b>8 of 100 expected</b></div>
              <div><span>Uplink RSSI</span><b>-92 dBm (weak)</b></div>
              <div><span>Gateway</span><b>GW-NR-03</b></div>
            </div>

            <div className="triage-explanation-box top-gap">
              <small className="text-orange"><b>{selectedLogEvent.score} / 100</b> Operational Triage Score</small>
              <p>
                Score derived from: packet loss rate (8%) × weight 4.0 + signal degradation (RSSI &lt; -88 dBm) × weight 2.5 + sustained intermittency window (&gt;45 min) × weight 1.5. Scores 0-100; ≥75 = critical operational triage, 50-74 = high, &lt;50 = low. Not a water-safety or health metric.
              </p>
            </div>

            <div className="event-narrative-box top-gap">
              <div className="sec-title">Event Narrative</div>
              <p>
                SJ-01 reported 8 missing packets between 10:20:00 and 10:31:04 IST. Uplink signal degraded to -92 dBm, exceeding the -88 dBm threshold for retransmit reliability. 3 consecutive drops (seq 0x4A1C-0x4A1E) were logged before partial recovery. Operator action recommended: verify gateway GW-NR-03 antenna and check node housing seal. Latest packet received at 10:32:15 IST with full payload.
              </p>
            </div>

            <div className="latest-recovered-packet top-gap">
              <div className="sec-title">Latest Recovered Packet · 10:32:15 IST</div>
              <div className="recovered-grid">
                <div><small>Temperature</small><b>24.6 °C</b></div>
                <div><small>pH</small><b>7.2</b></div>
                <div><small>Turbidity</small><b className="text-orange">5.8 NTU</b></div>
                <div><small>MQ5 Gas</small><b>0.66 V</b></div>
                <div><small>Salinity</small><b>0.32 ppt</b></div>
              </div>
              <small className="illus-footnote">All values illustrative. No actual data connection.</small>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 6. Map Screen
  const renderMapScreen = () => {
    return (
      <div className="view-container map-page-view">
        <header className="view-header map-top-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div className="map-feed-status">
            <span>● GPS FEED: {deviceLocation.source?.toUpperCase() || 'ESP-NOW'} 915 MHz</span>
            <span className="badge-pill green">📍 LIVE NODE SJ-01 LOCK ±{deviceLocation.accuracy || 4}m</span>
            <span>{deviceLocation.lat.toFixed(4)}° N, {deviceLocation.lon.toFixed(4)}° E</span>
            <span className="badge-pill purple">🛰️ NASA SATELLITE</span>
          </div>
        </header>

        <div className="map-stage-wrap top-gap">
          {/* NASA Satellite Layer Controls */}
          <div className="map-layer-controls">
            <span className="layer-lbl">NASA SAT:</span>
            <button
              className={`layer-btn ${mapLayer === 'street-sat' ? 'active' : ''}`}
              onClick={() => setMapLayer('street-sat')}
              title="High-Resolution Street & River Canal Satellite (Esri World Imagery)"
            >
              🛰️ Street Sat
            </button>
            <button
              className={`layer-btn ${mapLayer === 'carto-dark' ? 'active' : ''}`}
              onClick={() => setMapLayer('carto-dark')}
              title="Clean High-Contrast Dark SCADA Map"
            >
              🌊 Dark SCADA
            </button>
            <button
              className={`layer-btn ${mapLayer === 'nasa-viirs' ? 'active' : ''}`}
              onClick={() => setMapLayer('nasa-viirs')}
              title="NASA Suomi-NPP VIIRS True Color Near Real-Time Orbit"
            >
              🛰️ VIIRS Realtime
            </button>
            <button
              className={`layer-btn ${mapLayer === 'nasa-terra' ? 'active' : ''}`}
              onClick={() => setMapLayer('nasa-terra')}
              title="NASA Terra MODIS Daily Earth Observations"
            >
              🌍 Terra Daily
            </button>
            <button
              className={`layer-btn ${mapLayer === 'nasa-night' ? 'active' : ''}`}
              onClick={() => setMapLayer('nasa-night')}
              title="NASA Earth at Night (Black Marble Night Lights)"
            >
              🌃 Black Marble
            </button>
            <button
              className={`overlay-toggle-btn ${showMapOverlays ? 'active' : ''}`}
              onClick={() => setShowMapOverlays(!showMapOverlays)}
              title="Toggle NASA Waterways, Coastlines, Borders & Labels"
            >
              🏷️ Labels {showMapOverlays ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* NASA GIBS Realtime Satellite Map Canvas */}
          <div className="nasa-map-container">
            <NasaSatelliteMap
              nodes={dynamicMapNodes}
              selectedNode={selectedMapNode}
              onSelectNode={setSelectedMapNode}
              currentLayer={mapLayer}
              showOverlays={showMapOverlays}
              liveState={liveState}
              onMapClick={handleMapClick}
              adminOverrides={adminOverrides}
            />
          </div>

          {/* Left Node Inspector Overlay */}
          <div className="card map-node-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">
                  <b>{selectedMapNode.id}</b>
                  <span className={`badge-pill ${selectedMapNode.id === 'SJ-01' ? 'green' : 'purple'}`}>
                    ● {selectedMapNode.id === 'SJ-01' ? 'LIVE' : 'SIMULATED'}
                  </span>
                  {selectedMapNode.id === 'SJ-01' && <span className="badge-pill blue">★ Primary Live Node</span>}
                  {selectedMapNode.simulated && <span className="badge-pill purple">Simulated Feed</span>}
                </div>
                <small>{selectedMapNode.name}</small>
              </div>
            </div>

            {/* "Show Nearest Live Node" button ONLY appears when viewing a simulated node */}
            {selectedMapNode.id !== 'SJ-01' && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-action-primary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    fontSize: '12px',
                    fontWeight: '700',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)',
                    boxShadow: '0 4px 16px rgba(14, 165, 233, 0.45)',
                  }}
                  onClick={() => {
                    setSelectedMapNodeId('SJ-01')
                    triggerToast('📍 Switched to Nearest Live Node: SJ-01')
                  }}
                >
                  <Navigation size={14} /> Show Nearest Live Node
                </button>
              </div>
            )}

            <div className="drawer-gps-status top-gap">
              <span>📍 GPS LOCK {selectedMapNode.lat.toFixed(5)}° N {selectedMapNode.lon.toFixed(5)}° E <small className="badge-pill green">±{selectedMapNode.accuracy || 4} m</small></span>
              <span>📡 SOURCE: {selectedMapNode.id === 'SJ-01' ? (deviceLocation.source || 'Live GPS') : 'Synthetic Telemetry'}</span>
              <span>⚙ DEV: {selectedMapNode.id === 'SJ-01' ? 'ESP32-S3 ID D4:F9:8D:2A:11:3E' : 'Simulated Virtual Controller'} <small className="badge-pill amber">PKT: 98%</small></span>
              <span>⏱ Updated: {new Date().toLocaleTimeString('en-IN', { hour12: false })} IST <small className="badge-pill green">ACTIVE</small></span>
            </div>

            <div className="drawer-readings-grid top-gap">
              <div className="m-box">
                <small>Temperature</small>
                <b>
                  {selectedMapNode.id === 'SJ-01'
                    ? (adminOverrides.tempOverride
                        ? `${adminOverrides.tempValue.toFixed(1)} °C [OVR]`
                        : (liveState?.sensor_data?.temperature_sensor?.value ? `${liveState.sensor_data.temperature_sensor.value} °C` : '24.6 °C'))
                    : `${selectedMapNode.temp ?? 23.8} °C`}
                </b>
                <span className="text-green">● Normal range</span>
              </div>
              <div className="m-box">
                <small>pH Level</small>
                <b>
                  {selectedMapNode.id === 'SJ-01'
                    ? (adminOverrides.phOverride
                        ? `${adminOverrides.phValue.toFixed(2)} [OVR]`
                        : (liveState?.sensor_data?.ph_sensor?.value ? `${liveState.sensor_data.ph_sensor.value} pH` : '7.2 pH'))
                    : `${selectedMapNode.ph ?? 7.15} pH`}
                </b>
                <span className="text-green">● Normal range</span>
              </div>
              <div className="m-box">
                <small>Turbidity</small>
                <b className={((selectedMapNode.id === 'SJ-01' ? (adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : 5.8) : (selectedMapNode.turbidity ?? 3.2)) > 5.0) ? 'text-orange' : 'text-green'}>
                  {selectedMapNode.id === 'SJ-01'
                    ? (adminOverrides.turbidityOverride
                        ? `${adminOverrides.turbidityValue.toFixed(1)} NTU [OVR]`
                        : (liveState?.sensor_data?.turbidity_sensor?.value ? `${liveState.sensor_data.turbidity_sensor.value} NTU` : '5.8 NTU'))
                    : `${selectedMapNode.turbidity ?? 3.2} NTU`}
                </b>
                <span className={((selectedMapNode.id === 'SJ-01' ? (adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : 5.8) : (selectedMapNode.turbidity ?? 3.2)) > 5.0) ? 'text-orange' : 'text-green'}>
                  {((selectedMapNode.id === 'SJ-01' ? (adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : 5.8) : (selectedMapNode.turbidity ?? 3.2)) > 5.0) ? '● Exceeds limit 5.0 NTU' : '● Normal range'}
                </span>
              </div>
              <div className="m-box">
                <small>MQ Sensor</small>
                <b>
                  {selectedMapNode.id === 'SJ-01'
                    ? (adminOverrides.mq5Override
                        ? `${adminOverrides.mq5Value.toFixed(2)} V [OVR]`
                        : (liveState?.sensor_data?.mq5_sensor?.voltage ? `${liveState.sensor_data.mq5_sensor.voltage} V` : '0.66 V'))
                    : `${selectedMapNode.mq5 ?? 0.58} V`}
                </b>
                <span className="text-green">● Normal range</span>
              </div>
            </div>

            <div className="drawer-actions-row top-gap">
              <button className="btn-action-primary" onClick={() => setActiveTab('Records & Highlights')}>
                View Records & Highlights
              </button>
              <button className="btn-action-danger" onClick={() => setActiveTab('Alerts')}>
                Open Alerts (2)
              </button>
              <button className="btn-action-secondary" onClick={() => setActiveTab('Log')}>
                Node Log
              </button>
            </div>
          </div>

          {/* Right GPS Telemetry List */}
          <div className="card map-telemetry-drawer">
            <div className="sec-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>NETWORK NODES ({dynamicMapNodes.length})</span>
              <small style={{ color: '#10b981', fontSize: '9px' }}>● LIVE & SIMULATED</small>
            </div>
            <div className="nodes-telemetry-list top-gap">
              {dynamicMapNodes.map((n) => (
                <div
                  key={n.id}
                  className={`node-telemetry-item ${selectedMapNode.id === n.id ? 'active' : ''}`}
                  onClick={() => setSelectedMapNode(n)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`status-dot ${n.id === 'SJ-01' ? 'green' : n.color || 'purple'}`} />
                  <span className="node-lbl">{n.id}</span>
                  <span className="coord-txt">
                    {n.lat.toFixed(4)}° N {n.lon.toFixed(4)}° E
                  </span>
                  <span className={`badge-pill ${n.id === 'SJ-01' ? 'green' : 'muted'}`}>
                    {n.id === 'SJ-01' ? 'LIVE' : 'SIM'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 7. Profile Screen
  const renderProfileScreen = () => {
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="view-title">Profile</h1>
            <p className="view-subtitle">Configure the address and monitoring context used across Monitor, Map, Records, Logs, Alerts, and Archive.</p>
          </div>
        </header>

        {/* Section 1: Address configuration */}
        <div className="card panel top-gap">
          <div className="panel-heading">
            <div>
              <h2>Address configuration</h2>
              <p>Choose the household address that should be used as the monitoring context for this profile.</p>
            </div>
          </div>

          <div className="address-search-box">
            <Search size={16} className="search-icon" />
            <input type="text" placeholder="Search address, district, or landmark" defaultValue="24 River View Lane" />
            <button className="btn-secondary-flat"><Compass size={14} /> Use current location</button>
          </div>

          <div className="saved-address-card top-gap">
            <div className="sa-left">
              <MapPin size={18} className="text-blue" />
              <div>
                <b>Saved address <small>Provisional monitoring context</small></b>
                <p>24 River View Lane, North River district · Illustrative household address</p>
                <small className="snapshot-timestamp">Snapshot 27 Oct 2026 10:32:15 IST</small>
              </div>
            </div>
            <div className="sa-badges">
              <span className="badge-pill blue">Selected</span>
              <span className="badge-pill green">Saved</span>
            </div>
          </div>

          <div className="other-addresses-list top-gap">
            <small>Other nearby addresses</small>
            <div className="address-row-item">
              <MapPin size={14} />
              <span>18 River View Lane, North River district</span>
              <span className="distance-tag">120 m</span>
              <span className="badge-pill muted">Unverified</span>
            </div>
            <div className="address-row-item">
              <MapPin size={14} />
              <span>31 Canal Bank Road, North River district</span>
              <span className="distance-tag">340 m</span>
              <span className="badge-pill muted">Unverified</span>
            </div>
          </div>
        </div>

        {/* Section 2: Monitoring context */}
        <div className="card panel top-gap">
          <div className="panel-heading">
            <div>
              <h2>Monitoring context</h2>
              <p>Choose the nearest node that should be used for this address. The selected node scopes the data shown in Monitor, Map, Records, Logs, Alerts, and Archive.</p>
            </div>
          </div>

          <div className="monitoring-selected-node-box">
            <div className="ms-head">
              <div className="ms-title">
                <i className="chip-icon-drop" />
                <div>
                  <b>SJ-01 · River View inlet</b>
                  <small>Provisional nearest node · 42 m from selected address</small>
                </div>
              </div>
              <div className="ms-pills">
                <span className="badge-pill amber">Provisional nearest node</span>
                <span className="badge-pill amber">92% packet completeness</span>
              </div>
            </div>

            <div className="ms-params-grid top-gap">
              <div><small>Temperature</small><b>24.6°C</b></div>
              <div><small>pH</small><b>7.2</b></div>
              <div><small>Turbidity</small><b className="text-orange">5.8 NTU</b></div>
              <div><small>MQ5 Gas</small><b>0.66 V</b></div>
              <div><small>Salinity</small><b>0.32 ppt</b></div>
            </div>
          </div>

          <div className="nearby-nodes-list top-gap">
            <small>Nearby node options</small>
            <div className="node-opt-row active-opt">
              <i className="chip-icon-drop" />
              <span>SJ-01 · River View inlet <small>42 m · Provisional nearest node</small></span>
              <span className="badge-pill amber">Provisional</span>
            </div>
            <div className="node-opt-row">
              <i className="chip-icon-drop" />
              <span>SJ-017 · Canal Bank intake <small>210 m · Verified supply connection</small></span>
              <span className="badge-pill green">Verified supply</span>
            </div>
            <div className="node-opt-row">
              <i className="chip-icon-drop" />
              <span>SJ-021 · North River crossing <small>380 m · Verified supply connection</small></span>
              <span className="badge-pill green">Verified supply</span>
            </div>
          </div>

          <div className="info-note top-gap">
            <Info size={16} />
            <span>
              Provisional nearest-node mapping does not confirm household supply connection. Verified supply nodes are shown separately so you can request provider mapping if needed.
            </span>
          </div>
        </div>

        {/* Section 3: Scope and Controls */}
        <div className="card panel top-gap">
          <div className="panel-heading">
            <div>
              <h2>Scope and controls</h2>
              <p>The selected address and node will scope the data shown across the following pages.</p>
            </div>
          </div>

          <div className="scope-tiles-grid">
            <div className="scope-tile" onClick={() => setActiveTab('Water Quality Monitor')}>
              <SlidersHorizontal size={16} className="text-blue" />
              <div>
                <b>Monitor</b>
                <small>Real-time readings from SJ-01</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Map')}>
              <MapIcon size={16} className="text-blue" />
              <div>
                <b>Map</b>
                <small>SJ-01 near selected address</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Records & Highlights')}>
              <FileText size={16} className="text-blue" />
              <div>
                <b>Records & Highlights</b>
                <small>Historical datasets and parameter highlights for SJ-01</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Log')}>
              <Radio size={16} className="text-blue" />
              <div>
                <b>Logs</b>
                <small>Packet completeness and telemetry logs</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Alerts')}>
              <Bell size={16} className="text-orange" />
              <div>
                <b>Alerts</b>
                <small>3 open items · 2 high operational, 1 AI review</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Archive')}>
              <Archive size={16} className="text-blue" />
              <div>
                <b>Archive</b>
                <small>Archived snapshots tied to SJ-01</small>
              </div>
            </div>
          </div>

          <div className="scope-footer-actions top-gap">
            <div>
              <small>Selected monitoring context</small>
              <b>24 River View Lane · SJ-01 · River View inlet</b>
            </div>
            <div className="scope-btns">
              <button className="btn-secondary-flat" onClick={() => triggerToast('Mapping request sent to water utility provider.')}>
                Request provider mapping
              </button>
              <button className="btn-action-primary" onClick={() => triggerToast('Monitoring context saved successfully.')}>
                Save monitoring context
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 8. Home Overview Screen
  const renderHomeScreen = () => {
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="view-title">Home</h1>
            <p className="view-subtitle">Your SuJal node overview and quick status at a glance.</p>
          </div>
          <span className="node-chip">
            <i className="chip-icon-drop" /> SJ-01 · River View inlet
          </span>
        </header>

        <div className="card node-context-bar top-gap">
          <div className="bar-left">
            <b>24 River View Lane</b>
            <span>North River district · 42 m from address</span>
          </div>
          <div className="bar-meta-row">
            <span>SJ-01 · River View inlet</span>
            <span>27 Oct 2026, 10:32:15 IST</span>
            <span className="badge-pill amber">Provisional</span>
          </div>
        </div>

        <div className="metrics-grid-4 top-gap">
          <div className="card metric-card" onClick={() => setActiveTab('Water Quality Monitor')}>
            <span className="card-lbl">Temperature</span>
            <div className="metric-huge">24.6 <span className="unit">°C</span></div>
            <span className="badge-pill blue">● Live</span>
          </div>
          <div className="card metric-card" onClick={() => setActiveTab('Water Quality Monitor')}>
            <span className="card-lbl">pH</span>
            <div className="metric-huge">7.2 <span className="unit">pH</span></div>
            <span className="badge-pill blue">● Live</span>
          </div>
          <div className="card metric-card" onClick={() => setActiveTab('Water Quality Monitor')}>
            <span className="card-lbl">Turbidity</span>
            <div className="metric-huge text-orange">5.8 <span className="unit">NTU</span></div>
            <span className="badge-pill orange">● Excursion</span>
          </div>
          <div className="card metric-card" onClick={() => setActiveTab('Water Quality Monitor')}>
            <span className="card-lbl">MQ5 Gas</span>
            <div className="metric-huge">0.66 <span className="unit">V</span></div>
            <span className="badge-pill blue">● Live</span>
          </div>
        </div>

        <div className="quick-grid top-gap">
          {[
            ['Water Quality Monitor', 'Live sensors, diagnostics, and excursion trends', SlidersHorizontal],
            ['Alerts queue', '3 open items · 2 high operational, 1 AI review', Bell],
            ['Records & Highlights', 'Monthly datasets, parameter highlights and preview table', FileText],
            ['Archive', 'Historical retained sensor exports', Archive],
            ['Telemetry Ingest Log', 'Raw packet feed and triage scores', Radio],
            ['Node Map', 'Cartographic node network view', MapIcon],
          ].map(([p, desc, Icon]) => (
            <button className="card quick-card" key={p} onClick={() => setActiveTab(p.startsWith('Water') ? 'Water Quality Monitor' : p.startsWith('Node') ? 'Map' : p.startsWith('Records') ? 'Records & Highlights' : p.split(' ')[0])}>
              <Icon size={20} className="text-blue" />
              <div>
                <b>{p}</b>
                <span>{desc}</span>
              </div>
              <em>Open →</em>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // 8. Admin Dashboard Screen (Operator Controls, Sensor Overrides & Component Toggles)
  const renderAdminDashboardScreen = () => {
    const sensors = liveState?.sensor_data
    const reading = (value, digits = 1) => typeof value === 'number' ? value.toFixed(digits) : '—'
    const flow = sensors?.flow_sensors
    const feedback = liveState?.actuator_feedback
    const selectedChannel = liveState?.selected_channel || 'A'

    const activeOverrideCount = [
      adminOverrides.turbidityOverride,
      adminOverrides.phOverride,
      adminOverrides.mq5Override,
      adminOverrides.tempOverride,
      adminOverrides.tankLevelOverride,
      adminOverrides.flowOverride,
      adminOverrides.mainValve === 'CLOSED',
      adminOverrides.dosingPump === 'RUNNING',
      adminOverrides.flushValve === 'PURGING',
      adminOverrides.uvSterilizer !== 'ACTIVE',
      adminOverrides.buzzerAlarm === 'ALARMING',
    ].filter(Boolean).length

    return (
      <div className="view-container admin-dashboard-view">
        {/* Header Bar */}
        <header className="admin-dashboard-header">
          <div className="admin-header-title-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <ShieldCheck size={24} className="text-green" />
              <h1>Admin Dashboard · Hardware Overrides & Actuators</h1>
              <span className="badge-pill orange" style={{ fontSize: '10px', textTransform: 'uppercase' }}>
                🔒 Isolated SCADA Operator Console
              </span>
            </div>
            <p>
              SuJal Supervisory Control and Data Acquisition (SCADA) · Primary Node SJ-01 (River View Inlet) · Hardware Direct Access
            </p>
            <div className="admin-header-badges">
              <span className="badge-pill green">● OPERATOR: operator@sujal.com</span>
              <span className="badge-pill blue">⚙ ESP32-S3: ONLINE (240MHz)</span>
              <span className={`badge-pill ${activeOverrideCount > 0 ? 'orange' : 'green'}`}>
                {activeOverrideCount > 0 ? `⚠️ ${activeOverrideCount} MANUAL OVERRIDES ACTIVE` : '● AUTONOMOUS CLOSED-LOOP'}
              </span>
              <span className="badge-pill purple">📡 LORA / ESP-NOW: 915 MHz</span>
            </div>
          </div>

          <div className="admin-header-actions">
            <button
              className="btn-action-primary"
              onClick={() => {
                setActiveTab('Water Quality Monitor')
                triggerToast('Returned to Live Dashboard.')
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0284c7' }}
              title="Exit Admin Console and return to Live Dashboard"
            >
              ← Back to Live Dashboard
            </button>
            <button
              className="btn-action-secondary"
              onClick={resetAllOverrides}
              title="Reset all sensor bypasses and actuator overrides back to autonomous hardware mode"
            >
              <RotateCw size={14} /> Reset All to Hardware AUTO
            </button>
            <button
              className="btn-action-danger"
              onClick={() => {
                handleAdminCommand('ESP32_SYSTEM', 'SOFT_REBOOT')
                triggerToast('⚡ ESP32 Node SJ-01 Soft Reboot packet dispatched.')
              }}
              title="Send reset pulse to ESP32 microcontroller"
            >
              <Power size={14} /> Soft Reboot ESP32
            </button>
            <button
              className="btn-action-secondary"
              onClick={() => {
                setIsAdminAuthenticated(false)
                try { sessionStorage.removeItem('sujal_admin_auth') } catch {
                  // ignore
                }
                setActiveTab('Water Quality Monitor')
                triggerToast('🔒 Admin session locked.')
              }}
              title="Lock admin session and exit to Live Dashboard"
            >
              <Lock size={14} /> Lock Admin
            </button>
          </div>
        </header>

        {/* SECTION 0: BRANCH CONTROL AND DEVICE STATUS */}
        <div className="card admin-control-card" style={{ padding: 18, marginTop: 14 }}>
          <div className="card-head-row">
            <div className="card-sensor-info">
              <div className="card-sensor-icon">
                <Sliders size={20} className="text-blue" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '15px', color: '#ffffff' }}>Branch Control and Device Status</h2>
                <p style={{ margin: '3px 0 0', fontSize: '11px', color: 'var(--muted)' }}>
                  {user ? 'Commands are recorded in Firestore and delivered when the ESP32 polls.' : 'Sign in as an assigned operator to issue valve commands.'}
                </p>
              </div>
            </div>
            <span className={`badge-pill ${feedback?.slave_online ? 'blue' : 'amber'}`}>
              {feedback?.slave_online ? '● Controller online' : '● Controller status unknown'}
            </span>
          </div>

          <div className="header-right-meta" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            <span className="badge-pill muted">Mode: {liveState?.mode || '—'}</span>
            <span className="badge-pill muted">Active branch: {feedback?.active_channel || selectedChannel || 'A'}</span>
            <span className="badge-pill muted">A flow: {reading(flow?.channel_a?.flow_rate_lpm, 2)} L/min</span>
            <span className="badge-pill muted">B flow: {reading(flow?.channel_b?.flow_rate_lpm, 2)} L/min</span>
            <button
              className="btn-action-primary"
              disabled={commandBusy}
              onClick={() => queueDeviceCommand('SET_CHANNEL', 'A')}
            >
              Switch to A
            </button>
            <button
              className="btn-action-primary"
              disabled={commandBusy}
              onClick={() => queueDeviceCommand('SET_CHANNEL', 'B')}
            >
              Switch to B
            </button>
            <button
              className="btn-action-secondary"
              disabled={commandBusy}
              onClick={() => queueDeviceCommand('SET_MODE', liveState?.mode === 'AUTO' ? 'MANUAL' : 'AUTO')}
            >
              Toggle Auto / Manual
            </button>
          </div>

          <div className="bar-meta-row" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: '11px', color: 'var(--text-secondary)' }}>
            <span>Treatment stage: <b>{liveState?.treatment?.stage || '—'}</b></span>
            <span>Treatment status: <b>{liveState?.treatment?.status || '—'}</b></span>
            <span>Outlet pH: <b>{reading(liveState?.verification_data?.ph_sensor?.value, 2)}</b></span>
            <span>Outlet turbidity: <b>{reading(liveState?.verification_data?.turbidity_sensor?.value, 2)} NTU</b></span>
            <span>Verification: <b className="text-orange">{liveState?.treatment?.verification || 'No verification status reported'}</b></span>
          </div>

          {liveCommands.length > 0 && (
            <small style={{ marginTop: 6, color: 'var(--muted)', fontSize: '10px', display: 'block' }}>
              Latest command: {liveCommands[0].command} · {liveCommands[0].status} · {liveCommands[0].id}
            </small>
          )}
          {firestoreError && (
            <p className="text-orange" role="alert" style={{ margin: '6px 0 0', fontSize: '11px' }}>
              Firestore access notice: {firestoreError}. Operating under authenticated operator token.
            </p>
          )}
        </div>

        {/* SECTION 1: MANUAL SENSOR OVERRIDERS */}
        <div>
          <div className="admin-section-heading">
            <span>🔬 Manual Sensor Overriders (ADC Bypasses & Test Simulators)</span>
            <small style={{ color: '#8c8884', fontSize: '11px', textTransform: 'none' }}>
              Enabling manual override overrides hardware ADC telemetry across all dashboard views
            </small>
          </div>

          <div className="admin-grid-2col">
            {/* 1. Turbidity Sensor Card */}
            <div className={`admin-control-card ${adminOverrides.turbidityOverride ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Droplets size={18} className="text-orange" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>Turbidity Optical Sensor</b>
                    <small>DFRobot Gravity · ADC1_CH0 (GPIO 36)</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.turbidityOverride ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, turbidityOverride: false }))
                      handleAdminCommand('SENSOR_TURBIDITY', 'AUTO_ADC')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.turbidityOverride ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, turbidityOverride: true }))
                      handleAdminCommand('SENSOR_TURBIDITY', 'MANUAL_OVERRIDE', { val: adminOverrides.turbidityValue })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Hardware ADC</span>
                  <b>{liveState?.sensor_data?.turbidity_sensor?.value ? `${liveState.sensor_data.turbidity_sensor.value} NTU` : '5.8 NTU'}</b>
                </div>
                <div className="reading-item">
                  <span>Operating Limit</span>
                  <b className="text-blue">5.0 NTU</b>
                </div>
                <div className="reading-item">
                  <span>Effective Value</span>
                  <b className={adminOverrides.turbidityOverride ? 'override-val' : 'text-green'}>
                    {adminOverrides.turbidityOverride ? `${adminOverrides.turbidityValue.toFixed(1)} NTU [OVR]` : `${liveState?.sensor_data?.turbidity_sensor?.value ?? 5.8} NTU`}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Condition</span>
                  <b className={(adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : 5.8) > 5.0 ? 'text-orange' : 'text-green'}>
                    {(adminOverrides.turbidityOverride ? adminOverrides.turbidityValue : 5.8) > 5.0 ? 'EXCURSION' : 'NORMAL'}
                  </b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Simulated Turbidity NTU</span>
                  <span>{adminOverrides.turbidityValue.toFixed(1)} NTU</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.1"
                    disabled={!adminOverrides.turbidityOverride}
                    value={adminOverrides.turbidityValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setAdminOverrides((prev) => ({ ...prev, turbidityValue: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="15"
                    step="0.1"
                    disabled={!adminOverrides.turbidityOverride}
                    value={adminOverrides.turbidityValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setAdminOverrides((prev) => ({ ...prev, turbidityValue: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.turbidityOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, turbidityValue: 0.4 }))}
                >
                  Clear (0.4 NTU)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.turbidityOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, turbidityValue: 4.2 }))}
                >
                  Normal (4.2 NTU)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.turbidityOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, turbidityValue: 5.8 }))}
                >
                  Excursion (5.8 NTU)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.turbidityOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, turbidityValue: 9.6 }))}
                >
                  Heavy Sludge (9.6 NTU)
                </button>
              </div>
            </div>

            {/* 2. pH Electrode Sensor Card */}
            <div className={`admin-control-card ${adminOverrides.phOverride ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Activity size={18} className="text-blue" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>pH Glass Electrode</b>
                    <small>E-201-C BNC Probe · ADC1_CH3 (GPIO 39)</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.phOverride ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, phOverride: false }))
                      handleAdminCommand('SENSOR_PH', 'AUTO_ADC')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.phOverride ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, phOverride: true }))
                      handleAdminCommand('SENSOR_PH', 'MANUAL_OVERRIDE', { val: adminOverrides.phValue })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Hardware ADC</span>
                  <b>{liveState?.sensor_data?.ph_sensor?.value ? `${liveState.sensor_data.ph_sensor.value} pH` : '7.20 pH'}</b>
                </div>
                <div className="reading-item">
                  <span>Nominal Band</span>
                  <b className="text-blue">6.5 - 8.5</b>
                </div>
                <div className="reading-item">
                  <span>Effective Value</span>
                  <b className={adminOverrides.phOverride ? 'override-val' : 'text-green'}>
                    {adminOverrides.phOverride ? `${adminOverrides.phValue.toFixed(2)} [OVR]` : `${liveState?.sensor_data?.ph_sensor?.value ?? 7.20}`}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Quality</span>
                  <b className={(adminOverrides.phOverride ? adminOverrides.phValue : 7.2) < 6.5 ? 'text-orange' : (adminOverrides.phOverride ? adminOverrides.phValue : 7.2) > 8.5 ? 'text-orange' : 'text-green'}>
                    {(adminOverrides.phOverride ? adminOverrides.phValue : 7.2) < 6.5 ? 'ACIDIC' : (adminOverrides.phOverride ? adminOverrides.phValue : 7.2) > 8.5 ? 'ALKALINE' : 'POTABLE'}
                  </b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Simulated pH Value</span>
                  <span>{adminOverrides.phValue.toFixed(2)} pH</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="0"
                    max="14"
                    step="0.05"
                    disabled={!adminOverrides.phOverride}
                    value={adminOverrides.phValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setAdminOverrides((prev) => ({ ...prev, phValue: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="14"
                    step="0.05"
                    disabled={!adminOverrides.phOverride}
                    value={adminOverrides.phValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setAdminOverrides((prev) => ({ ...prev, phValue: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.phOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, phValue: 5.2 }))}
                >
                  Acidic (5.2 pH)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.phOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, phValue: 7.2 }))}
                >
                  Neutral Drinkable (7.2 pH)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.phOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, phValue: 8.9 }))}
                >
                  Alkaline Inflow (8.9 pH)
                </button>
              </div>
            </div>

            {/* 3. MQ-5 Gas Sensor Card */}
            <div className={`admin-control-card ${adminOverrides.mq5Override ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Flame size={18} className="text-orange" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>MQ-5 Gas & Leakage Sensor</b>
                    <small>LPG / CH4 Detector · ADC1_CH6 (GPIO 34)</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.mq5Override ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, mq5Override: false }))
                      handleAdminCommand('SENSOR_MQ5', 'AUTO_ADC')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.mq5Override ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, mq5Override: true }))
                      handleAdminCommand('SENSOR_MQ5', 'MANUAL_OVERRIDE', { val: adminOverrides.mq5Value })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Hardware Voltage</span>
                  <b>{liveState?.sensor_data?.mq5_sensor?.voltage ? `${liveState.sensor_data.mq5_sensor.voltage} V` : '0.66 V'}</b>
                </div>
                <div className="reading-item">
                  <span>Alarm Trigger</span>
                  <b className="text-orange">&gt; 1.00 V</b>
                </div>
                <div className="reading-item">
                  <span>Effective Value</span>
                  <b className={adminOverrides.mq5Override ? 'override-val' : 'text-green'}>
                    {adminOverrides.mq5Override ? `${adminOverrides.mq5Value.toFixed(2)} V [OVR]` : `${liveState?.sensor_data?.mq5_sensor?.voltage ?? 0.66} V`}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Atmosphere</span>
                  <b className={(adminOverrides.mq5Override ? adminOverrides.mq5Value : 0.66) >= 1.0 ? 'text-orange' : 'text-green'}>
                    {(adminOverrides.mq5Override ? adminOverrides.mq5Value : 0.66) >= 1.0 ? 'LEAK HAZARD' : 'CLEAR'}
                  </b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Simulated Sensor Voltage</span>
                  <span>{adminOverrides.mq5Value.toFixed(2)} V</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="0.1"
                    max="3.3"
                    step="0.02"
                    disabled={!adminOverrides.mq5Override}
                    value={adminOverrides.mq5Value}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setAdminOverrides((prev) => ({ ...prev, mq5Value: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="0.1"
                    max="3.3"
                    step="0.02"
                    disabled={!adminOverrides.mq5Override}
                    value={adminOverrides.mq5Value}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0.1
                      setAdminOverrides((prev) => ({ ...prev, mq5Value: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.mq5Override}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, mq5Value: 0.66 }))}
                >
                  Baseline (0.66 V)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.mq5Override}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, mq5Value: 0.95 }))}
                >
                  Trace Gas (0.95 V)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.mq5Override}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, mq5Value: 1.85 }))}
                >
                  🚨 Gas Alert (1.85 V)
                </button>
              </div>
            </div>

            {/* 4. Temperature Sensor Card */}
            <div className={`admin-control-card ${adminOverrides.tempOverride ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Gauge size={18} className="text-green" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>Water Temperature Sensor</b>
                    <small>Dallas DS18B20 · 1-Wire Bus (GPIO 4)</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.tempOverride ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, tempOverride: false }))
                      handleAdminCommand('SENSOR_TEMP', 'AUTO_BUS')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.tempOverride ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, tempOverride: true }))
                      handleAdminCommand('SENSOR_TEMP', 'MANUAL_OVERRIDE', { val: adminOverrides.tempValue })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Hardware Probe</span>
                  <b>{liveState?.sensor_data?.temperature_sensor?.value ? `${liveState.sensor_data.temperature_sensor.value} °C` : '24.6 °C'}</b>
                </div>
                <div className="reading-item">
                  <span>Optimal Range</span>
                  <b className="text-blue">18 - 28 °C</b>
                </div>
                <div className="reading-item">
                  <span>Effective Value</span>
                  <b className={adminOverrides.tempOverride ? 'override-val' : 'text-green'}>
                    {adminOverrides.tempOverride ? `${adminOverrides.tempValue.toFixed(1)} °C [OVR]` : `${liveState?.sensor_data?.temperature_sensor?.value ?? 24.6} °C`}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Thermal State</span>
                  <b className={(adminOverrides.tempOverride ? adminOverrides.tempValue : 24.6) > 30 ? 'text-orange' : 'text-green'}>
                    {(adminOverrides.tempOverride ? adminOverrides.tempValue : 24.6) > 30 ? 'WARM EXCURSION' : 'NOMINAL'}
                  </b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Simulated Water Temperature</span>
                  <span>{adminOverrides.tempValue.toFixed(1)} °C</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="5"
                    max="50"
                    step="0.5"
                    disabled={!adminOverrides.tempOverride}
                    value={adminOverrides.tempValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setAdminOverrides((prev) => ({ ...prev, tempValue: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="5"
                    max="50"
                    step="0.5"
                    disabled={!adminOverrides.tempOverride}
                    value={adminOverrides.tempValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 20
                      setAdminOverrides((prev) => ({ ...prev, tempValue: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tempOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tempValue: 14.5 }))}
                >
                  Cold Inflow (14.5 °C)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tempOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tempValue: 24.6 }))}
                >
                  Ambient (24.6 °C)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tempOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tempValue: 38.0 }))}
                >
                  Thermal Run (38.0 °C)
                </button>
              </div>
            </div>

            {/* 5. Ultrasonic Water Tank Level */}
            <div className={`admin-control-card ${adminOverrides.tankLevelOverride ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Droplets size={18} className="text-blue" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>Ultrasonic Tank Level Sensor</b>
                    <small>JSN-SR04T Waterproof · GPIO 18/19</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.tankLevelOverride ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, tankLevelOverride: false }))
                      handleAdminCommand('SENSOR_TANK_LEVEL', 'AUTO')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.tankLevelOverride ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, tankLevelOverride: true }))
                      handleAdminCommand('SENSOR_TANK_LEVEL', 'MANUAL_OVERRIDE', { val: adminOverrides.tankLevelValue })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Hardware Echo</span>
                  <b>84% Full</b>
                </div>
                <div className="reading-item">
                  <span>Capacity</span>
                  <b className="text-blue">5,000 Litres</b>
                </div>
                <div className="reading-item">
                  <span>Effective Level</span>
                  <b className={adminOverrides.tankLevelOverride ? 'override-val' : 'text-green'}>
                    {adminOverrides.tankLevelOverride ? `${adminOverrides.tankLevelValue}% [OVR]` : '84%'}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Tank Status</span>
                  <b className={(adminOverrides.tankLevelOverride ? adminOverrides.tankLevelValue : 84) < 20 ? 'text-orange' : (adminOverrides.tankLevelOverride ? adminOverrides.tankLevelValue : 84) > 95 ? 'text-orange' : 'text-green'}>
                    {(adminOverrides.tankLevelOverride ? adminOverrides.tankLevelValue : 84) < 20 ? 'RESERVE LOW' : (adminOverrides.tankLevelOverride ? adminOverrides.tankLevelValue : 84) > 95 ? 'OVERFLOW RISK' : 'NOMINAL'}
                  </b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Tank Head Level Percentage</span>
                  <span>{adminOverrides.tankLevelValue}%</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    disabled={!adminOverrides.tankLevelOverride}
                    value={adminOverrides.tankLevelValue}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      setAdminOverrides((prev) => ({ ...prev, tankLevelValue: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    disabled={!adminOverrides.tankLevelOverride}
                    value={adminOverrides.tankLevelValue}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0
                      setAdminOverrides((prev) => ({ ...prev, tankLevelValue: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tankLevelOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tankLevelValue: 18 }))}
                >
                  Low Reserve (18%)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tankLevelOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tankLevelValue: 84 }))}
                >
                  Nominal (84%)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.tankLevelOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, tankLevelValue: 98 }))}
                >
                  Overflow Risk (98%)
                </button>
              </div>
            </div>

            {/* 6. Water Flow Rate Sensor */}
            <div className={`admin-control-card ${adminOverrides.flowOverride ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Activity size={18} className="text-green" />
                  </div>
                  <div className="card-sensor-titles">
                    <b>Inflow Meter & Hall Pulse</b>
                    <small>YF-S201 Turbine · GPIO 21 Pulse</small>
                  </div>
                </div>
                <div className="admin-toggle-btn-group">
                  <button
                    className={`toggle-btn ${!adminOverrides.flowOverride ? 'active open' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, flowOverride: false }))
                      handleAdminCommand('SENSOR_FLOW', 'AUTO')
                    }}
                  >
                    AUTO
                  </button>
                  <button
                    className={`toggle-btn ${adminOverrides.flowOverride ? 'active closed' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, flowOverride: true }))
                      handleAdminCommand('SENSOR_FLOW', 'MANUAL_OVERRIDE', { val: adminOverrides.flowValue })
                    }}
                  >
                    OVERRIDE
                  </button>
                </div>
              </div>

              <div className="card-readings-compare">
                <div className="reading-item">
                  <span>Pulse Frequency</span>
                  <b>{adminOverrides.flowOverride ? `${(adminOverrides.flowValue * 7.5).toFixed(0)} Hz` : '138 Hz'}</b>
                </div>
                <div className="reading-item">
                  <span>Pipe Diameter</span>
                  <b className="text-blue">1/2" Inch</b>
                </div>
                <div className="reading-item">
                  <span>Effective Flow</span>
                  <b className={adminOverrides.flowOverride ? 'override-val' : 'text-green'}>
                    {adminOverrides.flowOverride ? `${adminOverrides.flowValue.toFixed(1)} L/m [OVR]` : '18.4 L/m'}
                  </b>
                </div>
                <div className="reading-item">
                  <span>Inlet Velocity</span>
                  <b>{adminOverrides.flowOverride ? (adminOverrides.flowValue > 0 ? 'FLOWING' : 'STAGNANT') : 'FLOWING'}</b>
                </div>
              </div>

              <div className="admin-slider-wrap">
                <div className="slider-label-row">
                  <span>Simulated Inflow Rate</span>
                  <span>{adminOverrides.flowValue.toFixed(1)} L/min</span>
                </div>
                <div className="slider-input-row">
                  <input
                    type="range"
                    min="0"
                    max="45"
                    step="0.5"
                    disabled={!adminOverrides.flowOverride}
                    value={adminOverrides.flowValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setAdminOverrides((prev) => ({ ...prev, flowValue: val }))
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="45"
                    step="0.5"
                    disabled={!adminOverrides.flowOverride}
                    value={adminOverrides.flowValue}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setAdminOverrides((prev) => ({ ...prev, flowValue: val }))
                    }}
                    className="slider-num-box"
                  />
                </div>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Presets:</span>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.flowOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, flowValue: 0.0 }))}
                >
                  Dry / Shutoff (0.0 L/m)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.flowOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, flowValue: 18.5 }))}
                >
                  Nominal (18.5 L/m)
                </button>
                <button
                  className="admin-preset-pill"
                  disabled={!adminOverrides.flowOverride}
                  onClick={() => setAdminOverrides((prev) => ({ ...prev, flowValue: 36.0 }))}
                >
                  Peak Inflow (36.0 L/m)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: HARDWARE COMPONENT ACTUATORS & RELAY TOGGLES */}
        <div className="top-gap">
          <div className="admin-section-heading">
            <span>⚙️ Hardware Component Actuators & Relays (Direct Toggles)</span>
            <small style={{ color: '#8c8884', fontSize: '11px', textTransform: 'none' }}>
              Direct relay control lines wired to ESP32 optocouplers & motor drivers
            </small>
          </div>

          <div className="admin-grid-2col">
            {/* Actuator 1: Main Inflow Valve */}
            <div className={`admin-control-card ${adminOverrides.mainValve === 'OPEN' ? 'active-actuator' : 'active-override'}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Power size={18} className={adminOverrides.mainValve === 'OPEN' ? 'text-green' : 'text-orange'} />
                  </div>
                  <div>
                    <b>Main Solenoid Inflow Gate Valve</b>
                    <small>Relay Channel 1 · 12V DC Coil · Normally Closed</small>
                  </div>
                </div>
                <span className={`badge-pill ${adminOverrides.mainValve === 'OPEN' ? 'green' : 'red'}`}>
                  {adminOverrides.mainValve === 'OPEN' ? '● OPEN · WATER PASSING' : '● CLOSED · SHUTOFF'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Controls raw water supply inlet into coagulation and filtration chambers.
              </p>

              <div className="admin-toggle-btn-group">
                <button
                  className={`toggle-btn ${adminOverrides.mainValve === 'OPEN' ? 'active open' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, mainValve: 'OPEN' }))
                    handleAdminCommand('MAIN_VALVE', 'OPEN')
                  }}
                >
                  <Check size={14} /> COMMAND OPEN
                </button>
                <button
                  className={`toggle-btn ${adminOverrides.mainValve === 'CLOSED' ? 'active closed' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, mainValve: 'CLOSED' }))
                    handleAdminCommand('MAIN_VALVE', 'CLOSE')
                  }}
                >
                  <X size={14} /> COMMAND SHUTOFF
                </button>
              </div>

              <button
                className="btn-action-danger"
                style={{ width: '100%' }}
                onClick={() => {
                  setAdminOverrides((prev) => ({ ...prev, mainValve: 'CLOSED' }))
                  handleAdminCommand('MAIN_VALVE', 'EMERGENCY_CUTOFF')
                  triggerToast('🚨 EMERGENCY CUTOFF: Main Solenoid Valve instantly closed!')
                }}
              >
                <ShieldAlert size={14} /> EMERGENCY CUTOFF (INSTANT SHUTDOWN)
              </button>
            </div>

            {/* Actuator 2: Chemical Dosing Pump */}
            <div className={`admin-control-card ${adminOverrides.dosingPump === 'RUNNING' ? 'active-actuator' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Sliders size={18} className="text-blue" />
                  </div>
                  <div>
                    <b>Chlorine & Coagulant Dosing Pump</b>
                    <small>Relay Channel 2 · Peristaltic 12V Motor Driver</small>
                  </div>
                </div>
                <span className={`badge-pill ${adminOverrides.dosingPump === 'RUNNING' ? 'green' : 'muted'}`}>
                  {adminOverrides.dosingPump === 'RUNNING' ? `● RUNNING (${adminOverrides.dosingMode})` : '● STOPPED'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Injects precise parts-per-million coagulant solution to settle colloidal turbidity.
              </p>

              <div className="admin-toggle-btn-group">
                <button
                  className={`toggle-btn ${adminOverrides.dosingPump === 'STOPPED' ? 'active closed' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, dosingPump: 'STOPPED' }))
                    handleAdminCommand('DOSING_PUMP', 'STOP')
                  }}
                >
                  STOP PUMP
                </button>
                <button
                  className={`toggle-btn ${adminOverrides.dosingPump === 'RUNNING' ? 'active open' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, dosingPump: 'RUNNING' }))
                    handleAdminCommand('DOSING_PUMP', 'START', { mode: adminOverrides.dosingMode })
                  }}
                >
                  START PUMP
                </button>
              </div>

              <div className="admin-presets-row">
                <span style={{ fontSize: '10px', color: '#666' }}>Mode:</span>
                {['AUTO', '25% PULSE', '50% HALF', '100% MAX'].map((mode) => (
                  <button
                    key={mode}
                    className={`admin-preset-pill ${adminOverrides.dosingMode === mode ? 'active' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, dosingMode: mode }))
                      handleAdminCommand('DOSING_MODE', mode)
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Actuator 3: Sludge Drain Flush Valve */}
            <div className={`admin-control-card ${adminOverrides.flushValve === 'PURGING' ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <RefreshCw size={18} className="text-orange" />
                  </div>
                  <div>
                    <b>Sludge Flush & Drain Valve</b>
                    <small>Relay Channel 3 · Bottom Sediment Chamber</small>
                  </div>
                </div>
                <span className={`badge-pill ${adminOverrides.flushValve === 'PURGING' ? 'orange' : 'green'}`}>
                  {adminOverrides.flushValve === 'PURGING' ? '● PURGING SEDIMENT' : '● SEALED NORMAL'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Purges accumulated sediment and sedimented sludge from chamber settling hopper.
              </p>

              <div className="admin-toggle-btn-group">
                <button
                  className={`toggle-btn ${adminOverrides.flushValve === 'CLOSED' ? 'active open' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, flushValve: 'CLOSED' }))
                    handleAdminCommand('FLUSH_VALVE', 'CLOSE')
                  }}
                >
                  SEALED / CLOSED
                </button>
                <button
                  className={`toggle-btn ${adminOverrides.flushValve === 'PURGING' ? 'active closed' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, flushValve: 'PURGING' }))
                    handleAdminCommand('FLUSH_VALVE', 'OPEN_PURGE')
                  }}
                >
                  OPEN PURGE DRAIN
                </button>
              </div>

              <button
                className="btn-action-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  setAdminOverrides((prev) => ({ ...prev, flushValve: 'PURGING' }))
                  handleAdminCommand('FLUSH_VALVE', 'TIMED_CYCLE_15S')
                  triggerToast('⏱ Sludge Purge cycle activated for 15 seconds.')
                  setTimeout(() => {
                    setAdminOverrides((prev) => ({ ...prev, flushValve: 'CLOSED' }))
                    triggerToast('✔ Sludge Purge cycle completed. Valve resealed.')
                  }, 15000)
                }}
              >
                ⏱ Run Automated 15-Second Purge Cycle
              </button>
            </div>

            {/* Actuator 4: UV Sterilizer Chamber */}
            <div className={`admin-control-card ${adminOverrides.uvSterilizer === 'ACTIVE' ? 'active-actuator' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Zap size={18} className="text-purple" />
                  </div>
                  <div>
                    <b>UV-C Sterilization Matrix</b>
                    <small>Relay Channel 4 · 254 nm Germicidal Quartz Tube</small>
                  </div>
                </div>
                <span className={`badge-pill ${adminOverrides.uvSterilizer === 'ACTIVE' ? 'purple' : 'muted'}`}>
                  {adminOverrides.uvSterilizer === 'ACTIVE' ? '● STERILIZING (254nm)' : '● STANDBY OFF'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Eradicates pathogens, coliforms, and microbial bio-contaminants at the outlet canal.
              </p>

              <div className="admin-toggle-btn-group">
                <button
                  className={`toggle-btn ${adminOverrides.uvSterilizer === 'ACTIVE' ? 'active open' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, uvSterilizer: 'ACTIVE' }))
                    handleAdminCommand('UV_STERILIZER', 'ACTIVATE')
                  }}
                >
                  <Zap size={14} /> ACTIVATE UV-C
                </button>
                <button
                  className={`toggle-btn ${adminOverrides.uvSterilizer === 'STANDBY' ? 'active closed' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, uvSterilizer: 'STANDBY' }))
                    handleAdminCommand('UV_STERILIZER', 'DEACTIVATE')
                  }}
                >
                  STANDBY OFF
                </button>
              </div>
            </div>

            {/* Actuator 5: Audible Buzzer & Siren Alarm */}
            <div className={`admin-control-card ${adminOverrides.buzzerAlarm === 'ALARMING' ? 'active-override' : ''}`}>
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    {adminOverrides.buzzerAlarm === 'ALARMING' ? (
                      <Volume2 size={18} className="text-orange" />
                    ) : (
                      <VolumeX size={18} className="text-muted" />
                    )}
                  </div>
                  <div>
                    <b>Station 85dB Warning Siren</b>
                    <small>Piezo Sounder & Strobe Beacon · GPIO 27</small>
                  </div>
                </div>
                <span className={`badge-pill ${adminOverrides.buzzerAlarm === 'ALARMING' ? 'orange' : 'green'}`}>
                  {adminOverrides.buzzerAlarm === 'ALARMING' ? '● SIREN ACTIVE' : '● SILENCED'}
                </span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Local on-site auditory alert for flood excursion, gas leaks, and severe turbidity.
              </p>

              <div className="admin-toggle-btn-group">
                <button
                  className={`toggle-btn ${adminOverrides.buzzerAlarm === 'SILENCED' ? 'active open' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, buzzerAlarm: 'SILENCED' }))
                    handleAdminCommand('SIREN_BUZZER', 'SILENCE')
                  }}
                >
                  <VolumeX size={14} /> FORCE SILENCE
                </button>
                <button
                  className={`toggle-btn ${adminOverrides.buzzerAlarm === 'ALARMING' ? 'active closed' : ''}`}
                  onClick={() => {
                    setAdminOverrides((prev) => ({ ...prev, buzzerAlarm: 'ALARMING' }))
                    handleAdminCommand('SIREN_BUZZER', 'TEST_ALARM')
                    setTimeout(() => {
                      setAdminOverrides((prev) => ({ ...prev, buzzerAlarm: 'SILENCED' }))
                    }, 4000)
                  }}
                >
                  <Volume2 size={14} /> TEST SIREN (4 SEC PULSE)
                </button>
              </div>
            </div>

            {/* Actuator 6: Telemetry RF & Mesh Channel */}
            <div className="admin-control-card">
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Radio size={18} className="text-blue" />
                  </div>
                  <div>
                    <b>LoRa / ESP-NOW Telemetry Channel</b>
                    <small>SX1262 Transceiver + 2.4GHz ESP-NOW Mesh</small>
                  </div>
                </div>
                <span className="badge-pill blue">● 915 MHz ACTIVE</span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Configures long-range sub-gigahertz telemetry frequency and relay channel.
              </p>

              <div className="admin-presets-row">
                {['Channel 1 (915.0 MHz)', 'Channel 2 (868.0 MHz)', 'Direct WiFi MQTT'].map((ch) => (
                  <button
                    key={ch}
                    className={`admin-preset-pill ${adminOverrides.loraChannel === ch ? 'active' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, loraChannel: ch }))
                      handleAdminCommand('TELEMETRY_CHANNEL', ch)
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            {/* Actuator 7: Telemetry Sampling Frequency */}
            <div className="admin-control-card">
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Cpu size={18} className="text-green" />
                  </div>
                  <div>
                    <b>ESP32 Telemetry Sampling Profile</b>
                    <small>Analog Sampling Timer · FreeRTOS Task Period</small>
                  </div>
                </div>
                <span className="badge-pill green">● RATE: {adminOverrides.telemetryRate}</span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Adjusts power consumption vs observation frequency for rural off-grid solar deployments.
              </p>

              <div className="admin-presets-row">
                {[
                  ['1s', '1s (High Speed)'],
                  ['10s', '10s (Active SCADA)'],
                  ['60s', '60s (Standard)'],
                  ['5m', '5m (Eco Deep Sleep)'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    className={`admin-preset-pill ${adminOverrides.telemetryRate === val ? 'active' : ''}`}
                    onClick={() => {
                      setAdminOverrides((prev) => ({ ...prev, telemetryRate: val }))
                      handleAdminCommand('SAMPLING_RATE', val)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Actuator 8: Hardware Diagnostics & Self-Test */}
            <div className="admin-control-card">
              <div className="card-head-row">
                <div className="card-sensor-info">
                  <div className="card-sensor-icon">
                    <Wrench size={18} className="text-orange" />
                  </div>
                  <div>
                    <b>Hardware Self-Diagnostics</b>
                    <small>Automatic Bus & Voltage Self-Test Sequence</small>
                  </div>
                </div>
                <span className="badge-pill green">● READY</span>
              </div>

              <p style={{ fontSize: '11px', color: '#a8a49e', margin: 0 }}>
                Runs comprehensive self-diagnostic test of all ADC lines, internal RTC, I2C bus, and relay coils.
              </p>

              <button
                className="btn-action-primary"
                style={{ width: '100%' }}
                onClick={() => {
                  handleAdminCommand('SYSTEM_DIAGNOSTIC', 'RUN_SELF_TEST')
                  triggerToast('🧪 Diagnostic sequence started: ADC calibration, relay coil test, and memory check.')
                  setTimeout(() => {
                    triggerToast('✔ Self-test passed: All 4 Relays OK, ADC Rails within ±0.02V tolerance.')
                  }, 2500)
                }}
              >
                <Activity size={14} /> Run Comprehensive Hardware Self-Test
              </button>
            </div>
          </div>
        </div>

        {/* SECTION 3: RECENT ADMIN COMMANDS AUDIT LOG */}
        <div className="card top-gap" style={{ padding: 18 }}>
          <div className="sec-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>OPERATOR COMMAND DISPATCH LOG ({adminCommandLogs.length})</span>
            <small className="badge-pill green">● REALTIME BUS LOG</small>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="admin-command-table">
              <thead>
                <tr>
                  <th>Command ID</th>
                  <th>Timestamp</th>
                  <th>Target Component</th>
                  <th>Action / Commanded State</th>
                  <th>Operator ID</th>
                  <th>Bus Status</th>
                </tr>
              </thead>
              <tbody>
                {adminCommandLogs.map((log) => (
                  <tr key={log.id}>
                    <td><code>{log.id}</code></td>
                    <td>{log.time}</td>
                    <td><b>{log.target}</b></td>
                    <td><span className="text-blue">{log.action}</span></td>
                    <td>{log.operator}</td>
                    <td><span className="badge-pill green">{log.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const getContent = () => {
    switch (activeTab) {
      case 'Home':
        return renderHomeScreen()
      case 'Water Quality Monitor':
        return renderMonitorScreen()
      case 'Alerts':
        return renderAlertsScreen()
      case 'Records':
      case 'Records & Highlights':
        return renderRecordsScreen()
      case 'Archive':
        return renderArchiveScreen()
      case 'Log':
        return renderLogScreen()
      case 'Map':
        return renderMapScreen()
      case 'Profile':
        return renderProfileScreen()
      case 'Admin Dashboard':
        return renderAdminDashboardScreen()
      default:
        return renderMonitorScreen()
    }
  }

  return (
    <div className="app-shell">
      {/* Mobile scrim overlay */}
      <div
        className={`mobile-scrim ${menuOpen ? 'visible' : ''}`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Main Sidebar */}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <img src={sujalLogo} alt="Sujal logo" className="brand-symbol" />
          </div>
          <div>
            <b>Sujal</b>
            <small>Intelligence in every drop</small>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {[
            ['Home', LayoutDashboard],
            ['Water Quality Monitor', SlidersHorizontal],
            ['Map', MapIcon],
            ['Records & Highlights', FileSpreadsheet],
            ['Log', Radio],
            ['Alerts', Bell, 3],
            ['Archive', Archive],
          ].map(([name, Icon, badge]) => (
            <button
              key={name}
              className={`nav-link ${(activeTab === name || (name === 'Records & Highlights' && activeTab === 'Records')) ? 'selected' : ''}`}
              onClick={() => {
                setActiveTab(name)
                setMenuOpen(false)
              }}
            >
              <Icon size={17} />
              <span>{name}</span>
              {badge && <span className="nav-badge-orange">{badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className={`nav-link ${activeTab === 'Profile' ? 'selected' : ''}`}
            onClick={() => {
              setActiveTab('Profile')
              setMenuOpen(false)
            }}
          >
            <Settings2 size={17} />
            <span>Profile</span>
          </button>

          {/* Redesigned Operator / Admin Panel Button */}
          <div className="admin-sidebar-footer">
            <button
              className={`admin-panel-btn ${isAdminAuthenticated ? 'armed' : ''} ${activeTab === 'Admin Dashboard' ? 'selected' : ''}`}
              onClick={() => {
                if (isAdminAuthenticated) {
                  setActiveTab('Admin Dashboard')
                  setMenuOpen(false)
                } else {
                  setAdminAuthEmail('operator@sujal.com')
                  setAdminAuthPassword('')
                  setAdminAuthError('')
                  setAdminAuthOpen(true)
                }
              }}
              title="Open Operator Admin Console & Component Overrides"
            >
              <div className="admin-btn-avatar">
                {isAdminAuthenticated ? (
                  <ShieldCheck size={18} className="text-green" />
                ) : (
                  <Lock size={18} className="text-orange" />
                )}
              </div>
              <div className="admin-btn-meta">
                <div className="admin-btn-title-row">
                  <b>Admin Panel</b>
                  <span className={`admin-status-indicator ${isAdminAuthenticated ? 'armed' : 'locked'}`} />
                </div>
                <small>{isAdminAuthenticated ? 'operator@sujal.com' : 'Verify Operator'}</small>
              </div>
              <span className={`admin-chip ${isAdminAuthenticated ? 'green' : 'orange'}`}>
                {isAdminAuthenticated ? 'ARMED' : 'AUTH'}
              </span>
            </button>

            {isAdminAuthenticated && (
              <div className="admin-quick-actions">
                <span className="admin-session-label">● SJ-01 Overrides Active</span>
                <button
                  className="admin-lock-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (user) signOut(auth)
                    setIsAdminAuthenticated(false)
                    try { sessionStorage.removeItem('sujal_admin_auth') } catch {
                      // ignore
                    }
                    if (activeTab === 'Admin Dashboard') setActiveTab('Water Quality Monitor')
                    triggerToast('🔒 Admin session locked.')
                  }}
                  title="Lock Admin Console"
                >
                  <Unlock size={11} /> Lock
                </button>
              </div>
            )}
            <small className="sidebar-version">SUJAL · NODE SJ-01 RIVER VIEW</small>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-area">
        <div className="mobile-top-bar">
          <button className="mobile-menu-btn" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="mobile-brand-title">
            <img src={sujalLogo} alt="Sujal" height="20" />
            <span>Sujal</span>
          </div>
        </div>

        <div className="content-wrap">
          <ErrorBoundary key={activeTab}>
            {getContent()}
          </ErrorBoundary>

          <footer className="app-footer">
            <span>SUJAL <i>·</i> NODE SJ-01 RIVER VIEW INLET</span>
            <span>
              24 River View Lane <i>·</i> 27 Oct 2026, 10:32:15 IST
            </span>
          </footer>
        </div>
      </main>

      {/* Notification Toast */}
      {toastMsg && (
        <div className="toast">
          <Check size={16} />
          {toastMsg}
        </div>
      )}

      {/* Sign In Modal */}
      {loginOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setLoginOpen(false)}
        >
          <form
            className="login-modal card"
            onSubmit={async (e) => {
              e.preventDefault()
              const fd = new FormData(e.currentTarget)
              try {
                await signInWithEmailAndPassword(auth, fd.get('email'), fd.get('password'))
                setLoginOpen(false)
                triggerToast('Signed in successfully.')
              } catch (err) {
                triggerToast(`Sign in error: ${err.message}`)
              }
            }}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setLoginOpen(false)}
              aria-label="Close login dialog"
            >
              <X size={18} />
            </button>
            <div className="brand-mark mb-3">
              <img src={sujalLogo} alt="Sujal" height="32" />
            </div>
            <h2>Operator Sign In</h2>
            <p>Access live telemetry control for node SJ-01.</p>
            <label>
              Email
              <input type="email" name="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input type="password" name="password" autoComplete="current-password" required />
            </label>
            <button className="btn-action-primary full top-gap">Sign in</button>
          </form>
        </div>
      )}

      {/* Coordinate Modal */}
      {showCoordModal && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setShowCoordModal(false)}
        >
          <div className="coord-modal card">
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowCoordModal(false)}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Navigation size={22} className="text-blue" />
              <div>
                <h2 style={{ margin: 0, fontSize: '17px', color: '#fff' }}>Set Live Device Coordinates</h2>
                <small style={{ color: '#8c8884', fontSize: '11px' }}>Position SuJal Node SJ-01 at the actual field deployment site</small>
              </div>
            </div>

            <div className="coord-presets">
              <span style={{ fontSize: '10px', color: '#777', alignSelf: 'center' }}>Presets:</span>
              <button
                type="button"
                className="coord-preset-btn"
                onClick={detectLiveLocation}
                disabled={isLocating}
              >
                {isLocating ? '📍 Locating GPS...' : '📍 My Live GPS'}
              </button>
              <button
                type="button"
                className="coord-preset-btn"
                onClick={() => {
                  setManualLat('28.6655')
                  setManualLon('77.2340')
                  setManualAddress('Yamuna River Monitoring Bank')
                }}
              >
                Yamuna River (28.66, 77.23)
              </button>
              <button
                type="button"
                className="coord-preset-btn"
                onClick={() => {
                  setManualLat('28.5448')
                  setManualLon('77.3094')
                  setManualAddress('Okhla Barrage Inflow Canal')
                }}
              >
                Okhla Canal (28.54, 77.31)
              </button>
              <button
                type="button"
                className="coord-preset-btn"
                onClick={() => {
                  setManualLat('28.6139')
                  setManualLon('77.2090')
                  setManualAddress('River View inlet · North River District')
                }}
              >
                Central Bench (28.61, 77.21)
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const latNum = parseFloat(manualLat)
                const lonNum = parseFloat(manualLon)
                if (isNaN(latNum) || latNum < -90 || latNum > 90) {
                  triggerToast('Latitude must be between -90 and 90')
                  return
                }
                if (isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
                  triggerToast('Longitude must be between -180 and 180')
                  return
                }
                const newLoc = {
                  lat: Number(latNum.toFixed(5)),
                  lon: Number(lonNum.toFixed(5)),
                  accuracy: 3,
                  source: 'Custom Field Site',
                  address: manualAddress.trim() || 'Custom Field Site',
                }
                setDeviceLocation(newLoc)
                try {
                  localStorage.setItem('sujal_live_device_location', JSON.stringify(newLoc))
                } catch {
                  // Ignore storage write error
                }
                setShowCoordModal(false)
                triggerToast(`📍 Location updated to ${newLoc.lat}° N, ${newLoc.lon}° E`)
              }}
            >
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginTop: 12 }}>
                Latitude (-90 to +90)
                <input
                  type="text"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  placeholder="e.g. 28.5355"
                  required
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-inner)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: '#fff', marginTop: 4, fontSize: '12px' }}
                />
              </label>

              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginTop: 10 }}>
                Longitude (-180 to +180)
                <input
                  type="text"
                  value={manualLon}
                  onChange={(e) => setManualLon(e.target.value)}
                  placeholder="e.g. 77.3910"
                  required
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-inner)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: '#fff', marginTop: 4, fontSize: '12px' }}
                />
              </label>

              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginTop: 10 }}>
                Site / Address Description
                <input
                  type="text"
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="e.g. River View inlet, Water Treatment Canal"
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card-inner)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: '#fff', marginTop: 4, fontSize: '12px' }}
                />
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button type="submit" className="btn-action-primary" style={{ flex: 1 }}>
                  Save & Update Map
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => setShowCoordModal(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Operator Verification Modal */}
      {adminAuthOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setAdminAuthOpen(false)}
        >
          <div className="admin-auth-modal card">
            <button
              type="button"
              className="modal-close"
              onClick={() => setAdminAuthOpen(false)}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div className="admin-auth-header">
              <div className="admin-auth-icon-wrap">
                <ShieldCheck size={28} className="text-green" />
              </div>
              <div>
                <h2>Operator Security Verification</h2>
                <p>SuJal Supervisory Control and Data Acquisition (SCADA)</p>
              </div>
            </div>

            <div className="admin-auth-notice">
              <Lock size={14} className="text-orange" />
              <span>
                Authorized access required to unlock hardware component toggles and sensor overrides for Node SJ-01.
              </span>
            </div>

            <div className="admin-auth-credentials-hint">
              <div className="cred-hint-row">
                <span>Login:</span>
                <code>operator@sujal.com</code>
              </div>
              <div className="cred-hint-row">
                <span>Password:</span>
                <code>operator</code>
              </div>
              <button
                type="button"
                className="btn-fill-creds"
                onClick={() => {
                  setAdminAuthEmail('operator@sujal.com')
                  setAdminAuthPassword('operator')
                  setAdminAuthError('')
                }}
              >
                Auto-fill
              </button>
            </div>

            {adminAuthError && (
              <div className="admin-auth-error-banner" role="alert">
                <AlertTriangle size={15} />
                <span>{adminAuthError}</span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault()
                const trimmedEmail = adminAuthEmail.trim().toLowerCase()
                const trimmedPass = adminAuthPassword.trim()
                if (trimmedEmail === 'operator@sujal.com' && trimmedPass === 'operator') {
                  setIsAdminAuthenticated(true)
                  try {
                    sessionStorage.setItem('sujal_admin_auth', 'true')
                  } catch {
                    // ignore
                  }
                  setAdminAuthOpen(false)
                  setAdminAuthError('')
                  setActiveTab('Admin Dashboard')
                  setMenuOpen(false)
                  triggerToast('🔐 Operator verified: Admin Dashboard unlocked')
                } else {
                  setAdminAuthError('Invalid operator credentials. Expected: operator@sujal.com / operator')
                }
              }}
            >
              <label className="admin-auth-label">
                Operator Login ID
                <input
                  type="text"
                  value={adminAuthEmail}
                  onChange={(e) => setAdminAuthEmail(e.target.value)}
                  placeholder="operator@sujal.com"
                  required
                  className="admin-auth-input"
                />
              </label>

              <label className="admin-auth-label">
                Password
                <input
                  type="password"
                  value={adminAuthPassword}
                  onChange={(e) => setAdminAuthPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="admin-auth-input"
                />
              </label>

              <div className="admin-auth-actions top-gap">
                <button type="submit" className="btn-action-primary full">
                  Verify & Open Admin Dashboard
                </button>
                <button
                  type="button"
                  className="btn-action-secondary full"
                  onClick={() => setAdminAuthOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
