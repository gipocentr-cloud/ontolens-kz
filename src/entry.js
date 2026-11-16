import * as OL from './app.js';
const { boot } = OL;
const mount = document.getElementById('app');
mount.innerHTML = '';
window.__ontolens = OL;
boot(mount).catch((e) => {
  mount.innerHTML = '<pre style="padding:20px;white-space:pre-wrap;color:#8E2F27">'
    + String(e && e.stack || e).replace(/[<&]/g, (c) => ({ '<': '&lt;', '&': '&amp;' }[c])) + '</pre>';
});
