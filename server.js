const express = require("express");
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ---------- KONFIGURASI (dari environment variable) ----------
const PORT = process.env.PORT || 3000;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const DASH_USER = process.env.DASH_USER;
const DASH_PASS = process.env.DASH_PASS;

if (!MQTT_USER || !MQTT_PASSWORD || !DASH_USER || !DASH_PASS) {
  console.error("PERINGATAN: MQTT_USER, MQTT_PASSWORD, DASH_USER, DASH_PASS belum semuanya diisi!");
}

// ---------- LOGIN SEDERHANA (Basic Auth) ----------
// Harus SEBELUM express.static supaya halaman dashboard ikut terkunci
app.use((req, res, next) => {
  const auth = (req.headers.authorization || "").split(" ")[1] || "";
  const decoded = Buffer.from(auth, "base64").toString();
  const idx = decoded.indexOf(":");
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (DASH_USER && DASH_PASS && user === DASH_USER && pass === DASH_PASS) {
    return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Smart Aquarium"');
  res.status(401).send("Login diperlukan");
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- MQTT (MaQIATTo) ----------
const MQTT_BROKER = "mqtt://maqiatto.com:1883";
const TOPIC_STATUS   = `${MQTT_USER}/status`;
const TOPIC_CONTROL  = `${MQTT_USER}/control`;
const TOPIC_SETTINGS = `${MQTT_USER}/settings`;

// ---------- DATA LOGGING CSV ----------
const CSV_PATH = path.join(__dirname, "log_suhu_aquarium.csv");
const LOG_INTERVAL_MS = 30000; // simpan ke CSV tiap 30 detik
let latestStatus = null;
let lastLogTime = 0;

function pastikanCSVHeader() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(
      CSV_PATH,
      "timestamp,temperature,temp_status,aerator_status,mode,setpoint_low,setpoint_high\n"
    );
  }
}

function tulisBarisCSV(status) {
  pastikanCSVHeader();
  const ts = new Date().toISOString();
  fs.appendFileSync(
    CSV_PATH,
    `${ts},${status.temperature},${status.temp_status},${status.aerator_status},${status.mode},${status.setpoint_low},${status.setpoint_high}\n`
  );
}

const client = mqtt.connect(MQTT_BROKER, {
  username: MQTT_USER,
  password: MQTT_PASSWORD
});

client.on("connect", () => {
  console.log("Terhubung ke MQTT broker MaQIATTo");
  client.subscribe(TOPIC_STATUS, (err) => {
    if (err) console.error("Gagal subscribe:", err.message);
    else console.log("Subscribe berhasil ke:", TOPIC_STATUS);
  });
});

client.on("error", (err) => {
  console.error("MQTT error:", err.message);
});

client.on("message", (topic, message) => {
  if (topic !== TOPIC_STATUS) return;
  try {
    latestStatus = JSON.parse(message.toString());
    const sekarang = Date.now();
    if (sekarang - lastLogTime >= LOG_INTERVAL_MS) {
      lastLogTime = sekarang;
      tulisBarisCSV(latestStatus);
    }
  } catch (e) {
    console.error("Gagal parse pesan MQTT:", e.message);
  }
});

// ---------- API ----------
app.get("/api/status", (req, res) => {
  if (!latestStatus) return res.status(503).json({ error: "Belum ada data dari ESP" });
  res.json(latestStatus);
});

app.get("/api/history", (req, res) => {
  pastikanCSVHeader();
  const limit = parseInt(req.query.limit) || 50;
  const baris = fs.readFileSync(CSV_PATH, "utf-8").trim().split("\n").slice(1).slice(-limit);
  res.json(
    baris.filter(Boolean).map((line) => {
      const [timestamp, temperature, temp_status, aerator_status, mode, setpoint_low, setpoint_high] = line.split(",");
      return {
        timestamp,
        temperature: parseFloat(temperature),
        temp_status,
        aerator_status,
        mode,
        setpoint_low,
        setpoint_high
      };
    })
  );
});

app.get("/api/download", (req, res) => {
  pastikanCSVHeader();
  res.download(CSV_PATH, "log_suhu_aquarium.csv");
});

app.post("/api/control", (req, res) => {
  client.publish(TOPIC_CONTROL, JSON.stringify(req.body));
  res.json({ result: "perintah dikirim via MQTT" });
});

app.post("/api/settings", (req, res) => {
  client.publish(TOPIC_SETTINGS, JSON.stringify(req.body));
  res.json({ result: "setting dikirim via MQTT" });
});

pastikanCSVHeader();
app.listen(PORT, () => console.log(`Dashboard jalan di port ${PORT}`));