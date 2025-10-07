/***************************************************
 * Boxing for Fitness App — Main Logic
 * Version: perth-1.1 (Perth-local server; URL updated)
 ***************************************************/
(function ensureSettings(){
  if (typeof window.SETTINGS === 'undefined') {
    window.SETTINGS = {
      WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbyI-9BNZT-FCeE8vq2eIHsnqvfdfepUkLWoP1Yw0qUbLW-2_6XmyTRPiaqE2PlU41-wJA/exec",
      SECRET: "BFF"
    };
    console.warn('[BFF] settings.js not found; using embedded fallback SETTINGS.');
  }
})();
console.log("[BFF] Active Webhook:", window.SETTINGS.WEBHOOK_URL);

// Pricing
const PRICING = {
  single: { label: 'Single $20', amount: 20, credits: 1 },
  '10':   { label: '10-Pack $180', amount: 180, credits: 10 },
  '20':   { label: '20-Pack $360', amount: 360, credits: 20 },
};

// Local storage helpers
const LS = { queue:'bff_queue', members:'bff_members', payments:'bff_payments', attendance:'bff_att' };
const read  = (k,d=[]) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
const write = (k,v)   => localStorage.setItem(k, JSON.stringify(v));

// Queue to Apps Script (robust/offline)
async function queueEvent(ev){
  const q = read(LS.queue); q.push(ev); write(LS.queue,q);
  await flushQueue();
}
async function flushQueue(){
  let q = read(LS.queue); if(!q.length) return;
  while(q.length){
    const ev = q[0];
    try{
      await fetch(window.SETTINGS.WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors', // avoid CORS blocking on GH Pages/iOS
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: window.SETTINGS.SECRET, ...ev })
      });
      q.shift(); write(LS.queue,q);
    }catch(e){ console.warn('webhook failed, will retry', e); break; }
  }
}
window.addEventListener('online', flushQueue);

// UI helpers
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const toast = $('#toast');
const showToast = (m)=>{ if(!toast) return; toast.textContent=m; toast.style.display='block'; setTimeout(()=>toast.style.display='none',1600); };

// Tabs
$$('nav button[data-tab]').forEach(btn=>{
  btn.onclick = ()=>{
    $$('nav button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['checkin','members','payments','reports'].forEach(t=>$('#tab-'+t).style.display='none');
    $('#tab-'+btn.dataset.tab).style.display='block';
    if(btn.dataset.tab==='members')  renderMembers();
    if(btn.dataset.tab==='payments') refreshPayments();
    if(btn.dataset.tab==='reports')  refreshReports();
  };
});

// Sessions (static HTML): hover/active + selected text
let selectedSession = '';
function wireSessions(){
  const boxes = $$('#sessionGrid .session');
  boxes.forEach(box=>{
    box.addEventListener('click', ()=>{
      boxes.forEach(b=>b.classList.remove('active'));
      box.classList.add('active');
      selectedSession = `${box.dataset.day} ${box.dataset.time}`;
      const sel = $('#selectedSession'); if (sel) sel.value = selectedSession;
    });
    box.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); box.click(); }
    });
    box.setAttribute('tabindex','0');
    box.setAttribute('role','button');
  });
  if (boxes[0]) boxes[0].click();
}

// Members
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

  ['mName','mPhone','mEmail','mNotes'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
  renderMembers(); showToast('Member added (+1 free)');
});

function renderMembers(){
  const tbody = $('#memberTable tbody'); if(!tbody) return;
  tbody.innerHTML = '';
  const members = getMembers().sort((a,b)=>a.name.localeCompare(b.name));
  members.forEach(m=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.name}</td>
      <td>${m.phone || ''}</td>
      <td>${m.email || ''}</td>
      <td><span class="chip">${m.credits||0}</span></td>
      <td style="display:flex;gap:8px;">
        <button class="btn sm secondary" data-action="plus1" data-id="${m.id}">+1</button>
        <button class="btn sm ghost" data-action="delete" data-id="${m.id}">🗑️</button>
      </td>
      <td>${m.email ? `<button class="btn sm ghost contactMember" data-email="${m.email}" data-name="${m.name}">✉️ Contact</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-action="plus1"]').forEach(b=>{
    b.onclick = ()=>{
      const id = Number(b.dataset.id);
      const ms = getMembers();
      const m = ms.find(x=>x.id===id); if(!m) return;
      m.credits = (m.credits||0)+1; setMembers(ms); renderMembers(); showToast('Credit added');
    };
  });
  tbody.querySelectorAll('button[data-action="delete"]').forEach(b=>{
    b.onclick = async ()=>{
      const id = Number(b.dataset.id);
      const ms = getMembers();
      const m  = ms.find(x=>x.id===id); if(!m) return;
      if(!confirm(`Delete ${m.name}?`)) return;
      setMembers(ms.filter(x=>x.id!==id)); renderMembers(); showToast('Member deleted');
      await queueEvent({ type:'member_delete', payload:{ memberId:id, memberName:m.name } });
    };
  });
  tbody.querySelectorAll('.contactMember').forEach(btn=>{
    btn.onclick = ()=>{
      const email = btn.dataset.email;
      const name  = btn.dataset.name || '';
      const subject = encodeURIComponent('Boxing for Fitness – Message');
      const body    = encodeURIComponent(`Hi ${name},\n\n`);
      window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    };
  });

  const dl = $('#memberList');
  if (dl) dl.innerHTML = members.map(m=>`<option value="${m.name} (${m.phone||''})"></option>`).join('');
}

// Payments
function getPayments(){ return read(LS.payments); }
function setPayments(v){ write(LS.payments,v); }

$('#addCredit')?.addEventListener('click', async ()=>{
  const input = $('#payMember')?.value.trim();
  const pack  = $('#payPack')?.value;
  if(!input || !pack) return;

  const members = getMembers();
  const m = members.find(x=>input.includes(x.name));
  if(!m) return alert('Select a valid member');

  const p = PRICING[pack];
  m.credits = (m.credits||0) + p.credits; setMembers(members); renderMembers();

  const rec = { date:new Date().toISOString(), type:pack, memberId:m.id, memberName:m.name, amount:p.amount, credits:p.credits, memberEmail:m.email||'' };
  const txs = getPayments(); txs.unshift(rec); setPayments(txs);
  await queueEvent({ type:'payment', payload:rec });

  if($('#payMember')) $('#payMember').value='';
  showToast('Payment applied'); refreshPayments(); refreshReports();
});

function refreshPayments(){
  const tb = $('#txTable tbody'); if(!tb) return;
  tb.innerHTML=''; getPayments().forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(t.date).toLocaleString()}</td>
      <td>${PRICING[t.type]?.label||t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>`;
    tb.appendChild(tr);
  });
}

$('#clearPayments')?.addEventListener('click', ()=>{
  if(!confirm('Clear recent transactions on this device? This does NOT affect the Google Sheet.')) return;
  setPayments([]); refreshPayments(); showToast('Local transactions cleared');
});

// Attendance / check-in
function getAttendance(){ return read(LS.attendance); }
function setAttendance(v){ write(LS.attendance,v); }

$('#confirmCheckin')?.addEventListener('click', async ()=>{
  if(!selectedSession) return alert('Select a session');
  const input = $('#checkinMember')?.value.trim();
  const members = getMembers();
  const m = members.find(x => input && input.includes(x.name));
  if(!m) return alert('Select a valid member');

  if((m.credits||0) <= 0){
    if(confirm(`${m.name} has 0 credits. Add a Single ($20) and check in?`)){
      m.credits = (m.credits||0)+1;
      const rec = { date:new Date().toISOString(), type:'single', memberId:m.id, memberName:m.name, amount:20, credits:1, memberEmail:m.email||'' };
      const txs=getPayments(); txs.unshift(rec); setPayments(txs);
      await queueEvent({ type:'payment', payload:rec });
    } else return;
  }

  m.credits -= 1; setMembers(members); renderMembers();

  const att = { date:new Date().toISOString(), session:selectedSession, memberId:m.id, memberName:m.name };
  const atts=getAttendance(); atts.unshift(att); setAttendance(atts);
  await queueEvent({ type:'attendance', payload:att });

  if($('#checkinMember')) $('#checkinMember').value='';
  showToast('Checked in'); refreshReports();
});

// Reports / exports
function refreshReports(){
  const atts = getAttendance();
  const today = new Date().toDateString();
  const todays = atts.filter(a => new Date(a.date).toDateString() === today);
  if($('#todaySummary')) $('#todaySummary').textContent = todays.length ? `${todays.length} check-ins today.` : 'No check-ins today.';
}
function toCSV(rows){return rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');}
function download(n,t){const b=new Blob([t],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();URL.revokeObjectURL(a.href);}
$('#exportAttendance')?.addEventListener('click',()=>{ const a=getAttendance(); const rows=[['date','session','memberId','memberName']]; a.forEach(x=>rows.push([x.date,x.session,x.memberId,x.memberName])); download('attendance.csv',toCSV(rows)); });
$('#exportPayments')?.addEventListener('click',()=>{ const a=getPayments(); const rows=[['date','type','memberId','memberName','amount','credits']]; a.forEach(x=>rows.push([x.date,x.type,x.memberId,x.memberName,x.amount,x.credits])); download('payments.csv',toCSV(rows)); });

// Init
function init(){ wireSessions(); renderMembers(); refreshPayments(); refreshReports(); flushQueue(); }
init();
