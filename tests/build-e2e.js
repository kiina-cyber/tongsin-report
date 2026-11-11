// 產生端對端測試用的 App 頁面：把真的 docs/index.html 接到「外層頁面模擬的 Google 伺服器」
// 執行：node tests/build-e2e.js，接著用瀏覽器開 tests/e2e.html
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let h = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
const shim = `<script>
  // 網路開關由外層頁面控制；fetch 改成呼叫外層的模擬伺服器
  Object.defineProperty(Navigator.prototype, 'onLine', { get(){ return parent.__online; } });
  window.fetch = async (url, opt) => {
    await new Promise(r => setTimeout(r, 15));
    if(!parent.__online) throw new TypeError('Failed to fetch');
    const res = parent.__gasCall(JSON.parse(opt.body));
    return { json: async () => JSON.parse(JSON.stringify(res)) };
  };
  window.confirm = m => parent.__confirm(m);
  window.alert = m => parent.__alerts.push(m);
  var API_URL = 'https://script.google.com/macros/s/fake/exec';
</script>`;
h = h.replace('<script src="config.js"></script>', shim).replace('<script src="shared.js"></script>', '<script src="../docs/shared.js"></script>');
// App 裡用 const/let 宣告的變數不會掛在 window 上，這裡開放給測試讀寫
const expose = `<script>
  Object.defineProperties(window, {
    me:{ get:()=>me }, S:{ get:()=>S }, Q:{ get:()=>Q }, ui:{ get:()=>ui }, TOKEN:{ get:()=>TOKEN }, syncing:{ get:()=>syncing },
    dlg:{ get:()=>dlg, set:v=>{ dlg=v; } } });
</script>`;
h = h.replace(/<\/body>\s*<\/html>\s*$/, expose + '\n</body>\n</html>\n');
fs.writeFileSync(path.join(__dirname, '_app.html'), h);
console.log('已產生 tests/_app.html');
