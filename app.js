// app.js — Boxing for Fitness PWA
// Handles offline queue, UI tabs, member/payments/attendance management

// ---------- STORAGE ----------
function getQueue() {
  return JSON.parse(localStorage.getItem('bff_queue') || '[]');
}
function setQueue(q) {
  localStorage.setItem('bff_queue', JSON.stringify(q));
}
function getMembers() {
  return JSON.parse(localStorage.getItem('bff_members') || '[]');
}
function setMembers(m) {
  localStorage.setItem('bff_members', JSON.stringify(m));
}

// ---------- GOOGLE SHEETS SYNC ----------
async function queueEvent(event) {
  const q = getQueue();
  q.push(event);
  setQueue(q);
  await flushQueue();
}

async function flushQueue() {
  const q = getQueue();
  if (!q.length) return;
  console.log('[BFF] flushing queue', q.length);

  while (q.length) {
    const ev = q[0];
    try {
      // Avoid CORS preflight — use no-cors + text/plain
      const resp = await fetch(SETTINGS.WEBHOOK_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: SETTINGS.SECRET, ...ev })
      });

      // Response is opaque when using no-cors, assume success
      console.log('[BFF] webhook sent (opaque/ok), dequeuing');
      q.shift();
      setQueue(q);
    } catch (err) {
      console.warn('[BFF] webhook error, will retry later', err);
      break;
    }
  }
}

// ---------- UI TAB HANDLING ----------
document.querySelectorAll('nav button[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('section[id^="tab-"]').forEach(sec => sec.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';
  });
});

// ---------- SESSION GRID ----------
const sessions = [
  { day: 'Mon', time: '6:00 AM', name: 'Morning Box' },
  { day: 'Mon', time: '5:30 PM', name: 'Evening Box' },
  { day: 'Wed', time: '6:00 AM', name: 'Morning Box' },
  { day: 'Wed', time: '5:30 PM', name: 'Evening Box' },
  { day: 'Sat', time: '7:30 AM', name: 'Weekend Warrior' }
];
const sessionGrid = document.getElementById('sessionGrid');
sessions.forEach(s => {
  const div = document.createElement('div');
  div.className = 'session';
  div.innerHTML = `<div class="time">${s.time}</div><div>${s.day} – ${s.name}</div>`;
  div.onclick = () => {
    document.getElementById('selectedSession').value = `${s.day} ${s.time} ${s.name}`;
  };
  sessionGrid.appendChild(div);
});

// ---------- ADD MEMBER ----------
document.getElementById('addMember').addEventListener('click', async () => {
  const name = document.getElementById('mName').value.trim();
  const phone = document.getElementById('mPhone').value.trim();
  if (!name) return alert('Enter member name');
  const notes = document.getElementById('mNotes').value.trim();
  const members = getMembers();
  const id = Date.now();
  const member = { id, name, phone, notes, credits: 1, createdAt: new Date().toISOString() };
  members.push(member);
  setMembers(members);
  renderMembers();
  await queueEvent({ type: 'member_add', payload: { member } });
  showToast('Member added +1 free credit');
});

// ---------- RENDER MEMBERS ----------
function renderMembers() {
  const tbody = document.querySelector('#memberTable tbody');
  tbody.innerHTML = '';
  getMembers().forEach(m => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.name}</td>
      <td>${m.phone}</td>
      <td>${m.credits}</td>
      <td><button class="btn sm secondary" data-id="${m.id}">Delete</button></td>`;
    tbody.appendChild(tr);
  });

  // Delete handlers
  tbody.querySelectorAll('button[data-id]').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      let members = getMembers().filter(x => x.id !== id);
      setMembers(members);
      renderMembers();
      await queueEvent({ type: 'member_delete', payload: { id } });
      showToast('Member deleted');
    };
  });

  // Update datalist
  const dl = document.getElementById('memberList');
  dl.innerHTML = getMembers()
    .map(m => `<option value="${m.name} (${m.phone})"></option>`)
    .join('');
}
renderMembers();

// ---------- APPLY PAYMENT ----------
document.getElementById('addCredit').addEventListener('click', async () => {
  const memberInput = document.getElementById('payMember').value.trim();
  const pack = document.getElementById('payPack').value;
  const members = getMembers();
  const m = members.find(x => memberInput.includes(x.name));
  if (!m) return alert('Select a valid member');

  let addCredits = 0, amount = 0;
  if (pack === 'single') { addCredits = 1; amount = 20; }
  else if (pack === '10') { addCredits = 10; amount = 180; }
  else if (pack === '20') { addCredits = 20; amount = 360; }

  m.credits += addCredits;
  setMembers(members);
  renderMembers();

  const tx = { member: m.name, credits: addCredits, amount, date: new Date().toISOString() };
  await queueEvent({ type: 'payment', payload: { tx } });
  showToast(`Added ${addCredits} credits to ${m.name}`);
});

// ---------- CONFIRM CHECK-IN ----------
document.getElementById('confirmCheckin').addEventListener('click', async () => {
  const memberInput = document.getElementById('checkinMember').value.trim();
  const session = document.getElementById('selectedSession').value.trim();
  if (!session) return alert('Select session');
  const members = getMembers();
  const m = members.find(x => memberInput.includes(x.name));
  if (!m) return alert('Select a valid member');
  if (m.credits <= 0) return alert('No credits left');

  m.credits -= 1;
  setMembers(members);
  renderMembers();

  const att = { member: m.name, session, date: new Date().toISOString() };
  await queueEvent({ type: 'attendance', payload: { att } });
  showToast(`${m.name} checked in`);
});

// ---------- TOAST ----------
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 2000);
}

// ---------- AUTO-FLUSH ----------
window.addEventListener('online', flushQueue);
flushQueue();
