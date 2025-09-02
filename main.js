// main.js — OBR popover poller for Owlbear events
import OBR from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk/+esm";
import { DiceRoll } from "https://cdn.jsdelivr.net/npm/@dice-roller/rpg-dice-roller/+esm";

const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const portEl = document.getElementById("port");
const autostartEl = document.getElementById("autostart");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const scanBtn = document.getElementById("scan");

let since = 0, running = false;
let aborter = null;
const PORTS = [17620,17621,17622,17623,17624,17625];

function logLine(s, cls){ const d=document.createElement("div"); if(cls)d.className=cls; d.textContent=s; logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight; }
function setStatus(s){ statusEl.textContent=s; }

async function health(port){
  try{
    const r = await fetch(`http://127.0.0.1:${port}/health`, { cache:"no-store" });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type")||"";
    if (!ct.includes("application/json")) return false;
    return true;
  }catch{return false;}
}

async function scanPorts(){
  setStatus("scanning...");
  for (const p of PORTS){
    if (await health(p)){
      portEl.value = String(p);
      logLine(`Connected to bridge on port ${p}`, "ok");
      setStatus("ready");
      return p;
    }
  }
  logLine("No local bridge found on 17620–17625", "err");
  setStatus("not found");
  return null;
}

async function pollOnce(signal){
  const port = Number(portEl.value || 17620);
  const url = `http://127.0.0.1:${port}/pull?since=${since}&target=owlbear`;
  const res = await fetch(url, { cache:"no-store", signal });
  const text = await res.text();

  if (!res.ok){ logLine(`Bridge HTTP ${res.status}: ${text.slice(0,120)}`, "err"); throw new Error("bridge"); }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")){ logLine("Non-JSON from bridge: "+text.slice(0,120), "err"); throw new Error("nonjson"); }

  const data = JSON.parse(text);
  if (Array.isArray(data.events)) {
  for (const ev of data.events) {
    const msg = ev.roll || ev.text || "";
    if (msg) {
      logLine(msg);
      // Perform the actual dice roll client-side:
      await rollAndAnnounce(msg);
    }
  }
}
  if (typeof data.last === "number") since = data.last;
}

async function loop(){
  setStatus("running");
  while(running){
    try{
      aborter = new AbortController();
      await pollOnce(aborter.signal);
      await new Promise(r=>setTimeout(r,50));
    }catch(e){
      if (!running) break;
      // If the connection is refused, try a quick rescan
      if (String(e).includes("Failed to fetch") || String(e).includes("network") ){
        const p = await scanPorts();
        if (!p) await new Promise(r=>setTimeout(r,500));
      }else{
        await new Promise(r=>setTimeout(r,250));
      }
    } finally {
      aborter = null;
    }
  }
  setStatus("stopped");
}

function normalizeNotation(s) {
  // tidy up “d20 + 3”, unicode minus, uppercase “D”, etc.
  return (s || "")
    .replace(/\u2212/g, "-")
    .replace(/\s+/g, "")
    .replace(/D/g, "d");
}

async function rollAndAnnounce(notation) {
  const n = normalizeNotation(notation);
  let total, detail;
  try {
    const r = new DiceRoll(n);            // parses + rolls once
    total = r.total;                      // number
    detail = r.output;                    // e.g. "2d20kh1+3: [17, 4] + 3 = 20"
  } catch (e) {
    await OBR.notification.show(`OBR Dice: invalid roll "${notation}"`, "ERROR");
    return;
  }

  // Show everyone (who has the extension) via broadcast
  const payload = { notation: n, total, detail };
  try { await OBR.broadcast.sendMessage("arrogantsloth.pdfdice.roll", payload); } catch {}

  // Local toast
  await OBR.notification.show(detail, "SUCCESS");

  // Optional: drop a temporary local label in the scene (client-only)
  // Remove if you don’t want scene artifacts.
  try {
    const { buildLabel } = await import("https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk/+esm");
    const item = buildLabel().plainText(detail).build();
    await OBR.scene.local.addItems([item]);  // local-only
  } catch {}
}

startBtn.onclick = async () => {
  if (running) return;
  running = true;
  if (!(await health(Number(portEl.value||17620)))) await scanPorts();
  since = since || 0;
  loop();
};
stopBtn.onclick = () => { running = false; try{ aborter?.abort(); }catch{} };
scanBtn.onclick = scanPorts;

// Start automatically when embedded in OBR
OBR.onReady(() => { if (autostartEl.checked) startBtn.click(); });
