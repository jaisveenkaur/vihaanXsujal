import { useEffect, useState, useRef, useMemo } from 'react'
import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  ChevronDown,
  Compass,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Info,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Menu,
  Radio,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
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
    node: 'SJ-014 · River View inlet',
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
    node: 'SJ-014 · River View inlet',
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
    node: 'SJ-014 · River View inlet',
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
  { month: 'July 2026', range: '01–31 Jul', status: 'Closed · Available', samples: '44,640', complete: '98.7%', missing: '1.3%', archived: true, filename: 'SJ-014_2026-07.csv', days: '31 / 31', missingReadings: '580 / 45,220', size: '~3.8 MB', date: '03 Aug 2026 00:14 IST' },
  { month: 'June 2026', range: '01–30 Jun', status: 'Closed · Available', samples: '43,200', complete: '99.2%', missing: '0.8%', archived: true, filename: 'SJ-014_2026-06.csv', days: '30 / 30', missingReadings: '340 / 43,540', size: '~3.6 MB', date: '02 Jul 2026 00:10 IST' },
  { month: 'May 2026', range: '01–31 May', status: 'Closed · Minor gaps', samples: '43,804', complete: '94.1%', missing: '5.9%', archived: true, filename: 'SJ-014_2026-05.csv', days: '31 / 31', missingReadings: '2,610 / 46,414', size: '~3.7 MB', date: '03 Jun 2026 00:18 IST' },
  { month: 'April 2026', range: '01–30 Apr', status: 'Closed', samples: '2,880', complete: '92%', missing: '8%', archived: true, filename: 'SJ-014_2026-04.csv', days: '30 / 30', missingReadings: '240 / 3,120', size: '~1.1 MB', date: '02 May 2026 00:12 IST' },
]

const TELEMETRY_LOGS = [
  { id: 'EVT-2026-1027-0009', time: '10:31:04 IST', node: 'SJ-014', type: 'DATA QUALITY', status: 'INCOMPLETE', payload: 'Telemetry gap detected — 92% packet completeness over last hour', score: 81 },
  { id: 'EVT-2026-1027-0008', time: '10:30:47 IST', node: 'SJ-014', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 5.8 NTU exceeds SJ-014 configured limit 5.0 NTU', score: 78 },
  { id: 'EVT-2026-1027-0007', time: '10:29:58 IST', node: 'SJ-014', type: 'AI INTERPRET', status: 'PENDING REVIEW', payload: 'AI model flagged multi-parameter correlation; turbidity rise + MQ5 stable', score: 42 },
  { id: 'EVT-2026-1027-0006', time: '10:28:30 IST', node: 'SJ-014', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 5.6 NTU · pH 7.2 · Temp 24.5 °C · MQ5 0.66 V', score: 12 },
  { id: 'EVT-2026-1027-0005', time: '10:25:00 IST', node: 'SJ-014', type: 'DATA QUALITY', status: 'DROPPED', payload: '3 consecutive packets dropped (seq 0x4A1C-0x4A1E). Uplink RSSI -92 dBm', score: 55 },
  { id: 'EVT-2026-1027-0004', time: '10:20:01 IST', node: 'SJ-014', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 4.9 NTU · pH 7.1 · Temp 24.5 °C · MQ5 0.65 V', score: 10 },
  { id: 'EVT-2026-1027-0003', time: '10:00:00 IST', node: 'SJ-014', type: 'SYSTEM', status: 'ACKNOWLEDGED', payload: 'Configured operating limit updated: 4.5 -> 5.0 NTU by illustrative operator', score: 8 },
  { id: 'EVT-2026-1027-0002', time: '09:50:15 IST', node: 'SJ-014', type: 'MEASUREMENT', status: 'INGESTED', payload: 'Turbidity 4.7 NTU · pH 7.0 · Temp 24.1 °C · MQ5 0.64 V', score: 11 },
  { id: 'EVT-2026-1027-0001', time: '09:31:02 IST', node: 'SJ-014', type: 'SYSTEM', status: 'ACKNOWLEDGED', payload: 'Device boot complete. Firmware v3.1.7. Sensor self-test passed.', score: 6 },
]

const MAP_NODES = [
  { id: 'SJ-011', name: 'North Intake', status: 'Live', lat: 28.6281, lon: 77.2033, x: 28, y: 22, color: 'green' },
  { id: 'SJ-012', name: 'Sub-station 4', status: '4 m ago', lat: 28.6188, lon: 77.2061, x: 38, y: 52, color: 'amber' },
  { id: 'SJ-013', name: 'Reservoir Feeder', status: 'Missing GPS', lat: 28.6155, lon: 77.2178, x: 48, y: 72, color: 'amber' },
  { id: 'SJ-014', name: 'River View inlet', status: 'Live · Selected', lat: 28.6139, lon: 77.2090, x: 55, y: 32, color: 'red', selected: true },
  { id: 'SJ-015', name: 'East Main', status: 'Live', lat: 28.6098, lon: 77.2102, x: 68, y: 48, color: 'green' },
  { id: 'SJ-016', name: 'Canal Bank', status: 'Stale', lat: 28.6071, lon: 77.2155, x: 75, y: 65, color: 'muted' },
  { id: 'SJ-017', name: 'South Crossing', status: 'Alert', lat: 28.6155, lon: 77.2178, x: 74, y: 82, color: 'red' },
]

// --- NASA GIBS Realtime Satellite Map Component ---
function NasaSatelliteMap({ nodes, selectedNode, onSelectNode, currentLayer, showOverlays, liveState }) {
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const baseLayersRef = useRef({})
  const labelsLayerRef = useRef(null)
  const markersRef = useRef({})
  const [leafletReady, setLeafletReady] = useState(Boolean(typeof window !== 'undefined' && window.L))

  // Dynamically ensure Leaflet is loaded
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (window.L) {
      setLeafletReady(true)
      return undefined
    }

    let isMounted = true
    const checkTimer = setInterval(() => {
      if (window.L && isMounted) {
        setLeafletReady(true)
        clearInterval(checkTimer)
      }
    }, 100)

    // Fallback script tag injector if head script didn't fire
    if (!document.getElementById('leaflet-cdn-script')) {
      const link = document.createElement('link')
      link.id = 'leaflet-cdn-style'
      link.rel = 'stylesheet'
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css'
      document.head.appendChild(link)

      const script = document.createElement('script')
      script.id = 'leaflet-cdn-script'
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
      script.onload = () => {
        if (isMounted) setLeafletReady(true)
      }
      document.head.appendChild(script)
    }

    return () => {
      isMounted = false
      clearInterval(checkTimer)
    }
  }, [])

  useEffect(() => {
    if (!leafletReady || !mapContainerRef.current) return undefined
    const L = window.L
    if (!L) return undefined

    // Clean up existing map instance or residual container ID to prevent double-initialization
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
      zoom: 13,
      minZoom: 2,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
    })
    mapInstanceRef.current = map

    L.control.zoom({ position: 'bottom-right' }).addTo(map)

    // 1. NASA Realtime VIIRS TrueColor (Suomi-NPP) - Latest available daily composite
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

    // 2. NASA Terra MODIS TrueColor - Daily multispectral reflectance
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

    // 3. NASA Earth at Night (Black Marble) - Night lights observation
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

    // 4. High-Res Street & River Hybrid Satellite (Esri World Imagery)
    const streetSatLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 19,
        attribution: '&copy; Esri & OpenStreetMap',
      }
    )

    baseLayersRef.current = {
      'nasa-viirs': viirsLayer,
      'nasa-terra': terraLayer,
      'nasa-night': nightLayer,
      'street-sat': streetSatLayer,
    }

    const activeBase = baseLayersRef.current[currentLayer] || streetSatLayer
    activeBase.addTo(map)

    // Transparent dark street, waterway & place labels overlay
    const labels = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
      {
        subdomains: 'abcd',
        maxZoom: 19,
        zIndex: 600,
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      }
    )
    labelsLayerRef.current = labels
    if (showOverlays) {
      labels.addTo(map)
    }

    // Boundary box for 24 River View Lane
    const riverViewBounds = [
      [28.6115, 77.2065],
      [28.6160, 77.2115],
    ]
    L.rectangle(riverViewBounds, {
      color: '#2c94bd',
      weight: 1.5,
      dashArray: '4, 4',
      fillColor: '#2c94bd',
      fillOpacity: 0.12,
    }).addTo(map)

    // Node Markers
    markersRef.current = {}
    nodes.forEach((node) => {
      const isSelected = selectedNode?.id === node.id
      const pinColor = isSelected ? '#e06836' : node.color === 'green' ? '#35aa83' : node.color === 'amber' ? '#d8a329' : '#6b6661'

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

      const marker = L.marker([node.lat, node.lon], { icon: customIcon }).addTo(map)
      marker.on('click', () => {
        onSelectNode(node)
      })

      marker.bindPopup(`
        <div class="nasa-popup">
          <div class="popup-title"><b>${node.id}</b> · ${node.name}</div>
          <div class="popup-sub">GPS: ${node.lat.toFixed(4)}° N, ${node.lon.toFixed(4)}° E</div>
          <div class="popup-status">Status: <b>${node.status}</b></div>
          ${node.id === 'SJ-014' ? `
            <div class="popup-metrics">
              <span>Turb: <b>${liveState?.sensor_data?.turbidity_sensor?.value ?? 5.8} NTU</b></span>
              <span>pH: <b>${liveState?.sensor_data?.ph_sensor?.value ?? 7.2}</b></span>
              <span>MQ-5: <b>${liveState?.sensor_data?.mq5_sensor?.voltage ?? 0.66} V</b></span>
            </div>
          ` : ''}
        </div>
      `, { className: 'dark-leaflet-popup' })

      markersRef.current[node.id] = marker
    })

    // Invalidate size on load and on window resize to ensure full 640px height rendering
    const timers = [
      setTimeout(() => map.invalidateSize(), 100),
      setTimeout(() => map.invalidateSize(), 300),
      setTimeout(() => map.invalidateSize(), 700),
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
  }, [leafletReady])

  // Switch base layers
  useEffect(() => {
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
  }, [currentLayer])

  // Switch overlays
  useEffect(() => {
    const map = mapInstanceRef.current
    const labels = labelsLayerRef.current
    if (!map || !labels) return
    if (showOverlays) {
      if (!map.hasLayer(labels)) labels.addTo(map)
    } else {
      if (map.hasLayer(labels)) map.removeLayer(labels)
    }
  }, [showOverlays])

  // Pan to selected node
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map || !selectedNode) return
    map.panTo([selectedNode.lat, selectedNode.lon], { animate: true, duration: 0.8 })
    const marker = markersRef.current[selectedNode.id]
    if (marker) {
      marker.openPopup()
    }
  }, [selectedNode])

  return (
    <div
      ref={mapContainerRef}
      id="nasa-leaflet-map"
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        inset: 0,
        background: '#131211',
      }}
    >
      {!leafletReady && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: '#dedbd7' }}>
          <div className="badge-pill purple" style={{ marginBottom: 12 }}>Connecting to NASA EOSDIS GIBS...</div>
          <small style={{ color: '#8c8884' }}>Streaming live Earth observations & satellite telemetry</small>
        </div>
      )}
    </div>
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
              <line x1={padL} y1={yPos} x2={width - padR} y2={yPos} stroke="#2b2825" strokeDasharray="2,3" />
              <text x={padL - 6} y={yPos + 3} fill="#78736d" fontSize="9" textAnchor="end">
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
  const [liveState, setLiveState] = useState(null)
  const [liveReadings, setLiveReadings] = useState([])
  const [liveAlerts, setLiveAlerts] = useState(null)
  const [liveCommands, setLiveCommands] = useState([])
  const [firestoreError, setFirestoreError] = useState('')
  const [commandBusy, setCommandBusy] = useState(false)
  const [selectedMapNode, setSelectedMapNode] = useState(MAP_NODES.find((n) => n.selected) || MAP_NODES[3])
  const [mapLayer, setMapLayer] = useState('nasa-viirs')
  const [showMapOverlays, setShowMapOverlays] = useState(true)

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

  const triggerToast = (msg) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3500)
  }

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
    if (!user || !db) { setLoginOpen(true); return }
    setCommandBusy(true)
    try {
      const fields = command === 'SET_CHANNEL' ? { selected_channel: value } : { mode: value }
      await addDoc(collection(db, 'devices', 'SUJAL_01', 'commands'), {
        command, status: 'pending', requested_by: user.uid, created_at: serverTimestamp(), ...fields,
      })
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
    const temp = sensors?.temperature_sensor?.value
    const ph = sensors?.ph_sensor?.value
    const turbidity = sensors?.turbidity_sensor?.value
    const gas = sensors?.mq5_sensor?.voltage
    const flow = sensors?.flow_sensors
    const feedback = liveState?.actuator_feedback
    const selectedChannel = liveState?.selected_channel || 'A'
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
            <div className="metric-foot">{liveState ? 'Live ESP32 reading' : 'Illustrative demo reading'}</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">pH</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <div className="metric-huge">
              {reading(ph, 2)} <span className="unit">pH</span>
            </div>
            <div className="metric-foot">{sensors?.ph_sensor?.calibrated ? 'Calibrated sensor' : 'Calibration status unverified'}</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">Turbidity</span>
              <span className="badge-pill orange">● Excursion</span>
            </div>
            <div className="metric-huge text-orange">
              {reading(turbidity)} <span className="unit">NTU</span>
            </div>
            <div className="metric-foot text-orange">{turbidity > 5 ? 'Above demo alert threshold 5 NTU' : 'Sensor reading · not a potability determination'}</div>
          </div>

          <div className="card metric-card">
            <div className="card-top">
              <span className="card-lbl">MQ5 Gas</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <div className="metric-huge">
              {reading(gas, 2)} <span className="unit">V</span>
            </div>
            <div className="metric-foot">Gas above water · separate from water quality</div>
          </div>
        </div>

        <div className="card top-gap" style={{ padding: 18 }}>
          <div className="table-header-split">
            <div><h2>Branch control and device status</h2><p>{user ? 'Commands are recorded in Firestore and delivered when the ESP32 polls.' : 'Sign in as an assigned operator to issue valve commands.'}</p></div>
            <span className={`badge-pill ${feedback?.slave_online ? 'blue' : 'amber'}`}>{feedback?.slave_online ? 'Controller online' : 'Controller status unknown'}</span>
          </div>
          <div className="header-right-meta" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
            <span className="badge-pill muted">Mode: {liveState?.mode || '—'}</span>
            <span className="badge-pill muted">Active branch: {feedback?.active_channel || selectedChannel}</span>
            <span className="badge-pill muted">A flow: {reading(flow?.channel_a?.flow_rate_lpm, 2)} L/min</span>
            <span className="badge-pill muted">B flow: {reading(flow?.channel_b?.flow_rate_lpm, 2)} L/min</span>
            <button className="btn-action-primary" disabled={commandBusy} onClick={() => queueDeviceCommand('SET_CHANNEL', 'A')}>Switch to A</button>
            <button className="btn-action-primary" disabled={commandBusy} onClick={() => queueDeviceCommand('SET_CHANNEL', 'B')}>Switch to B</button>
            <button className="btn-action-secondary" disabled={commandBusy} onClick={() => queueDeviceCommand('SET_MODE', liveState?.mode === 'AUTO' ? 'MANUAL' : 'AUTO')}>Toggle Auto / Manual</button>
          </div>
          <div className="bar-meta-row" style={{ marginTop: 12 }}>
            <span>Treatment stage: {liveState?.treatment?.stage || '—'}</span>
            <span>Treatment status: {liveState?.treatment?.status || '—'}</span>
            <span>Outlet pH: {reading(liveState?.verification_data?.ph_sensor?.value, 2)}</span>
            <span>Outlet turbidity: {reading(liveState?.verification_data?.turbidity_sensor?.value, 2)} NTU</span>
            <span>Verification: {liveState?.treatment?.verification || 'No verification status reported'}</span>
          </div>
          {liveCommands.length > 0 && <small>Latest command: {liveCommands[0].command} · {liveCommands[0].status} · {liveCommands[0].id}</small>}
          {firestoreError && <p className="text-orange" role="alert">Firestore access error: {firestoreError}. Check that this account has operator access to SUJAL_01.</p>}
        </div>

        {/* Row 2: 4 Diagnostic / Status Cards */}
        <div className="metrics-grid-4">
          <div className="card diag-card">
            <div className="card-top">
              <span className="diag-heading">Water potability</span>
              <span className="badge-pill orange">● Not determined</span>
            </div>
            <p className="diag-desc">
              Sensor readings alone cannot determine potability. Lab verification is required for pathogen, chemical, and biological safety assessment.
            </p>
            <div className="diag-rows">
              <div><span>Lab verification</span><b>Required</b></div>
              <div><span>Safety claim</span><b>None</b></div>
              <div><span>Interpretation</span><b>Sensor only</b></div>
            </div>
          </div>

          <div className="card diag-card">
            <div className="card-top">
              <span className="diag-heading">Time to Water Filter</span>
              <span className="badge-pill amber">● Not configured</span>
            </div>
            <p className="diag-desc">
              This card is for maintenance and service planning. No health forecast is generated from sensor data. Configure the service interval to enable scheduling.
            </p>
            <div className="diag-rows">
              <div><span>Service interval</span><b>Not configured</b></div>
              <div><span>Next service</span><b>—</b></div>
              <div><span>Purpose</span><b>Maintenance</b></div>
            </div>
          </div>

          <div className="card diag-card">
            <div className="card-top">
              <span className="diag-heading">Gemini Report</span>
              <span className="badge-pill purple">● Illustrative AI</span>
            </div>
            <p className="diag-desc">
              Elevated turbidity and incomplete telemetry suggest operator review. This response is an illustrative AI interpretation and does not establish potability.
            </p>
            <div className="diag-rows">
              <div><span>Turbidity</span><b className="text-orange">Elevated</b></div>
              <div><span>Telemetry</span><b>92% complete</b></div>
              <div><span>Recommendation</span><b>Review</b></div>
            </div>
          </div>

          <div className="card diag-card">
            <div className="card-top">
              <span className="diag-heading">Co-Relation Data</span>
              <span className="badge-pill blue">● Sample</span>
            </div>
            <p className="diag-desc">
              Temperature ↔ MQ5 gas. Illustrative 24 h paired analysis; correlation is not causation.
            </p>
            <div className="diag-rows">
              <div><span>Sample size</span><b>128</b></div>
              <div><span>Time window</span><b>24h</b></div>
              <div><span>Correlation</span><b>−0.74</b></div>
            </div>
          </div>
        </div>

        {/* Row 3: 4 Visual Trend Charts in 2x2 Grid */}
        <div className="charts-grid-2x2">
          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">Temperature</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(tempPoints, demoTempPoints, temp)} minVal={18} maxVal={26} color="#34a4ce" yLabels={[18, 20, 22, 24, 26]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">pH</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(phPoints, demoPhPoints, ph)} minVal={6.0} maxVal={8.0} color="#34a4ce" yLabels={[6.0, 6.5, 7.0, 7.5, 8.0]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">Turbidity</span>
              <span className="badge-pill orange">● Excursion</span>
            </div>
            <AreaTrendChart dataPoints={chartData(turbPoints, demoTurbPoints, turbidity)} minVal={0} maxVal={8} color="#e06836" showExcursion excursionLimit={5.0} yLabels={[0, 2, 4, 6, 8]} />
          </div>

          <div className="card chart-panel">
            <div className="card-top">
              <span className="diag-heading">MQ5 Gas</span>
              <span className="badge-pill blue">● Live</span>
            </div>
            <AreaTrendChart dataPoints={chartData(mq5Points, demoMq5Points, gas)} minVal={0.4} maxVal={0.8} color="#34a4ce" yLabels={[0.4, 0.5, 0.6, 0.7, 0.8]} />
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
                    <small>SJ-014 · 5.8 NTU exceeds illustrative node limit 5.0 NTU</small>
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

  // 3. Records Screen
  const renderRecordsScreen = () => {
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="view-title">Records</h1>
            <p className="view-subtitle">
              {liveReadings.length ? `Live sensor history for SUJAL_01 · ${liveReadings.length} latest packets loaded. Download exports the loaded live readings.` : 'Live sensor history for SUJAL_01 will appear after telemetry arrives and your operator account is authorized.'}
            </p>
          </div>
          <button className="btn-secondary-flat" onClick={() => setActiveTab('Profile')}>
            Change in Profile
          </button>
        </header>

        <div className="card node-context-bar">
          <div className="bar-left">
            <b>SUJAL_01 · SuJal device</b>
            <span>Device location is not configured</span>
          </div>
          <div className="bar-meta-row">
            <span>Sequence {liveState?.sequence ?? '—'}</span>
            <span>Commanded channel: {liveState?.selected_channel || '—'}</span>
            <span className={`badge-pill ${liveState ? 'green' : 'muted'}`}>{liveState ? '● Telemetry received' : 'Waiting for telemetry'}</span>
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
                <button className="btn-csv-export" onClick={() => downloadCsvMock(`SJ-014_${ds.month.replace(' ', '_')}.csv`)}>
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
              <span className="badge-pill muted">1,248 samples</span>
              <span className="badge-pill green">82% complete</span>
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
            <button className="btn-action-primary" onClick={() => downloadCsvMock(`SJ-014_${filterMonthTab.replace(' ', '_')}.csv`)}>
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
              ● 24 River View Lane, North River District · SJ-014 · River View Inlet <small>Provisional</small>
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
            <span className="select-pill">Node <b>SJ-014 ▾</b></span>
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
              <small>Months below are in Records (recent/partial) — not archived</small>
              <div className="records-sub-row">
                <div>
                  <b>October 2026</b>
                  <small>● Current · Partial (27 days collected)</small>
                </div>
                <button className="btn-secondary-flat" onClick={() => setActiveTab('Records')}>
                  In Records
                </button>
              </div>
              <div className="records-sub-row">
                <div>
                  <b>September 2026</b>
                  <small>● Closed · Pending archive transfer</small>
                </div>
                <button className="btn-secondary-flat" onClick={() => setActiveTab('Records')}>
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
                  <b>SJ-014 · River View Inlet</b>
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
            <p className="view-subtitle">SJ-014 · River View Inlet · 24 River View Lane, North River District · Provisional nearest-node mapping</p>
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
              <div><span>Node</span><b>SJ-014 · River View Inlet</b></div>
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
                SJ-014 reported 8 missing packets between 10:20:00 and 10:31:04 IST. Uplink signal degraded to -92 dBm, exceeding the -88 dBm threshold for retransmit reliability. 3 consecutive drops (seq 0x4A1C-0x4A1E) were logged before partial recovery. Operator action recommended: verify gateway GW-NR-03 antenna and check node housing seal. Latest packet received at 10:32:15 IST with full payload.
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
        <header className="view-header map-top-bar">
          <div className="map-feed-status">
            <span>● GPS FEED: ESP-NOW</span>
            <span>915 MHz</span>
            <span>NODES: 6 TRACKED</span>
            <span className="text-amber">2 STALE GPS</span>
            <span>SNAP: 27 Oct 2026 10:32:15 IST</span>
            <span className="badge-pill purple">🛰️ NASA GIBS REALTIME</span>
          </div>
        </header>

        <div className="map-stage-wrap top-gap">
          {/* NASA Satellite Layer Controls */}
          <div className="map-layer-controls">
            <span className="layer-lbl">NASA SAT:</span>
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
              className={`layer-btn ${mapLayer === 'street-sat' ? 'active' : ''}`}
              onClick={() => setMapLayer('street-sat')}
              title="High-Resolution Street & River Canal Satellite"
            >
              🗺️ Street Sat
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
              nodes={MAP_NODES}
              selectedNode={selectedMapNode}
              onSelectNode={setSelectedMapNode}
              currentLayer={mapLayer}
              showOverlays={showMapOverlays}
              liveState={liveState}
            />
          </div>

          {/* Left Node Inspector Overlay */}
          <div className="card map-node-drawer">
            <div className="drawer-header">
              <div>
                <div className="drawer-title">
                  <b>{selectedMapNode.id}</b>
                  <span className={`badge-pill ${selectedMapNode.color === 'red' ? 'red' : selectedMapNode.color === 'green' ? 'green' : 'amber'}`}>
                    ● {selectedMapNode.status.toUpperCase()}
                  </span>
                  {selectedMapNode.selected && <span className="badge-pill purple">★ Nearest (provisional)</span>}
                </div>
                <small>{selectedMapNode.name} · North River District</small>
              </div>
            </div>

            <div className="drawer-gps-status top-gap">
              <span>📍 GPS LOCK {selectedMapNode.lat.toFixed(4)}° N {selectedMapNode.lon.toFixed(4)}° E <small className="badge-pill green">±4 m</small></span>
              <span>⚙ DEV: ESP32-S3 ID D4:F9:8D:2A:11:3E <small className="badge-pill amber">PKT: 92%</small></span>
              <span>⏱ Snapshot: 27 Oct 2026 10:32:15 IST <small className="badge-pill purple">ILLUS</small></span>
            </div>

            <div className="drawer-readings-grid top-gap">
              <div className="m-box">
                <small>Temperature</small>
                <b>{selectedMapNode.id === 'SJ-014' && liveState?.sensor_data?.temperature_sensor?.value ? `${liveState.sensor_data.temperature_sensor.value} °C` : '24.6 °C'}</b>
                <span className="text-green">● Normal range</span>
              </div>
              <div className="m-box">
                <small>pH Level</small>
                <b>{selectedMapNode.id === 'SJ-014' && liveState?.sensor_data?.ph_sensor?.value ? `${liveState.sensor_data.ph_sensor.value} pH` : '7.2 pH'}</b>
                <span className="text-green">● Normal range</span>
              </div>
              <div className="m-box">
                <small>Turbidity</small>
                <b className="text-orange">{selectedMapNode.id === 'SJ-014' && liveState?.sensor_data?.turbidity_sensor?.value ? `${liveState.sensor_data.turbidity_sensor.value} NTU` : '5.8 NTU'}</b>
                <span className="text-orange">● Exceeds limit 5.0 NTU</span>
              </div>
              <div className="m-box">
                <small>MQ5 Gas</small>
                <b>{selectedMapNode.id === 'SJ-014' && liveState?.sensor_data?.mq5_sensor?.voltage ? `${liveState.sensor_data.mq5_sensor.voltage} V` : '0.66 V'}</b>
                <span className="text-green">● Normal range</span>
              </div>
            </div>

            <div className="drawer-actions-row top-gap">
              <button className="btn-action-primary" onClick={() => setActiveTab('Records')}>
                View Records
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
            <div className="sec-title">GPS TELEMETRY — ALL NODES</div>
            <div className="nodes-telemetry-list top-gap">
              {MAP_NODES.map((n) => (
                <div
                  key={n.id}
                  className={`node-telemetry-item ${selectedMapNode.id === n.id ? 'active' : ''}`}
                  onClick={() => setSelectedMapNode(n)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`status-dot ${n.color}`} />
                  <span className="node-lbl">{n.id}</span>
                  <span className="coord-txt">
                    {n.lat.toFixed(4)}° N {n.lon.toFixed(4)}° E
                  </span>
                  <span className="badge-pill muted">{n.status.split('·')[0].trim()}</span>
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
                  <b>SJ-014 · River View inlet</b>
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
              <span>SJ-014 · River View inlet <small>42 m · Provisional nearest node</small></span>
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
                <small>Real-time readings from SJ-014</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Map')}>
              <MapIcon size={16} className="text-blue" />
              <div>
                <b>Map</b>
                <small>SJ-014 near selected address</small>
              </div>
            </div>
            <div className="scope-tile" onClick={() => setActiveTab('Records')}>
              <FileText size={16} className="text-blue" />
              <div>
                <b>Records</b>
                <small>Historical data filtered by SJ-014</small>
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
                <small>Archived snapshots tied to SJ-014</small>
              </div>
            </div>
          </div>

          <div className="scope-footer-actions top-gap">
            <div>
              <small>Selected monitoring context</small>
              <b>24 River View Lane · SJ-014 · River View inlet</b>
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
            <i className="chip-icon-drop" /> SJ-014 · River View inlet
          </span>
        </header>

        <div className="card node-context-bar top-gap">
          <div className="bar-left">
            <b>24 River View Lane</b>
            <span>North River district · 42 m from address</span>
          </div>
          <div className="bar-meta-row">
            <span>SJ-014 · River View inlet</span>
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
            ['Records', 'Monthly datasets, CSV snapshots and preview', FileText],
            ['Archive', 'Historical retained sensor exports', Archive],
            ['Telemetry Ingest Log', 'Raw packet feed and triage scores', Radio],
            ['Node Map', 'Cartographic node network view', MapIcon],
          ].map(([p, desc, Icon]) => (
            <button className="card quick-card" key={p} onClick={() => setActiveTab(p.startsWith('Water') ? 'Water Quality Monitor' : p.startsWith('Node') ? 'Map' : p.split(' ')[0])}>
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

  const getContent = () => {
    switch (activeTab) {
      case 'Home':
        return renderHomeScreen()
      case 'Water Quality Monitor':
        return renderMonitorScreen()
      case 'Alerts':
        return renderAlertsScreen()
      case 'Records':
        return renderRecordsScreen()
      case 'Archive':
        return renderArchiveScreen()
      case 'Log':
        return renderLogScreen()
      case 'Map':
        return renderMapScreen()
      case 'Profile':
        return renderProfileScreen()
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
            ['Records', FileSpreadsheet],
            ['Log', Radio],
            ['Alerts', Bell, 3],
            ['Archive', Archive],
          ].map(([name, Icon, badge]) => (
            <button
              key={name}
              className={`nav-link ${activeTab === name ? 'selected' : ''}`}
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

          <div className="sidebar-static-links">
            <span className="sidebar-sub-link">
              <FileText size={13} /> Landing Page
            </span>
            <span className="sidebar-sub-link">
              <Compass size={13} /> Illustration
            </span>
          </div>

          <div className="account-row">
            <span className="avatar">{user?.email?.[0]?.toUpperCase() || 'AM'}</span>
            <span>{user?.email || 'Operator AM'}</span>
            <button title="Options" onClick={() => (user ? signOut(auth) : setLoginOpen(true))}>
              <ChevronDown size={14} />
            </button>
          </div>
          <small className="sidebar-version">SUJAL · NODE SJ-014</small>
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
          {getContent()}

          <footer className="app-footer">
            <span>SUJAL <i>·</i> NODE SJ-014 RIVER VIEW INLET</span>
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
            <p>Access live telemetry control for node SJ-014.</p>
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
    </div>
  )
}
