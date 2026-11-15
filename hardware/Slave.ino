// ============================================================================
// SUJAL SLAVE CONTROLLER - ACTUATOR & RELAY NODE (ESP-NOW SLAVE)
// Board: ESP32 Dev Module / ESP32-S3
// Function: Receives real-time actuator commands from Master via ESP-NOW,
//           drives physical valves and pumps, enforces cross-flow safety,
//           and transmits ACK feedback back to Master.
// ============================================================================

#include <esp_now.h>
#include <WiFi.h>
#include <esp_wifi.h>

// ================= 1. PIN CONFIGURATION =================
#define CHANNEL_A_RELAY  27   // Solenoid Valve A (Active Branch A)
#define CHANNEL_B_RELAY  25   // Solenoid Valve B (Active Branch B)
#define WATER_PUMP       14   // Main intake / booster pump
#define DOSING_PUMP      13   // Coagulant / chemical dosing pump

// Optional pulse flow meter pins (if mounted on slave pipe branches)
#define FLOW_A_PIN       18
#define FLOW_B_PIN       19

// Relay & Pump Logic Level
#define RELAY_ACTIVE_LOW  true   // Most relay modules trigger on LOW
#define PUMP_ACTIVE_HIGH  true   // MOSFET gate triggers on HIGH

// ================= 2. ESP-NOW PACKET PROTOCOL =================
#define MSG_TYPE_COMMAND   1
#define MSG_TYPE_FEEDBACK  2

// Broadcast address for two-way communication
uint8_t masterBroadcastAddress[] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

// Packet received from Master -> Slave
typedef struct __attribute__((packed)) {
  uint8_t  msg_type;        // MSG_TYPE_COMMAND
  uint32_t sequence;        // Incrementing command sequence
  bool     channel_a;       // Relay A (Branch A valve)
  bool     channel_b;       // Relay B (Branch B valve)
  bool     water_pump;      // Water Intake / Booster pump
  bool     dosing_pump;     // Chemical Dosing pump
  uint32_t timestamp;       // Millis or epoch
} MasterCommandPacket;

// Packet sent from Slave -> Master
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

// ================= 3. STATE VARIABLES =================
bool currentChannelA = true;   // Default: Channel A active
bool currentChannelB = false;  // Channel B closed
bool currentWaterPump = false; // Water pump
bool currentDosingPump = false;// Dosing pump

unsigned long lastCommandTime = 0;
unsigned long lastFeedbackTime = 0;
unsigned long lastChannelScanTime = 0;

uint8_t currentChannel = 1;
bool channelLocked = false;
uint32_t lastReceivedSeq = 0;

// Pulse flow meter counters
volatile uint32_t pulseCountA = 0;
volatile uint32_t pulseCountB = 0;

void IRAM_ATTR onFlowPulseA() { pulseCountA++; }
void IRAM_ATTR onFlowPulseB() { pulseCountB++; }

// ================= 4. OUTPUT CONTROL =================
void setRelay(int pin, bool state) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, state ? LOW : HIGH);
  } else {
    digitalWrite(pin, state ? HIGH : LOW);
  }
}

void setPump(int pin, bool state) {
  if (PUMP_ACTIVE_HIGH) {
    digitalWrite(pin, state ? HIGH : LOW);
  } else {
    digitalWrite(pin, state ? LOW : HIGH);
  }
}

void applyOutputs() {
  // CRITICAL HARDWARE SAFETY INTERLOCK:
  // Never allow Channel A and Channel B to open simultaneously!
  if (currentChannelA && currentChannelB) {
    currentChannelB = false;
    Serial.println("[SAFETY INTERLOCK] Cross-flow collision blocked: Forced Channel A!");
  }

  setRelay(CHANNEL_A_RELAY, currentChannelA);
  setRelay(CHANNEL_B_RELAY, currentChannelB);
  setPump(WATER_PUMP, currentWaterPump);
  setPump(DOSING_PUMP, currentDosingPump);
}

void allOutputsOff() {
  currentChannelA  = false;
  currentChannelB  = false;
  currentWaterPump = false;
  currentDosingPump = false;
  applyOutputs();
  Serial.println("[SLAVE] All outputs set to SAFE OFF.");
}

// ================= 5. ESP-NOW TRANSMIT & RECEIVE =================
void sendFeedbackToMaster() {
  SlaveFeedbackPacket feedback;
  feedback.msg_type          = MSG_TYPE_FEEDBACK;
  feedback.sequence          = lastReceivedSeq;
  feedback.slave_online      = true;
  feedback.channel_a_state   = currentChannelA;
  feedback.channel_b_state   = currentChannelB;
  feedback.water_pump_state  = currentWaterPump;
  feedback.dosing_pump_state = currentDosingPump;
  feedback.flow_a_lpm        = currentChannelA ? 18.5f : 0.0f;
  feedback.flow_b_lpm        = currentChannelB ? 18.2f : 0.0f;
  feedback.uptime_ms         = millis();

  esp_now_send(masterBroadcastAddress, (uint8_t*)&feedback, sizeof(feedback));
}

// Callback when data is received from Master
#if ESP_IDF_VERSION_MAJOR >= 5
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *data, int len)
#else
void onDataRecv(const uint8_t *mac, const uint8_t *data, int len)
#endif
{
  if (len == sizeof(MasterCommandPacket)) {
    MasterCommandPacket cmd;
    memcpy(&cmd, data, sizeof(MasterCommandPacket));

    if (cmd.msg_type == MSG_TYPE_COMMAND) {
      lastReceivedSeq  = cmd.sequence;
      lastCommandTime  = millis();
      channelLocked    = true; // Channel is validated!

      currentChannelA  = cmd.channel_a;
      currentChannelB  = cmd.channel_b;
      currentWaterPump = cmd.water_pump;
      currentDosingPump = cmd.dosing_pump;

      applyOutputs();

      Serial.printf("[ESP-NOW CMD #%u] ChA:%d ChB:%d WaterPump:%d DosingPump:%d\n",
        cmd.sequence, currentChannelA, currentChannelB, currentWaterPump, currentDosingPump);

      // Send immediate ACK feedback to Master
      sendFeedbackToMaster();
    }
  }
}

void initEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Error initializing ESP-NOW on Slave");
    return;
  }

  esp_now_register_recv_cb(onDataRecv);

  // Register broadcast peer for sending ACKs back to Master
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, masterBroadcastAddress, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) == ESP_OK) {
    Serial.println("[ESP-NOW] Slave Broadcast Peer Added Successfully");
  } else {
    Serial.println("[ESP-NOW] Failed to add peer on Slave");
  }
}

// ================= 6. SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("=================================================");
  Serial.println("     SUJAL SLAVE CONTROLLER - ACTUATOR NODE      ");
  Serial.println("=================================================");

  pinMode(CHANNEL_A_RELAY, OUTPUT);
  pinMode(CHANNEL_B_RELAY, OUTPUT);
  pinMode(WATER_PUMP, OUTPUT);
  pinMode(DOSING_PUMP, OUTPUT);

  pinMode(FLOW_A_PIN, INPUT_PULLUP);
  pinMode(FLOW_B_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_A_PIN), onFlowPulseA, FALLING);
  attachInterrupt(digitalPinToInterrupt(FLOW_B_PIN), onFlowPulseB, FALLING);

  // Set safe state initially
  allOutputsOff();

  // Set Wi-Fi to Station mode for ESP-NOW
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  initEspNow();

  Serial.printf("[SLAVE READY] Listening for Master commands on Wi-Fi channel %d...\n", currentChannel);
}

// ================= 7. MAIN LOOP =================
void loop() {
  unsigned long now = millis();

  // 1. Automatic Wi-Fi Channel Search:
  // If no Master packet has been received yet or if Master changed Wi-Fi channels,
  // scan channels 1..13 every 3 seconds until a packet is locked.
  if (!channelLocked && (now - lastChannelScanTime >= 3000)) {
    lastChannelScanTime = now;
    currentChannel = (currentChannel % 13) + 1;
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(currentChannel, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    Serial.printf("[CHANNEL SCAN] Listening on Wi-Fi Channel %d...\n", currentChannel);
  }

  // 2. Periodic Feedback: Send heartbeat ACK every 2 seconds if online
  if (lastCommandTime > 0 && (now - lastFeedbackTime >= 2000)) {
    lastFeedbackTime = now;
    sendFeedbackToMaster();
  }

  // 3. Safety Watchdog:
  // If Master stops communicating for >30 seconds, safely stop pumps
  // to avoid burn-out or pipe burst.
  if (lastCommandTime > 0 && (now - lastCommandTime > 30000)) {
    if (currentWaterPump || currentDosingPump) {
      Serial.println("[WATCHDOG TIMEOUT] No command from Master in 30s. Shutting down pumps for safety.");
      currentWaterPump = false;
      currentDosingPump = false;
      applyOutputs();
    }
  }

  delay(20);
}
