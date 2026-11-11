// 手機尺寸檢查：在 14 款常見手機尺寸（含瀏海、橫條）下量測版面是否被切到或擠壓
// 需要先安裝：npm i puppeteer-core　執行：node tests/build-e2e.js && node tests/devices.check.js .
const http=require('http'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const root=path.resolve(process.argv[2]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.gs':'text/javascript; charset=utf-8','.png':'image/png'};
const server=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);const f=path.resolve(path.join(root,p));if(!fs.existsSync(f)){s.writeHead(404);return s.end();}s.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s);}).listen(8768);
const D=[
 {n:'iPhone SE 第2/3代',w:375,h:667,t:20,b:0},{n:'iPhone 12/13 mini',w:375,h:812,t:50,b:34},{n:'iPhone 12/13/14',w:390,h:844,t:47,b:34},
 {n:'iPhone 12/13 Pro Max・14 Plus',w:428,h:926,t:47,b:34},{n:'iPhone 14 Pro・15・16',w:393,h:852,t:59,b:34},
 {n:'iPhone 15 Pro Max・16 Plus',w:430,h:932,t:59,b:34},{n:'iPhone 16 Pro',w:402,h:874,t:62,b:34},{n:'iPhone 16 Pro Max',w:440,h:956,t:62,b:34},
 {n:'Galaxy S23/S24',w:360,h:780,t:28,b:16},{n:'Galaxy S24 Ultra',w:384,h:824,t:28,b:16},{n:'Galaxy A54/A55',w:412,h:915,t:28,b:16},
 {n:'Pixel 8',w:412,h:915,t:28,b:16},{n:'Pixel 8 Pro',w:448,h:998,t:28,b:16},{n:'Galaxy Z Fold 外螢幕',w:344,h:882,t:28,b:16}];
(async()=>{const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',protocolTimeout:120000});
 const rows=[]; try{ const pg=await b.newPage(); await pg.setViewport({width:500,height:1100}); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto('http://localhost:8768/tests/devices.html',{waitUntil:'load'}); await pg.evaluate(()=>init()); await pg.evaluate(()=>prepare());
  for(const d of D){ const s=new Set(); for(const big of [false,true]) for(const off of [false,true]) (await pg.evaluate((d,big,off)=>check(d,big,off),d,big,off)).forEach(x=>s.add((big?'[大字] ':'')+x)); d.sales=[...s]; }
  await pg.evaluate(()=>loginBoss());
  for(const d of D){ const s=new Set(); for(const big of [false,true]) (await pg.evaluate((d,big)=>checkLobby(d,big),d,big)).forEach(x=>s.add((big?'[大字] ':'')+x)); d.boss=[...s]; }
  await pg.evaluate(()=>doLogout());
  for(const d of D){ const s=new Set(); for(const big of [false,true]) (await pg.evaluate((d,big)=>checkLogin(d,big),d,big)).forEach(x=>s.add((big?'[大字] ':'')+x)); d.login=[...s]; }
  for(const d of D){ const all=[...d.login,...d.sales,...d.boss]; rows.push((all.length?'✗ ':'✓ ')+d.n+'（'+d.w+'×'+d.h+'）'+(all.length?'\n    - '+all.join('\n    - '):'')); }
  rows.push('頁面錯誤：'+(errs.length?errs.join(' / '):'無'));
 }catch(e){rows.push('EXC '+e.message);} finally{await b.close();server.close();console.log(rows.join('\n'));}})();
