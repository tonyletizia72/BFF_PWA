/***********************
 * Boxing for Fitness – PWA client
 * - Uses settings.js (window.SETTINGS) for webhook URL + secret
 * - Falls back to embedded SETTINGS if settings.js is missing
 * - Sessions: fixed timetable (Mon–Sat) with hover/active highlighting
 * - Members: add / delete, +1 free credit on add
 * - Payments: single, 10-pack, 20-pack; posts to Google Apps Script
 * - Attendance: check-in deducts 1 credit (prompts to add if 0)
 * - Recent transactions kept locally (with Clear button)
 * - Perth time formatting on client for display (server logs Perth time too)
 ***********************/

(function ensureSettings() {
  if (typeof window.SETTINGS === "undefined") {
    window.SETTINGS = {
      WEBHOOK_URL:
        https://script.google.com/macros/s/AKfycbyI-9BNZT-FCeE8vq2eIHsnqvfdfepUkLWoP1Yw0qUbLW-2_6XmyTRPiaqE2PlU41-wJA/exec,
      SECRET: "BFF"
    };
    console.warn("[BFF] settings.js not found; using embedded fallback SETTINGS.");
  }
})();
console.log("[BFF] Active Webhook:", window.SETTINGS.WEBHOOK_URL);

/* ------------------ Utilities ------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORE_KEYS = {
  MEMBERS: "bff.members.v1",
  TX: "bff.tx.v1",
  SELECTED_SESSION: "bff.selectedSession.v1"
};

const PERTH_TZ = "Australia/Perth";
function perthNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: PERTH_TZ }));
}
function fmtPerth(dt = new Date()) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: PERTH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true
  }).format(dt);
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 1400);
}

/* ------------------ Local store ------------------ */

function loadMembers() {
  try { return JSON.parse(localStorage.getItem(STORE_KEYS.MEMBERS)) || []; }
  catch { return []; }
}
function saveMembers(list) {
  localStorage.setItem(STORE_KEYS.MEMBERS, JSON.stringify(list));
}
function loadTx() {
  try { return JSON.parse(localStorage.getItem(STORE_KEYS.TX)) || []; }
  catch { return []; }
}
function saveTx(list) {
  localStorage.setItem(STORE_KEYS.TX, JSON.stringify(list));
}

/* ------------------ Data & UI state ------------------ */

let MEMBERS = loadMembers();
let TX = loadTx();
let SELECTED_SESSION = localStorage.getItem(STORE_KEYS.SELECTED_SESSION) || "";

/* Session timetable — vertically aligned by day */
const SESSIONS = [
  { day: "Monday",     times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Tuesday",    times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Wednesday",  times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Thursday",   times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Friday",     times: ["6:00 AM","9:30 AM"] },
  { day: "Saturday",   times: ["8:00 AM","9:30 AM"] }
];

/* ------------------ Rendering ------------------ */

function navTo(tab) {
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["checkin","members","payments","reports"].forEach(k => {
    const sec = $("#tab-" + k);
    if (sec) sec.style.display = (k === tab) ? "" : "none";
  });
}

function renderSessions() {
  const wrap = $("#sessionGrid");
  if (!wrap) return;
  wrap.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "grid sessions-vertical";

  SESSIONS.forEach(col => {
    const colDiv = document.createElement("div");
    colDiv.className = "session-column cardish";
    const h = document.createElement("div");
    h.className = "day-title";
    h.textContent = col.day;
    colDiv.appendChild(h);

    col.times.forEach(t => {
      const btn = document.createElement("button");
      btn.className = "sessionBtn";
      btn.textContent = t;
      btn.title = `${col.day} ${t}`;
      const full = `${col.day} ${t}`;
      if (SELECTED_SESSION === full) btn.classList.add("active");
      btn.addEventListener("mouseenter", () => btn.classList.add("hover"));
      btn.addEventListener("mouseleave", () => btn.classList.remove("hover"));
      btn.addEventListener("click", () => {
        SELECTED_SESSION = full;
        localStorage.setItem(STORE_KEYS.SELECTED_SESSION, SELECTED_SESSION);
        $("#selectedSession").value = SELECTED_SESSION;
        $$(".sessionBtn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
      colDiv.appendChild(btn);
    });

    grid.appendChild(colDiv);
  });

  wrap.appendChild(grid);
  $("#selectedSession").value = SELECTED_SESSION || "";
}

function renderMemberDatalist() {
  const list = $("#memberList");
  if (!list) return;
  list.innerHTML = MEMBERS.map(m => (
    `<option value="${m.name} (${m.phone || ""})">`
  )).join("");
}

function renderMemberTable() {
  const tbody = $("#memberTable tbody");
  if (!tbody) return;
  tbody.innerHTML = MEMBERS.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>${m.phone || ""}</td>
      <td><span class="chip">${m.credits || 0}</span></td>
      <td class="row" style="gap:8px;justify-content:flex-end">
        <button class="btn sm secondary" data-email="${m.email || ""}" data-member="${m.id}">Email</button>
        <button class="btn sm ghost" data-del="${m.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  // bind delete / email
  $$('button[data-del]').forEach(b => b.onclick = () => deleteMember(b.dataset.del));
  $$('button[data-email]').forEach(b => b.onclick = () => {
    const id = b.dataset.member;
    const m = MEMBERS.find(x => String(x.id) === String(id));
    if (!m || !m.email) return toast("No email saved for this member.");
    window.location.href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent("Boxing for Fitness")}`;
  });
}

function renderPaymentsTable() {
  const tbody = $("#txTable tbody");
  if (!tbody) return;
  tbody.innerHTML = TX.map(t => `
    <tr>
      <td>${fmtPerth(new Date(t.ts))}</td>
      <td>${t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>
    </tr>
  `).join("");
}

/* ------------------ Member ops ------------------ */

function addMember() {
  const name = $("#mName").value.trim();
  const phone = $("#mPhone").value.trim();
  const notes = $("#mNotes").value.trim();
  if (!name) return toast("Name is required.");

  const member = {
    id: Date.now(),
    name, phone, notes,
    email: "", // can be set later via CSV import if needed
    credits: 1, // first class free
    createdAt: new Date().toISOString()
  };
  MEMBERS.push(member);
  saveMembers(MEMBERS);
  renderMemberDatalist();
  renderMemberTable();
  toast("Member added (+1 free).");

  // Post to server (member_add)
  queueEvent("member_add", { member });
}

function deleteMember(id) {
  const m = MEMBERS.find(x => String(x.id) === String(id));
  if (!m) return;
  if (!confirm(`Delete ${m.name}?`)) return;

  MEMBERS = MEMBERS.filter(x => String(x.id) !== String(id));
  saveMembers(MEMBERS);
  renderMemberDatalist();
  renderMemberTable();
  toast("Member deleted.");

  queueEvent("member_delete", { memberId: m.id, memberName: m.name });
}

/* ------------------ Payments ------------------ */

function packToCreditsAmount(val) {
  switch (val) {
    case "single": return { credits: 1, amount: 20, label: "Single $20" };
    case "10":     return { credits: 10, amount: 180, label: "10-Pack $180" };
    case "20":     return { credits: 20, amount: 360, label: "20-Pack $360" };
    default:       return { credits: 0, amount: 0, label: "" };
  }
}

function applyPayment() {
  const memberNameInput = $("#payMember").value.trim();
  const packSel = $("#payPack").value;
  const { credits, amount, label } = packToCreditsAmount(packSel);

  const m = resolveMemberByInput(memberNameInput);
  if (!m) return alert("Select a valid member.");

  m.credits = (m.credits || 0) + credits;
  saveMembers(MEMBERS);
  renderMemberTable();

  const tx = {
    ts: new Date().toISOString(),
    type: label,
    memberId: m.id,
    memberName: m.name,
    amount,
    credits
  };
  TX.unshift(tx);
  saveTx(TX);
  renderPaymentsTable();

  queueEvent("payment", {
    type: label,
    memberId: m.id,
    memberName: m.name,
    amount,
    credits,
    memberEmail: m.email || ""
  });

  toast("Payment applied.");
}

function clearTransactions() {
  if (!confirm("Clear recent transactions (local only)?")) return;
  TX = [];
  saveTx(TX);
  renderPaymentsTable();
  toast("Cleared.");
}

/* ------------------ Check-in ------------------ */

function resolveMemberByInput(input) {
  // input looks like "Name (phone)"; try to match by name prefix or phone
  const s = input.toLowerCase();
  let m = MEMBERS.find(x =>
    x.name.toLowerCase() === s || s.startsWith(x.name.toLowerCase())
  );
  if (!m) {
    // pull phone between parentheses
    const match = /\(([^)]+)\)$/.exec(input);
    if (match) {
      const ph = match[1].replace(/\s+/g,"");
      m = MEMBERS.find(x => (x.phone||"").replace(/\s+/g,"") === ph);
    }
  }
  return m;
}

function confirmCheckin() {
  const memberInput = $("#checkinMember").value.trim();
  if (!memberInput) return toast("Select a member.");
  if (!SELECTED_SESSION) return toast("Select a session.");

  const m = resolveMemberByInput(memberInput);
  if (!m) return toast("Select a valid member.");

  if ((m.credits || 0) <= 0) {
    if (!confirm(`${m.name} has 0 credits. Add a single class ($20) now?`)) return;
    // simulate a single purchase
    $("#payMember").value = `${m.name} (${m.phone || ""})`;
    $("#payPack").value = "single";
    applyPayment();
    return;
  }

  // deduct one credit
  m.credits = (m.credits || 0) - 1;
  saveMembers(MEMBERS);
  renderMemberTable();

  queueEvent("attendance", {
    session: SELECTED_SESSION,
    memberId: m.id,
    memberName: m.name
  });

  toast("Checked in.");
}

/* ------------------ Server sync ------------------ */

async function queueEvent(type, payload) {
  // Post directly (no background queue needed)
  try {
    const res = await fetch(window.SETTINGS.WEBHOOK_URL, {
      method: "POST",
      // text/plain to avoid CORS preflight
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        secret: window.SETTINGS.SECRET,
        type,
        payload
      })
    });
    const txt = await res.text();
    if (txt !== "OK") console.warn("[BFF] Webhook non-OK:", txt);
  } catch (err) {
    console.error("[BFF] Webhook error:", err);
    alert("Network error sending to Sheets. Data is safe locally; try again later.");
  }
}

/* ------------------ Wire up ------------------ */

function bindNav() {
  $$("nav button").forEach(b => {
    b.onclick = () => navTo(b.dataset.tab);
  });
}

function bindForms() {
  const addBtn = $("#addMember");
  if (addBtn) addBtn.onclick = addMember;

  const payBtn = $("#addCredit");
  if (payBtn) payBtn.onclick = applyPayment;

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn ghost sm";
  clearBtn.textContent = "Clear Recent";
  clearBtn.style.marginLeft = "8px";
  const payPanel = $("#tab-payments .row");
  if (payPanel) {
    payPanel.appendChild(clearBtn);
    clearBtn.onclick = clearTransactions;
  }

  const checkinBtn = $("#confirmCheckin");
  if (checkinBtn) checkinBtn.onclick = confirmCheckin;
}

/* ------------------ Init ------------------ */

function init() {
  // Tabs
  bindNav();
  navTo("checkin");

  // Sessions
  renderSessions();

  // Members + payments
  renderMemberDatalist();
  renderMemberTable();
  renderPaymentsTable();

  // Forms/events
  bindForms();

  // Set defaults
  if (!SELECTED_SESSION) {
    SELECTED_SESSION = "Monday 6:00 AM";
    localStorage.setItem(STORE_KEYS.SELECTED_SESSION, SELECTED_SESSION);
    $("#selectedSession").value = SELECTED_SESSION;
  }
}

document.addEventListener("DOMContentLoaded", init);

/* ------------------ Styling helpers injected for hover ------------------ */
const style = document.createElement("style");
style.textContent = `
  .sessions-vertical {
    display: grid;
    grid-template-columns: repeat(6, minmax(150px, 1fr));
    gap: 16px;
  }
  .session-column { padding: 12px; border:1px solid var(--line); border-radius:12px; background:#111217; }
  .day-title { font-weight: 700; margin-bottom: 8px; color:#e5e7eb }
  .sessionBtn {
    width: 100%;
    margin: 6px 0;
    border:1px solid var(--line);
    background:#0e0f12;
    color: var(--text);
    border-radius:10px;
    padding:10px 12px;
    cursor:pointer;
    transition: transform .06s ease, background .1s ease, border-color .1s ease;
  }
  .sessionBtn.hover { background:#161821; border-color:#2f3240; transform: translateY(-1px); }
  .sessionBtn.active { background: var(--accent); color: white; border-color: var(--accent); }
  .cardish { box-shadow: var(--shadow); }
`;
document.head.appendChild(style);
