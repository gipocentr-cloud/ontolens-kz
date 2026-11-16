/**
 * Оболочка платформы OntoLens-KZ (ТЗ v2.2, раздел 5): вход, «Мои онтологии»,
 * управление, предпросмотр и публикация версии, переход в рабочее пространство.
 *
 * Адреса: #/ — список, #/o/<код> — работа с онтологией, #/o/<код>/new — новая версия,
 * #/o/<код>/people — эксперты онтологии, #/admin — управление.
 */
import { openWorkspace, state as WS } from '../app.js';
import { CSS } from '../ui/styles.js';
import { normEmail, slugCode } from './common.js';

const SHELL_CSS = `
.sh{min-height:100%;background:var(--paper);display:flex;flex-direction:column}
.sh-top{height:56px;display:flex;align-items:center;gap:14px;padding:0 20px;background:var(--ink);color:var(--paper);flex-shrink:0}
.sh-top b{font-family:var(--serif);font-size:20px}
.sh-top .sp{flex:1}
.sh-top .who{font-size:13px;color:#CFCBC2}
.sh-top button{background:#26282D;border:1px solid #3A3D44;color:#CFCBC2;border-radius:6px;padding:5px 10px}
.sh-top nav{display:flex;gap:4px}
.sh-top nav a{color:#CFCBC2;text-decoration:none;padding:5px 10px;border-radius:6px;font-size:13.5px}
.sh-top nav a[aria-current="page"]{background:#33363D;color:#fff}
.sh-main{flex:1;width:100%;max-width:1120px;margin:0 auto;padding:28px 20px 48px;display:grid;gap:20px;align-content:start}
.sh h1{font-family:var(--serif);font-size:26px;margin:0}
.sh h2{font-size:16px;margin:0}
.sh .lead{color:var(--muted);margin:0;max-width:68ch;line-height:1.5}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card-o{background:var(--white);border:1px solid var(--line);border-radius:10px;padding:16px 18px;display:grid;gap:10px;min-width:0}
.card-o h3{font-family:var(--serif);font-size:19px;margin:0;line-height:1.25}
.card-o .meta{font-size:12.5px;color:var(--muted-2);display:flex;gap:10px;flex-wrap:wrap}
.card-o .role{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--teal)}
.card-o .desc{font-size:13px;color:var(--muted);margin:0}
.bar{height:6px;background:var(--line-2);border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--green)}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;color:var(--muted-2)}
.nums b{display:block;font-size:17px;color:var(--ink);font-variant-numeric:tabular-nums}
.acts{display:flex;gap:8px;flex-wrap:wrap}
.sh .btn{padding:7px 13px;border-radius:7px;border:1px solid var(--line-3);background:var(--white);font-size:13.5px}
.sh .btn.primary{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.sh .btn:disabled{opacity:.5;cursor:default}
.empty-o{background:var(--white);border:1px dashed var(--line-3);border-radius:10px;padding:28px;color:var(--muted);text-align:center}
.login{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
.login .box{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:32px;max-width:440px;width:100%;display:grid;gap:14px}
.login h1{font-size:28px}
.gbtn{display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 14px;border:1px solid var(--line-3);border-radius:8px;background:#fff;font-size:15px}
.err{color:var(--red);font-size:13px;white-space:pre-wrap}
.tbl{width:100%;border-collapse:collapse;background:var(--white);border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13px}
.tbl th,.tbl td{padding:8px 10px;border-bottom:1px solid var(--line-2);text-align:left;vertical-align:top}
.tbl th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted-2);background:var(--paper-2)}
.tblwrap{overflow-x:auto}
.form{display:flex;gap:8px;flex-wrap:wrap;align-items:end;background:var(--white);border:1px solid var(--line);border-radius:8px;padding:12px}
.form label{display:grid;gap:4px;font-size:12px;color:var(--muted-2)}
.form input,.form select,.form textarea{padding:6px 8px;border:1px solid var(--line-3);border-radius:6px;background:#fff;min-width:160px}
.form textarea{min-width:min(520px,80vw);min-height:60px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;border:1px solid var(--line-3)}
.pill.off{color:var(--red);border-color:var(--red)}
.loadingsh{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted-2)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chips span{background:var(--paper-2);border:1px solid var(--line-2);border-radius:99px;padding:2px 8px;font-size:12px}
.chips button{border:0;background:none;color:var(--red);padding:0 0 0 4px}
`;

function h(tag, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [nameId, ...cls] = tag.split('.');
  const [name, id] = nameId.split('#');
  const el = document.createElement(name);
  if (id) el.id = id;
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const VIS = { after_own: 'после своей оценки', open: 'сразу', blind: 'не видят' };

export function startShell(mount, backend, opts = {}) {
  const st = document.createElement('style');
  st.textContent = CSS + SHELL_CSS;
  document.head.appendChild(st);
  const ctx = { backend, user: null, person: null, ontologies: [], admin: false };
  const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };
  const flash = { text: '', kind: '' };

  function frame(active, ...content) {
    const isAdmin = ctx.admin;
    return h('div.sh',
      h('header.sh-top',
        h('b', 'OntoLens'),
        h('nav', h('a', { href: '#/', 'aria-current': active === 'list' ? 'page' : null }, 'Мои онтологии'),
          isAdmin ? h('a', { href: '#/admin', 'aria-current': active === 'admin' ? 'page' : null }, 'Управление') : null),
        h('div.sp'),
        h('span.who', ctx.person ? ctx.person.name : ctx.user.email, isAdmin ? ' · администратор' : ''),
        h('button', { onclick: async () => { await backend.signOut(); location.hash = '#/'; route(); } }, 'Выйти')),
      h('main.sh-main', flash.text ? h('div', { class: 'err', role: 'status', style: { color: flash.kind === 'ok' ? 'var(--green)' : null } }, flash.text) : null, ...content));
  }
  function show(node) { mount.replaceChildren(node); flash.text = ''; }
  function loading(text) { mount.replaceChildren(h('div.sh', h('div.loadingsh', text || 'Загрузка…'))); }
  function fail(e) { flash.text = String(e && e.message || e); flash.kind = 'bad'; }

  // ------------------------------------------------------------ вход
  function loginScreen(err) {
    show(h('div.sh', h('div.login', h('div.box',
      h('div', { style: { fontFamily: 'var(--serif)', color: 'var(--muted-2)' } }, 'OntoLens-KZ'),
      h('h1', 'Работа с онтологиями'),
      h('p.lead', 'Войдите через Google. Учётная запись нужна только для того, чтобы открыть вам ваши онтологии и сохранить ваши оценки.'),
      backend.kind === 'mock' ? h('label', { style: { display: 'grid', gap: '4px', fontSize: '12px', color: 'var(--muted-2)' } },
        'Демонстрационный вход: email', h('input#mock-email', { type: 'email', value: opts.mockEmail || 'gipocentr@gmail.com',
          style: { padding: '7px', border: '1px solid var(--line-3)', borderRadius: '6px' } })) : null,
      h('button.gbtn', { onclick: async () => {
        try {
          const em = document.getElementById('mock-email');
          await backend.signIn(em ? em.value : undefined);
          route();
        } catch (e) { loginScreen(e.code === 'auth/popup-closed-by-user' ? '' : (e.message || String(e))); }
      } }, h('span', { style: { fontWeight: '700', color: '#4285F4' } }, 'G'), 'Войти через Google'),
      err ? h('div.err', err) : null))));
  }

  function noAccess() {
    show(h('div.sh', h('div.login', h('div.box',
      h('h1', 'Доступ ещё не выдан'),
      h('p.lead', `Вы вошли как ${ctx.user.email}. Администратор платформы ещё не добавил этот адрес. Напишите ему и после этого обновите страницу.`),
      h('button.btn', { onclick: async () => { await backend.signOut(); route(); } }, 'Войти под другим аккаунтом')))));
  }

  // ------------------------------------------------------------ мои онтологии
  async function listScreen() {
    loading();
    try { ctx.ontologies = await backend.listOntologies(); } catch (e) { fail(e); ctx.ontologies = []; }
    const mine = ctx.ontologies.filter((o) => o.status !== 'archived' || ctx.admin);
    if (mine.length === 1 && !ctx.admin && !flash.text && !sessionStorage.getItem('ol.stayList')) {
      sessionStorage.setItem('ol.stayList', '1');
      go('#/o/' + mine[0].id);
      return;
    }
    const cards = h('div.cards');
    for (const o of mine) cards.append(ontologyCard(o));
    show(frame('list',
      h('div', h('h1', 'Мои онтологии'),
        h('p.lead', mine.length ? 'Выберите онтологию, чтобы продолжить работу.' : 'Вам пока не назначена ни одна онтология. Когда администратор или редактор добавит вас, она появится здесь.')),
      mine.length ? cards : h('div.empty-o', ctx.admin ? 'Онтологий пока нет. Создайте первую в разделе «Управление».' : 'Здесь пока пусто.')));
    // числа на карточках дописываются по мере загрузки
    for (const o of mine) fillCard(o);
  }

  function roleIn(o) {
    const e = normEmail(ctx.user.email);
    if (ctx.admin || o.editors.includes(e)) return 'editor';
    return 'expert';
  }

  function ontologyCard(o) {
    const role = roleIn(o);
    return h('article.card-o', { id: 'card-' + o.id },
      h('div.role', role === 'editor' ? 'редактор' : 'эксперт', o.status === 'closed' ? ' · экспертиза закрыта' : ''),
      h('h3', o.title),
      o.description ? h('p.desc', o.description) : null,
      h('div.meta', h('span', o.currentVersion ? 'версия ' + o.currentVersion : 'версия не опубликована'), h('span.cnt', '')),
      h('div.bar', h('i', { style: { width: '0%' } })),
      h('div.nums'),
      h('div.acts',
        o.currentVersion ? h('button.btn.primary', { onclick: () => go('#/o/' + o.id) }, role === 'editor' ? 'Открыть' : 'Продолжить') : null,
        role === 'editor' ? h('button.btn', { onclick: () => go('#/o/' + o.id + '/new') }, 'Новая версия') : null,
        role === 'editor' ? h('button.btn', { onclick: () => go('#/o/' + o.id + '/people') }, 'Эксперты') : null));
  }

  async function fillCard(o) {
    const card = document.getElementById('card-' + o.id);
    if (!card || !o.currentVersion) return;
    try {
      const versions = await backend.listVersions(o.id);
      const v = versions.find((x) => x.id === o.currentVersion);
      const terms = (v && v.metrics && v.metrics.terms) || 0;
      const cnt = card.querySelector('.cnt');
      if (terms) cnt.textContent = `${terms} терминов`;
      const nums = card.querySelector('.nums');
      if (roleIn(o) === 'editor') {
        const all = await backend.allReviews(o.id, o.currentVersion);
        const done = all.map((x) => Object.values(x.items).filter((r) => r.verdict).length);
        const avg = done.length && terms ? Math.round(done.reduce((a, b) => a + b, 0) / done.length / terms * 100) : 0;
        let disagree = 0;
        const iris = new Set(all.flatMap((x) => Object.keys(x.items)));
        for (const iri of iris) {
          const vs = all.map((x) => x.items[iri] && x.items[iri].verdict).filter((x) => x && x !== 'unclear');
          if (vs.length > 1 && vs.some((x) => x !== vs[0])) disagree++;
        }
        card.querySelector('.bar i').style.width = avg + '%';
        nums.replaceChildren(
          h('div', h('b', `${all.length} / ${o.experts.length}`), 'экспертов начали'),
          h('div', h('b', avg + ' %'), 'проверено в среднем'),
          h('div', h('b', String(disagree)), 'расхождений'));
      } else {
        const my = await backend.myReviews(o.id, o.currentVersion);
        const n = Object.values(my).filter((r) => r.verdict).length;
        const pct = terms ? Math.round(n / terms * 100) : 0;
        card.querySelector('.bar i').style.width = pct + '%';
        nums.replaceChildren(h('div', h('b', `${n} / ${terms || '?'}`), 'проверено вами'), h('div', h('b', pct + ' %'), 'готово'));
      }
    } catch (e) { /* числа на карточке не обязательны */ }
  }

  // ------------------------------------------------------------ рабочее пространство
  async function workspace(oid, preview) {
    loading(preview ? 'Подготовка предпросмотра…' : 'Загрузка онтологии…');
    let o;
    try { o = await backend.getOntology(oid); } catch (e) { fail(e); go('#/'); return; }
    const role = roleIn(o);
    if (preview && role !== 'editor') { go('#/o/' + oid); return; }
    const base = { backend, ontology: o, email: normEmail(ctx.user.email), name: (ctx.person && ctx.person.name) || ctx.user.email,
      role, onBack: () => { sessionStorage.setItem('ol.stayList', '1'); go('#/'); } };
    const host = h('div', { style: { height: '100%' } });
    mount.replaceChildren(host);
    if (preview) {
      await openWorkspace(host, { ...base, preview: true, files: [], onPublish: async (p) => {
        try {
          const vid = await backend.publishVersion(oid, { files: p.files, profile: p.profile, profileName: p.profileName,
            layout: p.layout, metrics: p.metrics, note: '' });
          flash.text = `Опубликована версия ${vid}.`; flash.kind = 'ok';
          go('#/o/' + oid);
        } catch (e) { alertBox('Публикация не удалась: ' + (e.message || e)); }
      } });
      return;
    }
    if (!o.currentVersion) { flash.text = 'У этой онтологии ещё нет опубликованной версии.'; go('#/'); return; }
    let data, prevVid = null;
    try {
      data = await backend.getVersionFiles(oid, o.currentVersion);
      const vs = await backend.listVersions(oid);
      const i = vs.findIndex((x) => x.id === o.currentVersion);
      prevVid = vs[i + 1] ? vs[i + 1].id : null;
    } catch (e) { fail(e); go('#/'); return; }
    await openWorkspace(host, { ...base, vid: o.currentVersion, prevVid, files: data.files, profile: data.profile,
      profileName: data.version.profileName, layout: data.layout });
  }

  function alertBox(text) {
    const box = h('div', { role: 'alert', class: 'ol-toast bad' }, h('span', text), h('button.linkbtn', { onclick: () => box.remove() }, '✕'));
    document.body.append(box);
  }

  // ------------------------------------------------------------ эксперты онтологии (редактор)
  async function peopleOfOntology(oid) {
    loading();
    let o;
    try { o = await backend.getOntology(oid); } catch (e) { fail(e); go('#/'); return; }
    if (roleIn(o) !== 'editor') { go('#/'); return; }
    const list = h('div.chips', ...o.experts.map((e) => h('span', e, h('button', { 'aria-label': 'Убрать ' + e, onclick: async () => {
      try { await backend.updateOntology(oid, { experts: o.experts.filter((x) => x !== e) }); } catch (err) { fail(err); }
      peopleOfOntology(oid);
    } }, '✕'))));
    const inp = h('input', { type: 'email', id: 'add-expert', placeholder: 'email эксперта', 'aria-label': 'email эксперта' });
    const vis = h('select', { id: 'vis', 'aria-label': 'Видимость оценок' }, ...Object.entries(VIS).map(([k, t]) =>
      h('option', { value: k, selected: o.visibility === k ? true : null }, 'Чужие оценки видны: ' + t)));
    show(frame('list',
      h('div', h('h1', o.title), h('p.lead', 'Эксперты этой онтологии. Добавленный эксперт увидит онтологию при следующем входе. Если человека ещё нет на платформе, его должен завести администратор.')),
      o.experts.length ? list : h('div.empty-o', 'Экспертов пока нет.'),
      h('form.form', { onsubmit: async (ev) => {
        ev.preventDefault();
        const e = normEmail(inp.value);
        if (!e) return;
        try { await backend.updateOntology(oid, { experts: Array.from(new Set([...o.experts, e])) }); flash.text = `Добавлен ${e}.`; flash.kind = 'ok'; }
        catch (err) { fail(err); }
        peopleOfOntology(oid);
      } }, h('label', 'Добавить эксперта', inp), h('button.btn.primary', { type: 'submit' }, 'Добавить')),
      h('div.form', h('label', 'Правило видимости', vis), h('button.btn', { onclick: async () => {
        try { await backend.updateOntology(oid, { visibility: vis.value }); flash.text = 'Сохранено.'; flash.kind = 'ok'; } catch (err) { fail(err); }
        peopleOfOntology(oid);
      } }, 'Сохранить')),
      h('div.acts', h('button.btn', { onclick: () => go('#/') }, '← К списку'))));
  }

  // ------------------------------------------------------------ управление (администратор)
  async function adminScreen() {
    if (!ctx.admin) { go('#/'); return; }
    loading();
    let people = [], onts = [], log = [];
    try { [people, onts, log] = await Promise.all([backend.listPeople(), backend.listOntologies(), backend.listLog(50)]); } catch (e) { fail(e); }
    people.sort((a, b) => a.email.localeCompare(b.email));

    const pe = h('input', { type: 'email', id: 'p-email', required: true });
    const pn = h('input', { type: 'text', id: 'p-name', required: true, placeholder: 'Фамилия И. О.' });
    const pr = h('select', { id: 'p-role' }, h('option', { value: 'member' }, 'участник'), h('option', { value: 'admin' }, 'администратор'));
    const peopleForm = h('form.form', { onsubmit: async (ev) => {
      ev.preventDefault();
      try { await backend.savePerson({ email: pe.value, name: pn.value, role: pr.value, active: true }); flash.text = `Сохранён ${normEmail(pe.value)}.`; flash.kind = 'ok'; }
      catch (e) { fail(e); }
      adminScreen();
    } }, h('label', 'Email (Google)', pe), h('label', 'Имя для отчётов', pn), h('label', 'Роль', pr), h('button.btn.primary', { type: 'submit' }, 'Добавить или обновить'));

    const peopleTbl = h('table.tbl', h('thead', h('tr', h('th', 'Email'), h('th', 'Имя'), h('th', 'Роль'), h('th', 'Онтологии'), h('th', ''))),
      h('tbody', ...people.map((p) => {
        const where = onts.filter((o) => o.editors.includes(p.email) || o.experts.includes(p.email))
          .map((o) => `${o.title} (${o.editors.includes(p.email) ? 'редактор' : 'эксперт'})`).join('; ');
        return h('tr', h('td', p.email), h('td', p.name), h('td', p.role === 'admin' ? 'администратор' : 'участник', p.active === false ? h('span.pill.off', { style: { marginLeft: '6px' } }, 'отключён') : null),
          h('td', where || '—'),
          h('td', h('button.btn', { onclick: async () => {
            try { await backend.savePerson({ ...p, active: p.active === false }); } catch (e) { fail(e); }
            adminScreen();
          } }, p.active === false ? 'Включить' : 'Отключить')));
      })));

    const ot = h('input', { type: 'text', id: 'o-title', required: true, placeholder: 'GeodeticOnt-KZ — строительная геодезия' });
    const oc = h('input', { type: 'text', id: 'o-code', placeholder: 'код (латиница), можно пусто' });
    const oe = h('input', { type: 'text', id: 'o-editors', placeholder: 'email редакторов через запятую' });
    const od = h('input', { type: 'text', id: 'o-desc', placeholder: 'описание, одна строка' });
    const ontForm = h('form.form', { onsubmit: async (ev) => {
      ev.preventDefault();
      const id = slugCode(oc.value || ot.value);
      const editors = oe.value.split(/[,;\s]+/).map(normEmail).filter(Boolean);
      try { await backend.createOntology({ id, title: ot.value.trim(), description: od.value.trim(), editors, experts: [] }); flash.text = `Создана онтология ${id}.`; flash.kind = 'ok'; }
      catch (e) { fail(e); }
      adminScreen();
    } }, h('label', 'Название', ot), h('label', 'Код', oc), h('label', 'Редакторы', oe), h('label', 'Описание', od), h('button.btn.primary', { type: 'submit' }, 'Создать'));

    const ontTbl = h('table.tbl', h('thead', h('tr', h('th', 'Код'), h('th', 'Название'), h('th', 'Версия'), h('th', 'Редакторы'), h('th', 'Экспертов'), h('th', 'Статус'), h('th', ''))),
      h('tbody', ...onts.map((o) => h('tr', h('td', h('code', o.id)), h('td', o.title), h('td', o.currentVersion || '—'),
        h('td', o.editors.join(', ') || '—'), h('td', String(o.experts.length)), h('td', o.status),
        h('td', h('div.acts',
          h('button.btn', { onclick: async () => {
            const v = prompt('Редакторы (email через запятую):', o.editors.join(', '));
            if (v == null) return;
            try { await backend.updateOntology(o.id, { editors: v.split(/[,;\s]+/).map(normEmail).filter(Boolean) }); } catch (e) { fail(e); }
            adminScreen();
          } }, 'Редакторы'),
          h('button.btn', { onclick: async () => {
            const next = o.status === 'open' ? 'closed' : o.status === 'closed' ? 'archived' : 'open';
            try { await backend.updateOntology(o.id, { status: next }); } catch (e) { fail(e); }
            adminScreen();
          } }, o.status === 'open' ? 'Закрыть экспертизу' : o.status === 'closed' ? 'В архив' : 'Открыть')))))));

    const logTbl = h('table.tbl', h('thead', h('tr', h('th', 'Когда'), h('th', 'Кто'), h('th', 'Что'), h('th', 'Подробности'))),
      h('tbody', ...log.map((x) => h('tr', h('td', new Date(x.ts).toLocaleString('ru-RU')), h('td', x.email), h('td', x.action), h('td', x.details)))));

    show(frame('admin',
      h('div', h('h1', 'Управление'), h('p.lead', 'Люди, онтологии и журнал действий. Вход — только через Google, поэтому указывайте адрес, которым человек входит в Google.')),
      h('h2', 'Участники'), peopleForm, h('div.tblwrap', peopleTbl),
      h('h2', 'Онтологии'), ontForm, h('div.tblwrap', ontTbl),
      h('h2', 'Журнал (последние 50)'), h('div.tblwrap', logTbl),
      h('div.acts', h('button.btn', { onclick: async () => {
        try {
          const all = await backend.exportAll();
          const blob = new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `ontolens-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
        } catch (e) { fail(e); adminScreen(); }
      } }, 'Выгрузить всю базу (JSON)'))));
  }

  // ------------------------------------------------------------ маршрутизация
  async function route() {
    const user = backend.currentUser() || await backend.init();
    ctx.user = user;
    if (!user) { loginScreen(); return; }
    if (!ctx.person || normEmail(ctx.person.email) !== normEmail(user.email)) {
      loading();
      try { ctx.person = await backend.me(); } catch (e) { ctx.person = null; }
      ctx.admin = !!(ctx.person && ctx.person.role === 'admin' && ctx.person.active !== false);
    }
    if (!ctx.person || ctx.person.active === false) { noAccess(); return; }
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    if (parts[0] === 'admin') return adminScreen();
    if (parts[0] === 'o' && parts[1]) {
      if (parts[2] === 'new') return workspace(parts[1], true);
      if (parts[2] === 'people') return peopleOfOntology(parts[1]);
      return workspace(parts[1], false);
    }
    return listScreen();
  }

  window.addEventListener('hashchange', route);
  route();
  return { route, ctx, state: WS };
}
