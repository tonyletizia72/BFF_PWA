/*************************************************
 * Boxing for Fitness — Auto-sync Edition (v2.3)
 *************************************************/

(function ensureSettings() {
  if (typeof window.SETTINGS === "undefined") {
    window.SETTINGS = {
      WEBHOOK_URL:
        "https://script.google.com/macros/s/AKfycbxd7Do-Rqa_Lfp4LZNQlUZRqCVn2hOHTygm87HNkds5BSZw9953s-2OQV7hnHumZfIXGQ/exec",
      SECRET: "BFF",
    };
  }
})();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const KEYS = {
  MEMBERS: "bff.members.v1",
  TX: "bff.tx.v1",
  SELECTED: "bff.selectedSession.v1",
};

const load = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const PERTH_TZ = "Australia/Perth";
const fmtPerth = (d = new Date()) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: PERTH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true
  }).format(new Date(d));

let MEMBERS = load(KEYS.MEMBERS, []);
let TX = load(KEYS.TX, []);
let SELECTED_SESSION = localStorage.getItem(KEYS.SELECTED) || "";

const SESSIONS = [
  { day: "Monday", times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Tuesday", times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Wednesday", times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Thursday", times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Friday", times: ["6:00 AM","9:30 AM"] },
  { day: "Saturday", times: ["8:00 AM","9:30 AM"] },
];

/* Toast */
function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 1400);
}

/* NAV */
function navTo(tab) {
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["checkin","members","payments","reports"].forEach(k => {
    const s = $("#tab-" + k);
    if (s) s.style.display = (k === tab) ? "" : "none";
  });
}

/* RENDERING */
function renderSessions() {
  const grid = $("#sessionGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "sessions-vertical";
  SESSIONS.forEach(col => {
    const colDiv = document.createElement("div");
    colDiv.className = "session-column cardish";
    const title = document.createElement("div");
    title.className = "day-title";
    title.textContent = col.day;
    colDiv.appendChild(title);
    col.times.forEach(t => {
      const btn = document.createElement("button");
      btn.className = "sessionBtn";
      btn.textContent = t;
      const full = `${col.day} ${t}`;
      if (SELECTED_SESSION === full) btn.classList.add("active");
      btn.onmouseenter = () => btn.classList.add("hover");
      btn.onmouseleave = () => btn.classList.remove("hover");
      btn.onclick = () => {
        SELECTED_SESSION = full;
        localStorage.setItem(KEYS.SELECTED, full);
        $("#selectedSession").value = full;
        $$(".sessionBtn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      };
      colDiv.appendChild(btn);
    });
    wrap.appendChild(colDiv);
  });
  grid.appendChild(wrap);
  $("#selectedSession").value = SELECTED_SESSION || "";
}

function renderMemberDatalist() {
  const d = $("#memberList");
  if (d) d.innerHTML = MEMBERS.map(m => `<option value="${m.name} (${m.phone||""})">`).join("");
}
function renderMemberTable() {
  const tb = $("#memberTable tbody");
  if (!tb) return;
  tb.innerHTML = MEMBERS.map(m => `
    <tr><td>${m.name}</td><td>${m.phone||""}</td><td><span class="chip">${m.credits||0}</span></td></tr>
  `).join("");
}
function renderPaymentsTable() {
  const tb = $("#txTable tbody");
  if (!tb) return;
  tb.innerHTML = TX.map(t => `
    <tr><td>${t.date||fmtPerth(t.ts)}</td><td>${t.type}</td><td>${t.memberName}</td><td>$${t.amount}</td><td>${t.credits}</td></tr>
  `).join("");
}

/* SYNC */
async function loadFromSheets() {
  try {
    const res = await fetch(window.SETTINGS.WEBHOOK_URL);
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    if (json.members?.length) {
      MEMBERS = json.members.map(m => ({
        id: m.id, name: m.name, phone: m.phone, email: m.email,
        notes: m.notes, credits: m.credits || 0
      }));
      save(KEYS.MEMBERS, MEMBERS);
    }
    if (json.payments?.length) {
      TX = json.payments.map(p => ({
        date: p.date, type: p.type, memberName: p.memberName,
        amount: p.amount, credits: p.credits
      }));
      save(KEYS.TX, TX);
    }
    renderMemberDatalist();
    renderMemberTable();
    renderPaymentsTable();
    console.log(`[BFF] Auto-synced ${MEMBERS.length} members, ${TX.length} payments`);
  } catch (err) {
    console.error("[BFF] Sync error:", err);
    toast("Offline mode — using saved data");
  }
}

/* INIT */
function init() {
  navTo("checkin");
  renderSessions();
  renderMemberDatalist();
  renderMemberTable();
  renderPaymentsTable();
  loadFromSheets(); // Auto-sync
}
document.addEventListener("DOMContentLoaded", init);

/* STYLES */
const style = document.createElement("style");
style.textContent = `
  .sessions-vertical { display:grid; grid-template-columns:repeat(6,minmax(150px,1fr)); gap:16px; }
  .session-column { padding:12px; border:1px solid var(--line); border-radius:12px; background:#111217; }
  .day-title { font-weight:700; margin-bottom:8px; color:#e5e7eb }
  .sessionBtn { width:100%; margin:6px 0; border:1px solid var(--line);
    background:#0e0f12; color:var(--text); border-radius:10px;
    padding:10px 12px; cursor:pointer;
    transition: transform .06s ease, background .1s ease, border-color .1s ease; }
  .sessionBtn.hover { background:#161821; border-color:#2f3240; transform:translateY(-1px); }
  .sessionBtn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .cardish { box-shadow:var(--shadow); }
`;
document.head.appendChild(style);
