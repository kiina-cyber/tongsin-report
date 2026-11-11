/* =====================================================================
   同欣冒險者公會：手機端與 Google Apps Script 共用的規則
   ---------------------------------------------------------------------
   這個檔案同時被 App（docs/shared.js）和 Apps Script（apps-script/Shared.gs）使用，
   兩邊必須保持一模一樣。修改後請把內容複製到 Apps Script 的 Shared.gs。
   ===================================================================== */
var TS = (function(){
  var STAGES = [ {n:'諮詢'},{n:'場勘'},{n:'報價'},{n:'簽約'},{n:'其他'},{n:'完工'} ];
  var OTHER_STAGE = 4, SIGN_STAGE = 3, DONE_STAGE = STAGES.length-1;   // 其他（自填）／簽約／完工＝成交
  var STATUS_KEYS = ['doing','won','quiet','no'];
  var STATUS_NAMES = { doing:'進行中', won:'已成交', quiet:'暫無回應', no:'無意願' };
  var XP = { add:10, stage:20, note:5, won:200 };
  var DEFAULT_CATS = ['伴唱機租賃','沉浸式包廂','音響周邊銷售','其他'];
  var MAX_TEXT = 500;

  // 各種操作允許寫入的欄位
  var UPDATE_FIELDS = ['stage','stageNote','p','st','updated','noteDay','stagesDone','dealXP','wonAt','wonBy'];
  var EDIT_FIELDS   = ['name','cat','catNote','contact','phone','addr'];
  var REVOKE_FIELDS = ['dealXP','wonAt','wonBy','revoked','st','stage','p'];
  var CASE_FIELDS   = ['id','owner','name','cat','catNote','stage','stageNote','p','st','contact','phone','addr',
                       'created','updated','stagesDone','dealXP','wonAt','wonBy','revoked','noteDay','bossUnread','hist'];

  function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
  function txt(v){ return String(v==null?'':v).slice(0,MAX_TEXT); }
  function num(v,d){ v=Number(v); return isFinite(v)?v:(d||0); }

  // 依欄位型別整理資料，避免奇怪的值寫進試算表
  function cleanField(k, v){
    switch(k){
      case 'stage': v=Math.round(num(v)); return v>=0 && v<STAGES.length ? v : 0;
      case 'p': v=Math.round(num(v)/5)*5; return Math.max(0, Math.min(100, v));
      case 'st': return STATUS_KEYS.indexOf(v)>=0 ? v : 'doing';
      case 'created': case 'updated': return num(v, Date.now());
      case 'wonAt': return v ? num(v) : null;
      case 'dealXP': case 'revoked': case 'bossUnread': return !!v;
      case 'stagesDone': return (Array.isArray(v)?v:[]).map(function(x){return Math.round(num(x));}).filter(function(x){return x>=0&&x<STAGES.length;});
      case 'wonBy': case 'noteDay': return v ? txt(v) : null;
      case 'hist': return Array.isArray(v) ? v.map(cleanHist) : [];
      default: return txt(v);
    }
  }
  function cleanHist(h){
    h = h || {};
    return { id:txt(h.id||uid()), t:num(h.t,Date.now()), by:txt(h.by), kind:h.kind==='boss'?'boss':'',
             stage:cleanField('stage',h.stage), stageNote:txt(h.stageNote), p:cleanField('p',h.p), st:cleanField('st',h.st), note:txt(h.note) };
  }
  function assign(target, src, fields){
    fields.forEach(function(k){ if(src && Object.prototype.hasOwnProperty.call(src,k)) target[k]=cleanField(k, src[k]); });
  }
  function addHist(c, h){
    if(!h) return;
    h = cleanHist(h);
    c.hist = c.hist || [];
    if(!c.hist.some(function(x){ return x.id===h.id; })){ c.hist.unshift(h); c.hist.sort(function(a,b){ return b.t-a.t; }); }
  }

  /* ---------- 套用一筆操作 ----------
     state = { users:[], cases:[], xplog:[] }；actor = 目前登入的使用者 {id, role}
     回傳 null 代表成功，回傳文字代表被拒絕的原因。 */
  function applyOp(state, op, actor){
    if(!op || !op.type) return '資料格式錯誤';
    if(!actor) return '請重新登入';
    var isBoss = actor.role==='boss';
    var c = op.caseId ? state.cases.filter(function(x){ return x.id===op.caseId; })[0] : null;
    var mine = c && (isBoss || c.owner===actor.id);
    var salesExists = function(id){ return state.users.some(function(u){ return u.id===id && u.role==='sales'; }); };

    switch(op.type){
      case 'addCase': {
        var n = op.case || {};
        if(!n.id || !txt(n.name)) return '客戶資料不完整';
        if(state.cases.some(function(x){ return x.id===n.id; })) return null;            // 已經新增過
        if(!isBoss && n.owner!==actor.id) return '只能新增自己的客戶';
        if(!salesExists(n.owner)) return '找不到負責的業務';
        var nc = {}; assign(nc, n, CASE_FIELDS); nc.hist = nc.hist || [];
        if(nc.st==='won' || nc.stage===DONE_STAGE){ nc.st='doing'; nc.stage=0; }        // 新增時不能直接成交
        nc.dealXP=false; nc.wonAt=null; nc.wonBy=null; nc.revoked=false; nc.bossUnread=false;
        state.cases.push(nc); return null;
      }
      case 'updateCase': {
        if(!c) return '案件不存在';
        if(!mine) return '只能更新自己負責的案件';
        assign(c, op.set, UPDATE_FIELDS);
        if(c.stage===DONE_STAGE){ c.st='won'; c.p=100; }
        if(c.st==='won' && c.stage!==DONE_STAGE){ c.stage=DONE_STAGE; c.p=100; }
        addHist(c, op.hist); return null;
      }
      case 'editCase': {
        if(!c) return '案件不存在';
        if(!mine) return '只能修改自己負責的客戶';
        assign(c, op.set, EDIT_FIELDS); return null;
      }
      case 'deleteCase': {
        if(!c) return null;
        if(!mine) return '只能刪除自己負責的客戶';
        if(c.st==='won') return '已成交的案件不能刪除，請先請會長撤銷成交';
        state.cases = state.cases.filter(function(x){ return x.id!==c.id; }); return null;
      }
      case 'readBoss': {
        if(!c) return null;
        if(c.owner===actor.id) c.bossUnread=false; return null;
      }
      case 'bossComment': {
        if(!isBoss) return '只有會長可以留言';
        if(!c) return '案件不存在';
        addHist(c, op.hist); c.bossUnread=true; return null;
      }
      case 'transfer': {
        if(!isBoss) return '只有會長可以轉派';
        if(!c) return '案件不存在';
        if(!salesExists(op.to)) return '找不到要轉派的業務';
        c.owner=op.to; c.bossUnread=true; addHist(c, op.hist); return null;
      }
      case 'revoke': {
        if(!isBoss) return '只有會長可以撤銷成交';
        if(!c) return '案件不存在';
        assign(c, op.set, REVOKE_FIELDS); addHist(c, op.hist); return null;
      }
      case 'xp': {
        var e = op.entry || {};
        if(!e.id || !e.uid) return '經驗值資料不完整';
        if(state.xplog.some(function(x){ return x.id===e.id; })) return null;
        var amount = Math.round(num(e.xp));
        if(!isBoss && e.uid!==actor.id && amount>0) return '不能幫別人加經驗值';
        if(Math.abs(amount)>1000) return '經驗值數字異常';
        var entry = { id:txt(e.id), t:num(e.t,Date.now()), uid:txt(e.uid), caseId:txt(e.caseId), why:txt(e.why), xp:amount };
        state.xplog.push(entry);
        var u = state.users.filter(function(x){ return x.id===entry.uid; })[0];
        if(u) u.xp = Math.max(0, num(u.xp)+amount);
        return null;
      }
      case 'profile': {
        var me = state.users.filter(function(x){ return x.id===actor.id; })[0];
        if(!me) return '找不到使用者';
        var s = op.set || {};
        if(s.char!==undefined) me.char = cleanChar(s.char);
        if(s.tutDone!==undefined) me.tutDone = !!s.tutDone;
        return null;
      }
    }
    return '不認得的操作：'+op.type;
  }
  function cleanChar(ch){
    if(!ch || typeof ch!=='object') return null;
    var classes=['knight','mage','priest','archer','assassin'], hairs=['short','long','pony'];
    return { cls: classes.indexOf(ch.cls)>=0?ch.cls:'knight', g: ch.g==='f'?'f':'m', hair: hairs.indexOf(ch.hair)>=0?ch.hair:'short',
             hc: Math.max(0,Math.min(9,Math.round(num(ch.hc)))), outfit: Math.max(0,Math.min(2,Math.round(num(ch.outfit)))),
             path: ch.path==='A'||ch.path==='B' ? ch.path : null };
  }

  return { STAGES:STAGES, OTHER_STAGE:OTHER_STAGE, SIGN_STAGE:SIGN_STAGE, DONE_STAGE:DONE_STAGE,
           STATUS_KEYS:STATUS_KEYS, STATUS_NAMES:STATUS_NAMES, XP:XP, DEFAULT_CATS:DEFAULT_CATS,
           uid:uid, applyOp:applyOp, cleanHist:cleanHist, cleanChar:cleanChar, cleanField:cleanField, CASE_FIELDS:CASE_FIELDS };
})();
