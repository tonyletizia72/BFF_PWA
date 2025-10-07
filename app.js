// ================== Boxing for Fitness PWA (with Google Sheets sync) ==================

// Pricing
const PRICING = {
  single: { label: 'Single $20', amount: 20, credits: 1 },
  '10':   { label: '10-Pack $180', amount: 180, credits: 10 },
  '20':   { label: '20-Pack $360', amount: 360, credits: 20 },
};

// Timetable
const TIMETABLE = [
  { day: 'Monday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Tuesday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Wednesday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Thursday', times: ['6:00 AM','9:30 AM','5:00 PM','6:30 PM'] },
  { day: 'Friday', times: ['6:00 AM','9:30 AM'] },
  { day: 'Saturday', times: ['8:00 AM','9:30 AM'] },
];

// ================== Google Sheets Sync ==================
const SYNC_KEY = 'bff_pending_events_v1';
function getQueue(){try{return JSON.parse(localStorage.getItem(SYNC_KEY)||'[]');}catch{return[];}}
function setQueue(q){localStorage.setItem(SYNC_KEY,JSON.stringify(q));}
function queueEvent(type,payload){const ev={type,payload,ts:Date.now()};const q=getQueue();q.push(ev);setQueue(q);flushQueue();}
async function flushQueue(){
  try{
    if(!window.SETTINGS||!SETTINGS.WEBHOOK_URL||SETTINGS.WEBHOOK_URL.includes('PASTE_'))return;
  }catch{return;}
  let q=getQueue();if(!q.length)return;
  while(q.length){
    const ev=q[0];
    try{
      const resp=await fetch(SETTINGS.WEBHOOK_URL,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({secret:SETTINGS.SECRET,...ev})
      });
      const txt=await resp.text();
      if(!resp.ok){console.warn('[BFF] webhook error',resp.status,txt);break;}
      console.log('[BFF] webhook ok:',txt);
      q.shift();setQueue(q);
    }catch(err){console.warn('[BFF] network error, retry later',err);break;}
  }
}
window.addEventListener('online',flushQueue);
window.addEventListener('load',()=>setTimeout(flushQueue,500));

// ================== IndexedDB ==================
let db=null;const DB_NAME='robbies_gym_db_v1';
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=e=>{const d=e.target.result;
    d.createObjectStore('members',{keyPath:'id',autoIncrement:true});
    d.createObjectStore('attendance',{keyPath:'id',autoIncrement:true});
    d.createObjectStore('payments',{keyPath:'id',autoIncrement:true});};
  r.onsuccess=()=>{db=r.result;res();};r.onerror=()=>rej(r.error);});}
async function openIfNeeded(){if(!db)await openDB();}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store);}
function idbAdd(s,v){return new Promise((res,rej)=>{const r=tx(s,'readwrite').add(v);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function idbPut(s,v){return new Promise((res,rej)=>{const r=tx(s,'readwrite').put(v);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function idbGetAll(s){return new Promise((res,rej)=>{const r=tx(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
function idbGet(s,k){return new Promise((res,rej)=>{const r=tx(s).get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}

// ================== UI helpers ==================
const $=q=>document.querySelector(q),$$=q=>document.querySelectorAll(q);
const toast=$('#toast');
function showToast(m){toast.textContent=m;toast.style.display='block';setTimeout(()=>toast.style.display='none',1200);}

// Tabs
$$('nav button[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  $$('nav button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  ['checkin','members','payments','reports'].forEach(t=>$('#tab-'+t).style.display='none');
  $('#tab-'+btn.dataset.tab).style.display='block';
  if(btn.dataset.tab==='members')refreshMembers();
  if(btn.dataset.tab==='payments')refreshPayments();
  if(btn.dataset.tab==='reports')refreshReports();
}));

// Sessions grid
const sessionGrid=$('#sessionGrid');let selectedSession=null;
function renderSessions(){sessionGrid.innerHTML='';
  TIMETABLE.forEach(day=>day.times.forEach(time=>{
    const d=document.createElement('div');
    d.className='session';d.innerHTML=`<div class="time">${time}</div><div class="tag">${day.day}</div>`;
    d.onclick=()=>{selectedSession=`${day.day} ${time}`;$('#selectedSession').value=selectedSession;};
    sessionGrid.appendChild(d);
  }));}

// Member search helpers
async function refreshMemberDatalist(){const list=$('#memberList');list.innerHTML='';
  const ms=await idbGetAll('members');
  ms.sort((a,b)=>a.name.localeCompare(b.name)).forEach(m=>{
    const o=document.createElement('option');o.value=`${m.name} (${m.phone||''})`;o.dataset.id=m.id;list.appendChild(o);
  });}
async function findMemberByInput(v){const ms=await idbGetAll('members');const t=v.trim().toLowerCase();return ms.find(m=>(m.name+' '+(m.phone||'')).toLowerCase().includes(t));}

// ================== Members ==================
$('#addMember').addEventListener('click',async()=>{
  const name=$('#mName').value.trim();if(!name)return alert('Name required');
  const phone=$('#mPhone').value.trim(),notes=$('#mNotes').value.trim();
  await openIfNeeded();const m={name,phone,notes,credits:1,createdAt:new Date().toISOString()};
  const id=await idbAdd('members',m);m.id=id;queueEvent('member_add',{member:m});
  $('#mName').value=$('#mPhone').value=$('#mNotes').value='';showToast('Member added (+1 free)');
  refreshMembers();refreshMemberDatalist();
});

async function deleteMember(id,m){
  await openIfNeeded();
  await new Promise((res,rej)=>{const r=tx('members','readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});
  queueEvent('member_delete',{memberId:id,memberName:m?.name||''});
  showToast('Member deleted');refreshMembers();refreshMemberDatalist();
}

async function refreshMembers(){
  await openIfNeeded();const tb=$('#memberTable tbody');tb.innerHTML='';
  const ms=await idbGetAll('members');
  ms.sort((a,b)=>a.name.localeCompare(b.name)).forEach(m=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${m.name}</td>
      <td>${m.phone||''}</td>
      <td><span class="chip">${m.credits||0}</span></td>
      <td style="display:flex;gap:8px;">
        <button class="btn sm secondary" data-action="plus1" data-id="${m.id}">+1</button>
        <button class="btn sm ghost" data-action="delete" data-id="${m.id}">🗑️</button>
      </td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('button[data-action="plus1"]').forEach(b=>b.onclick=async()=>{
    const id=Number(b.dataset.id);const m=await idbGet('members',id);m.credits=(m.credits||0)+1;await idbPut('members',m);
    refreshMembers();refreshMemberDatalist();showToast('Credit added');
  });
  tb.querySelectorAll('button[data-action="delete"]').forEach(b=>b.onclick=async()=>{
    const id=Number(b.dataset.id);const m=await idbGet('members',id);
    if(!m)return;const ok=confirm(`Delete ${m.name}? This removes them locally; reports stay intact.`);
    if(ok)await deleteMember(id,m);
  });
}

// ================== Payments ==================
$('#addCredit').addEventListener('click',async()=>{
  const val=$('#payMember').value;const m=await findMemberByInput(val);if(!m)return alert('Select a valid member');
  const pack=$('#payPack').value;const p=PRICING[pack];
  await openIfNeeded();m.credits=(m.credits||0)+p.credits;await idbPut('members',m);
  const rec={date:new Date().toISOString(),type:pack,amount:p.amount,credits:p.credits,memberId:m.id,memberName:m.name};
  await idbAdd('payments',rec);queueEvent('payment',rec);
  showToast('Payment applied');$('#payMember').value='';refreshPayments();refreshMembers();refreshMemberDatalist();
});
async function refreshPayments(){
  await openIfNeeded();const tb=$('#txTable tbody');tb.innerHTML='';
  const txs=await idbGetAll('payments');txs.sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(t=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${new Date(t.date).toLocaleString()}</td><td>${PRICING[t.type]?.label||t.type}</td>
      <td>${t.memberName}</td><td>$${t.amount}</td><td>${t.credits}</td>`;
    tb.appendChild(tr);
  });
}

// ================== Check-in ==================
$('#confirmCheckin').addEventListener('click',async()=>{
  if(!selectedSession)return alert('Select a session');
  const val=$('#checkinMember').value;const m=await findMemberByInput(val);if(!m)return alert('Select a valid member');
  await openIfNeeded();
  if((m.credits||0)<=0){
    if(confirm(`${m.name} has 0 credits. Add a Single ($20)?`)){
      m.credits=(m.credits||0)+1;await idbPut('members',m);
      const autoPay={date:new Date().toISOString(),type:'single',amount:20,credits:1,memberId:m.id,memberName:m.name};
      await idbAdd('payments',autoPay);queueEvent('payment',autoPay);
    }else return;
  }
  m.credits=(m.credits||0)-1;await idbPut('members',m);
  const att={date:new Date().toISOString(),session:selectedSession,memberId:m.id,memberName:m.name};
  await idbAdd('attendance',att);queueEvent('attendance',att);
  $('#checkinMember').value='';showToast('Checked in');
  refreshMembers();refreshReports();refreshPayments();
});

// ================== Reports ==================
async function refreshReports(){
  await openIfNeeded();const tb=$('#attTable tbody');tb.innerHTML='';
  const atts=await idbGetAll('attendance');atts.sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,50).forEach(a=>{
    const tr=document.createElement('tr');tr.innerHTML=`<td>${new Date(a.date).toLocaleString()}</td><td>${a.session}</td><td>${a.memberName}</td>`;tb.appendChild(tr);
  });
  const today=new Date().toDateString();
  const todays=atts.filter(a=>new Date(a.date).toDateString()===today);
  $('#todaySummary').textContent=todays.length?`${todays.length} check-ins today.`:'No check-ins today.';
}

// ================== Exports ==================
function toCSV(rows){return rows.map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n');}
function download(n,t){const b=new Blob([t],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();URL.revokeObjectURL(a.href);}
$('#exportAttendance').addEventListener('click',async()=>{const a=await idbGetAll('attendance');const rows=[['date','session','memberId','memberName']];a.forEach(x=>rows.push([x.date,x.session,x.memberId,x.memberName]));download('attendance.csv',toCSV(rows));});
$('#exportPayments').addEventListener('click',async()=>{const a=await idbGetAll('payments');const rows=[['date','type','memberId','memberName','amount','credits']];a.forEach(x=>rows.push([x.date,x.type,x.memberId,x.memberName,x.amount,x.credits]));download('payments.csv',toCSV(rows));});

// ================== Init ==================
async function init(){await openIfNeeded();renderSessions();refreshMembers();refreshMemberDatalist();refreshPayments();refreshReports();flushQueue();}
init();
