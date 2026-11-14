const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { defineSecret } = require('firebase-functions/params')
const { onRequest } = require('firebase-functions/v2/https')

initializeApp()
const db = getFirestore()
const deviceIngestKey = defineSecret('DEVICE_INGEST_KEY')

function makeOperationalAlerts(packet) {
  const alerts = []
  const feedback = packet.actuator_feedback || {}
  const sensors = packet.sensor_data || {}
  if (feedback.fault_code && Number(feedback.fault_code) !== 0) {
    alerts.push({ id: 'device-fault', severity: 'high', title: 'Device fault reported', detail: `Fault code ${feedback.fault_code} reported by the controller.` })
  }
  if (feedback.slave_online === false) {
    alerts.push({ id: 'actuator-controller-offline', severity: 'high', title: 'Actuator controller offline', detail: 'The actuator controller is not reporting online.' })
  }
  const channel = packet.selected_channel === 'B' ? 'b' : 'a'
  const baseline = Number(packet.clog_estimate?.[`baseline_${channel}_lpm`] || 0)
  const channelFlow = Number(sensors.flow_sensors?.[`channel_${channel}`]?.flow_rate_lpm || 0)
  if (baseline > 0 && channelFlow / baseline < 0.25) {
    alerts.push({ id: `low-flow-${channel}`, severity: 'high', title: `Low flow detected on channel ${channel.toUpperCase()}`, detail: 'Active branch flow is below 25% of its configured baseline. Check for a blockage or sensor issue.' })
  }
  return alerts
}

exports.ingestTelemetry = onRequest({
  region: 'asia-south1',
  secrets: [deviceIngestKey],
  timeoutSeconds: 20,
}, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const suppliedKey = req.get('x-device-key')
  if (!suppliedKey || suppliedKey !== deviceIngestKey.value()) return res.status(401).json({ error: 'Unauthorized device.' })
  const packet = req.body
  if (!packet || packet.device_id !== 'SUJAL_01' || !packet.sensor_data || !packet.actuator_feedback) {
    return res.status(400).json({ error: 'Expected device_id, sensor_data, and actuator_feedback.' })
  }

  try {
    const root = db.collection('devices').doc('SUJAL_01')
    const now = FieldValue.serverTimestamp()
    const state = { ...packet, server_received_at: now }
    const batch = db.batch()
    batch.set(root.collection('state').doc('latest'), state)
    const reading = root.collection('readings').doc()
    batch.set(reading, { ...packet, recorded_at: now })
    const activeAlerts = makeOperationalAlerts(packet)
    for (const alert of activeAlerts) {
      batch.set(root.collection('alerts').doc(alert.id), { ...alert, status: 'open', created_at: now, updated_at: now }, { merge: true })
    }
    await batch.commit()
    return res.status(200).json({ ok: true, reading_id: reading.id, active_alerts: activeAlerts.map(({ id, ...alert }) => alert) })
  } catch (error) {
    console.error('Telemetry ingest failed', error)
    return res.status(500).json({ error: 'Telemetry could not be stored.' })
  }
})

exports.pollDeviceCommand = onRequest({
  region: 'asia-south1',
  secrets: [deviceIngestKey],
  timeoutSeconds: 10,
}, async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' })
  const suppliedKey = req.get('x-device-key')
  if (!suppliedKey || suppliedKey !== deviceIngestKey.value()) return res.status(401).json({ error: 'Unauthorized device.' })
  try {
    const ref = db.doc('devices/SUJAL_01/commands/current')
    const snap = await ref.get()
    if (!snap.exists || snap.data().status !== 'pending') return res.status(200).json({ command: 'NONE' })
    const command = snap.data()
    await ref.update({ status: 'delivered', delivered_at: FieldValue.serverTimestamp() })
    return res.status(200).json({ command: command.command, selected_channel: command.selected_channel, mode: command.mode })
  } catch (error) {
    console.error('Command polling failed', error)
    return res.status(500).json({ error: 'Command could not be retrieved.' })
  }
})
