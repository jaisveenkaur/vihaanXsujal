# SuJal Hardware — Master-Slave ESP32 Architecture & Firebase Integration

This folder contains the complete firmware for the **SuJal Node SJ-01 Dual-ESP32 SCADA System**:
1. **Master ESP32** (`hardware/master.ino`): Sensor acquisition hub, Wi-Fi gateway, and HTTPS Firebase Realtime Database client.
2. **Slave ESP32** (`hardware/Slave.ino`): Physical valve and pump relay controller with cross-flow hardware safety interlock.
3. Both ESPs communicate wirelessly via **ESP-NOW** (sub-millisecond latency, zero-router dependency).

---

## 1. System Architecture

```
[ Web Dashboard / Admin Console ]
     ▲ (Live Telemetry & Actuator Commands)
     ▼ HTTPS REST (SSL / TLS)
[ Firebase Realtime Database ]
  https://vihaanxsujal-default-rtdb.asia-southeast1.firebasedatabase.app
     ▲
     ▼ HTTPS PUT / GET
[ MASTER ESP32 ] (hardware/master.ino)
  ├── Wi-Fi Station (Connected to Hotspot/Router)
  ├── Analog pH Sensor (GPIO 34)
  ├── Analog Turbidity Sensor (GPIO 35)
  ├── MQ-5 Gas Sensor (GPIO 32)
  ├── DS18B20 Temp Sensor (GPIO 4 via OneWire)
  └── ESP-NOW Wireless Radio (Broadcast Channel)
          ▲
          ▼ ESP-NOW Bidirectional Packets (1 ms)
[ SLAVE ESP32 ] (hardware/Slave.ino)
  ├── ESP-NOW Radio (Auto-channel locking)
  ├── Branch A Solenoid Relay (GPIO 27)
  ├── Branch B Solenoid Relay (GPIO 25)
  ├── Water Intake / Booster Pump (GPIO 14)
  ├── Chemical Dosing Pump (GPIO 13)
  └── Flow Sensors A & B (GPIO 18 / 19)
```

---

## 2. Pinout & Wiring Tables

### A. Master ESP32 (Sensor Hub & Gateway)

| Component | Pin Type | ESP32 GPIO | Description / Notes |
| :--- | :--- | :--- | :--- |
| **Analog pH Sensor** | Analog IN | `GPIO 34` | 0-3.3V analog input (calibrated for standard 0-14 pH probe) |
| **Turbidity Sensor (SEN0189)** | Analog IN | `GPIO 35` | 0-3.3V analog input (>2.5V clean, <2.0V turbid) |
| **MQ-5 Gas Sensor** | Analog IN | `GPIO 32` | 0-3.3V analog input for flammable/combustible gas detection |
| **DS18B20 Temp Sensor** | Digital OneWire | `GPIO 4` | 4.7kΩ pull-up resistor between GPIO 4 and 3.3V |
| **GND** | Power | `GND` | Common ground connected to all sensors |
| **VCC** | Power | `3.3V / 5V` | Sensor supply |

---

### B. Slave ESP32 (Actuator & Relay Controller)

| Component | Pin Type | ESP32 GPIO | Description / Notes |
| :--- | :--- | :--- | :--- |
| **Relay Channel A (Branch A)** | Digital OUT | `GPIO 27` | Active-LOW relay controlling Branch A solenoid valve |
| **Relay Channel B (Branch B)** | Digital OUT | `GPIO 25` | Active-LOW relay controlling Branch B solenoid valve |
| **Water Pump** | Digital OUT | `GPIO 14` | Active-HIGH MOSFET gate or relay for main intake pump |
| **Dosing Pump** | Digital OUT | `GPIO 13` | Active-HIGH MOSFET gate or relay for chlorine/coagulant dosing |
| **Flow Meter A (Optional)** | Digital Pulse IN | `GPIO 18` | Interrupt pulse counter for Branch A water flow |
| **Flow Meter B (Optional)** | Digital Pulse IN | `GPIO 19` | Interrupt pulse counter for Branch B water flow |
| **GND** | Power | `GND` | Common ground shared with relay boards and pump supplies |

> **Safety Interlock**: The Slave firmware enforces a hard lock: Relay A and Relay B can **never** be energized at the same time. If both are commanded, Channel B is automatically blocked.

---

## 3. Step-by-Step Flashing Instructions

### Required Arduino IDE Setup:
1. **ESP32 Board Support**:
   - Go to **Arduino IDE > Preferences**, add this URL to *Additional Boards Manager URLs*:
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Go to **Tools > Board > Boards Manager**, search for `esp32` and install it.
2. **Required Libraries** (Install via **Tools > Manage Libraries**):
   - **ArduinoJson** (by Benoit Blanchon, v6 or v7)
   - **OneWire** (by Paul Stoffregen)
   - **DallasTemperature** (by Miles Burton)

---

### Step 1: Flash the Master ESP32
1. Plug the **Master ESP32** into your computer via USB.
2. In Arduino IDE, open:
   ```
   hardware/master.ino
   ```
3. Update lines 19-20 with your Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   ```
4. In **Tools**:
   - Board: **ESP32 Dev Module** (or your specific ESP32-S3 model)
   - Upload Speed: `921600` or `115200`
   - Port: Select the COM / `/dev/cu.usbserial...` port for your Master board.
5. Click **Upload** (`→`).
6. Open **Tools > Serial Monitor** (115200 baud). You will see:
   ```
   =================================================
       SUJAL MASTER CONTROLLER - FIREBASE GATEWAY   
   =================================================
   [WIFI] Connected! IP: 192.168.x.x (Channel: 1)
   [ESP-NOW] Master Broadcast Peer Added Successfully
   [SENSORS] Temp: 24.6C | pH: 7.20 | Turb: 4.8 NTU | MQ5: 0.65V
   [FIREBASE] Telemetry updated (#1) -> 200 OK
   ```

---

### Step 2: Flash the Slave ESP32
1. Unplug the Master and plug in the **Slave ESP32**.
2. In Arduino IDE, open:
   ```
   hardware/Slave.ino
   ```
3. No Wi-Fi password or MAC address configuration is needed! The Slave uses automatic channel searching and connects to the Master over ESP-NOW.
4. Select the Slave's COM port and click **Upload** (`→`).
5. Open Serial Monitor (115200 baud). You will see:
   ```
   =================================================
        SUJAL SLAVE CONTROLLER - ACTUATOR NODE      
   =================================================
   [SLAVE READY] Listening for Master commands...
   [ESP-NOW CMD #1] ChA:1 ChB:0 WaterPump:1 DosingPump:0
   ```

---

## 4. Firebase Realtime Database Data Structure

The Master ESP32 automatically syncs bidirectional telemetry with your Firebase RTDB:

### 1. Telemetry Upload (PUT to `/devices/SUJAL_01/state/latest.json`)
```json
{
  "device_id": "SUJAL_01",
  "sequence": 142,
  "uptime_ms": 284000,
  "temperature": 24.6,
  "ph": 7.22,
  "turbidity": 4.8,
  "mq5": 0.65,
  "flow_a": 18.5,
  "flow_b": 0.0,
  "selected_channel": "A",
  "mode": "AUTO",
  "actuators": {
    "slave_online": true,
    "channelA": true,
    "channelB": false,
    "waterPump": true,
    "dosingPump": false
  }
}
```

### 2. Actuator Overrides (GET from `/devices/SUJAL_01/actuators.json`)
Dispatched by the Web Admin Dashboard (`operator@sujal.com`):
```json
{
  "channelA": true,
  "channelB": false,
  "waterPump": true,
  "dosingPump": false,
  "selected_channel": "A",
  "updated_at": 1731644000000
}
```
When an operator toggles an override in the web dashboard, the Master fetches it via HTTPS, immediately transmits the packet to the Slave via ESP-NOW, and the Slave flips the physical relay in under 1 second!
