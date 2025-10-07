// app.js — Boxing for Fitness PWA (Sheets sync + no-cors + payments table)

// ---------- Config ----------
const PRICING = {
  single: { label: 'Single $20', amount: 20, credits: 1 },
  '10':   { label: '10-Pack $180', amount: 180, credits: 10 },
  '20':   { label: '20-Pack $360', amount: 360, credits: 20 },
};

const TIMETABLE = [
  { day: 'Monday',    times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Tuesday',   times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Wednesday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Thursday',  times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Friday',    times: ['6:00 AM','9:30 AM'] },
  { day: 'Saturday',  times: ['8:00 AM','9:30 AM'] },
];

// ---------- Local storage ----------
const LS = {
  queue: 'bff_queue',
  members: 'bff_members',
  payments: 'bff_payments',
  attendance: 'bff_att',
};
const read  = (k, d=[]) => JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
const write = (k, v)   => localStorage.setItem(k, JSON.stringify(v));

// ---------- Queue → Google Sheets (no-cors to avoid preflight) ----------
async function queueEvent(ev){
  const q = read(LS.queue); q.push(ev); write(LS.queue,q);
  await flushQueue();
}
async function flushQueue(){
  let q = read(LS.queue); if(!q.length) return;
  while(q.length){
    const ev = q[0];
    try{
      await fetch(SETTINGS.WEBHOOK_URL,{
        method:'POST',
        mode:'no-cors',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
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

// ---------- Helpers ----------
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const toast = $('#toast');
function showToast(msg){ toast.textContent=msg; toast.style.display='block'; setTimeout(()=>toast.style.display='none',1600); }

// ---------- Tabs ----------
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

// ---------- Sessions (vertical by day) ----------
const sessionGrid = $('#sessionGrid');
let selectedSession = '';
function renderSessions(){
  sessionGrid.innerHTML='';
  TIMETABLE.forEach(col=>{
    const box=document.createElement('div');
    box.className='day-col';
    box.innerHTML=`<h4>${col.day}</h4>`;
    col.times.forEach(t=>{
      const slot=document.createElement('div');
      slot.className='slot';
      slot.innerHTML=`<div class="time">${t}</div>`;
      slot.onclick=()=>{ selectedSession=`${col.day} ${t}`; $('#selectedSession').value=selectedSession; };
      box.appendChild(slot);
    });
    sessionGrid.appendChild(box);
  });
}

// ---------- Members ----------
function getMembers(){ return read(LS.members); }
function setMembers(v){ write(LS.members,v); }

$('#addMember').addEventListener('click', async ()=>{
  const name  = $('#mName').value.trim(); if(!name) return alert('Name required');
  const phone = $('#mPhone').value.trim();
  const email = ($('#mEmail')?.value || '').trim();
  const notes = $('#mNotes').value.trim();

  const members=getMembers();
  const id=Date.now();
  const member={ id, name, phone, email, notes, credits:1, createdAt:new Date().toISOString() };
  members.push(member); setMembers(members);

  await queueEvent({ type:'member_add', payload:{ member } });

  $('#mName').value=$('#mPhone').value=$('#mNotes').value='';
  if($('#mEmail')) $('#mEmail').value='';
  renderMembers(); showToast('Member added (+1 free)');
});

function renderMembers(){
  const tbody=$('#memberTable tbody'); tbody.innerHTML='';
  const members=getMembers().sort((a,b)=>a.name.localeCompare(b.name));
  members.forEach(m=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${m.name}</td>
      <td>${m.phone||''}</td>
      <td><span class="chip">${m.credits||0}</span></td>
      <td style="display:flex;gap:8px;">
        <button class="btn sm secondary" data-action="plus1" data-id="${m.id}">+1</button>
        <button class="btn sm ghost" data-action="delete" data-id="${m.id}">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // +1
  tbody.querySelectorAll('button[data-action="plus1"]').forEach(b=>b.onclick=()=>{
    const id=Number(b.dataset.id); const ms=getMembers(); const m=ms.find(x=>x.id===id); if(!m) return;
    m.credits=(m.credits||0)+1; setMembers(ms); renderMembers(); showToast('Credit added');
  });

  // delete
  tbody.querySelectorAll('button[data-action="delete"]').forEach(b=>b.onclick=async()=>{
    const id=Number(b.dataset.id); const ms=getMembers(); const m=ms.find(x=>x.id===id); if(!m) return;
    if(!confirm(`Delete ${m.name}?`)) return;
    setMembers(ms.filter(x=>x.id!==id)); renderMembers(); showToast('Member deleted');
    await queueEvent({ type:'member_delete', payload:{ memberId:id, memberName:m.name }});
  });

  // datalist
  const dl=$('#memberList'); dl.innerHTML='';
  members.forEach(m=>{ const o=document.createElement('option'); o.value=`${m.name} (${m.phone||''})`; dl.appendChild(o); });
}

// ---------- Payments ----------
function getPayments(){ return read(LS.payments); }
function setPayments(v){ write(LS.payments,v); }

$('#addCredit').addEventListener('click', async ()=>{
  const input=$('#payMember').value.trim();
  const pack=$('#payPack').value;
  const members=getMembers();
  const m=members.find(x=>input.includes(x.name));
  if(!m) return alert('Select a valid member');

  const p=PRICING[pack];
  m.credits=(m.credits||0)+p.credits; setMembers(members); renderMembers();

  // Local record (for UI + weekly reports)
  const rec = {
    date: new Date().toISOString(),
    type: pack,                       // 'single' | '10' | '20'
    memberId: m.id,
    memberName: m.name,
    amount: p.amount,
    credits: p.credits,
    memberEmail: m.email || ''
  };
  const txs=getPayments(); txs.unshift(rec); setPayments(txs); // newest first

  // Send a **flat** payload that matches the sheet headers
  await queueEvent({ type:'payment', payload: rec });

  $('#payMember').value=''; showToast('Payment applied');
  refreshPayments();
  refreshReports();
});

function refreshPayments(){
  const tb=$('#txTable tbody'); if(!tb) return;
  tb.innerHTML='';
  const txs=getPayments();
  txs.forEach(t=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(t.date).toLocaleString()}</td>
      <td>${PRICING[t.type]?.label || t.type}</td>
      <td>${t.memberName}</td>
      <td>$${t.amount}</td>
      <td>${t.credits}</td>`;
    tb.appendChild(tr);
  });
}

// ---------- Attendance / Check-in ----------
function getAttendance(){ return read(LS.attendance); }
function setAttendance(v){ write(LS.attendance,v); }

$('#confirmCheckin').addEventListener('click', async ()=>{
  if(!selectedSession) return alert('Select a session');
  const input=$('#checkinMember').value.trim();
  const members=getMembers(); const m=members.find(x=>input.includes(x.name));
  if(!m) return alert('Select a valid member');

  // if no credit, offer auto single purchase
  if((m.credits||0) <= 0){
    if(confirm(`${m.name} has 0 credits. Add a Single ($20) and check in?`)){
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
      const txs=getPayments(); txs.unshift(rec); setPayments(txs);
      await queueEvent({ type:'payment', payload: rec });
    }else{
      return;
    }
  }

  m.credits -= 1; setMembers(members); renderMembers();

  const att = { date:new Date().toISOString(), session:selectedSession, memberId:m.id, memberName:m.name };
  const atts=getAttendance(); atts.unshift(att); setAttendance(atts);
  await queueEvent({ type:'attendance', payload: att });

  $('#checkinMember').value=''; showToast('Checked in');
  refreshReports();
});

// ---------- Reports (today + simple weekly) ----------
function startOfWeek(d){const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x;}
function inSameWeek(a,b){return startOfWeek(a).getTime()===startOfWeek(b).getTime();}

function refreshReports(){
  const atts=getAttendance();
  const today=new Date().toDateString();
  const tToday=atts.filter(a=>new Date(a.date).toDateString()===today);
  $('#todaySummary').textContent = tToday.length ? `${tToday.length} check-ins today.` : 'No check-ins today.';

  const now=new Date();
  const txs=getPayments();
  const weekTxs=txs.filter(t=>inSameWeek(new Date(t.date), now));
  const weekAtts=atts.filter(a=>inSameWeek(new Date(a.date), now));
  const revenue=weekTxs.reduce((s,t)=>s+(t.amount||0),0);
  const sold=weekTxs.reduce((s,t)=>s+(t.credits||0),0);
  $('#weeklySummary') && ($('#weeklySummary').textContent = `Revenue: $${revenue} • Credits sold: ${sold} • Check-ins: ${weekAtts.length}`);
}

// ---------- Init ----------
function init(){
  renderSessions();
  renderMembers();
  refreshPayments();
  refreshReports();
  flushQueue();
}
init();
