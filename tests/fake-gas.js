/* 測試用：在 Node 或瀏覽器裡模擬 Google Apps Script 的服務（試算表、鎖、快取、屬性） */
(function(G){
  function makeSheet(name){
    var data = [], hidden = false;
    function ensure(r, c){ while(data.length<r) data.push([]); data.forEach(function(row){ while(row.length<c) row.push(''); }); }
    function range(r, c, nr, nc){
      return {
        getValues: function(){ ensure(r+nr-1, c+nc-1); return data.slice(r-1, r-1+nr).map(function(row){ return row.slice(c-1, c-1+nc).map(function(v){ return v instanceof Date ? new Date(v.getTime()) : v; }); }); },
        setValues: function(v){ if(v.length!==nr || v.some(function(x){ return x.length!==nc; })) throw new Error('setValues 尺寸不符');
          ensure(r+nr-1, c+nc-1); v.forEach(function(row,i){ row.forEach(function(x,j){ data[r-1+i][c-1+j] = x===undefined||x===null ? '' : x; }); }); return this; },
        clearContent: function(){ for(var i=0;i<nr;i++) for(var j=0;j<nc;j++) if(data[r-1+i]) data[r-1+i][c-1+j]=''; return this; },
        setFontWeight: function(){ return this; }, setBackground: function(){ return this; }, setFontColor: function(){ return this; },
        setNumberFormat: function(){ return this; }
      };
    }
    var sh = {
      getName: function(){ return name; },
      getLastRow: function(){ for(var i=data.length;i>0;i--){ if(data[i-1].some(function(v){ return v!=='' && v!=null; })) return i; } return 0; },
      getRange: function(a, b, c, d){ if(typeof a==='string') return range(1, 1, 1, 1); return range(a, b, c||1, d||1); },
      setFrozenRows: function(){}, hideSheet: function(){ hidden=true; },
      deleteRows: function(start, n){ data.splice(start-1, n); },
      _data: data
    };
    return sh;
  }
  var book = { sheets: [] };
  book.getSheetByName = function(n){ return book.sheets.filter(function(s){ return s.getName()===n; })[0] || null; };
  book.insertSheet = function(n){ var s = makeSheet(n); book.sheets.push(s); return s; };
  book.getSheets = function(){ return book.sheets.slice(); };
  book.deleteSheet = function(s){ book.sheets = book.sheets.filter(function(x){ return x!==s; }); };
  book.insertSheet('工作表1');

  var props = {}, cache = {}, uuid = 0;
  G.SpreadsheetApp = { getActiveSpreadsheet: function(){ return book; } };
  G.LockService = { getScriptLock: function(){ return { waitLock: function(){}, releaseLock: function(){} }; } };
  G.CacheService = { getScriptCache: function(){ return {
    get: function(k){ return k in cache ? cache[k] : null; }, put: function(k,v){ cache[k]=String(v); }, remove: function(k){ delete cache[k]; } }; } };
  G.PropertiesService = { getScriptProperties: function(){ return {
    getProperty: function(k){ return k in props ? props[k] : null; }, setProperty: function(k,v){ props[k]=String(v); },
    getProperties: function(){ return Object.assign({}, props); }, deleteProperty: function(k){ delete props[k]; } }; } };
  G.Utilities = { getUuid: function(){ uuid++; return 'tok-'+uuid+'-'+Math.random().toString(36).slice(2); } };
  G.ContentService = { MimeType:{ JSON:'json' }, createTextOutput: function(s){ return { content:s, setMimeType: function(){ return this; }, getContent: function(){ return s; } }; } };
  // 測試輔助：直接呼叫 doPost，像 fetch 一樣拿回物件
  G.__gasCall = function(body){ return JSON.parse(G.doPost({ postData:{ contents: JSON.stringify(body) } }).getContent()); };
  G.__gasBook = book;
  G.__gasClearCache = function(){ cache = {}; };
})(typeof globalThis!=='undefined' ? globalThis : this);
