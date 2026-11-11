/* =====================================================================
   同欣回報（同欣冒險者公會）：Google Apps Script 伺服器
   ---------------------------------------------------------------------
   ・資料存在這個試算表的工作表裡：業務、案件、更新紀錄、經驗值紀錄、設定、系統紀錄（隱藏）
   ・第一次使用：執行一次 setup()，再「部署 → 網頁應用程式」
   ・需要同一個專案裡的 Shared.gs（App 與伺服器共用的規則）
   ===================================================================== */
var SHEET = { users:'業務', cases:'案件', hist:'更新紀錄', xp:'經驗值紀錄', config:'設定', ops:'系統紀錄' };
var HEAD = {
  users:  ['ID','姓名','密碼','角色','啟用','經驗值','角色外觀','教學完成'],
  cases:  ['ID','客戶名稱','業務ID','負責業務','服務類別','類別說明','目前階段','階段說明','整體進度(%)','狀態',
           '聯絡人','電話','地址','建立時間','最後更新','成交時間','會長留言未讀','系統資料'],
  hist:   ['ID','案件ID','客戶名稱','時間','更新者ID','更新者','類型','階段','階段說明','進度(%)','狀態','備註'],
  xp:     ['ID','時間','業務ID','業務','案件ID','原因','經驗值'],
  config: ['服務類別'],
  ops:    ['操作ID','時間','使用者ID','類型','結果']
};
var TOKEN_DAYS = 180;      // 登入有效天數
var MAX_FAIL = 5;          // 密碼連續錯幾次就暫時鎖定
var LOCK_MINUTES = 10;     // 鎖定幾分鐘
var MAX_OPS = 100;         // 每次同步最多處理幾筆
var OPS_KEEP = 20000;      // 系統紀錄最多保留幾筆

/* ---------------- 第一次安裝 ---------------- */
function setup(){
  var book = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET).forEach(function(k){
    var sh = book.getSheetByName(SHEET[k]) || book.insertSheet(SHEET[k]);
    if(sh.getLastRow()===0){
      sh.getRange(1,1,1,HEAD[k].length).setValues([HEAD[k]]).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ecdcb4');
      sh.setFrozenRows(1);
    }
  });
  sheet_('users').getRange('C:C').setNumberFormat('@');                 // 密碼保留開頭的 0
  sheet_('cases').getRange('L:L').setNumberFormat('@');                 // 電話保留開頭的 0
  var u = sheet_('users');
  if(u.getLastRow()===1){
    u.getRange(2,1,3,HEAD.users.length).setValues([
      ['', '老闆',     '0000', '老闆', '是', 0, '', ''],
      ['', '業務一號', '1111', '業務', '是', 0, '', ''],
      ['', '業務二號', '2222', '業務', '是', 0, '', '']
    ]);
  }
  var c = sheet_('config');
  if(c.getLastRow()===1) c.getRange(2,1,TS.DEFAULT_CATS.length,1).setValues(TS.DEFAULT_CATS.map(function(x){ return [x]; }));
  ['工作表1','Sheet1'].forEach(function(n){ var d=book.getSheetByName(n); if(d && d.getLastRow()===0 && book.getSheets().length>1) book.deleteSheet(d); });
  sheet_('ops').hideSheet();
  var db = load_(); save_(db);                                           // 幫沒有 ID 的業務補上 ID
  return '安裝完成：請到「業務」工作表修改姓名和密碼，然後部署成網頁應用程式。';
}

/* ---------------- 網址入口 ---------------- */
function doGet(){ return out_({ ok:true, app:'同欣回報 API' }); }

function doPost(e){
  var req;
  try{ req = JSON.parse(e.postData.contents); }catch(err){ return out_({ ok:false, error:'BAD_REQUEST' }); }
  try{
    if(req.action==='roster') return out_(roster_());
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);                                                 // 一次只處理一個人的寫入，避免互相覆蓋
    try{
      if(req.action==='login') return out_(login_(req));
      if(req.action==='sync')  return out_(sync_(req));
      if(req.action==='admin') return out_(admin_(req));
      if(req.action==='changePin') return out_(changePin_(req));
      return out_({ ok:false, error:'UNKNOWN_ACTION' });
    } finally { lock.releaseLock(); }
  }catch(err){
    return out_({ ok:false, error:'SERVER', message:String(err && err.message || err) });
  }
}
function out_(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- API ---------------- */
function roster_(){
  var db = load_();
  return { ok:true, users: db.users.filter(function(u){ return u.active; }).map(function(u){ return { id:u.id, name:u.name, role:u.role }; }) };
}

function login_(req){
  var cache = CacheService.getScriptCache(), key = 'fail_'+req.uid;
  var fails = Number(cache.get(key)||0);
  if(fails>=MAX_FAIL) return { ok:false, error:'LOCKED', message:'密碼錯太多次，請 '+LOCK_MINUTES+' 分鐘後再試' };
  var db = load_();
  var u = db.users.filter(function(x){ return x.id===req.uid && x.active; })[0];
  if(!u) return { ok:false, error:'NO_USER', message:'找不到這位使用者' };
  if(String(req.pin)!==u.pin){
    cache.put(key, String(fails+1), LOCK_MINUTES*60);
    return { ok:false, error:'WRONG_PIN', message:'密碼不對，請再試一次', left:MAX_FAIL-fails-1 };
  }
  cache.remove(key);
  var token = Utilities.getUuid(), props = PropertiesService.getScriptProperties();
  props.setProperty('tok_'+token, JSON.stringify({ uid:u.id, t:Date.now() }));
  pruneTokens_(props);
  return { ok:true, token:token, uid:u.id, state:view_(db, u) };
}

function sync_(req){
  var db = load_();
  var actor = auth_(req.token, db);
  if(!actor) return { ok:false, error:'AUTH', message:'登入已失效，請重新登入' };
  var ops = Array.isArray(req.ops) ? req.ops.slice(0, MAX_OPS) : [];
  var results = [], log = [], changed = false;
  if(ops.length){
    var done = doneOps_();
    var state = { users:db.users.filter(function(u){ return u.active; }), cases:db.cases, xplog:db.xplog };
    ops.forEach(function(op){
      if(!op || !op.id){ results.push({ id:op&&op.id, ok:false, error:'缺少操作編號' }); return; }
      if(done[op.id]){ results.push({ id:op.id, ok:true, dup:true }); return; }    // 重送的同一筆，不重複套用
      var err = TS.applyOp(state, op, actor);
      results.push({ id:op.id, ok:!err, error:err||undefined });
      log.push([op.id, new Date(), actor.id, String(op.type), err||'OK']);
      if(!err) changed = true;
    });
    db.cases = state.cases;
    if(changed) save_(db);
    appendOps_(log);
  }
  return { ok:true, results:results, state:view_(db, actor) };
}

// 會長在 App 裡管理成員：新增、改名、重設密碼、切換身分、停用／啟用
function admin_(req){
  var db = load_(), actor = auth_(req.token, db);
  if(!actor) return { ok:false, error:'AUTH', message:'登入已失效，請重新登入' };
  if(actor.role!=='boss') return { ok:false, error:'FORBIDDEN', message:'只有會長可以管理成員' };
  var fail = function(m){ return { ok:false, error:'INVALID', message:m }; };
  var name = str_(req.name), pin = str_(req.pin), role = req.role==='boss' ? 'boss' : 'sales';
  var dup = function(n, selfId){ return db.users.some(function(u){ return u.active && u.name===n && u.id!==selfId; }); };
  var msg;
  if(req.cmd==='addUser'){
    if(!name) return fail('請輸入姓名');
    if(name.length>20) return fail('姓名最多 20 個字');
    if(dup(name)) return fail('已經有同名的成員');
    if(!/^\d{4}$/.test(pin)) return fail('密碼要是 4 位數字');
    db.users.push({ id:'u'+TS.uid(), name:name, pin:pin, role:role, active:true, xp:0, char:null, tutDone:false });
    msg = '已新增「'+name+'」';
  } else if(req.cmd==='updateUser'){
    var u = db.users.filter(function(x){ return x.id===req.uid; })[0];
    if(!u) return fail('找不到這位成員');
    if(req.name!==undefined){
      if(!name) return fail('請輸入姓名');
      if(name.length>20) return fail('姓名最多 20 個字');
      if(dup(name, u.id)) return fail('已經有同名的成員');
      u.name = name;
    }
    if(req.pin!==undefined && pin!==''){
      if(!/^\d{4}$/.test(pin)) return fail('密碼要是 4 位數字');
      u.pin = pin;
    }
    if(req.active!==undefined){
      if(u.id===actor.id && !req.active) return fail('不能停用自己');
      u.active = !!req.active;
    }
    if(req.role!==undefined){
      if(u.id===actor.id && role!=='boss') return fail('不能取消自己的會長身分');
      u.role = role;
    }
    if(!db.users.some(function(x){ return x.active && x.role==='boss'; })) return fail('至少要保留一位啟用中的會長');
    msg = '已更新「'+u.name+'」';
  } else return fail('不認得的操作');
  save_(db);
  return { ok:true, message:msg, state:view_(db, actor) };
}

// 每個人自己改密碼（要先輸入目前的密碼）
function changePin_(req){
  var db = load_(), actor = auth_(req.token, db);
  if(!actor) return { ok:false, error:'AUTH', message:'登入已失效，請重新登入' };
  var cache = CacheService.getScriptCache(), key = 'fail_'+actor.id, fails = Number(cache.get(key)||0);
  if(fails>=MAX_FAIL) return { ok:false, error:'LOCKED', message:'密碼錯太多次，請 '+LOCK_MINUTES+' 分鐘後再試' };
  if(String(req.oldPin)!==actor.pin){
    cache.put(key, String(fails+1), LOCK_MINUTES*60);
    return { ok:false, error:'WRONG_PIN', message:'目前的密碼不對' };
  }
  cache.remove(key);
  if(!/^\d{4}$/.test(String(req.newPin))) return { ok:false, error:'INVALID', message:'新密碼要是 4 位數字' };
  actor.pin = String(req.newPin);
  save_(db);
  return { ok:true, message:'密碼已更新' };
}

function auth_(token, db){
  if(!token) return null;
  var raw = PropertiesService.getScriptProperties().getProperty('tok_'+token);
  if(!raw) return null;
  var info = JSON.parse(raw);
  if(Date.now()-info.t > TOKEN_DAYS*86400000) return null;
  return db.users.filter(function(u){ return u.id===info.uid && u.active; })[0] || null;
}
function pruneTokens_(props){
  var all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function(k){
    if(k.indexOf('tok_')!==0) return;
    try{ if(now-JSON.parse(all[k]).t > TOKEN_DAYS*86400000) props.deleteProperty(k); }catch(e){ props.deleteProperty(k); }
  });
}

// 每個人看得到的資料：業務只看自己的案件；會長看全部
function view_(db, actor){
  var isBoss = actor.role==='boss';
  return {
    users: db.users.filter(function(u){ return u.active; }).map(function(u){
      return { id:u.id, name:u.name, role:u.role, xp:u.xp, char:u.char, tutDone:u.tutDone }; }),
    cases: db.cases.filter(function(c){ return isBoss || c.owner===actor.id; }),
    xplog: db.xplog.filter(function(x){ return x.uid===actor.id; }),
    categories: db.categories,
    members: isBoss ? db.users.map(function(u){ return { id:u.id, name:u.name, role:u.role, active:u.active }; }) : []   // 會長的成員管理用（不含密碼）
  };
}

/* ---------------- 讀寫試算表 ---------------- */
function sheet_(key){
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET[key]);
  if(!sh) throw new Error('找不到工作表「'+SHEET[key]+'」，請先執行 setup');
  return sh;
}
function rows_(key){
  var sh = sheet_(key), n = sh.getLastRow();
  return n<2 ? [] : sh.getRange(2,1,n-1,HEAD[key].length).getValues();
}
function writeTable_(key, data){
  var sh = sheet_(key), n = sh.getLastRow(), w = HEAD[key].length;
  if(n>1) sh.getRange(2,1,n-1,w).clearContent();
  if(data.length) sh.getRange(2,1,data.length,w).setValues(data);
}
function ms_(v){ if(v instanceof Date) return v.getTime(); if(typeof v==='number') return v; if(!v) return null; var t=Date.parse(v); return isNaN(t)?null:t; }
function date_(t){ return t ? new Date(t) : ''; }
function str_(v){ return v==null ? '' : String(v).trim(); }
function stageIndex_(v){ var i = TS.STAGES.map(function(s){ return s.n; }).indexOf(str_(v)); return i>=0 ? i : 0; }
function statusKey_(v){ for(var k in TS.STATUS_NAMES){ if(TS.STATUS_NAMES[k]===str_(v)) return k; } return 'doing'; }

function load_(){
  var raw = rows_('users'), fixIds = false, users = [];
  raw.forEach(function(r){
    if(!str_(r[1])) return;
    if(!str_(r[0])){ r[0] = 'u'+TS.uid(); fixIds = true; }                // 老闆新增業務時 ID 可以留空，這裡自動補上
    var pin = str_(r[2]); if(/^\d{1,3}$/.test(pin)) pin = ('0000'+pin).slice(-4);
    var ch = null; try{ ch = r[6] ? TS.cleanChar(JSON.parse(r[6])) : null; }catch(e){}
    users.push({ id:str_(r[0]), name:str_(r[1]), pin:pin, role: str_(r[3])==='老闆' ? 'boss' : 'sales',
                 active: str_(r[4])!=='否', xp:0, char:ch, tutDone: str_(r[7])==='是' });
  });
  if(fixIds) sheet_('users').getRange(2,1,raw.length,1).setValues(raw.map(function(r){ return [r[0]]; }));
  var cases = rows_('cases').filter(function(r){ return str_(r[0]); }).map(function(r){
    var sys = {}; try{ sys = JSON.parse(r[17]||'{}'); }catch(e){}
    var c = { id:str_(r[0]), name:str_(r[1]), owner:str_(r[2]), cat:str_(r[4]), catNote:str_(r[5]),
      stage:stageIndex_(r[6]), stageNote:str_(r[7]), p:TS.cleanField('p', r[8]), st:statusKey_(r[9]),
      contact:str_(r[10]), phone:str_(r[11]), addr:str_(r[12]), created:ms_(r[13])||Date.now(), updated:ms_(r[14])||Date.now(),
      wonAt:ms_(r[15]), bossUnread: str_(r[16])==='是',
      stagesDone: sys.stagesDone || [], dealXP:!!sys.dealXP, wonBy:sys.wonBy||null, revoked:!!sys.revoked, noteDay:sys.noteDay||null, hist:[] };
    if(c.stage===TS.DONE_STAGE) c.st='won';                                  // 試算表手動改過時，維持規則一致
    if(c.st==='won'){ c.stage=TS.DONE_STAGE; c.p=100; }
    return c;
  });
  var byId = {}; cases.forEach(function(c){ byId[c.id]=c; });
  rows_('hist').forEach(function(r){
    var c = byId[str_(r[1])]; if(!c) return;
    c.hist.push({ id:str_(r[0]), t:ms_(r[3])||0, by:str_(r[4]), kind: str_(r[6])==='會長留言' ? 'boss' : '',
                  stage:stageIndex_(r[7]), stageNote:str_(r[8]), p:TS.cleanField('p', r[9]), st:statusKey_(r[10]), note:str_(r[11]) });
  });
  cases.forEach(function(c){ c.hist.sort(function(a,b){ return b.t-a.t; }); });
  var xplog = rows_('xp').filter(function(r){ return str_(r[0]); }).map(function(r){
    return { id:str_(r[0]), t:ms_(r[1])||0, uid:str_(r[2]), caseId:str_(r[4]), why:str_(r[5]), xp:Number(r[6])||0 };
  });
  var sum = {}; xplog.forEach(function(x){ sum[x.uid] = (sum[x.uid]||0) + x.xp; });
  users.forEach(function(u){ u.xp = Math.max(0, sum[u.id]||0); });
  var categories = rows_('config').map(function(r){ return str_(r[0]); }).filter(String);
  return { users:users, cases:cases, xplog:xplog, categories: categories.length ? categories : TS.DEFAULT_CATS };
}

function save_(db){
  var name = {}; db.users.forEach(function(u){ name[u.id]=u.name; });
  var sum = {}; db.xplog.forEach(function(x){ sum[x.uid] = (sum[x.uid]||0) + x.xp; });
  writeTable_('users', db.users.map(function(u){
    return [u.id, u.name, u.pin, u.role==='boss'?'老闆':'業務', u.active?'是':'否', Math.max(0,sum[u.id]||0),
            u.char ? JSON.stringify(u.char) : '', u.tutDone ? '是' : ''];
  }));
  writeTable_('cases', db.cases.map(function(c){
    return [c.id, c.name, c.owner, name[c.owner]||'', c.cat, c.catNote||'', TS.STAGES[c.stage].n, c.stageNote||'', c.p,
            TS.STATUS_NAMES[c.st], c.contact||'', c.phone||'', c.addr||'', date_(c.created), date_(c.updated), date_(c.wonAt),
            c.bossUnread ? '是' : '',
            JSON.stringify({ stagesDone:c.stagesDone||[], dealXP:!!c.dealXP, wonBy:c.wonBy||null, revoked:!!c.revoked, noteDay:c.noteDay||null })];
  }));
  var hist = [];
  db.cases.forEach(function(c){ (c.hist||[]).forEach(function(h){
    hist.push([h.id, c.id, c.name, date_(h.t), h.by, name[h.by]||'', h.kind==='boss'?'會長留言':'進度更新',
               h.kind==='boss'?'':TS.STAGES[h.stage].n, h.stageNote||'', h.kind==='boss'?'':h.p, h.kind==='boss'?'':TS.STATUS_NAMES[h.st], h.note||'']);
  }); });
  hist.sort(function(a,b){ return b[3]-a[3]; });
  writeTable_('hist', hist);
  writeTable_('xp', db.xplog.map(function(x){ return [x.id, date_(x.t), x.uid, name[x.uid]||'', x.caseId||'', x.why, x.xp]; }));
}

function doneOps_(){
  var done = {}; rows_('ops').forEach(function(r){ done[str_(r[0])] = true; }); return done;
}
function appendOps_(log){
  if(!log.length) return;
  var sh = sheet_('ops');
  sh.getRange(sh.getLastRow()+1, 1, log.length, HEAD.ops.length).setValues(log);
  var extra = sh.getLastRow()-1-OPS_KEEP;
  if(extra>0) sh.deleteRows(2, extra);
}
