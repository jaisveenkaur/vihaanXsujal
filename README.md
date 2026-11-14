# SuJal

SuJal is a water monitoring and treatment prototype dashboard for the ESP32 device `SUJAL_01`. The dashboard supports live sensor monitoring, treatment verification, two branch controls, alerts, records, logs, and CSV export.

## Run the dashboard

```sh
npm install
npm --prefix frontend install
npm run dev
```

Without Firebase configuration, the UI runs in demo mode with illustrative readings. To use Firebase, add the Firebase Web App config values to the root `.env` file, and restart Vite. The `.env` file is ignored by Git.

In Firebase Console:

1. Enable **Authentication → Email/Password** and create the operator accounts.
2. Create a **Cloud Firestore** database.
3. Deploy the Firestore rules and functions from this repository.
4. Set the `DEVICE_INGEST_KEY` Functions secret to a long random value. Keep it in the device's private build settings; do not commit it.

The browser only reads device state after operator sign-in. Use Firebase Auth users created in the console; public sign-up is not enabled. Authenticated operators can issue branch and mode commands. Firestore rules prevent browser writes to telemetry.

## Firestore layout

```text
devices/SUJAL_01/state/latest        Latest ESP32 telemetry packet
devices/SUJAL_01/readings/{id}       Append-only reading history
devices/SUJAL_01/alerts/{alertId}    Operational alerts
devices/SUJAL_01/commands/current   Latest operator command
```

## ESP32 API

Deploy the Cloud Functions, then send the full telemetry JSON body to `ingestTelemetry` as an HTTPS `POST` with `x-device-key: <DEVICE_INGEST_KEY>`. The endpoint stores the latest packet and an immutable history record, and raises operational alerts for controller faults or a selected branch flow below 25% of its configured baseline.

The ESP32 can poll `pollDeviceCommand` with an HTTPS `GET` and the same header. It returns `{"command":"NONE"}` when there is no pending command, or a `SET_CHANNEL` / `SET_MODE` instruction. After operating the valve, publish a new state packet with updated `selected_channel`, `mode`, and `actuator_feedback` so the dashboard reflects confirmed device state.

## Post-treatment verification data

The supplied packet has `sensor_data` for the incoming water. To show measured values after the treatment station, add an optional object at the packet root:

```json
"verification_data": {
  "ph_sensor": { "value": 7.1, "raw_adc": 1830, "voltage": 1.47, "calibrated": true },
  "turbidity_sensor": { "value": 2.8, "raw_adc": 1720, "voltage": 1.39, "calibrated": true },
  "temperature_sensor": { "value": 24.6, "unit": "celsius" }
}
```

This keeps inlet and post-treatment readings distinct. `treatment.verification` can carry the device's verification status text. Sensor thresholds shown in the interface are operational demo settings and do not certify water as potable.

## Deploy

Install and sign in to the Firebase CLI, select the Firebase project with `firebase use --add`, install function dependencies, set the Functions secret, build the frontend, and deploy Hosting, Firestore rules, and Functions. Firebase Functions deployment may require a billing-enabled Firebase project. Use your Firebase project ID locally; do not commit service-account keys or device secrets.
