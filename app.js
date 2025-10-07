// ================== Boxing for Fitness PWA (with Google Sheets sync) ==================
// Pricing & packs
const PRICING = {
  single: { label: 'Single $20', amount: 20, credits: 1 },
  '10':   { label: '10-Pack $180', amount: 180, credits: 10 },
  '20':   { label: '20-Pack $360', amount: 360, credits: 20 },
};

// Sessions timetable
const TIMETABLE = [
  { day: 'Monday',    times: ['6:00 AM', '9:30 AM', '5:00 PM', '6:30 PM'] },
  { day: 'Tuesday',   times: ['6:00 AM', '9:30 AM', '5:00 PM', '6:30 PM'] },
  { day: 'Wednesday', times: ['6:00 AM', '9:30 AM', '5:00 PM', '6:30 PM'] },
  { day: 'Thursday',  times: ['6:00 AM', '9:30 AM', '5:00 PM', '6:30 PM'] },
  { day: 'Friday',    times: ['6:00 AM', '9:30 AM'] },
  { day: 'Saturday',  times: ['8:00 AM', '9:30 AM'] },
];

// ================== Google Sheets Sync via Webhook ==================
// Requires settings.js with:
// const SETTINGS = { WEBHOOK_URL: ".../exec", SECRET: "your-secret" };
const SYNC_KEY = 'bff_pending_events_v1';

function getQueue() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '[]'); }
  catch { return []; }
}
function setQueue(q) { localStorage.setItem(SYNC_KEY, JSON.stringify(q)); }

function queueEvent(type, payload) {
  const ev = { type, payload, ts: Date.now() };
  const q = getQueue(); q.push(ev); setQueue(q);
  console.log('[BFF] queued event:', ev);
  flushQueue(); // try immediately
}

async function flushQueue() {
  try {
    if (!window.SETTINGS || !SETTINGS.WEBHOOK_URL || SETTINGS.WEBHOOK_URL.includes('PASTE_')) {
      // Not configured yet — keep events queued
      return;
    }
  } catch {
    // settings.js not loaded; keep queued
    return;
  }

  let q = getQueue();
  if (!q.length) return;

  // Send one-by-one to be robust and simple
  while (q.length) {
    const ev = q[0];
    try {
      const resp = await fetch(SETTINGS.WEBHOOK_URL, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ secret: SETTINGS.SECRET, ...ev })
      });
      const text = await resp.text();
      if (!resp.ok) {
        console.warn('[BFF] webhook error', resp.status, text);
        break; // stop, keep it queued
      }
      console.log('[BFF] webhook ok:', text);
      q.shift(); setQueue(q);
    } catch (err) {
      console.warn('[BFF] webhook network error, will retry later', err);
      break; // offline? will retry when back online
    }
  }
}
window.addEventListener('online', flushQueue);
window.addEventListener('load', () => setTimeout(flushQueue, 500));

// ================== Local DB (IndexedDB) ==================
const DB_NAME = 'robbies_gym_db_v1';
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      d.createObjectStore('members', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('payments', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}
async function openIfNeeded(){ if(!db) await openDB(); }

function tx(store, mode='readonly') { return db.transaction(store, mode).objectStore(store); }
function idbAdd(store, value)   { return new Promise((res, rej)=>{ const r=tx(store,'readwrite').add(value); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
function idbPut(store, value)   { return new Promise((res, rej)=>{ const r=tx(store,'readwrite').put(value); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
function idbGetAll(store)       { return new Promise((res, rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}
function idbGet(store, key)     { return new Promise((res, rej)=>{ const r=tx(store).get(key); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });}

// ================== UI Helpers ==================
const $  = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);
const toast = $('#toast');
function showToast(msg) { toast.textContent = msg; toast.style.display='block'; setTimeout(()=>toast.style.display='none', 1200); }

// Tabs
$$('nav button[data-tab]').forEach(btn => btn.addEventListener('click', () => {
  $$('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['checkin','members','payments','reports'].forEach(t => $('#tab-'+t).style.display='none');
  $('#tab-' + btn.dataset.tab).style.display = 'block';
  if (btn.dataset.tab === 'members')  refreshMembers();
  if (btn.dataset.tab === 'payments') refreshPayments();
  if (btn.dataset.tab === 'reports')  refreshReports();
}));

// Sessions grid
const sessionGrid = $('#sessionGrid');
let selectedSession = null;
function renderSessions() {
  sessionGrid.innerHTML = '';
  TIMETABLE.forEach(day => {
    day.times.forEach(time => {
      const div = document.createElement('div');
      div.className = 'session';
      div.innerHTML = `<div class="time">${time}</div><div class="tag">${day.day}</div>`;
      div.onclick = () => {
        selectedSession = `${day.day} ${time}`;
        $('#selectedSession').value = selectedSession;
      };
      sessionGrid.appendChild(div);
    });
  });
}

// Member datalist
async function refreshMemberDatalist() {
  const list = $('#memberList'); list.innerHTML='';
  const members = await idbGetAll('members');
  members.sort((a,b)=>a.name.localeCompare(b.name)).forEach(m => {
    const opt = document.createElement('option');
    opt.value = `${m.name} (${m.phone||''})`;
    opt.dataset.id = m.id;
    list.appendChild(opt);
  });
}

// Find member by input text
async function findMemberByInput(value) {
  const members = await idbGetAll('members');
  const trimmed = value.trim().toLowerCase();
  return members.find(m => (m.name + ' ' + (m.phone||'')).toLowerCase().includes(trimmed));
}

// ================== Members ==================
$('#addMember').addEventListener('click', async () => {
  const name = $('#mName').value.trim();
  if (!name) return alert('Name required');
  const phone = $('#mPhone').value.trim();
  const notes = $('#mNotes').value.trim();
  await openIfNeeded();
  const member = { name, phone, notes, credits: 1, createdAt: new Date().toISOString() };
  const id = await idbAdd('members', member);
  member.id = id; // include id for sheet row
  queueEvent('member_add', { member });
  $('#mName').value=''; $('#mPhone').value=''; $('#mNotes').value='';
  showToast('Member added (+1 free)');
  refreshMembers(); refreshMemberDatalist();
});

async function refreshMembers() {
  await openIfNeeded();
  const tbody = $('#memberTable tbody'); tbody.innerHTML='';
  const members = await idbGetAll('members');
  members.sort((a,b)=>a.name.localeCompare(b.name)).forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.name}</td><td>${m.phone||''}</td><td><span class="chip">${m.credits||0}</span></td>
      <td><button class="btn sm secondary" data-id="${m.id}">+1</button></td>`;
    tbody.appendChild(tr);
  });
  // quick +1
  tbody.querySelectorAll('button[data-id]').forEach(btn => btn.onclick = async () => {
    const id = Number(btn.dataset.id);
    const m = await idbGet('members', id); m.credits = (m.credits||0)+1; await idbPut('members', m);
    refreshMembers(); refreshMemberDatalist(); showToast('Credit added');
  });
}

// ================== Payments ==================
$('#addCredit').addEventListener('click', async () => {
  const val = $('#payMember').value;
  const m = await findMemberByInput(val);
  if (!m) return alert('Select a valid member');
  const pack = $('#payPack').value;
  const p = PRICING[pack];
  await openIfNeeded();
  m.credits = (m.credits||0) + p.credits;
  await idbPut('members', m);

  const record = {
    date: new Date().toISOString(),
    type: pack,
    amount: p.amount,
    credits: p.credits,
    memberId: m.id,
    memberName: m.name
  };
  await idbAdd('payments', record);
  queueEvent('payment', record);

  showToast('Payment applied');
  $('#payMember').value='';
  refreshPayments(); refreshMembers(); refreshMemberDatalist();
});

async function refreshPayments() {
  await openIfNeeded();
  const tbody = $('#txTable tbody'); tbody.innerHTML='';
  const txs = await idbGetAll('payments');
  txs.sort((a,b)=> new Date(b.date)-new Date(a.date)).forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(t.date).toLocaleString()}</td>
      <td>${PRICING[t.type]?.label || t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>`;
    tbody.appendChild(tr);
  });
}

// ================== Check-in / Attendance ==================
$('#confirmCheckin').addEventListener('click', async () => {
  if (!selectedSession) return alert('Please select a session');
  const val = $('#checkinMember').value;
  const m = await findMemberByInput(val);
  if (!m) return alert('Select a valid member');
  await openIfNeeded();

  if ((m.credits||0) <= 0) {
    if (confirm(`${m.name} has 0 credits. Add a Single ($20) and check in?`)) {
      m.credits = (m.credits||0) + PRICING.single.credits;
      await idbPut('members', m);
      const autoPay = {
        date: new Date().toISOString(),
        type: 'single',
        amount: PRICING.single.amount,
        credits: PRICING.single.credits,
        memberId: m.id,
        memberName: m.name
      };
      await idbAdd('payments', autoPay);
      queueEvent('payment', autoPay);
    } else {
      return;
    }
  }

  // Deduct one and log attendance
  m.credits = (m.credits||0) - 1;
  await idbPut('members', m);

  const att = {
    date: new Date().toISOString(),
    session: selectedSession,
    memberId: m.id,
    memberName: m.name
  };
  await idbAdd('attendance', att);
  queueEvent('attendance', att);

  $('#checkinMember').value='';
  showToast('Checked in');
  refreshMembers(); refreshReports(); refreshPayments();
});

// ================== Reports / Exports ==================
async function refreshReports() {
  await openIfNeeded();
  const tbody = $('#attTable tbody'); tbody.innerHTML='';
  const atts = await idbGetAll('attendance');
  atts.sort((a,b)=> new Date(b.date)-new Date(a.date)).slice(0,50).forEach(a => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(a.date).toLocaleString()}</td><td>${a.session}</td><td>${a.memberName}</td>`;
    tbody.appendChild(tr);
  });
  const today = new Date().toDateString();
  const todays = atts.filter(a => new Date(a.date).toDateString() === today);
  $('#todaySummary').textContent = todays.length ? `${todays.length} check-ins today.` : 'No check-ins today.';
}

// CSV export
function toCSV(rows) {
  return rows.map(r => r.map(x => '"' + String(x).replaceAll('"','""') + '"').join(',')).join('\n');
}
function download(name, text) {
  const blob = new Blob([text], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
$('#exportAttendance').addEventListener('click', async () => {
  const atts = await idbGetAll('attendance');
  const rows = [['date','session','memberId','memberName']];
  atts.sort((a,b)=> new Date(a.date)-new Date(b.date)).forEach(a=> rows.push([a.date,a.session,a.memberId,a.memberName]));
  download('attendance.csv', toCSV(rows));
});
$('#exportPayments').addEventListener('click', async () => {
  const txs = await idbGetAll('payments');
  const rows = [['date','type','memberId','memberName','amount','credits']];
  txs.sort((a,b)=> new Date(a.date)-new Date(b.date)).forEach(t=> rows.push([t.date,t.type,t.memberId,t.memberName,t.amount,t.credits]));
  download('payments.csv', toCSV(rows));
});

// ================== Init & Install prompt ==================
async function init() {
  await openIfNeeded();
  renderSessions();
  refreshMembers();
  refreshMemberDatalist();
  refreshPayments();
  refreshReports();
  // Try to flush any queued events on first load
  flushQueue();
}
init();

// Install prompt for non-iOS
let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  installBtn.textContent = 'Install';
});
installBtn.addEventListener('click', async () => {
  if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
});
