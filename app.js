/*************************************************
 * Boxing for Fitness — PWA client
 * - Uses settings.js for WEBHOOK_URL + SECRET
 * - Members: add (+1 free), delete
 * - Payments: single/10/20 packs
 * - Check-in: deducts 1 credit; prompts to add if 0
 * - Sessions: vertical columns by day w/ hover + active
 * - Recent transactions: local list + Clear button
 * - Perth-time display client-side
 *************************************************/

(function ensureSettings() {
  if (typeof window.SETTINGS === "undefined") {
    window.SETTINGS = {
      WEBHOOK_URL:
        "https://script.google.com/macros/s/AKfycbxd7Do-Rqa_Lfp4LZNQlUZRqCVn2hOHTygm87HNkds5BSZw9953s-2OQV7hnHumZfIXGQ/exec",
      SECRET: "BFF",
    };
    console.warn("[BFF] settings.js missing; using embedded fallback.");
  }
})();
console.log("[BFF] Webhook:", window.SETTINGS.WEBHOOK_URL);

/* ------------------ DOM helpers ------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------ Local store ------------------ */
const KEYS = {
  MEMBERS: "bff.members.v1",
  TX: "bff.tx.v1",
  SELECTED: "bff.selectedSession.v1",
};
const load = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

/* ------------------ Time helpers ------------------ */
const PERTH_TZ = "Australia/Perth";
const fmtPerth = (d = new Date()) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: PERTH_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true
  }).format(new Date(d));

/* ------------------ Data ------------------ */
let MEMBERS = load(KEYS.MEMBERS, []);
let TX = load(KEYS.TX, []);
let SELECTED_SESSION = localStorage.getItem(KEYS.SELECTED) || "";

const SESSIONS = [
  { day: "Monday",     times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Tuesday",    times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Wednesday",  times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Thursday",   times: ["6:00 AM","9:30 AM","5:00 PM","6:30 PM"] },
  { day: "Friday",     times: ["6:00 AM","9:30 AM"] },
  { day: "Saturday",   times: ["8:00 AM","9:30 AM"] },
];

/* ------------------ UI helpers ------------------ */
function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 1400);
}
function navTo(tab) {
  $$("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["checkin","members","payments","reports"].forEach(k => {
    const s = $("#tab-" + k);
    if (s) s.style.display = (k === tab) ? "" : "none";
  });
}

/* ------------------ Render ------------------ */
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
      btn.addEventListener("mouseenter", () => btn.classList.add("hover"));
      btn.addEventListener("mouseleave", () => btn.classList.remove("hover"));
      btn.addEventListener("click", () => {
        SELECTED_SESSION = full;
        localStorage.setItem(KEYS.SELECTED, SELECTED_SESSION);
        $("#selectedSession").value = SELECTED_SESSION;
        $$(".sessionBtn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
      colDiv.appendChild(btn);
    });

    wrap.appendChild(colDiv);
  });

  grid.appendChild(wrap);
  $("#selectedSession").value = SELECTED_SESSION || "";
}

function renderMemberDatalist() {
  const d = $("#memberList");
  if (!d) return;
  d.innerHTML = MEMBERS.map(m => `<option value="${m.name} (${m.phone||""})">`).join("");
}
function renderMemberTable() {
  const tb = $("#memberTable tbody");
  if (!tb) return;
  tb.innerHTML = MEMBERS.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>${m.phone||""}</td>
      <td><span class="chip">${m.credits||0}</span></td>
      <td class="row" style="gap:8px;justify-content:flex-end">
        <button class="btn sm secondary" data-email="${m.email||""}" data-id="${m.id}">Email</button>
        <button class="btn sm ghost" data-del="${m.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  $$('button[data-del]').forEach(b => b.onclick = () => deleteMember(b.dataset.del));
  $$('button[data-email]').forEach(b => b.onclick = () => {
    const m = MEMBERS.find(x => String(x.id) === String(b.dataset.id));
    if (!m || !m.email) return toast("No email saved for this member.");
    window.location.href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent("Boxing for Fitness")}`;
  });
}
function renderPaymentsTable() {
  const tb = $("#txTable tbody");
  if (!tb) return;
  tb.innerHTML = TX.map(t => `
    <tr>
      <td>${fmtPerth(t.ts)}</td>
      <td>${t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>
    </tr>
  `).join("");
}

/* ------------------ Members ------------------ */
function addMember() {
  const name = $("#mName").value.trim();
  const phone = $("#mPhone").value.trim();
  const email = $("#mEmail") ? $("#mEmail").value.trim() : "";
  const notes = $("#mNotes").value.trim();
  if (!name) return toast("Name is required.");

  const m = {
    id: Date.now(),
    name, phone, email, notes,
    credits: 1, // first class free
    createdAt: new Date().toISOString()
  };
  MEMBERS.push(m); save(KEYS.MEMBERS, MEMBERS);
  renderMemberDatalist(); renderMemberTable();
  toast("Member added (+1 free).");

  sendToServer("member", {
    memberId: m.id,
    memberName: m.name,
    memberPhone: m.phone,
    memberEmail: m.email,
    notes: m.notes,
    credits: m.credits
  });
}
function deleteMember(id) {
  const m = MEMBERS.find(x => String(x.id) === String(id));
  if (!m) return;
  if (!confirm(`Delete ${m.name}?`)) return;
  MEMBERS = MEMBERS.filter(x => String(x.id) !== String(id));
  save(KEYS.MEMBERS, MEMBERS);
  renderMemberDatalist(); renderMemberTable();
  toast("Member deleted.");
}

/* ------------------ Payments ------------------ */
function packInfo(v) {
  switch (v) {
    case "single": return { credits: 1, amount: 20, label: "Single $20" };
    case "10":     return { credits: 10, amount: 180, label: "10-Pack $180" };
    case "20":     return { credits: 20, amount: 360, label: "20-Pack $360" };
    default:       return { credits: 0, amount: 0,  label: "" };
  }
}
function resolveInputMember(input) {
  const s = input.toLowerCase();
  let m = MEMBERS.find(x => s.startsWith(x.name.toLowerCase()));
  if (!m) {
    const match = /\(([^)]+)\)$/.exec(input);
    if (match) {
      const ph = match[1].replace(/\s+/g,"");
      m = MEMBERS.find(x => (x.phone||"").replace(/\s+/g,"") === ph);
    }
  }
  return m;
}
function applyPayment() {
  const input = $("#payMember").value.trim();
  const pack = $("#payPack").value;
  const info = packInfo(pack);
  const m = resolveInputMember(input);
  if (!m) return alert("Select a valid member.");

  m.credits = (m.credits||0) + info.credits;
  save(KEYS.MEMBERS, MEMBERS);
  renderMemberTable();

  const tx = {
    ts: new Date(),
    type: info.label,
    memberId: m.id,
    memberName: m.name,
    amount: info.amount,
    credits: info.credits
  };
  TX.unshift(tx); save(KEYS.TX, TX);
  renderPaymentsTable();

  sendToServer("payment", {
    type: info.label,
    memberId: m.id,
    memberName: m.name,
    amount: info.amount,
    credits: info.credits
  });

  toast("Payment applied.");
}
function clearTransactions() {
  if (!confirm("Clear recent transactions (local only)?")) return;
  TX = []; save(KEYS.TX, TX); renderPaymentsTable();
  toast("Cleared.");
}

/* ------------------ Check-in ------------------ */
function confirmCheckin() {
  const input = $("#checkinMember").value.trim();
  if (!input) return toast("Select a member.");
  if (!SELECTED_SESSION) return toast("Select a session.");

  const m = resolveInputMember(input);
  if (!m) return toast("Select a valid member.");

  if ((m.credits||0) <= 0) {
    if (!confirm(`${m.name} has 0 credits. Add a single class ($20) now?`)) return;
    $("#payMember").value = `${m.name} (${m.phone||""})`;
    $("#payPack").value = "single";
    applyPayment(); // will post, update, and render
    return;
  }
  // deduct one
  m.credits = (m.credits||0) - 1;
  save(KEYS.MEMBERS, MEMBERS);
  renderMemberTable();

  sendToServer("attendance", {
    session: SELECTED_SESSION,
    memberId: m.id,
    memberName: m.name
  });

  toast("Checked in.");
}

/* ------------------ Server ------------------ */
async function sendToServer(type, payload) {
  try {
    const res = await fetch(window.SETTINGS.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid CORS preflight
      body: JSON.stringify({ secret: window.SETTINGS.SECRET, type, payload })
    });
    const txt = await res.text();
    if (!res.ok || txt !== "OK") {
      console.warn("[BFF] Webhook non-OK:", res.status, txt);
      alert("Network error sending to Sheets. Data is safe locally; try again later.");
    }
  } catch (err) {
    console.error("[BFF] Webhook error:", err);
    alert("Network error sending to Sheets. Data is safe locally; try again later.");
  }
}

/* ------------------ Wiring ------------------ */
function bindNav() {
  $$("nav button").forEach(b => b.onclick = () => navTo(b.dataset.tab));
}
function bindForms() {
  const add = $("#addMember"); if (add) add.onclick = addMember;
  const pay = $("#addCredit"); if (pay) pay.onclick = applyPayment;
  const chk = $("#confirmCheckin"); if (chk) chk.onclick = confirmCheckin;

  // Add “Clear Recent” to payments
  const row = $("#tab-payments .row");
  if (row) {
    const clear = document.createElement("button");
    clear.className = "btn ghost sm";
    clear.textContent = "Clear Recent";
    clear.style.marginLeft = "8px";
    clear.onclick = clearTransactions;
    row.appendChild(clear);
  }
}

/* ------------------ Init ------------------ */
function init() {
  bindNav(); navTo("checkin");
  renderSessions();
  renderMemberDatalist();
  renderMemberTable();
  renderPaymentsTable();
  bindForms();

  if (!SELECTED_SESSION) {
    SELECTED_SESSION = "Monday 6:00 AM";
    localStorage.setItem(KEYS.SELECTED, SELECTED_SESSION);
  }
  $("#selectedSession").value = SELECTED_SESSION;
}

document.addEventListener("DOMContentLoaded", init);

/* ------------------ Inject hover/active styles ------------------ */
const style = document.createElement("style");
style.textContent = `
  .sessions-vertical { display:grid; grid-template-columns:repeat(6, minmax(150px,1fr)); gap:16px; }
  .session-column { padding:12px; border:1px solid var(--line); border-radius:12px; background:#111217; }
  .day-title { font-weight:700; margin-bottom:8px; color:#e5e7eb }
  .sessionBtn {
    width:100%; margin:6px 0; border:1px solid var(--line);
    background:#0e0f12; color:var(--text); border-radius:10px;
    padding:10px 12px; cursor:pointer;
    transition: transform .06s ease, background .1s ease, border-color .1s ease;
  }
  .sessionBtn.hover { background:#161821; border-color:#2f3240; transform:translateY(-1px); }
  .sessionBtn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .cardish { box-shadow: var(--shadow); }
`;
document.head.appendChild(style);
