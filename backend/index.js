const crypto = require('crypto')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { defineSecret } = require('firebase-functions/params')
const { onRequest } = require('firebase-functions/v2/https')

initializeApp()

const db = getFirestore()
const deviceIngestKey = defineSecret('DEVICE_INGEST_KEY')
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/
const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const DEFAULT_DEVICE_ID = 'SUJAL_01'
const MIN_INGEST_INTERVAL_MS = 1500
const COMMAND_RETRY_MS = 60000
const MAX_BODY_BYTES = 32 * 1024
const ALERT_IDS = ['device-fault', 'actuator-controller-offline', 'low-flow-a', 'low-flow-b', 'turbidity-excursion', 'verification-excursion']

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value, keys) {
  return isObject(value) && Object.keys(value).every((key) => keys.includes(key))
}

function isNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isNullableNumber(value, min, max) {
  return value === null || isNumber(value, min, max)
}

function isNullableInteger(value, min, max) {
  return value === null || (Number.isInteger(value) && value >= min && value <= max)
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * A device with a provisioned per-device credential cannot fall back to the
 * shared key. The shared key is retained only for the original SUJAL_01 demo.
 */
async function authenticateDevice(deviceId, suppliedKey) {
  if (!DEVICE_ID_PATTERN.test(deviceId) || typeof suppliedKey !== 'string' || !suppliedKey) return false

  const credentialRef = db.doc(`devices/${deviceId}/security/credentials`)
  const credentialSnapshot = await credentialRef.get()
  if (credentialSnapshot.exists) {
    const credentials = credentialSnapshot.data()
    const acceptedKeys = [credentials.api_key, credentials.previous_api_key].filter((key) => typeof key === 'string')
    return acceptedKeys.some((key) => safeCompare(key, suppliedKey))
  }

  if (deviceId !== DEFAULT_DEVICE_ID) return false
  return safeCompare(deviceIngestKey.value(), suppliedKey)
}

function validateSensorReading(sensor, prefix, errors) {
  if (!isObject(sensor)) {
    errors.push(`${prefix} must be an object.`)
    return
  }

  if (prefix.endsWith('temperature_sensor')) {
    if (!hasOnlyKeys(sensor, ['value', 'unit']) || !isNullableNumber(sensor.value, -20, 80) || sensor.unit !== 'celsius') {
      errors.push(`${prefix} must contain a nullable value from -20 to 80 and unit "celsius".`)
    }
    return
  }

  if (prefix.endsWith('ph_sensor') || prefix.endsWith('turbidity_sensor')) {
    const isPh = prefix.endsWith('ph_sensor')
    const maxValue = isPh ? 14 : 1000
    if (!hasOnlyKeys(sensor, ['value', 'raw_adc', 'voltage', 'calibrated']) ||
      !isNullableNumber(sensor.value, 0, maxValue) ||
      !isNullableInteger(sensor.raw_adc, 0, 4095) ||
      !isNullableNumber(sensor.voltage, 0, 5) ||
      typeof sensor.calibrated !== 'boolean') {
      errors.push(`${prefix} has an invalid reading, ADC value, voltage, or calibration flag.`)
    }
  }
}

function validateFlowSensor(sensor, path, errors) {
  if (!isObject(sensor) || !hasOnlyKeys(sensor, ['flow_rate_lpm', 'total_volume_litre']) ||
    !isNullableNumber(sensor.flow_rate_lpm, 0, 200) ||
    !isNullableNumber(sensor.total_volume_litre, 0, 1_000_000_000)) {
    errors.push(`${path} must contain nullable flow_rate_lpm (0-200) and total_volume_litre (0-1000000000).`)
  }
}

function validateTelemetryPacket(packet) {
  const errors = []
  const allowedRootKeys = [
    'device_id', 'sequence', 'sequence_number', 'uptime_ms', 'mode', 'selected_channel',
    'sensor_data', 'verification_data', 'clog_estimate', 'actuator_feedback', 'treatment',
  ]

  if (!hasOnlyKeys(packet, allowedRootKeys)) return ['Packet must be a JSON object with only documented fields.']
  if (typeof packet.device_id !== 'string' || !DEVICE_ID_PATTERN.test(packet.device_id)) {
    errors.push('device_id must be 3-32 letters, digits, underscores, or hyphens.')
  }

  const sequence = packet.sequence ?? packet.sequence_number
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    errors.push('sequence must be a non-negative safe integer and increase for every packet.')
  }
  if (packet.sequence !== undefined && packet.sequence_number !== undefined && packet.sequence !== packet.sequence_number) {
    errors.push('sequence and sequence_number must match when both are supplied.')
  }
  if (!Number.isSafeInteger(packet.uptime_ms) || packet.uptime_ms < 0) {
    errors.push('uptime_ms must be a non-negative safe integer.')
  }
  if (!['AUTO', 'MANUAL'].includes(packet.mode)) errors.push('mode must be AUTO or MANUAL.')
  if (!['A', 'B'].includes(packet.selected_channel)) errors.push('selected_channel must be A or B.')

  const sensors = packet.sensor_data
  if (!isObject(sensors) || !hasOnlyKeys(sensors, ['ph_sensor', 'turbidity_sensor', 'temperature_sensor', 'mq5_sensor', 'flow_sensors'])) {
    errors.push('sensor_data must contain only the documented sensor groups.')
  } else {
    validateSensorReading(sensors.ph_sensor, 'sensor_data.ph_sensor', errors)
    validateSensorReading(sensors.turbidity_sensor, 'sensor_data.turbidity_sensor', errors)
    validateSensorReading(sensors.temperature_sensor, 'sensor_data.temperature_sensor', errors)

    const gas = sensors.mq5_sensor
    if (!isObject(gas) || !hasOnlyKeys(gas, ['raw_adc', 'voltage', 'unit', 'value']) ||
      !isNullableInteger(gas.raw_adc, 0, 4095) || !isNullableNumber(gas.voltage, 0, 5) ||
      gas.unit !== 'V' || (gas.value !== undefined && !isNullableNumber(gas.value, 0, 100000))) {
      errors.push('sensor_data.mq5_sensor has invalid raw_adc, voltage, unit, or value.')
    }

    const flow = sensors.flow_sensors
    if (!hasOnlyKeys(flow, ['inlet', 'channel_a', 'channel_b'])) {
      errors.push('sensor_data.flow_sensors must contain inlet, channel_a, and channel_b only.')
    } else {
      validateFlowSensor(flow.inlet, 'sensor_data.flow_sensors.inlet', errors)
      validateFlowSensor(flow.channel_a, 'sensor_data.flow_sensors.channel_a', errors)
      validateFlowSensor(flow.channel_b, 'sensor_data.flow_sensors.channel_b', errors)
    }
  }

  if (packet.verification_data !== undefined) {
    const verification = packet.verification_data
    if (!hasOnlyKeys(verification, ['ph_sensor', 'turbidity_sensor', 'temperature_sensor'])) {
      errors.push('verification_data may contain only pH, turbidity, and temperature sensor groups.')
    } else {
      if (verification.ph_sensor !== undefined) validateSensorReading(verification.ph_sensor, 'verification_data.ph_sensor', errors)
      if (verification.turbidity_sensor !== undefined) validateSensorReading(verification.turbidity_sensor, 'verification_data.turbidity_sensor', errors)
      if (verification.temperature_sensor !== undefined) validateSensorReading(verification.temperature_sensor, 'verification_data.temperature_sensor', errors)
    }
  }

  const clog = packet.clog_estimate
  if (!isObject(clog) || !hasOnlyKeys(clog, ['selected_channel_percent', 'baseline_a_lpm', 'baseline_b_lpm']) ||
    !isNullableNumber(clog.selected_channel_percent, 0, 100) ||
    !isNumber(clog.baseline_a_lpm, 0, 200) || !isNumber(clog.baseline_b_lpm, 0, 200)) {
    errors.push('clog_estimate has an invalid selected-channel percentage or baseline flow.')
  }

  const feedback = packet.actuator_feedback
  const feedbackKeys = ['slave_online', 'active_channel', 'water_pump_on', 'dosing_pump_on', 'a_inlet_open', 'a_outlet_open', 'b_inlet_open', 'b_outlet_open', 'fault_code']
  if (!hasOnlyKeys(feedback, feedbackKeys) || typeof feedback.slave_online !== 'boolean' ||
    !['A', 'B', 'NONE'].includes(feedback.active_channel) ||
    !['water_pump_on', 'dosing_pump_on', 'a_inlet_open', 'a_outlet_open', 'b_inlet_open', 'b_outlet_open'].every((key) => typeof feedback[key] === 'boolean') ||
    !Number.isInteger(feedback.fault_code) || feedback.fault_code < 0 || feedback.fault_code > 65535) {
    errors.push('actuator_feedback must contain valid online state, active channel, actuator booleans, and fault_code.')
  }

  if (packet.treatment !== undefined) {
    if (!hasOnlyKeys(packet.treatment, ['stage', 'status', 'verification']) ||
      !['stage', 'status', 'verification'].every((key) => packet.treatment[key] === undefined || (typeof packet.treatment[key] === 'string' && packet.treatment[key].length <= 160))) {
      errors.push('treatment may contain stage, status, and verification text up to 160 characters each.')
    }
  }

  return errors
}

function buildOperationalAlerts(packet) {
  const alerts = new Map()
  const feedback = packet.actuator_feedback
  const sensors = packet.sensor_data
  const channel = packet.selected_channel.toLowerCase()
  const flow = sensors.flow_sensors[`channel_${channel}`].flow_rate_lpm
  const baseline = packet.clog_estimate[`baseline_${channel}_lpm`]

  if (feedback.fault_code !== 0) {
    alerts.set('device-fault', { id: 'device-fault', severity: 'high', title: 'Device fault reported', detail: `Controller fault code ${feedback.fault_code}.` })
  }
  if (!feedback.slave_online) {
    alerts.set('actuator-controller-offline', { id: 'actuator-controller-offline', severity: 'high', title: 'Actuator controller offline', detail: 'The actuator controller is not reporting online.' })
  }
  if (baseline > 0 && flow !== null && flow / baseline < 0.25) {
    const id = `low-flow-${channel}`
    alerts.set(id, { id, severity: 'high', title: `Low flow on channel ${channel.toUpperCase()}`, detail: 'Active branch flow is below 25% of its configured baseline. Check for a blockage or sensor issue.' })
  }
  const turbidity = sensors.turbidity_sensor.value
  if (turbidity !== null && turbidity > 5) {
    alerts.set('turbidity-excursion', { id: 'turbidity-excursion', severity: 'high', title: 'Turbidity above demo operating limit', detail: `Measured turbidity ${turbidity} NTU exceeds the configured demo limit of 5.0 NTU.` })
  }
  const verification = packet.verification_data || {}
  const verifiedPh = verification.ph_sensor?.value
  const verifiedTurbidity = verification.turbidity_sensor?.value
  if ((verifiedPh !== null && verifiedPh !== undefined && (verifiedPh < 6.5 || verifiedPh > 8.5)) ||
    (verifiedTurbidity !== null && verifiedTurbidity !== undefined && verifiedTurbidity > 5)) {
    alerts.set('verification-excursion', {
      id: 'verification-excursion', severity: 'high', title: 'Post-treatment verification reading outside demo band',
      detail: 'Outlet verification pH or turbidity is outside the configured prototype operating band. Keep water flowing as designed, notify the operator, and verify with calibrated instruments/lab testing.',
    })
  }
  return alerts
}

function timestampMillis(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : 0
}

async function authenticateRequestDevice(deviceId, req, res) {
  if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) {
    res.status(400).json({ error: 'Invalid device_id.' })
    return false
  }
  const authenticated = await authenticateDevice(deviceId, req.get('x-device-key'))
  if (!authenticated) res.status(401).json({ error: 'Unauthorized device credential.' })
  return authenticated
}

exports.ingestTelemetry = onRequest({
  region: 'asia-south1',
  secrets: [deviceIngestKey],
  timeoutSeconds: 20,
  maxInstances: 3,
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const contentLength = Number(req.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES || (req.rawBody && req.rawBody.length > MAX_BODY_BYTES)) return res.status(413).json({ error: 'Telemetry packet is too large.' })
  if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json.' })

  const packet = req.body
  if (!isObject(packet) || typeof packet.device_id !== 'string' || !DEVICE_ID_PATTERN.test(packet.device_id)) {
    return res.status(400).json({ error: 'A valid device_id is required.' })
  }

  try {
    if (!(await authenticateRequestDevice(packet.device_id, req, res))) return
  } catch (error) {
    console.error('Device authentication failed:', error.message)
    return res.status(503).json({ error: 'Device authentication is temporarily unavailable.' })
  }

  const validationErrors = validateTelemetryPacket(packet)
  if (validationErrors.length) return res.status(400).json({ error: 'Invalid telemetry packet.', details: validationErrors })

  const sequence = packet.sequence ?? packet.sequence_number
  const normalizedPacket = { ...packet, sequence }
  delete normalizedPacket.sequence_number

  try {
    const root = db.collection('devices').doc(packet.device_id)
    const metaRef = root.collection('meta').doc('telemetry')
    const latestRef = root.collection('state').doc('latest')
    const readingRef = root.collection('readings').doc()
    const alertRefs = new Map(ALERT_IDS.map((id) => [id, root.collection('alerts').doc(id)]))
    const currentAlerts = buildOperationalAlerts(normalizedPacket)

    const result = await db.runTransaction(async (transaction) => {
      const metaSnapshot = await transaction.get(metaRef)
      const alertSnapshots = new Map()
      for (const [id, ref] of alertRefs) alertSnapshots.set(id, await transaction.get(ref))

      const nowMs = Date.now()
      const meta = metaSnapshot.exists ? metaSnapshot.data() : {}
      if (meta.last_sequence !== undefined && sequence <= meta.last_sequence) {
        return { status: 409, body: { error: 'Stale or replayed sequence.', last_sequence: meta.last_sequence } }
      }
      if (meta.last_ingest_time_ms && nowMs - meta.last_ingest_time_ms < MIN_INGEST_INTERVAL_MS) {
        return { status: 429, body: { error: 'Ingest interval is too short.', minimum_interval_ms: MIN_INGEST_INTERVAL_MS } }
      }

      const now = FieldValue.serverTimestamp()
      transaction.set(metaRef, {
        last_sequence: sequence,
        last_ingest_time_ms: nowMs,
        last_ingest_at: now,
        total_packets: FieldValue.increment(1),
      }, { merge: true })
      transaction.set(latestRef, { ...normalizedPacket, server_received_at: now })
      transaction.set(readingRef, { ...normalizedPacket, recorded_at: now })

      for (const [id, ref] of alertRefs) {
        const existing = alertSnapshots.get(id)
        const existingData = existing.exists ? existing.data() : null
        const current = currentAlerts.get(id)
        if (current) {
          const reopened = !existingData || existingData.status === 'resolved'
          transaction.set(ref, {
            ...current,
            status: existingData?.status === 'acknowledged' ? 'acknowledged' : 'open',
            created_at: reopened ? now : (existingData.created_at || now),
            updated_at: now,
          }, { merge: true })
        } else if (existingData && existingData.status !== 'resolved') {
          transaction.update(ref, { status: 'resolved', resolved_at: now, updated_at: now })
        }
      }

      return { status: 200, body: { ok: true, device_id: packet.device_id, sequence, reading_id: readingRef.id, active_alerts: [...currentAlerts.keys()] } }
    })

    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error('Telemetry ingest failed:', error.message)
    return res.status(500).json({ error: 'Telemetry could not be stored.' })
  }
})

exports.pollDeviceCommand = onRequest({
  region: 'asia-south1',
  secrets: [deviceIngestKey],
  timeoutSeconds: 15,
  maxInstances: 3,
}, async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' })
  const deviceId = req.query.device_id || DEFAULT_DEVICE_ID
  try {
    if (!(await authenticateRequestDevice(deviceId, req, res))) return

    const commandsRef = db.collection('devices').doc(deviceId).collection('commands')
    const result = await db.runTransaction(async (transaction) => {
      const pendingSnapshot = await transaction.get(commandsRef.where('status', '==', 'pending').limit(20))
      const dispatchedSnapshot = await transaction.get(commandsRef.where('status', '==', 'dispatched').limit(20))
      const nowMs = Date.now()

      const pending = pendingSnapshot.docs
        .sort((a, b) => timestampMillis(a.data().created_at) - timestampMillis(b.data().created_at))[0]
      const retry = dispatchedSnapshot.docs
        .filter((doc) => Number.isFinite(doc.data().dispatched_at_ms) && nowMs - doc.data().dispatched_at_ms >= COMMAND_RETRY_MS)
        .sort((a, b) => a.data().dispatched_at_ms - b.data().dispatched_at_ms)[0]
      const selected = pending || retry
      if (!selected) return { command: 'NONE' }

      const data = selected.data()
      const attempt = Number.isInteger(data.delivery_attempts) ? data.delivery_attempts + 1 : 1
      transaction.update(selected.ref, {
        status: 'dispatched',
        dispatched_at: FieldValue.serverTimestamp(),
        dispatched_at_ms: nowMs,
        delivery_attempts: attempt,
      })
      return {
        command_id: selected.id,
        command: data.command,
        selected_channel: data.selected_channel,
        mode: data.mode,
        status: 'dispatched',
        delivery_attempts: attempt,
        retry: !pending,
      }
    })

    return res.status(200).json(result)
  } catch (error) {
    console.error('Command polling failed:', error.message)
    return res.status(500).json({ error: 'Command could not be retrieved.' })
  }
})

exports.ackDeviceCommand = onRequest({
  region: 'asia-south1',
  secrets: [deviceIngestKey],
  timeoutSeconds: 15,
  maxInstances: 3,
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json.' })
  const contentLength = Number(req.get('content-length') || 0)
  if (contentLength > 8 * 1024 || (req.rawBody && req.rawBody.length > 8 * 1024)) return res.status(413).json({ error: 'Acknowledgement is too large.' })

  const body = req.body
  if (!isObject(body) || !COMMAND_ID_PATTERN.test(body.command_id || '') ||
    !['SUCCESS', 'FAILED'].includes(body.execution_status) ||
    (body.error !== undefined && (typeof body.error !== 'string' || body.error.length > 1000)) ||
    (body.feedback !== undefined && (!isObject(body.feedback) || Buffer.byteLength(JSON.stringify(body.feedback)) > 4096))) {
    return res.status(400).json({ error: 'Invalid command acknowledgement.' })
  }

  const deviceId = body.device_id || DEFAULT_DEVICE_ID
  try {
    if (!(await authenticateRequestDevice(deviceId, req, res))) return

    const commandRef = db.doc(`devices/${deviceId}/commands/${body.command_id}`)
    const targetStatus = body.execution_status === 'SUCCESS' ? 'executed' : 'failed'
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(commandRef)
      if (!snapshot.exists) return { status: 404, body: { error: 'Command not found.' } }
      const command = snapshot.data()
      if (command.status === targetStatus) return { status: 200, body: { ok: true, command_id: body.command_id, status: targetStatus, duplicate: true } }
      if (command.status !== 'dispatched') return { status: 409, body: { error: 'Command has not been dispatched or is already final.' } }

      transaction.update(commandRef, {
        status: targetStatus,
        executed_at: FieldValue.serverTimestamp(),
        execution_error: body.error || null,
        execution_feedback: body.feedback || null,
      })
      return { status: 200, body: { ok: true, command_id: body.command_id, status: targetStatus } }
    })

    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error('Command acknowledgement failed:', error.message)
    return res.status(500).json({ error: 'Command acknowledgement failed.' })
  }
})
