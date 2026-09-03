/* =========================================================
   NoFap — Calendário de Sequência (Setembro)
   Vanilla JS + IndexedDB. Sem frameworks, sem CDN, sem build.
   Funciona abrindo index.html com duplo clique.
   ========================================================= */

/* ------------------ Constantes ------------------ */
const MONTH_INDEX    = 8;    // setembro (0 = janeiro)
const MONTH_NAME     = 'Setembro';
const DAYS_IN_MONTH  = 30;
const WEEKDAYS       = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const DB_NAME        = 'nofapDB';
const DB_VERSION     = 1;
const STORE_DAYS     = 'days';  // { date: "2026-09-05", status: "success" | "failed" }
const STORE_META     = 'meta';  // { key: "best", value: 7 }

/* ------------------ Estado ------------------ */
let YEAR        = resolveSeptemberYear();
let daysMap     = new Map(); // "2026-09-05" -> "success" | "failed"
let bestStreak  = 0;
let selectedDay = null;
let lastSeenDay = null;

/* =========================================================
   1) CAMADA DE "BANCO DE DADOS" (IndexedDB)
   ========================================================= */
const DB = (function () {
  const hasIDB = typeof indexedDB !== 'undefined';
  const LS_KEY = 'nofapDB.fallback';   // reserva caso o navegador bloqueie IndexedDB
  let dbPromise = null;

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || { days: {}, meta: {} }; }
    catch (e) { return { days: {}, meta: {} }; }
  }
  function lsWrite(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function open() {
    if (!hasIDB) return Promise.reject(new Error('IndexedDB indisponível'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DAYS)) db.createObjectStore(STORE_DAYS, { keyPath: 'date' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function run(storeName, mode, action) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try { result = action(store); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(result && result.result !== undefined ? result.result : undefined); };
        tx.onerror    = function () { reject(tx.error); };
        tx.onabort    = function () { reject(tx.error); };
      });
    });
  }

  return {
    label: hasIDB ? 'IndexedDB' : 'localStorage (reserva)',

    getAll: function (storeName) {
      if (!hasIDB) {
        const d = lsRead();
        return Promise.resolve(storeName === STORE_DAYS ? Object.values(d.days) : Object.values(d.meta));
      }
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx   = db.transaction(storeName, 'readonly');
          const req  = tx.objectStore(storeName).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror   = function () { reject(req.error); };
        });
      });
    },

    put: function (storeName, value) {
      if (!hasIDB) {
        const d = lsRead();
        if (storeName === STORE_DAYS) d.days[value.date] = value;
        else d.meta[value.key] = value;
        lsWrite(d);
        return Promise.resolve(value);
      }
      return run(storeName, 'readwrite', function (store) { store.put(value); });
    },

    del: function (storeName, key) {
      if (!hasIDB) {
        const d = lsRead();
        if (storeName === STORE_DAYS) delete d.days[key];
        else delete d.meta[key];
        lsWrite(d);
        return Promise.resolve();
      }
      return run(storeName, 'readwrite', function (store) { store.delete(key); });
    },

    clear: function (storeName) {
      if (!hasIDB) {
        const d = lsRead();
        if (storeName === STORE_DAYS) d.days = {};
        else d.meta = {};
        lsWrite(d);
        return Promise.resolve();
      }
      return run(storeName, 'readwrite', function (store) { store.clear(); });
    }
  };
})();

/* =========================================================
   2) DATAS — sempre em ano/mês/dia LOCAIS (nunca UTC puro)
   ========================================================= */

/* Se setembro do ano corrente ainda não começou, usamos o último
   setembro que já existiu, para que o mês do jogo fique utilizável. */
function resolveSeptemberYear() {
  const now = new Date();
  let y = now.getFullYear();
  if (now.getMonth() < MONTH_INDEX) y -= 1;
  return y;
}

function localToday() {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() };
}

function dateKey(day) {
  return YEAR + '-09-' + String(day).padStart(2, '0');
}

/* Dia de hoje, se estiver dentro do mês do calendário (senão null) */
function currentDayOfMonth() {
  const t = localToday();
  if (t.y !== YEAR || t.m !== MONTH_INDEX) return null;
  return t.d;
}

/* SEGURANÇA: chamada no momento do clique, com a data real do dispositivo. */
function isFutureDate(day) {
  const t = localToday();
  const target = new Date(YEAR, MONTH_INDEX, day, 0, 0, 0, 0);   // meia-noite local
  const today  = new Date(t.y, t.m, t.d, 0, 0, 0, 0);            // meia-noite local
  return target.getTime() > today.getTime();
}

function weekdayOf(day) {
  return new Date(YEAR, MONTH_INDEX, day).getDay(); // 0 = domingo
}

/* =========================================================
   3) ESTATÍSTICAS / SEQUÊNCIA
   ========================================================= */
function computeStats() {
  let success = 0, failed = 0, registered = 0;

  daysMap.forEach(function (status) {
    registered++;
    if (status === 'success') success++;
    else failed++;
  });

  /* --- melhor sequência: maior sequência de sucessos consecutivos --- */
  let best = 0, run = 0;
  for (let d = 1; d <= DAYS_IN_MONTH; d++) {
    if (daysMap.get(dateKey(d)) === 'success') {
      run++;
      if (run > best) best = run;
    } else {
      run = 0; // "perdeu" ou dia sem registro quebra a sequência
    }
  }

  /* --- sequência atual: conta para trás a partir do ÚLTIMO dia registrado --- */
  let current = 0;
  let lastRegistered = null;
  for (let d = DAYS_IN_MONTH; d >= 1; d--) {
    if (daysMap.has(dateKey(d))) { lastRegistered = d; break; }
  }
  if (lastRegistered !== null && daysMap.get(dateKey(lastRegistered)) === 'success') {
    current = 1;
    for (let d = lastRegistered - 1; d >= 1; d--) {
      if (daysMap.get(dateKey(d)) === 'success') current++;
      else break;
    }
  }

  /* melhor sequência salva nunca diminui */
  if (best > bestStreak) bestStreak = best;
  if (current > bestStreak) bestStreak = current;

  return { current: current, best: bestStreak, success: success, failed: failed, registered: registered };
}

function motivationFor(streak) {
  if (streak === 0)  return 'Comece hoje. O dia 1 é o mais importante.';
  if (streak === 1)  return 'Primeiro dia no bolso. Não olhe para trás.';
  if (streak < 7)    return streak + ' dias seguidos. O hábito está se formando.';
  if (streak < 14)   return 'Uma semana completa vencida. Siga firme!';
  if (streak < 21)   return 'Duas semanas. Seu cérebro está se reprogramando.';
  if (streak < 30)   return 'Quase o mês inteiro. Continue dominando o dia.';
  return 'Mês perfeito. Isso é controle de verdade. 🔥';
}

/* =========================================================
   4) RENDERIZAÇÃO
   ========================================================= */
function renderCalendar() {
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';

  const firstWeekday = weekdayOf(1);                 // 0 = domingo
  const offset = (firstWeekday + 6) % 7;             // grade começa na segunda-feira
  const today = currentDayOfMonth();

  for (let i = 0; i < offset; i++) {
    const pad = document.createElement('div');
    pad.className = 'day day--pad';
    pad.setAttribute('aria-hidden', 'true');
    cal.appendChild(pad);
  }

  for (let day = 1; day <= DAYS_IN_MONTH; day++) {
    const status  = daysMap.get(dateKey(day)) || null;
    const locked  = isFutureDate(day);
    const isToday = today === day;

    const wrap = document.createElement('div');
    wrap.className = 'day';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-btn';
    btn.dataset.day = String(day);
    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-label', 'Dia ' + day + ' de ' + MONTH_NAME + (status ? ' — ' + (status === 'success' ? 'concluído' : 'perdido') : ' — sem registro'));

    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = String(day);
    btn.appendChild(num);

    const mark = document.createElement('span');
    mark.className = 'day-mark';
    mark.textContent = status === 'success' ? '✓' : (status === 'failed' ? '✕' : '');
    btn.appendChild(mark);

    if (status === 'success') btn.classList.add('is-success');
    if (status === 'failed')  btn.classList.add('is-fail');
    if (!status && !locked)   btn.classList.add('is-empty');
    if (locked) {
      /* Visual e semântica de bloqueado, mas ainda clicável para dar o aviso.
         A proteção real (que impede a gravação) está em onDayClick/saveStatus. */
      btn.classList.add('is-locked');
      btn.setAttribute('aria-disabled', 'true');
    }
    if (isToday) btn.classList.add('is-today');

    btn.addEventListener('click', function () { onDayClick(day); });

    wrap.appendChild(btn);

    if (isToday) {
      const tag = document.createElement('span');
      tag.className = 'today-tag';
      tag.textContent = 'hoje';
      wrap.appendChild(tag);
    }

    cal.appendChild(wrap);
  }
}

function renderStats() {
  const s = computeStats();

  document.getElementById('streakValue').textContent  = s.current;
  document.getElementById('statCurrent').textContent  = s.current;
  document.getElementById('statBest').textContent     = s.best;
  document.getElementById('statSuccess').textContent  = s.success;
  document.getElementById('statFail').textContent     = s.failed;
  document.getElementById('motivationText').textContent = motivationFor(s.current);

  document.getElementById('progressText').textContent = s.registered + ' / ' + DAYS_IN_MONTH;
  document.getElementById('progressFill').style.width = Math.round((s.registered / DAYS_IN_MONTH) * 100) + '%';

  return s;
}

function render() {
  document.getElementById('monthYear').textContent  = YEAR;
  document.getElementById('monthTitle').textContent = MONTH_NAME;
  renderCalendar();
  renderStats();
}

function popDay(day) {
  const btn = document.querySelector('.day-btn[data-day="' + day + '"]');
  if (!btn) return;
  btn.classList.remove('pop');
  void btn.offsetWidth; // reinicia a animação
  btn.classList.add('pop');
}

/* =========================================================
   5) MODAL
   ========================================================= */
const modal = document.getElementById('modal');

function openModal(day) {
  selectedDay = day;
  const status = daysMap.get(dateKey(day)) || null;

  document.getElementById('modalTitle').textContent = 'Dia ' + day + ' de ' + MONTH_NAME.toLowerCase();

  const cur = document.getElementById('modalCurrent');
  cur.className = 'modal-current';
  if (status === 'success') { cur.textContent = 'Status atual: Concluído ✓'; cur.classList.add('has-success'); }
  else if (status === 'failed') { cur.textContent = 'Status atual: Perdido ✕'; cur.classList.add('has-fail'); }
  else { cur.textContent = 'Nenhum registro ainda para este dia.'; }

  document.getElementById('btnClear').hidden = !status;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modal.hidden = true;
  selectedDay = null;
  document.body.style.overflow = '';
}

modal.addEventListener('click', function (e) {
  if (e.target.dataset && e.target.dataset.close) closeModal();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});

/* =========================================================
   6) INTERAÇÃO + ESCRITA NO BANCO
   ========================================================= */
function onDayClick(day) {
  /* Validação de data feita SEMPRE no momento do clique,
     antes de qualquer escrita no IndexedDB. */
  if (isFutureDate(day)) {
    showToast('Esse dia ainda não chegou.', true);
    return;
  }
  openModal(day);
}

async function saveStatus(day, status) {
  /* segunda barreira: valida novamente antes de gravar */
  if (isFutureDate(day)) {
    showToast('Esse dia ainda não chegou.', true);
    return;
  }
  if (day < 1 || day > DAYS_IN_MONTH) return;

  await DB.put(STORE_DAYS, { date: dateKey(day), status: status });
  daysMap.set(dateKey(day), status);

  /* recalcula TUDO do zero (sequência, melhor sequência, totais) */
  const stats = renderStats();
  renderCalendar();
  popDay(day);

  /* melhor sequência persistida no banco — esse valor nunca diminui */
  await DB.put(STORE_META, { key: 'best', value: bestStreak });

  if (status === 'success') showToast('Dia ' + day + ' registrado. Sequência: ' + stats.current + ' dia' + (stats.current === 1 ? '' : 's') + ' 🔥');
  else showToast('Dia ' + day + ' marcado como perdido. Recomece amanhã.');

  closeModal();
}

async function clearDay(day) {
  await DB.del(STORE_DAYS, dateKey(day));
  daysMap.delete(dateKey(day));
  renderCalendar();
  renderStats();
  showToast('Registro do dia ' + day + ' apagado.');
  closeModal();
}

document.getElementById('btnSuccess').addEventListener('click', function () {
  if (selectedDay !== null) saveStatus(selectedDay, 'success');
});

document.getElementById('btnFail').addEventListener('click', function () {
  if (selectedDay !== null) saveStatus(selectedDay, 'failed');
});

document.getElementById('btnClear').addEventListener('click', function () {
  if (selectedDay !== null) clearDay(selectedDay);
});

document.getElementById('resetBtn').addEventListener('click', async function () {
  const ok = confirm('Apagar TODOS os registros de setembro?\n(A melhor sequência histórica será mantida.)');
  if (!ok) return;
  await DB.clear(STORE_DAYS);
  daysMap.clear();
  renderCalendar();
  renderStats();
  showToast('Todos os registros foram apagados.');
});

/* =========================================================
   7) TOAST
   ========================================================= */
let toastTimer = null;
function showToast(message, warn) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.toggle('warn', !!warn);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
}

/* =========================================================
   8) BOOT: lê o IndexedDB e monta a tela
   ========================================================= */
async function loadFromDB() {
  const rows = await DB.getAll(STORE_DAYS);
  daysMap = new Map();
  rows.forEach(function (row) {
    if (row && row.date && (row.status === 'success' || row.status === 'failed')) {
      daysMap.set(row.date, row.status);
    }
  });

  const meta = await DB.getAll(STORE_META);
  meta.forEach(function (m) {
    if (m && m.key === 'best' && typeof m.value === 'number') {
      bestStreak = Math.max(bestStreak, m.value);
    }
  });
}

/* Verifica virada de dia: libera o novo dia sozinho, sem ação do usuário */
function checkDayRollover() {
  const t = localToday();
  const stamp = t.y + '-' + t.m + '-' + t.d;
  if (stamp === lastSeenDay) return;
  lastSeenDay = stamp;

  const newYear = resolveSeptemberYear();
  if (newYear !== YEAR) {
    YEAR = newYear;
    loadFromDB().then(render);
    return;
  }
  render();
}

async function init() {
  lastSeenDay = null;
  try {
    await loadFromDB();
  } catch (err) {
    console.warn('Falha ao ler o banco local:', err);
    daysMap = new Map();
    bestStreak = 0;
  }
  checkDayRollover();
  setInterval(checkDayRollover, 30000);          // a cada 30s
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkDayRollover();
  });
}

init();

/* =========================================================
   9) EXPOR PARA TESTES NO CONSOLE (opcional)
   Ex.: await window.nofapDB.forceSet(5, 'success') -> bloqueado se futuro
   ========================================================= */
window.nofapDB = {
  isFutureDate: isFutureDate,
  setStatus: saveStatus,
  clearDay: clearDay,
  read: function () {
    const o = {};
    daysMap.forEach(function (v, k) { o[k] = v; });
    return o;
  }
};
