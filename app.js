// app.js — Boxing for Fitness (PWA admin app)
// - Sheets sync with no-cors (Apps Script)
// - Members + email contact
// - Payments (flat payload) + Recent Transactions
// - Attendance + simple reports
// - Session cards with hover + active highlight

// ----- SETTINGS FALLBACK (if settings.js isn't present) -----
(function ensureSettings(){
  if (typeof window.SETTINGS === 'undefined') {
    window.SETTINGS = {
      WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbyg9eeOxCnSvfFvwY7Jyp9HihRyq-ky6cALWzvC8Y104orJdAUofh1PPEdd5kez9m6D3Q/exec",
      SECRET: "BFF"
    };
    console.warn('[BFF] settings.js not found; using embedded fallback SETTINGS.');
  }
})();

// ----- PRICING / TIMETABLE -----
const PRICING = {
  single: { label: 'Single $20', amount: 20, credits: 1 },
  '10':   { label: '10-Pack $180', amount: 180, credits: 10 },
  '20':   { label: '20-Pack $360', amount: 360, credits: 20 },
};

// Use your attached timetable; feel free to tweak times/days.
const TIMETABLE = [
  { day: 'Monday',    times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Tuesday',   times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Wednesday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Thursday',  times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Friday',    times: ['6:00 AM','9:30 AM'] },
  { day: 'Saturday',  times: ['8:00 AM','9:30 AM'] },
];

// ----- LOCAL STORAGE HELPERS -----
const LS = {
  queue: 'bff_queue',
  members: 'bff_members',
  payments: 'bff_payments',
  attendance: 'bff_att',
};
const read  = (k, d=[]) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
const write = (k, v)   => localStorage.setItem(k, JSON.stringify(v));

// ----- QUEUE → GOOGLE SHEETS (no CORS preflight) -----
async function queueEvent(ev){
  const q = read(LS.queue); q.push(ev); write(LS.queue,q);
  await flushQueue();
}
async function flushQueue(){
  let q = read(LS.queue); if(!q.length) return;
  while(q.length){
    const ev = q[0];
    try{
      await fetch(SETTINGS.WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // avoids preflight; response will be opaque
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: SETTINGS.SECRET, ...ev })
      });
      q.shift(); write(LS.queue,q);
    }catch(err){
      console.warn('[BFF] webhook send failed; will retry later', err);
      break;
    }
  }
}
window.addEventListener('online', flushQueue);

// ----- DOM SHORTCUTS -----
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const toast = $('#toast');
function showToast(msg){ if(!toast) return; toast.textContent=msg; toast.style.display='block'; setTimeout(()=>toast.style.display='none',1600); }

// ----- TABS -----
$$('nav button[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('nav button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['checkin','members','payments','reports'].forEach(t=>$('#tab-'+t).style.display='none');
    $('#tab-'+btn.dataset.tab).style.display='block';
    if(btn.dataset.tab==='members')  renderMembers();
    if(btn.dataset.tab==='payments') refreshPayments();
    if(btn.dataset.tab==='reports')  refreshReports();
  });
});

// ----- SESSIONS (cards with hover + active) -----
const sessionGrid = $('#sessionGrid');
let selectedSession = '';
let selectedSessionEl = null;

function renderSessions() {
  if (!sessionGrid) return;
  sessionGrid.innerHTML = '';

  // Render as simple session cards (fits your index.css styles)
  TIMETABLE.forEach(col => {
    col.times.forEach(t => {
      const card = document.createElement('div');
      card.className = 'session';
      card.setAttribute('role','button');
      card.setAttribute('tabindex','0');
      card.innerHTML = `
        <div class="time">${t}</div>
        <div>${col.day}</div>
      `;
      const activate = () => {
        if (selectedSessionEl) selectedSessionEl.classList.remove('active');
        card.classList.add('active');
        selectedSessionEl = card;
        selectedSession = `${col.day} ${t}`;
        const sel = $('#selectedSession'); if (sel) sel.value = selectedSession;
      };
      card.onclick = activate;
      card.onkeydown = (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); activate(); } };
      sessionGrid.appendChild(card);
    });
  });

  // Preselect first
  const first = sessionGrid.querySelector('.session');
  if (first) first.click();
}

// ----- MEMBERS -----
function getMembers(){ return read(LS.members); }
function setMembers(v){ write(LS.members,v); }

$('#addMember')?.addEventListener('click', async ()=>{
  const name  = $('#mName')?.value.trim(); if(!name) return alert('Name required');
  const phone = $('#mPhone')?.value.trim() || '';
  const email = $('#mEmail')?.value.trim() || '';
  const notes = $('#mNotes')?.value.trim() || '';

  const members = getMembers();
  const id = Date.now();
  const member = { id, name, phone, email, notes, credits: 1, createdAt: new Date().toISOString() };
  members.push(member); setMembers(members);

  await queueEvent({ type:'member_add', payload:{ member } });

  // clear form
  if($('#mName'))  $('#mName').value='';
  if($('#mPhone')) $('#mPhone').value='';
  if($('#mEmail')) $('#mEmail').value='';
  if($('#mNotes')) $('#mNotes').value='';
  renderMembers(); showToast('Member added (+1 free)');
});

function renderMembers(){
  const tbody = $('#memberTable tbody'); if(!tbody) return;
  tbody.innerHTML = '';
  const members = getMembers().sort((a,b)=>a.name.localeCompare(b.name));

  members.forEach((m, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.name}</td>
      <td>${m.phone || ''}</td>
      <td>${m.email || ''}</td>
      <td><span class="chip">${m.credits || 0}</span></td>
      <td style="display:flex;gap:8px;">
        <button class="btn sm secondary" data-action="plus1" data-id="${m.id}">+1</button>
        <button class="btn sm ghost" data-action="delete" data-id="${m.id}">🗑️</button>
      </td>
      <td>
        ${m.email ? `<button class="btn sm ghost contactMember" data-email="${m.email}" data-name="${m.name}">✉️ Contact</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });

  // +1 credit quick button
  tbody.querySelectorAll('button[data-action="plus1"]').forEach(b=>{
    b.onclick = ()=>{
      const id = Number(b.dataset.id);
      const ms = getMembers();
      const m = ms.find(x=>x.id===id); if(!m) return;
      m.credits = (m.credits||0) + 1;
      setMembers(ms); renderMembers(); showToast('Credit added');
    };
  });

  // delete member
  tbody.querySelectorAll('button[data-action="delete"]').forEach(b=>{
    b.onclick = async ()=>{
      const id = Number(b.dataset.id);
      const ms = getMembers();
      const m  = ms.find(x=>x.id===id); if(!m) return;
      if(!confirm(`Delete ${m.name}? Payments/attendance remain in the sheet.`)) return;
      setMembers(ms.filter(x=>x.id!==id));
      renderMembers(); showToast('Member deleted');
      await queueEvent({ type:'member_delete', payload:{ memberId:id, memberName:m.name }});
    };
  });

  // contact (mailto)
  tbody.querySelectorAll('.contactMember').forEach(btn=>{
    btn.onclick = (e)=>{
      const email = btn.dataset.email;
      const name  = btn.dataset.name || '';
      const subject = encodeURIComponent('Boxing for Fitness – Message');
      const body    = encodeURIComponent(`Hi ${name},\n\n`);
      window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    };
  });

  // datalist for search fields
  const dl = $('#memberList');
  if (dl) {
    dl.innerHTML = members.map(m => `<option value="${m.name} (${m.phone||''})"></option>`).join('');
  }
}

// ----- PAYMENTS -----
function getPayments(){ return read(LS.payments); }
function setPayments(v){ write(LS.payments,v); }

$('#addCredit')?.addEventListener('click', async ()=>{
  const input = $('#payMember')?.value.trim();
  const pack  = $('#payPack')?.value;
  if (!input || !pack) return;

  const members = getMembers();
  const m = members.find(x => input.includes(x.name));
  if (!m) return alert('Select a valid member');

  const p = PRICING[pack];
  m.credits = (m.credits||0) + p.credits;
  setMembers(members); renderMembers();

  // local record (flat payload)
  const rec = {
    date: new Date().toISOString(),
    type: pack, // 'single' | '10' | '20'
    memberId: m.id,
    memberName: m.name,
    amount: p.amount,
    credits: p.credits,
    memberEmail: m.email || ''
  };
  const txs = getPayments(); txs.unshift(rec); setPayments(txs);

  // send to Sheets
  await queueEvent({ type:'payment', payload: rec });

  if ($('#payMember')) $('#payMember').value='';
  showToast('Payment applied');
  refreshPayments();
  refreshReports();
});

function refreshPayments(){
  const tb = $('#txTable tbody'); if(!tb) return;
  tb.innerHTML = '';
  const txs = getPayments();
  txs.forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(t.date).toLocaleString()}</td>
      <td>${PRICING[t.type]?.label || t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>`;
    tb.appendChild(tr);
  });
}

// ----- ATTENDANCE / CHECK-IN -----
function getAttendance(){ return read(LS.attendance); }
function setAttendance(v){ write(LS.attendance,v); }

$('#confirmCheckin')?.addEventListener('click', async ()=>{
  if (!selectedSession) return alert('Select a session');
  const input = $('#checkinMember')?.value.trim();
  const members = getMembers();
  const m = members.find(x => input && input.includes(x.name));
  if (!m) return alert('Select a valid member');

  // If no credits, offer quick single purchase then proceed
  if ((m.credits||0) <= 0) {
    if (confirm(`${m.name} has 0 credits. Add a Single ($20) and check in?`)) {
      m.credits = (m.credits||0) + 1;
      const rec = {
        date: new Date().toISOString(),
        type: 'single',
        memberId: m.id,
        memberName: m.name,
        amount: 20,
        credits: 1,
        memberEmail: m.email || ''
      };
      const txs = getPayments(); txs.unshift(rec); setPayments(txs);
      await queueEvent({ type: 'payment', payload: rec });
    } else {
      return;
    }
  }

  // Deduct and record attendance
  m.credits -= 1;
  setMembers(members); renderMembers();

  const att = { date:new Date().toISOString(), session:selectedSession, memberId:m.id, memberName:m.name };
  const atts = getAttendance(); atts.unshift(att); setAttendance(atts);
  await queueEvent({ type:'attendance', payload: att });

  if ($('#checkinMember')) $('#checkinMember').value='';
  showToast('Checked in');
  refreshReports();
});

// ----- REPORTS -----
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; }
function inSameWeek(a,b){ return startOfWeek(a).getTime()===startOfWeek(b).getTime(); }

function refreshReports(){
  // Today summary
  const atts = getAttendance();
  const today = new Date().toDateString();
  const todays = atts.filter(a => new Date(a.date).toDateString() === today);
  if ($('#todaySummary')) $('#todaySummary').textContent = todays.length ? `${todays.length} check-ins today.` : 'No check-ins today.';

  // (You can add weekly summary here later if desired)
}

// ----- CSV EXPORTS -----
function toCSV(rows){return rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');}
function download(n,t){const b=new Blob([t],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();URL.revokeObjectURL(a.href);}
$('#exportAttendance')?.addEventListener('click',()=>{
  const a=getAttendance(); const rows=[['date','session','memberId','memberName']]; a.forEach(x=>rows.push([x.date,x.session,x.memberId,x.memberName])); download('attendance.csv',toCSV(rows));
});
$('#exportPayments')?.addEventListener('click',()=>{
  const a=getPayments(); const rows=[['date','type','memberId','memberName','amount','credits']]; a.forEach(x=>rows.push([x.date,x.type,x.memberId,x.memberName,x.amount,x.credits])); download('payments.csv',toCSV(rows));
});

// ----- INIT -----
function init(){
  renderSessions();
  renderMembers();
  refreshPayments();
  refreshReports();
  flushQueue();
}
init();
