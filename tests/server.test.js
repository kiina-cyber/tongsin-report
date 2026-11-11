// 伺服器端測試：用模擬的 Google 環境執行 Shared + Code.gs
// 執行：node tests/server.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, Date, Math, JSON };
vm.createContext(ctx);
for(const f of ['tests/fake-gas.js', 'docs/shared.js', 'apps-script/Code.gs'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

let pass = 0, fail = 0;
const ok = (cond, msg) => { if(cond){ pass++; } else { fail++; console.log('  ✗ ' + msg); } };
const call = b => ctx.__gasCall(b);
const sheet = n => ctx.__gasBook.getSheetByName(n);
const rowsOf = n => { const s = sheet(n); return s._data.slice(1, s.getLastRow()); };

// ---------- 共用規則兩份要一樣 ----------
ok(fs.readFileSync(path.join(root,'docs/shared.js'),'utf8') === fs.readFileSync(path.join(root,'apps-script/Shared.gs'),'utf8'),
   'docs/shared.js 和 apps-script/Shared.gs 內容一致（改了其中一份要複製到另一份）');

// ---------- 安裝 ----------
ok(/安裝完成/.test(ctx.setup()), 'setup 回傳完成');
ok(['業務','案件','更新紀錄','經驗值紀錄','設定','系統紀錄'].every(n => sheet(n)), '建立 6 個工作表');
ok(!sheet('工作表1'), '刪掉空白的預設工作表');
const users0 = rowsOf('業務');
ok(users0.length === 3 && users0.every(r => r[0]), '範例業務都有 ID');

// ---------- 名單與登入 ----------
const roster = call({ action:'roster' });
ok(roster.ok && roster.users.length === 3, '名單有 3 人');
const boss = roster.users.find(u => u.role === 'boss'), s1 = roster.users.find(u => u.name === '業務一號'), s2 = roster.users.find(u => u.name === '業務二號');
ok(roster.users.every(u => !('pin' in u)), '名單不會洩漏密碼');

let r = call({ action:'login', uid:s1.id, pin:'9999' });
ok(!r.ok && r.error === 'WRONG_PIN', '密碼錯誤會被拒絕');
for(let i = 0; i < 4; i++) call({ action:'login', uid:s1.id, pin:'0000' });
r = call({ action:'login', uid:s1.id, pin:'1111' });
ok(!r.ok && r.error === 'LOCKED', '錯 5 次後暫時鎖定（正確密碼也不行）');
ctx.__gasClearCache();
const L1 = call({ action:'login', uid:s1.id, pin:'1111' });
ok(L1.ok && L1.token && L1.state.users.length === 3, '解鎖後正確密碼可以登入');
const L2 = call({ action:'login', uid:s2.id, pin:'2222' });
const LB = call({ action:'login', uid:boss.id, pin:'0000' });
ok(LB.ok, '老闆可以登入');

// ---------- 業務同步 ----------
const now = Date.now();
const c1 = { id:'c-test-1', owner:s1.id, name:'A酒店', cat:'沉浸式包廂', catNote:'', stage:4, stageNote:'投影機規格確認', p:35, st:'doing',
  contact:'李經理', phone:'0912-345-678', addr:'台北市', created:now, updated:now, stagesDone:[4],
  hist:[{ id:'h1', t:now, by:s1.id, stage:4, stageNote:'投影機規格確認', p:35, st:'doing', note:'建立案件' }] };
const ops1 = [
  { id:'op1', type:'addCase', case:c1 },
  { id:'op2', type:'xp', entry:{ id:'x1', uid:s1.id, caseId:c1.id, why:'新增客戶', xp:10, t:now } },
  { id:'op3', type:'profile', set:{ char:{ cls:'mage', g:'f', hair:'long', hc:6, outfit:1 }, tutDone:true } }
];
r = call({ action:'sync', token:L1.token, ops:ops1 });
ok(r.ok && r.results.every(x => x.ok), '新增客戶、經驗值、角色都寫入');
ok(r.state.cases.length === 1 && r.state.users.find(u => u.id === s1.id).xp === 10, '回傳最新資料（1 件、10 XP）');
const caseRow = rowsOf('案件')[0];
ok(caseRow[1] === 'A酒店' && caseRow[3] === '業務一號' && caseRow[6] === '其他' && caseRow[7] === '投影機規格確認' && caseRow[9] === '進行中', '案件表用中文欄位寫入');
ok(caseRow[11] === '0912-345-678', '電話原樣保存');
ok(rowsOf('更新紀錄').length === 1 && rowsOf('經驗值紀錄').length === 1, '更新紀錄、經驗值紀錄各一筆');
ok(rowsOf('業務').find(x => x[0] === s1.id)[5] === 10, '業務表顯示經驗值');

r = call({ action:'sync', token:L1.token, ops:ops1 });
ok(r.results.every(x => x.dup) && rowsOf('經驗值紀錄').length === 1, '重送同一批不會重複套用');

// 完工＝成交
r = call({ action:'sync', token:L1.token, ops:[
  { id:'op4', type:'updateCase', caseId:c1.id, set:{ stage:5, p:40, st:'doing', updated:now+1000, stagesDone:[4,5], dealXP:true, wonAt:now+1000, wonBy:s1.id },
    hist:{ id:'h2', t:now+1000, by:s1.id, stage:5, p:100, st:'won', note:'完工' } },
  { id:'op5', type:'xp', entry:{ id:'x2', uid:s1.id, caseId:c1.id, why:'成交', xp:200, t:now+1000 } } ]});
const sc = r.state.cases[0];
ok(sc.st === 'won' && sc.p === 100 && sc.stage === 5, '完工會強制成為已成交 100%');
ok(r.state.users.find(u => u.id === s1.id).xp === 210, '成交後 210 XP');

// 權限
r = call({ action:'sync', token:L2.token, ops:[{ id:'op6', type:'updateCase', caseId:c1.id, set:{ p:5 } }] });
ok(!r.results[0].ok && r.state.cases.length === 0, '業務二號不能改別人的案件，也看不到');
r = call({ action:'sync', token:L2.token, ops:[{ id:'op7', type:'xp', entry:{ id:'x3', uid:s1.id, xp:500 } }] });
ok(!r.results[0].ok, '不能幫別人加經驗值');
r = call({ action:'sync', token:L1.token, ops:[{ id:'op8', type:'deleteCase', caseId:c1.id }] });
ok(!r.results[0].ok && /已成交/.test(r.results[0].error), '已成交的案件不能刪除');
r = call({ action:'sync', token:L1.token, ops:[{ id:'op9', type:'transfer', caseId:c1.id, to:s2.id }] });
ok(!r.results[0].ok, '業務不能轉派');
r = call({ action:'sync', token:'假的權杖', ops:[] });
ok(!r.ok && r.error === 'AUTH', '假權杖會被擋');

// 老闆：留言、轉派、撤銷
r = call({ action:'sync', token:LB.token, ops:[
  { id:'op10', type:'bossComment', caseId:c1.id, hist:{ id:'h3', t:now+2000, by:boss.id, kind:'boss', note:'價格可以再讓' } },
  { id:'op11', type:'transfer', caseId:c1.id, to:s2.id, hist:{ id:'h4', t:now+3000, by:boss.id, kind:'boss', note:'轉派給業務二號' } },
  { id:'op12', type:'revoke', caseId:c1.id, set:{ dealXP:false, wonAt:null, wonBy:null, revoked:true, st:'doing', stage:3, p:95 },
    hist:{ id:'h5', t:now+4000, by:boss.id, stage:3, p:95, st:'doing', note:'會長撤銷成交' } },
  { id:'op13', type:'xp', entry:{ id:'x4', uid:s1.id, caseId:c1.id, why:'撤銷成交', xp:-200, t:now+4000 } } ]});
ok(r.results.every(x => x.ok), '老闆的留言、轉派、撤銷都成功');
ok(r.state.cases.length === 1 && r.state.cases[0].owner === s2.id && r.state.cases[0].revoked, '老闆看得到全部，案件已轉派且標記撤銷');
ok(r.state.users.find(u => u.id === s1.id).xp === 10, '撤銷後從原本拿到的人扣回（210→10）');
const hRows = rowsOf('更新紀錄');
ok(hRows.length === 5 && hRows.some(h => h[6] === '會長留言' && h[11] === '價格可以再讓'), '更新紀錄包含會長留言');

r = call({ action:'sync', token:L2.token, ops:[] });
ok(r.state.cases.length === 1 && r.state.cases[0].bossUnread, '業務二號現在看得到這件，而且有未讀留言');
r = call({ action:'sync', token:L1.token, ops:[] });
ok(r.state.cases.length === 0 && r.state.xplog.length === 3, '業務一號看不到轉走的案件，但保留自己的經驗值紀錄');

// 老闆手動改試算表
const cs = sheet('案件'); cs._data[1][9] = '已成交';
r = call({ action:'sync', token:LB.token, ops:[] });
ok(r.state.cases[0].st === 'won' && r.state.cases[0].stage === 5 && r.state.cases[0].p === 100, '手動把狀態改成已成交，會自動補成完工 100%');
const us = sheet('業務'); us._data.push(['', '新來的業務', '7', '業務', '是', '', '', '']);
const R1 = call({ action:'roster' }), R2 = call({ action:'roster' });
const nu1 = R1.users.find(u => u.name === '新來的業務'), nu2 = R2.users.find(u => u.name === '新來的業務');
ok(nu1 && nu2 && nu1.id === nu2.id, '老闆新增業務時 ID 留空，系統會補上而且固定不變');
ok(call({ action:'login', uid:nu1.id, pin:'0007' }).ok, '密碼 7 會補成 0007');
us._data.find(row => row[0] === s1.id)[4] = '否';
ok(!call({ action:'roster' }).users.some(u => u.id === s1.id) && call({ action:'sync', token:L1.token }).error === 'AUTH', '停用的業務不出現在名單，也不能同步');

// 輸入清理
r = call({ action:'sync', token:L2.token, ops:[{ id:'op14', type:'addCase', case:{ id:'c-x', owner:s2.id, name:'<b>X</b>'.repeat(200), stage:5, st:'won', p:77, created:now, updated:now } }] });
const cx = r.state.cases.find(c => c.id === 'c-x');
ok(cx && cx.name.length === 500 && cx.st === 'doing' && cx.stage === 0 && cx.p === 75, '過長文字截斷、新增時不能直接成交、進度對齊 5%');
r = call({ action:'sync', token:L2.token, ops:[{ id:'op15', type:'hack' }] });
ok(!r.results[0].ok, '不認得的操作會被拒絕');
ok(JSON.parse(ctx.doPost({ postData:{ contents:'不是JSON' } }).getContent()).error === 'BAD_REQUEST', '亂送資料不會當掉');

// ---------- 會長在 App 裡管理成員 ----------
const adm = b => call(Object.assign({ action:'admin', token:LB.token }, b));
r = adm({ cmd:'addUser', name:'陳美玲', pin:'4321', role:'sales' });
ok(r.ok && r.state.members.some(m => m.name === '陳美玲' && m.active), '會長可以新增業務');
ok(r.state.members.every(m => !('pin' in m)), '成員清單不含密碼');
const mei = r.state.members.find(m => m.name === '陳美玲');
ok(call({ action:'login', uid:mei.id, pin:'4321' }).ok, '新增的業務可以登入');
ok(!adm({ cmd:'addUser', name:'陳美玲', pin:'1234' }).ok, '不能新增同名成員');
ok(!adm({ cmd:'addUser', name:'王小明', pin:'12a4' }).ok, '密碼不是 4 位數字會被擋');
ok(!adm({ cmd:'addUser', name:'', pin:'1234' }).ok, '沒有姓名會被擋');
r = adm({ cmd:'updateUser', uid:mei.id, name:'陳美玲(北區)', pin:'5555' });
ok(r.ok && rowsOf('業務').find(x => x[0] === mei.id)[1] === '陳美玲(北區)', '可以改名');
ok(call({ action:'login', uid:mei.id, pin:'5555' }).ok && !call({ action:'login', uid:mei.id, pin:'4321' }).ok, '重設密碼後只能用新密碼登入');
r = adm({ cmd:'updateUser', uid:mei.id, name:'陳美玲(北區)', pin:'' });
ok(r.ok && call({ action:'login', uid:mei.id, pin:'5555' }).ok, '密碼留空代表不改');
const LM = call({ action:'login', uid:mei.id, pin:'5555' });
r = adm({ cmd:'updateUser', uid:mei.id, active:false });
ok(r.ok && !call({ action:'roster' }).users.some(u => u.id === mei.id) && r.state.members.find(m => m.id === mei.id).active === false, '可以停用，停用後不在登入名單但仍在成員管理');
ok(call({ action:'sync', token:LM.token }).error === 'AUTH', '被停用的人原本的登入也失效');
ok(adm({ cmd:'updateUser', uid:mei.id, active:true }).ok && call({ action:'roster' }).users.some(u => u.id === mei.id), '可以重新啟用');
ok(!adm({ cmd:'updateUser', uid:boss.id, active:false }).ok, '會長不能停用自己');
ok(!adm({ cmd:'updateUser', uid:boss.id, role:'sales' }).ok, '會長不能取消自己的會長身分');
ok(!call({ action:'admin', token:L2.token, cmd:'addUser', name:'駭客', pin:'1234' }).ok, '業務不能管理成員');
ok(call({ action:'sync', token:L2.token }).state.members.length === 0, '業務拿不到成員清單');

// ---------- 自己改密碼 ----------
r = call({ action:'changePin', token:L2.token, oldPin:'0000', newPin:'8888' });
ok(!r.ok && r.error === 'WRONG_PIN', '目前密碼錯誤不能改');
r = call({ action:'changePin', token:L2.token, oldPin:'2222', newPin:'88' });
ok(!r.ok && r.error === 'INVALID', '新密碼不是 4 位數會被擋');
r = call({ action:'changePin', token:L2.token, oldPin:'2222', newPin:'8888' });
ok(r.ok && call({ action:'login', uid:s2.id, pin:'8888' }).ok, '改密碼後可以用新密碼登入');
ok(call({ action:'sync', token:L2.token }).ok, '改密碼後原本的登入仍有效');

console.log(`伺服器測試：通過 ${pass} 項，失敗 ${fail} 項`);
process.exit(fail ? 1 : 0);
