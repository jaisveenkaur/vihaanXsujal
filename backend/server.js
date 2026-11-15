/**
 * SuJal Standalone Backend Server (Zero-Cost / Spark Plan Compatible)
 *
 * Runs locally or on free hosting (Render, Railway, Fly.io) without requiring
 * Firebase Blaze or Google Cloud Secrets Manager.
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

// Load .env if present
const envPath = path.resolve(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  })
}

// Initialize Firebase Admin SDK
let app
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.resolve(__dirname, 'serviceAccountKey.json')
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))
  app = initializeApp({ credential: cert(serviceAccount) })
  console.log('Firebase Admin initialized with service account.')
} else {
  app = initializeApp({ projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'vihaanxsujal' })
  console.log('Firebase Admin initialized with project ID:', process.env.VITE_FIREBASE_PROJECT_ID || 'vihaanxsujal')
}

const db = getFirestore(app)
const PORT = process.env.PORT || 5001
const DEVICE_INGEST_KEY = process.env.DEVICE_INGEST_KEY || 'sujal_default_secure_key_2026'
const DEFAULT_DEVICE_ID = 'SUJAL_01'
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/
const MAX_BODY_BYTES = 32 * 1024

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

async function authenticateDevice(deviceId, suppliedKey) {
  if (!DEVICE_ID_PATTERN.test(deviceId) || typeof suppliedKey !== 'string' || !suppliedKey) return false

  const credentialRef = db.doc(`devices/${deviceId}/security/credentials`)
  try {
    const snapshot = await credentialRef.get()
    if (snapshot.exists) {
      const credentials = snapshot.data()
      const accepted = [credentials.api_key, credentials.previous_api_key].filter((k) => typeof k === 'string')
      return accepted.some((k) => safeCompare(k, suppliedKey))
    }
  } catch (err) {
    console.warn('Firestore credential lookup error:', err.message)
  }

  return safeCompare(DEVICE_INGEST_KEY, suppliedKey)
}

function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isNumber(val, min, max) {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max
}

function isNullableNumber(val, min, max) {
  return val === null || isNumber(val, min, max)
}

function validatePacket(body) {
  const errors = []
  if (!isObject(body)) return ['Packet body must be a JSON object.']
  if (!isNumber(body.sequence, 0, 2147483647)) errors.push('sequence must be a positive integer.')
  if (!isNumber(body.uptime_ms, 0, 100000000000)) errors.push('uptime_ms must be a valid number.')
  if (!['AUTO', 'MANUAL'].includes(body.mode)) errors.push('mode must be AUTO or MANUAL.')
  if (!['A', 'B'].includes(body.selected_channel)) errors.push('selected_channel must be A or B.')

  if (!isObject(body.sensor_data)) {
    errors.push('sensor_data is required.')
  } else {
    const s = body.sensor_data
    if (!isNullableNumber(s.temperature_sensor?.value, -20, 80)) errors.push('temperature must be -20 to 80 °C.')
    if (!isNullableNumber(s.ph_sensor?.value, 0, 14)) errors.push('pH must be 0 to 14.')
    if (!isNullableNumber(s.turbidity_sensor?.value, 0, 1000)) errors.push('turbidity must be 0 to 1000 NTU.')
    if (!isNullableNumber(s.mq5_sensor?.voltage, 0, 5)) errors.push('mq5 voltage must be 0 to 5 V.')
  }
  const loc = body.location || body.gps
  if (loc !== undefined && loc !== null) {
    if (!isObject(loc) || !isNumber(loc.lat, -90, 90) || !isNumber(loc.lon, -180, 180)) {
      errors.push('location/gps must be an object with valid lat (-90 to 90) and lon (-180 to 180).')
    }
  }
  return errors
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-device-key')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname

  const sendJson = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  if (pathname === '/health' || pathname === '/') {
    sendJson(200, { ok: true, status: 'SuJal standalone backend running', port: PORT })
    return
  }

  // POST /ingestTelemetry
  if (pathname === '/ingestTelemetry' && req.method === 'POST') {
    let bodyData = ''
    let tooLarge = false
    req.on('data', (chunk) => {
      bodyData += chunk
      if (bodyData.length > MAX_BODY_BYTES) {
        tooLarge = true
        sendJson(413, { error: 'Payload too large. Maximum 32 KB allowed.' })
        req.destroy()
      }
    })
    req.on('end', async () => {
      if (tooLarge) return
      try {
        const body = JSON.parse(bodyData)
        const deviceId = body.device_id || DEFAULT_DEVICE_ID
        const suppliedKey = req.headers['x-device-key']

        const authOk = await authenticateDevice(deviceId, suppliedKey)
        if (!authOk) return sendJson(401, { error: 'Unauthorized device credential.' })

        const validationErrors = validatePacket(body)
        if (validationErrors.length > 0) return sendJson(400, { error: 'Validation failed', details: validationErrors })

        const now = FieldValue.serverTimestamp()
        const stateDoc = {
          device_id: deviceId,
          sequence: body.sequence,
          uptime_ms: body.uptime_ms,
          mode: body.mode,
          selected_channel: body.selected_channel,
          sensor_data: body.sensor_data,
          clog_estimate: body.clog_estimate || null,
          actuator_feedback: body.actuator_feedback || null,
          verification_data: body.verification_data || null,
          location: body.location || body.gps || null,
          server_received_at: now,
          recorded_at: now,
        }

        await Promise.all([
          db.doc(`devices/${deviceId}/state/latest`).set(stateDoc),
          db.collection(`devices/${deviceId}/readings`).add(stateDoc),
        ])

        console.log(`[Telemetry Ingested] Device: ${deviceId} | Seq: ${body.sequence}`)
        return sendJson(200, { ok: true, device_id: deviceId, sequence: body.sequence })
      } catch (err) {
        console.error('Ingest error:', err)
        return sendJson(500, { error: 'Internal ingest error', message: err.message })
      }
    })
    return
  }

  // GET /pollDeviceCommand
  if (pathname === '/pollDeviceCommand' && req.method === 'GET') {
    const deviceId = url.searchParams.get('device_id') || DEFAULT_DEVICE_ID
    const suppliedKey = req.headers['x-device-key']
    const authOk = await authenticateDevice(deviceId, suppliedKey)
    if (!authOk) return sendJson(401, { error: 'Unauthorized device credential.' })

    try {
      const commandsRef = db.collection(`devices/${deviceId}/commands`)
      const pendingSnap = await commandsRef.where('status', '==', 'pending').orderBy('created_at', 'asc').limit(1).get()

      if (pendingSnap.empty) return sendJson(200, { pending: false })

      const docSnap = pendingSnap.docs[0]
      const cmdData = docSnap.data()
      await docSnap.ref.update({
        status: 'dispatched',
        dispatched_at: FieldValue.serverTimestamp(),
      })

      return sendJson(200, {
        pending: true,
        command_id: docSnap.id,
        command: cmdData.command,
        selected_channel: cmdData.selected_channel,
        mode: cmdData.mode,
      })
    } catch (err) {
      return sendJson(500, { error: 'Command polling failed', message: err.message })
    }
  }

  // POST /ackDeviceCommand
  if (pathname === '/ackDeviceCommand' && req.method === 'POST') {
    let bodyData = ''
    let tooLarge = false
    req.on('data', (chunk) => {
      bodyData += chunk
      if (bodyData.length > MAX_BODY_BYTES) {
        tooLarge = true
        sendJson(413, { error: 'Payload too large. Maximum 32 KB allowed.' })
        req.destroy()
      }
    })
    req.on('end', async () => {
      if (tooLarge) return
      try {
        const body = JSON.parse(bodyData)
        const deviceId = body.device_id || DEFAULT_DEVICE_ID
        const suppliedKey = req.headers['x-device-key']
        const authOk = await authenticateDevice(deviceId, suppliedKey)
        if (!authOk) return sendJson(401, { error: 'Unauthorized device credential.' })

        if (!body.command_id || !['SUCCESS', 'FAILED'].includes(body.execution_status)) {
          return sendJson(400, { error: 'Invalid acknowledgement body.' })
        }

        const cmdRef = db.doc(`devices/${deviceId}/commands/${body.command_id}`)
        await cmdRef.update({
          status: body.execution_status === 'SUCCESS' ? 'executed' : 'failed',
          executed_at: FieldValue.serverTimestamp(),
          execution_error: body.error || null,
        })

        return sendJson(200, { ok: true, command_id: body.command_id, status: body.execution_status })
      } catch (err) {
        return sendJson(500, { error: 'Ack error', message: err.message })
      }
    })
    return
  }

  sendJson(404, { error: 'Endpoint not found.' })
})

server.listen(PORT, () => {
  console.log(`=======================================================`)
  console.log(`🚀 SuJal Standalone Backend running on port ${PORT}`)
  console.log(`📡 Ingest:  POST http://localhost:${PORT}/ingestTelemetry`)
  console.log(`📥 Poll:    GET  http://localhost:${PORT}/pollDeviceCommand`)
  console.log(`✅ Ack:     POST http://localhost:${PORT}/ackDeviceCommand`)
  console.log(`=======================================================`)
})
