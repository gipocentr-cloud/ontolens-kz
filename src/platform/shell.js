/**
 * Оболочка платформы OntoLens-KZ (ТЗ v2.2, раздел 5): вход, «Мои онтологии»,
 * управление, предпросмотр и публикация версии, переход в рабочее пространство.
 *
 * Адреса: #/ — список, #/o/<код> — работа с онтологией, #/o/<код>/new — новая версия,
 * #/o/<код>/people — эксперты онтологии, #/admin — управление, #/admin/<код> — настройки онтологии.
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
.form input,.form select,.form textarea,.osec select{padding:6px 8px;border:1px solid var(--line-3);border-radius:6px;background:#fff;min-width:160px}
.form textarea{min-width:min(520px,80vw);min-height:60px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;border:1px solid var(--line-3)}
.pill.off{color:var(--red);border-color:var(--red)}
.loadingsh{flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted-2)}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chips span{background:var(--paper-2);border:1px solid var(--line-2);border-radius:99px;padding:2px 8px;font-size:12px}
.chips button{border:0;background:none;color:var(--red);padding:0 0 0 4px}
.sh h2 .cnt,.osec h3 .cnt{color:var(--muted-2);font-weight:400}
.newo>summary{cursor:pointer;display:inline-block;padding:7px 13px;border-radius:7px;border:1px solid var(--line-3);background:var(--white);font-size:13.5px;margin-bottom:8px}
.newo[open]>summary{background:var(--paper-2)}
.olist{display:grid;gap:8px}
.orow{display:grid;grid-template-columns:minmax(200px,2.2fr) auto minmax(120px,1fr) minmax(170px,1.2fr) auto 16px;gap:12px;align-items:center;text-align:left;width:100%;background:var(--white);border:1px solid var(--line);border-radius:9px;padding:11px 14px;font-size:13.5px;cursor:pointer}
.orow:hover,.orow:focus-visible{border-color:var(--ink)}
.orow .ot{font-weight:600}
.om{color:var(--muted-2);font-size:12.5px}
.chev{color:var(--muted-2);font-size:18px}
.opanel{background:var(--white);border:1.5px solid var(--ink);border-radius:10px;padding:16px 18px;display:grid;gap:16px;scroll-margin-top:12px}
.ohead{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:start}
.ohead h2{font-family:var(--serif);font-size:21px;margin:0 0 4px}
.ogrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px 22px}
.osec{display:grid;gap:8px;align-content:start;border-top:1px solid var(--line-2);padding-top:10px}
.osec h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0}
.hint{font-size:12.5px;color:var(--muted-2);margin:0;line-height:1.45}
.warnx{color:var(--red);font-style:normal;font-size:11px}
.form.inl{background:none;border:0;padding:0}
.form.inl{flex-wrap:wrap}
.form.inl label{flex:1 1 220px}
.form.inl input{min-width:150px;flex:1 1 180px}
.form.inl label input{width:100%;box-sizing:border-box}
.seg2{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line-3);border-radius:8px;overflow:hidden;justify-self:start}
.seg2 button{border:0;border-right:1px solid var(--line-3);background:var(--white);padding:6px 11px;font-size:13px}
.seg2 button:last-child{border-right:0}
.seg2 button[aria-checked="true"]{background:var(--ink);color:var(--paper)}
.pill.st-open{color:#2E5E3A;border-color:#2E5E3A}
.pill.st-closed{color:#7A4F00;border-color:#C79A3C}
.pill.st-archived{color:var(--muted-2)}
.pill.cur{color:#2E5E3A;border-color:#2E5E3A}
.sh .btn.bad{color:var(--red);border-color:var(--red)}
.logd>summary{cursor:pointer}
@media (max-width:760px){.orow{grid-template-columns:1fr auto}.orow .om,.orow code{display:none}}
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
  // #/admin — список онтологий и участников; #/admin/<код> — карточка онтологии раскрыта.
  const STATUS = { open: 'экспертиза открыта', closed: 'экспертиза закрыта', archived: 'в архиве' };
  const fmtDate = (s) => { try { return new Date(s).toLocaleDateString('ru-RU'); } catch (e) { return s || ''; } };

  async function adminScreen(openId) {
    if (!ctx.admin) { go('#/'); return; }
    loading();
    let people = [], onts = [], log = [];
    try { [people, onts, log] = await Promise.all([backend.listPeople(), backend.listOntologies(), backend.listLog(50)]); } catch (e) { fail(e); }
    people.sort((a, b) => a.email.localeCompare(b.email));
    onts.sort((a, b) => (a.status === 'archived') - (b.status === 'archived') || a.title.localeCompare(b.title, 'ru'));
    const known = new Map(people.map((p) => [p.email, p]));
    const nameOf = (e) => (known.get(e) && known.get(e).name) || e;
    const again = () => adminScreen(openId);
    const done = (text) => { flash.text = text; flash.kind = 'ok'; };

    // общий список адресов для подсказки в полях
    const dl = h('datalist#people-list', ...people.filter((p) => p.active !== false).map((p) => h('option', { value: p.email }, p.name)));

    // ---------- онтологии
    const ot = h('input', { type: 'text', id: 'o-title', required: true, placeholder: 'GeodeticOnt-KZ — строительная геодезия' });
    const oc = h('input', { type: 'text', id: 'o-code', placeholder: 'латиница; пусто — из названия' });
    const oe = h('input', { type: 'text', id: 'o-editors', placeholder: 'email через запятую', list: 'people-list' });
    const od = h('input', { type: 'text', id: 'o-desc', placeholder: 'одна строка' });
    const ontForm = h('form#o-form.form', { onsubmit: async (ev) => {
      ev.preventDefault();
      const id = slugCode(oc.value || ot.value);
      const editors = oe.value.split(/[,;\s]+/).map(normEmail).filter(Boolean);
      try { await backend.createOntology({ id, title: ot.value.trim(), description: od.value.trim(), editors, experts: [] }); done(`Создана онтология ${id}. Следующий шаг — загрузить первую версию.`); go('#/admin/' + id); return; }
      catch (e) { fail(e); }
      again();
    } }, h('label', 'Название', ot), h('label', 'Код', oc), h('label', 'Редакторы', oe), h('label', 'Описание', od), h('button.btn.primary', { type: 'submit' }, 'Создать'));
    const newBox = h('details.newo', onts.length ? null : { open: true }, h('summary', '+ Новая онтология'), ontForm);

    const rows = h('div.olist', ...onts.map((o) => (o.id === openId ? ontologyPanel(o) : ontologyRow(o))));

    function ontologyRow(o) {
      return h('button.orow', { type: 'button', 'aria-expanded': 'false', 'data-oid': o.id, onclick: () => go('#/admin/' + o.id) },
        h('span.ot', o.title), h('code', o.id),
        h('span.om', o.currentVersion ? 'версия ' + o.currentVersion : 'версия не загружена'),
        h('span.om', `редакторов ${o.editors.length} · экспертов ${o.experts.length}`),
        h('span', { class: 'pill st-' + o.status }, STATUS[o.status] || o.status),
        h('span.chev', '›'));
    }

    // список адресов с удалением и добавлением; новых людей сразу заводит участниками
    function emailList(o, field, label, hint) {
      const list = o[field];
      const chips = h('div.chips', ...list.map((e) => h('span', { title: e },
        nameOf(e), known.has(e) ? null : h('em.warnx', ' (нет среди участников)'),
        h('button', { type: 'button', 'aria-label': `Убрать ${e} из списка «${label}»`, onclick: async () => {
          try { await backend.updateOntology(o.id, { [field]: list.filter((x) => x !== e) }); done(`${e} убран.`); } catch (err) { fail(err); }
          again();
        } }, '✕'))));
      const em = h('input', { type: 'email', id: `add-${field}`, placeholder: 'email (Google)', list: 'people-list', required: true, 'aria-label': `email — ${label}` });
      const nm = h('input', { type: 'text', id: `add-${field}-name`, placeholder: 'Ф. И. О. (если новый)', 'aria-label': `имя — ${label}` });
      const form = h('form.form.inl', { onsubmit: async (ev) => {
        ev.preventDefault();
        const e = normEmail(em.value);
        if (!e) return;
        try {
          if (!known.has(e)) {
            if (!nm.value.trim()) { fail(`${e} нет среди участников. Укажите имя — участник будет заведён, иначе он не сможет войти.`); again(); return; }
            await backend.savePerson({ email: e, name: nm.value.trim(), role: 'member', active: true });
          }
          await backend.updateOntology(o.id, { [field]: Array.from(new Set([...list, e])) });
          done(`${e} добавлен.`);
        } catch (err) { fail(err); }
        again();
      } }, em, nm, h('button.btn', { type: 'submit' }, 'Добавить'));
      return h('section.osec', h('h3', label, h('span.cnt', ' ' + list.length)), hint ? h('p.hint', hint) : null,
        list.length ? chips : h('p.hint', 'Пока никого.'), form);
    }

    function ontologyPanel(o) {
      const panel = h('section#o-panel.opanel', { 'data-oid': o.id, 'aria-label': o.title });
      const close = h('button.btn', { type: 'button', onclick: () => go('#/admin') }, 'Свернуть');
      const head = h('div.ohead',
        h('div', h('h2', o.title), h('div.om', h('code', o.id), ' · ', o.currentVersion ? 'текущая версия ' + o.currentVersion : 'версия не загружена',
          ' · ', h('span', { class: 'pill st-' + o.status }, STATUS[o.status] || o.status))),
        h('div.acts',
          o.currentVersion ? h('button.btn.primary', { type: 'button', onclick: () => go('#/o/' + o.id) }, 'Открыть') : null,
          h('button.btn', { type: 'button', class: o.currentVersion ? 'btn' : 'btn primary', onclick: () => go('#/o/' + o.id + '/new') },
            o.currentVersion ? 'Загрузить новую версию' : 'Загрузить первую версию'),
          close));

      // название и описание
      const t = h('input', { type: 'text', id: 'e-title', value: o.title, required: true });
      const dsc = h('input', { type: 'text', id: 'e-desc', value: o.description || '' });
      const info = h('section.osec', h('h3', 'Название и описание'),
        h('form.form.inl', { onsubmit: async (ev) => {
          ev.preventDefault();
          try { await backend.updateOntology(o.id, { title: t.value.trim(), description: dsc.value.trim() }); done('Сохранено.'); } catch (e) { fail(e); }
          again();
        } }, h('label', 'Название', t), h('label', 'Описание', dsc), h('button.btn', { type: 'submit' }, 'Сохранить')),
        h('p.hint', 'Код ', h('code', o.id), ' не меняется: по нему хранятся версии и оценки.'));

      // статус
      const stat = h('section.osec', h('h3', 'Статус и видимость оценок'),
        h('div.seg2', { role: 'radiogroup', 'aria-label': 'Статус онтологии' }, ...Object.entries(STATUS).map(([k, txt]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.status === k), onclick: async () => {
            if (o.status === k) return;
            try { await backend.updateOntology(o.id, { status: k }); done(`Статус: ${txt}.`); } catch (e) { fail(e); }
            again();
          } }, txt))),
        h('p.hint', 'Закрыта — эксперты видят онтологию, но новые оценки не принимаются. В архиве — онтология скрыта у всех, кроме администратора.'));

      // видимость оценок
      const vis = h('select', { id: 'e-vis', 'aria-label': 'Видимость чужих оценок' }, ...Object.entries(VIS).map(([k, tx]) =>
        h('option', { value: k, selected: o.visibility === k ? true : null }, tx)));
      vis.addEventListener('change', async () => {
        try { await backend.updateOntology(o.id, { visibility: vis.value }); done('Правило видимости сохранено.'); } catch (e) { fail(e); }
        again();
      });
      stat.append(h('label', { style: { display: 'grid', gap: '4px', fontSize: '12px', color: 'var(--muted-2)', marginTop: '6px' } }, 'Чужие оценки эксперты видят', vis));

      // версии — загружаются отдельно
      const verBox = h('section#o-versions.osec', h('h3', 'Версии'), h('p.hint', 'Загрузка…'));
      (async () => {
        let vs = [];
        try { vs = await backend.listVersions(o.id); } catch (e) { verBox.replaceChildren(h('h3', 'Версии'), h('p.err', String(e.message || e))); return; }
        const del = document.getElementById('o-delete');
        if (del && vs.length) del.replaceChildren(h('h3', 'Удаление'), h('p.hint', 'Удалить нельзя: у онтологии есть опубликованные версии и, возможно, оценки. Отправьте её в архив.'));
        if (!vs.length) { verBox.replaceChildren(h('h3', 'Версии'), h('p.hint', 'Версий нет. Нажмите «Загрузить первую версию»: выберите файлы .ttl и profile.json, проверьте диагностику и опубликуйте.')); return; }
        verBox.replaceChildren(h('h3', 'Версии', h('span.cnt', ' ' + vs.length)),
          h('div.tblwrap', h('table.tbl', h('thead', h('tr', h('th', 'Версия'), h('th', 'Дата'), h('th', 'Кто'), h('th', 'Терминов'), h('th', 'Файлы'), h('th', ''))),
            h('tbody', ...vs.map((v) => h('tr',
              h('td', h('b', v.id)), h('td', fmtDate(v.created)), h('td', nameOf(v.createdBy)),
              h('td', String((v.metrics && v.metrics.terms) || '—')),
              h('td', (v.files || []).map((f) => f.name).join(', ') + (v.profileName ? ' + ' + v.profileName : '')),
              h('td', v.id === o.currentVersion ? h('span.pill.cur', 'текущая') : h('button.btn', { type: 'button', onclick: async () => {
                if (!confirm(`Сделать текущей версию ${v.id}? Эксперты будут оценивать её; оценки других версий сохраняются.`)) return;
                try { await backend.updateOntology(o.id, { currentVersion: v.id }); done(`Текущая версия — ${v.id}.`); } catch (e) { fail(e); }
                again();
              } }, 'Сделать текущей'))))))));
      })();

      const delSec = h('section#o-delete.osec.danger', h('h3', 'Удаление'),
        o.currentVersion ? h('p.hint', 'Удалить нельзя: у онтологии есть опубликованные версии и, возможно, оценки. Отправьте её в архив.')
          : h('div', h('p.hint', 'Версий нет, поэтому онтологию можно удалить.'), h('button.btn.bad', { type: 'button', onclick: async () => {
            if (!confirm(`Удалить онтологию «${o.title}» (${o.id})? Это нельзя отменить.`)) return;
            try { await backend.deleteOntology(o.id); done(`Онтология ${o.id} удалена.`); go('#/admin'); return; } catch (e) { fail(e); }
            again();
          } }, 'Удалить онтологию')));

      panel.append(head,
        h('div.ogrid',
          emailList(o, 'editors', 'Редакторы', 'Загружают версии, видят все оценки, назначают экспертов.'),
          emailList(o, 'experts', 'Эксперты', 'Оценивают текущую версию.'),
          info, stat),
        verBox, delSec);
      return panel;
    }

    // ---------- участники
    const pe = h('input', { type: 'email', id: 'p-email', required: true });
    const pn = h('input', { type: 'text', id: 'p-name', required: true, placeholder: 'Фамилия И. О.' });
    const pr = h('select', { id: 'p-role' }, h('option', { value: 'member' }, 'участник'), h('option', { value: 'admin' }, 'администратор'));
    const peopleForm = h('form#p-form.form', { onsubmit: async (ev) => {
      ev.preventDefault();
      try { await backend.savePerson({ email: pe.value, name: pn.value, role: pr.value, active: true }); done(`Сохранён ${normEmail(pe.value)}.`); }
      catch (e) { fail(e); }
      again();
    } }, h('label', 'Email (Google)', pe), h('label', 'Имя для отчётов', pn), h('label', 'Роль', pr), h('button.btn.primary', { type: 'submit' }, 'Добавить или обновить'));

    const peopleTbl = h('table.tbl', h('thead', h('tr', h('th', 'Email'), h('th', 'Имя'), h('th', 'Роль'), h('th', 'Онтологии'), h('th', ''))),
      h('tbody', ...people.map((p) => {
        const where = onts.filter((o) => o.editors.includes(p.email) || o.experts.includes(p.email));
        return h('tr', h('td', p.email), h('td', p.name), h('td', p.role === 'admin' ? 'администратор' : 'участник', p.active === false ? h('span.pill.off', { style: { marginLeft: '6px' } }, 'отключён') : null),
          h('td', where.length ? where.flatMap((o, i) => [i ? '; ' : '', h('a', { href: '#/admin/' + o.id }, o.title), ` (${o.editors.includes(p.email) ? 'редактор' : 'эксперт'})`]) : '—'),
          h('td', h('button.btn', { type: 'button', onclick: async () => {
            try { await backend.savePerson({ ...p, active: p.active === false }); } catch (e) { fail(e); }
            again();
          } }, p.active === false ? 'Включить' : 'Отключить')));
      })));

    const logTbl = h('table.tbl', h('thead', h('tr', h('th', 'Когда'), h('th', 'Кто'), h('th', 'Что'), h('th', 'Подробности'))),
      h('tbody', ...log.map((x) => h('tr', h('td', new Date(x.ts).toLocaleString('ru-RU')), h('td', x.email), h('td', x.action), h('td', x.details)))));

    show(frame('admin', dl,
      h('div', h('h1', 'Управление'), h('p.lead', 'Онтологии, участники и журнал. Нажмите на онтологию, чтобы открыть её настройки: версии, редакторы, эксперты, статус. Вход — только через Google, поэтому указывайте адрес, которым человек входит в Google.')),
      h('h2', 'Онтологии', h('span.cnt', ' ' + onts.length)), newBox,
      onts.length ? rows : h('div.empty-o', 'Онтологий пока нет.'),
      h('h2', 'Участники', h('span.cnt', ' ' + people.length)), peopleForm, h('div.tblwrap', peopleTbl),
      h('details.logd', h('summary', h('h2', { style: { display: 'inline' } }, 'Журнал (последние 50)')), h('div.tblwrap', logTbl)),
      h('div.acts', h('button.btn', { type: 'button', onclick: async () => {
        try {
          const all = await backend.exportAll();
          const blob = new Blob([JSON.stringify(all, null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `ontolens-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
        } catch (e) { fail(e); again(); }
      } }, 'Выгрузить всю базу (JSON)'))));
    const pnl = document.getElementById('o-panel');
    if (pnl) pnl.scrollIntoView({ block: 'start' });
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
    if (parts[0] === 'admin') return adminScreen(parts[1] ? decodeURIComponent(parts[1]) : null);
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
