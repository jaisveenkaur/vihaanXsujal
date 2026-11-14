# SuJal

SuJal is an ESP32 water monitoring prototype with a React dashboard, Firebase Authentication, Cloud Firestore, and Firebase Cloud Functions. The browser can read telemetry and create operator commands. The ESP32 alone authenticates to the device endpoints with a device key; it must never receive Firebase Admin credentials.

## Local setup

```sh
npm install
npm --prefix frontend install
npm --prefix backend install
```

Create a root `.env` file using your Firebase Web App configuration (the file is ignored by Git):

```ini
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=vihaanxsujal
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

The frontend uses illustrative data until an authenticated operator account is authorized and live readings arrive. Run the dashboard with `npm run dev`.

## Firebase console setup

1. Enable **Authentication → Email/Password**. Create operator accounts yourself; do not enable public sign-up for this operator dashboard.
2. Create a **Cloud Firestore** database.
3. Add an operator profile at `operators/{firebase-auth-uid}` with fields like `email`, `role: "operator"`, and `assigned_devices: ["SUJAL_01"]`. Alternatively, set trusted custom claims including both `role: "operator"` and `assigned_devices: ["SUJAL_01"]` using a trusted Admin SDK environment. An operator without a device assignment is denied access. Do not grant roles from the browser.
4. The default device key is stored as a Cloud Functions Secret. To rotate to individual keys, create `devices/{deviceId}/security/credentials` via a trusted Admin SDK script/console process with an `api_key` field. Never store this key in the frontend or commit it.
5. Check that the Firestore rules in this repo match the intended operator assignments before deploying them. Cloud Functions Admin SDK writes bypass Firestore Rules; the rules protect browser access.

## Firestore layout

```text
devices/{deviceId}/state/latest                 Current normalized telemetry
devices/{deviceId}/readings/{autoId}             Append-only telemetry history
devices/{deviceId}/meta/telemetry                Sequence / ingest bookkeeping
devices/{deviceId}/alerts/{alertId}              Current operational alert states
devices/{deviceId}/commands/{autoId}             Operator command lifecycle/history
devices/{deviceId}/security/credentials          Optional per-device credentials
operators/{uid}                                  Operator role and device assignment
```

## Device telemetry contract

`POST https://asia-south1-vihaanxsujal.cloudfunctions.net/ingestTelemetry`

Headers: `Content-Type: application/json`, `x-device-key: <device-key>`.

Each packet must include every field below. Send a strictly increasing non-negative `sequence` for every packet, including after reconnect/reboot (persist the counter in NVS/Preferences or use a durable boot-counter + packet counter). Null sensor values are allowed when a sensor has no valid reading; sequence and uptime are not nullable.

```json
{
  "device_id": "SUJAL_01",
  "sequence": 1,
  "uptime_ms": 1000,
  "mode": "MANUAL",
  "selected_channel": "A",
  "sensor_data": {
    "flow_sensors": {
      "inlet": { "flow_rate_lpm": 2.1, "total_volume_litre": 5.4 },
      "channel_a": { "flow_rate_lpm": 2.0, "total_volume_litre": 3.1 },
      "channel_b": { "flow_rate_lpm": 0.0, "total_volume_litre": 2.3 }
    },
    "ph_sensor": { "value": 7.1, "raw_adc": 1820, "voltage": 1.46, "calibrated": false },
    "turbidity_sensor": { "value": 4.2, "raw_adc": 2010, "voltage": 1.62, "calibrated": false },
    "temperature_sensor": { "value": 24.6, "unit": "celsius" },
    "mq5_sensor": { "raw_adc": 510, "voltage": 0.41, "unit": "V" }
  },
  "clog_estimate": { "selected_channel_percent": 100, "baseline_a_lpm": 2.0, "baseline_b_lpm": 2.0 },
  "actuator_feedback": {
    "slave_online": true,
    "active_channel": "A",
    "water_pump_on": true,
    "dosing_pump_on": false,
    "a_inlet_open": true,
    "a_outlet_open": true,
    "b_inlet_open": false,
    "b_outlet_open": false,
    "fault_code": 0
  },
  "verification_data": {
    "ph_sensor": { "value": 7.0, "raw_adc": 1800, "voltage": 1.45, "calibrated": false },
    "turbidity_sensor": { "value": 3.8, "raw_adc": 1900, "voltage": 1.53, "calibrated": false },
    "temperature_sensor": { "value": 24.5, "unit": "celsius" }
  }
}
```

Optional `verification_data` may include any subset of the three shown sensor groups. Optional `treatment` may contain short text fields `stage`, `status`, and `verification`. Supported ranges are pH 0–14, turbidity 0–1000 NTU, temperature -20–80°C, analog voltage 0–5 V, ADC 0–4095, and flow 0–200 L/min. Null is accepted for sensor numeric values. The MQ-5 reading is stored as gas-above-water telemetry and is not included in water quality status.

Backend rejects malformed packets, non-increasing sequences, and packets faster than one per 1.5 seconds. Operational alerts cover controller/device faults, low branch flow against its supplied baseline, inlet turbidity over the prototype's 5 NTU threshold, and outlet verification pH/turbidity outside the configured demo band (pH 6.5–8.5; turbidity ≤5 NTU). These are prototype alert thresholds only; the system does not certify water potability. A verification alert does not close the water path.

## Device command flow

The dashboard writes a pending `SET_CHANNEL` or `SET_MODE` document to `devices/SUJAL_01/commands/{autoId}`. Commands are queued, auditable and scoped to an operator. The ESP32 polls:

```text
GET https://asia-south1-vihaanxsujal.cloudfunctions.net/pollDeviceCommand?device_id=SUJAL_01
Header: x-device-key: <device-key>
```

It receives `{"command":"NONE"}` or a command with `command_id`, `command`, and the `selected_channel` or `mode` target. The firmware must validate the target, perform the switch safely, and then post an acknowledgement:

```text
POST https://asia-south1-vihaanxsujal.cloudfunctions.net/ackDeviceCommand
Header: Content-Type: application/json; x-device-key: <device-key>
```

```json
{
  "device_id": "SUJAL_01",
  "command_id": "id-returned-by-poll",
  "execution_status": "SUCCESS",
  "feedback": { "active_channel": "B" }
}
```

Use `FAILED` plus an optional short `error` when hardware rejects a command. Poll periodically (for example, every 2–5 seconds), acknowledge only after physical feedback confirms the action, and make command execution idempotent by tracking the last executed command ID. Backend retries an unacknowledged dispatched command after 60 seconds.

## Deploy

Install the Firebase CLI and authenticate/select the `vihaanxsujal` project if not already configured. Then run from the repository root:

```sh
firebase functions:secrets:set DEVICE_INGEST_KEY
npm run build
npm run backend:check
firebase deploy --only firestore:rules,functions,hosting
```

The secret command prompts for the value; use a long random value and enter the same value in ESP32 firmware provisioning. Do not put it in the React `.env`, source code, or Git. Firebase Cloud Functions deployment requires the Blaze plan. Use the deployed function URLs shown by the CLI if the project/region differs.

## Important behavior / limitations

- Live dashboard subscriptions require a signed-in operator assigned to `SUJAL_01`; a permission error usually means the operator document or rules assignment is missing.
- Firestore history is append-only from the browser; device ingestion uses the Admin SDK.
- Dashboard controls enqueue commands; a green/success UI acknowledgement is not proof of physical valve movement. Confirm with actuator feedback telemetry.
- This prototype does not make drinking-water safety or potability determinations. Bench-test valve behavior and preserve a safe water bypass before connecting to a real supply.
- Do not deploy with default-demo credentials, commit any credential or service-account JSON, or grant broad access through Firestore rules.
