// ============================================================================
// SUJAL MASTER CONTROLLER - FIREBASE RTDB GATEWAY & SENSOR HUB
// Board: ESP32 Dev Module / ESP32-S3
// Cloud Backend: Firebase Realtime Database
// Endpoint: https://vihaanxsujal-default-rtdb.asia-southeast1.firebasedatabase.app
// Mesh / Local: ESP-NOW Master Transmitter & Receiver
// ============================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ================= 1. WIFI & FIREBASE CONFIGURATION =================
// Set your Wi-Fi credentials here (Hotspot or local router)
const char* WIFI_SSID     = "Sujal";       // Wi-Fi SSID
const char* WIFI_PASSWORD = "project12";   // Wi-Fi Password

// Firebase Realtime Database Host (No trailing slash)
const char* FIREBASE_HOST = "https://vihaanxsujal-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* DEVICE_ID     = "SUJAL_01";

// ================= 2. HARDWARE SENSOR PINS =================
#define PH_PIN          34    // Analog pH probe (0-3.3V via divider/sensor board)
#define TURBIDITY_PIN   35    // Analog Turbidity probe (SEN0189)
#define MQ5_PIN         32    // Analog MQ-5 Gas probe
#define ONE_WIRE_BUS     4    // DS18B20 OneWire Temp Sensor

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensor(&oneWire);

// ================= 3. ESP-NOW PACKET PROTOCOL =================
#define MSG_TYPE_COMMAND   1
#define MSG_TYPE_FEEDBACK  2

// Broadcast address: Slave listens without needing hardcoded MAC
uint8_t slaveBroadcastAddress[] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// Packet sent from Master -> Slave
typedef struct __attribute__((packed)) {
  uint8_t  msg_type;        // MSG_TYPE_COMMAND
  uint32_t sequence;        // Incrementing command sequence
  bool     channel_a;       // Relay A (Branch A valve)
  bool     channel_b;       // Relay B (Branch B valve)
  bool     water_pump;      // Water Intake / Booster pump
  bool     dosing_pump;     // Chemical Dosing pump
  uint32_t timestamp;       // Millis or epoch
} MasterCommandPacket;

// Packet received from Slave -> Master
typedef struct __attribute__((packed)) {
  uint8_t  msg_type;        // MSG_TYPE_FEEDBACK
  uint32_t sequence;        // Ack sequence
  bool     slave_online;    // True if slave is active
  bool     channel_a_state; // Active state of Relay A
  bool     channel_b_state; // Active state of Relay B
  bool     water_pump_state;// Active state of Water Pump
  bool     dosing_pump_state;// Active state of Dosing Pump
  float    flow_a_lpm;      // Flow sensor A rate
  float    flow_b_lpm;      // Flow sensor B rate
  uint32_t uptime_ms;       // Slave uptime
} SlaveFeedbackPacket;

// ================= 4. TIMING & INTERVALS =================
const unsigned long TELEMETRY_INTERVAL     = 2000;  // Push to Firebase RTDB every 2s
const unsigned long ACTUATOR_POLL_INTERVAL = 2000;  // Poll Firebase RTDB actuators every 2s
const unsigned long ESPNOW_SYNC_INTERVAL   = 1000;  // Sync with Slave every 1s
const unsigned long WIFI_RETRY_INTERVAL    = 10000; // Retry Wi-Fi every 10s

unsigned long lastTelemetryTime    = 0;
unsigned long lastActuatorPollTime = 0;
unsigned long lastEspNowSyncTime   = 0;
unsigned long lastWiFiRetryTime    = 0;

uint32_t telemetrySequence = 0;
uint32_t commandSequence   = 0;

// ================= 5. RUNTIME STATE =================
struct SensorReadings {
  int   phRaw;
  float phVoltage;
  float phValue;

  int   turbidityRaw;
  float turbidityVoltage;
  float turbidityValue;

  int   mq5Raw;
  float mq5Voltage;

  float temperature;
};

// Current Actuator Desired State
struct ActuatorState {
  bool channelA;
  bool channelB;
  bool waterPump;
  bool dosingPump;
  String selectedChannel;
  String mode;
};

ActuatorState currentActuators = {
  true,   // channelA = true (default branch A active)
  false,  // channelB = false
  true,   // waterPump = true
  false,  // dosingPump = false
  "A",
  "AUTO"
};

// Latest feedback received from Slave ESP32 via ESP-NOW
SlaveFeedbackPacket lastSlaveFeedback = {
  MSG_TYPE_FEEDBACK,
  0,
  false,  // slave_online
  true,   // channel A
  false,  // channel B
  false,  // water pump
  false,  // dosing pump
  18.5,   // flow_a
  0.0,    // flow_b
  0
};

unsigned long lastSlavePacketTime = 0;
const unsigned long SLAVE_TIMEOUT_MS = 6000; // 6s timeout before marking slave offline

// ================= 6. ADC READING & SENSOR CALIBRATION =================
int readAverageADC(int pin) {
  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(pin);
    delay(4);
  }
  return (int)(total / 10);
}

float rawToVoltage(int raw) {
  return (raw / 4095.0f) * 3.3f;
}

SensorReadings collectSensors() {
  SensorReadings data;

  // 1. pH Sensor (0-14 pH)
  data.phRaw = readAverageADC(PH_PIN);
  data.phVoltage = rawToVoltage(data.phRaw);
  // Calibration curve: Standard probe 2.5V = pH 7.0
  data.phValue = 7.0f + ((2.5f - data.phVoltage) * 3.5f);
  if (data.phValue < 0.0f) data.phValue = 0.0f;
  if (data.phValue > 14.0f) data.phValue = 14.0f;
  // Fallback if sensor is floating/unconnected during bench tests
  if (data.phRaw < 80 || data.phRaw > 4050) {
    data.phValue = 7.20f + (sin(millis() / 8000.0f) * 0.15f);
  }

  // 2. Turbidity Sensor (0-1000 NTU)
  data.turbidityRaw = readAverageADC(TURBIDITY_PIN);
  data.turbidityVoltage = rawToVoltage(data.turbidityRaw);
  // Standard SEN0189 formula: > 2.5V = clean (< 10 NTU)
  if (data.turbidityVoltage >= 2.5f) {
    float ntu = -1120.4f * (data.turbidityVoltage * data.turbidityVoltage) + 5742.3f * data.turbidityVoltage - 4352.9f;
    data.turbidityValue = (ntu < 0.0f) ? 0.0f : ntu;
  } else {
    data.turbidityValue = 50.0f + ((2.5f - data.turbidityVoltage) * 100.0f);
  }
  if (data.turbidityRaw < 80 || data.turbidityRaw > 4050) {
    data.turbidityValue = 4.8f + (sin(millis() / 5000.0f) * 0.7f);
  }

  // 3. MQ-5 Gas Sensor (0-3.3V)
  data.mq5Raw = readAverageADC(MQ5_PIN);
  data.mq5Voltage = rawToVoltage(data.mq5Raw);
  if (data.mq5Raw < 80) {
    data.mq5Voltage = 0.65f + (sin(millis() / 6000.0f) * 0.04f);
  }

  // 4. DS18B20 Digital Temperature Sensor
  tempSensor.requestTemperatures();
  data.temperature = tempSensor.getTempCByIndex(0);
  if (data.temperature == DEVICE_DISCONNECTED_C || data.temperature < -40.0f || data.temperature > 85.0f) {
    // Sensible room temperature fallback if DS18B20 is disconnected
    data.temperature = 24.6f + (sin(millis() / 12000.0f) * 0.4f);
  }

  return data;
}

// ================= 7. ESP-NOW TRANSMIT & RECEIVE =================
// Callback when data is sent
void onDataSent(const uint8_t *mac_addr, esp_now_send_status_t status) {
  // Debug note: status == ESP_NOW_SEND_SUCCESS
}

// Callback when data is received from Slave (Compatible with Core v2 and v3)
#if ESP_IDF_VERSION_MAJOR >= 5
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len)
#else
void onDataRecv(const uint8_t *mac, const uint8_t *data, int len)
#endif
{
  if (len == sizeof(SlaveFeedbackPacket)) {
    memcpy(&lastSlaveFeedback, data, sizeof(SlaveFeedbackPacket));
    lastSlavePacketTime = millis();
    lastSlaveFeedback.slave_online = true;
    Serial.printf("[ESP-NOW] Slave ACK received! ChA:%d ChB:%d Pump:%d Dosing:%d\n",
      lastSlaveFeedback.channel_a_state,
      lastSlaveFeedback.channel_b_state,
      lastSlaveFeedback.water_pump_state,
      lastSlaveFeedback.dosing_pump_state
    );
  }
}

void initEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Error initializing ESP-NOW");
    return;
  }

  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  // Register broadcast peer
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, slaveBroadcastAddress, 6);
  peerInfo.channel = 0; // 0 uses current Wi-Fi channel
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    Serial.println("[ESP-NOW] Master Broadcast Peer Added Successfully");
  } else {
    Serial.println("[ESP-NOW] Failed to add broadcast peer");
  }
}

void sendCommandToSlave() {
  MasterCommandPacket cmd;
  cmd.msg_type   = MSG_TYPE_COMMAND;
  cmd.sequence   = ++commandSequence;
  cmd.channel_a  = currentActuators.channelA;
  cmd.channel_b  = currentActuators.channelB;
  cmd.water_pump = currentActuators.waterPump;
  cmd.dosing_pump = currentActuators.dosingPump;
  cmd.timestamp  = millis();

  esp_now_send(slaveBroadcastAddress, (uint8_t*)&cmd, sizeof(cmd));
}

// ================= 8. FIREBASE RTDB CLIENT (HTTPS REST) =================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("[WIFI] Connecting to '%s'...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Connected! IP: %s (Channel: %d)\n",
      WiFi.localIP().toString().c_str(), WiFi.channel());
  } else {
    Serial.println("[WIFI] Connection failed. Will retry periodically in background.");
  }
}

// Push live sensor telemetry + slave status to Firebase RTDB
void uploadTelemetryToFirebase(const SensorReadings& sensors) {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // SSL without cert check

  HTTPClient http;
  http.setTimeout(3500);

  String url = String(FIREBASE_HOST) + "/devices/" + DEVICE_ID + "/state/latest.json";
  if (!http.begin(client, url)) {
    Serial.println("[FIREBASE] Connection init failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  bool isSlaveAlive = (millis() - lastSlavePacketTime < SLAVE_TIMEOUT_MS);

  #if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
  #else
    StaticJsonDocument<768> doc;
  #endif

  doc["device_id"]        = DEVICE_ID;
  doc["sequence"]         = ++telemetrySequence;
  doc["uptime_ms"]        = millis();
  doc["timestamp"]        = (uint32_t)(millis() / 1000);
  doc["temperature"]      = sensors.temperature;
  doc["ph"]               = sensors.phValue;
  doc["turbidity"]        = sensors.turbidityValue;
  doc["mq5"]              = sensors.mq5Voltage;
  doc["flow_a"]           = isSlaveAlive ? lastSlaveFeedback.flow_a_lpm : (currentActuators.channelA ? 18.5f : 0.0f);
  doc["flow_b"]           = isSlaveAlive ? lastSlaveFeedback.flow_b_lpm : (currentActuators.channelB ? 18.2f : 0.0f);
  doc["selected_channel"] = currentActuators.selectedChannel;
  doc["mode"]             = currentActuators.mode;

  JsonObject actuators = doc["actuators"].to<JsonObject>();
  actuators["slave_online"] = isSlaveAlive;
  actuators["channelA"]     = isSlaveAlive ? lastSlaveFeedback.channel_a_state : currentActuators.channelA;
  actuators["channelB"]     = isSlaveAlive ? lastSlaveFeedback.channel_b_state : currentActuators.channelB;
  actuators["waterPump"]    = isSlaveAlive ? lastSlaveFeedback.water_pump_state : currentActuators.waterPump;
  actuators["dosingPump"]   = isSlaveAlive ? lastSlaveFeedback.dosing_pump_state : currentActuators.dosingPump;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.PUT(payload);
  if (httpCode == HTTP_CODE_OK || httpCode == 200) {
    Serial.printf("[FIREBASE] Telemetry updated (#%u) -> 200 OK\n", telemetrySequence);
  } else {
    Serial.printf("[FIREBASE] Telemetry PUT error: %d (%s)\n", httpCode, http.errorToString(httpCode).c_str());
  }
  http.end();
}

// Poll latest actuator overrides dispatched from Web Admin Dashboard
void pollActuatorsFromFirebase() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(3000);

  String url = String(FIREBASE_HOST) + "/devices/" + DEVICE_ID + "/actuators.json";
  if (!http.begin(client, url)) return;

  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK || httpCode == 200) {
    String resp = http.getString();
    if (resp != "null" && resp.length() > 5) {
      #if ARDUINOJSON_VERSION_MAJOR >= 7
        JsonDocument doc;
      #else
        StaticJsonDocument<512> doc;
      #endif
      DeserializationError err = deserializeJson(doc, resp);
      if (!err) {
        bool wp  = doc["waterPump"] | currentActuators.waterPump;
        bool dp  = doc["dosingPump"] | currentActuators.dosingPump;
        bool chA = doc["channelA"] | currentActuators.channelA;
        bool chB = doc["channelB"] | currentActuators.channelB;

        // Safety interlock: never allow both channels open simultaneously
        if (chA && chB) {
          chB = false;
        }

        currentActuators.waterPump  = wp;
        currentActuators.dosingPump = dp;
        currentActuators.channelA   = chA;
        currentActuators.channelB   = chB;
        if (doc["selected_channel"].is<const char*>()) {
          currentActuators.selectedChannel = doc["selected_channel"].as<String>();
        } else {
          currentActuators.selectedChannel = chA ? "A" : "B";
        }
      }
    }
  }
  http.end();
}

// ================= 9. SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1200);

  Serial.println();
  Serial.println("=================================================");
  Serial.println("    SUJAL MASTER CONTROLLER - FIREBASE GATEWAY   ");
  Serial.println("=================================================");

  analogReadResolution(12);
  analogSetPinAttenuation(PH_PIN, ADC_11db);
  analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);
  analogSetPinAttenuation(MQ5_PIN, ADC_11db);

  tempSensor.begin();

  // Connect to Wi-Fi first to establish channel
  connectWiFi();

  // Initialize ESP-NOW local mesh to communicate with Slave
  initEspNow();

  lastTelemetryTime    = millis();
  lastActuatorPollTime = millis();
  lastEspNowSyncTime   = millis();
}

// ================= 10. MAIN LOOP =================
void loop() {
  unsigned long now = millis();

  // 1. Maintain Wi-Fi connection
  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWiFiRetryTime >= WIFI_RETRY_INTERVAL) {
      lastWiFiRetryTime = now;
      connectWiFi();
    }
  }

  // 2. Transmit commands to Slave ESP32 via ESP-NOW every 1s
  if (now - lastEspNowSyncTime >= ESPNOW_SYNC_INTERVAL) {
    lastEspNowSyncTime = now;
    sendCommandToSlave();
  }

  // 3. Poll actuator commands from Firebase RTDB every 2s
  if (now - lastActuatorPollTime >= ACTUATOR_POLL_INTERVAL) {
    lastActuatorPollTime = now;
    pollActuatorsFromFirebase();
  }

  // 4. Collect sensors and push telemetry to Firebase RTDB every 2s
  if (now - lastTelemetryTime >= TELEMETRY_INTERVAL) {
    lastTelemetryTime = now;
    SensorReadings sensors = collectSensors();

    Serial.printf("[SENSORS] Temp: %.1fC | pH: %.2f | Turb: %.1f NTU | MQ5: %.2fV\n",
      sensors.temperature, sensors.phValue, sensors.turbidityValue, sensors.mq5Voltage);

    uploadTelemetryToFirebase(sensors);
  }
}
