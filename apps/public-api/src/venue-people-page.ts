/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { createHash } from 'node:crypto';
import { venuePeopleTaipeiMonth } from './venue-people-helpers.js';

const styles = `*{box-sizing:border-box}body{font:120%/1.6 system-ui,sans-serif;margin:auto;max-width:72rem;padding:1rem;color:#173b38;background:#f6f8f7}label{display:flex;flex-direction:column;gap:.25rem}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:.75rem}input,select,button{font:inherit;min-height:48px;max-width:100%;padding:.4rem}button{cursor:pointer}button:disabled{cursor:wait;opacity:.6}section{overflow-x:auto;margin-top:1rem}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #bbb;padding:.6rem;text-align:left;overflow-wrap:anywhere}:focus-visible{outline:3px solid #176b53}.skip:not(:focus){position:absolute;left:-9999px}footer{margin-top:2rem;font-size:.8em}nav{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}#status{min-height:2em}caption{text-align:left;font-weight:bold}`;

/** Self-contained browser controller. Exact bytes are CSP-hashed; no bundle/CDN required. */
export const venuePeoplePageScript = String.raw`(()=>{
'use strict';
const get=id=>document.getElementById(id);
const form=get('filters'),table=get('records'),status=get('status'),summary=get('summary');
let busy=false,active=null,person=null,page=1,listPage=1,total=0,caps=null,verifiedRegion='';
function controls(){
  for(const el of document.querySelectorAll('button,input,select'))el.disabled=busy;
  get('manual-add').disabled=true;get('manual-void').disabled=true;
  get('verify').disabled=busy||!get('region').value.trim();
  get('read').disabled=busy||caps?.canReadPeople!==true;
  get('export').disabled=busy||caps?.canExportPeople!==true;
  get('retry').disabled=busy||!active||caps?.canReadPeople!==true;
  get('previous').disabled=busy||!active||page<=1;
  get('next').disabled=busy||!active||page*active.limit>=total||page>=10000;
  get('back').disabled=busy||!person;
}
function clear(){table.replaceChildren();summary.textContent='';get('pagination').textContent='';total=0;}
function message(code){return code===401?'登入已失效，請重新登入。':code===403?'未獲此操作／場地區域權限，或 CSRF／來源不符。':code===413?'匯出超過 1000 筆，請縮小場地、日期或姓名篩選。':code===400?'查詢格式不符，請確認 UUID、月份／日期與篩選。':'查詢失敗，請稍後再試；這不代表沒有紀錄。';}
function selection(){
  if(get('region').value.trim()!==verifiedRegion)throw new Error('region');
  const from=get('from').value,until=get('until').value;
  if(Boolean(from)!==Boolean(until)||(from&&from>=until)||(!from&&!get('month').value))throw new Error('dates');
  return {mode:'people',regionId:get('region').value.trim(),fieldId:get('venue').value.trim()||null,personId:null,period:from?{from,until}:{month:get('month').value},search:get('search').value.trim(),sort:get('sort').value,direction:get('direction').value,page:1,limit:Number(get('limit').value)};
}
function csrfHeaders(){
  const cookies=document.cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-qigong-admin-csrf='));
  if(cookies.length!==1)throw new Error('csrf');const csrf=cookies[0].slice('__Host-qigong-admin-csrf='.length);
  if(!/^[A-Za-z0-9_-]{43}$/.test(csrf))throw new Error('csrf');
  return {'content-type':'application/json','x-csrf-token':csrf};
}
async function verify(){
  if(busy)return;busy=true;caps=null;active=null;person=null;clear();status.textContent='驗證區域讀取／匯出權限中…';controls();
  try{
    const regionId=get('region').value.trim();
    const response=await fetch('/admin/api/venue-suite/capabilities',{method:'POST',credentials:'same-origin',cache:'no-store',headers:csrfHeaders(),body:JSON.stringify({regionId})});
    if(!response.ok){status.textContent=message(response.status);return;}
    const data=await response.json();
    if(!data||typeof data.canReadPeople!=='boolean'||typeof data.canExportPeople!=='boolean')throw new Error('invalid capabilities');
    caps=data;verifiedRegion=regionId;
    get('permissions').textContent='此區域：'+(caps.canReadPeople?'可讀取姓名／出席':'無讀取權限')+'；'+(caps.canExportPeople?'可匯出 CSV':'無 CSV 匯出權限（需獨立 stats.export）')+'。實際操作仍會重新授權。';
    status.textContent=caps.canReadPeople||caps.canExportPeople?'權限驗證完成，請選篩選條件後查詢或匯出。':'此區域未授權任何人員／出席操作；請選擇授權區域或聯絡管理員。';
  }catch{status.textContent='權限驗證失敗，請重新登入或稍後重試；未開放操作。';}
  finally{busy=false;if(!caps)get('permissions').textContent='未取得有效區域權限，讀取與匯出保持停用。';controls();}
}
function invalidate(){
  if(busy)return;clear();active=null;person=null;page=1;
  if(get('region').value.trim()!==verifiedRegion){caps=null;get('permissions').textContent='區域已變更，請先驗證權限；不沿用上一區域授權。';}
  status.textContent='篩選已變更，請重新查詢／匯出；舊明細已清除。';controls();
}
function cell(row,value,heading){const el=document.createElement(heading?'th':'td');el.textContent=String(value);if(heading)el.scope='col';row.append(el);return el;}
function render(data){
  if(!data||data.mode!==(person?'detail':'people')||!Array.isArray(data.rows)||!data.totals||!Number.isSafeInteger(data.total)||data.total<0||!['attendanceCount','attendanceDays','learnerCount'].every(k=>Number.isSafeInteger(data.totals[k])&&data.totals[k]>=0))throw new Error('invalid response');
  clear();total=data.total;
  summary.textContent='完整篩選結果：出席 '+data.totals.attendanceCount+' 次／去重 '+data.totals.attendanceDays+' 日／'+data.totals.learnerCount+' 人（不是單頁統計）';
  const caption=document.createElement('caption');caption.textContent=person?'此學員在授權場地的出席明細':'所選授權場地學員（點姓名看明細）';table.append(caption);
  const head=document.createElement('thead'),tr=document.createElement('tr');
  for(const title of person?['當地日期','姓名','場地','歷史時區','UTC 時間','方式']:['姓名','所選場地次數','去重日數','最近出席日'])cell(tr,title,true);
  head.append(tr);table.append(head);const body=document.createElement('tbody');
  for(const row of data.rows){const tr=document.createElement('tr');
    if(person){for(const value of [row.date,row.name,row.fieldName+' ('+row.fieldCode+')',row.timezone,row.checkedInAt,row.method])cell(tr,value,false);}
    else{const td=cell(tr,'',false),button=document.createElement('button');button.type='button';button.textContent=row.name;button.addEventListener('click',()=>{if(busy)return;listPage=page;person=row.personId;page=1;void run(false);});td.append(button);for(const value of [row.attendanceCount,row.attendanceDays,row.latestDate])cell(tr,value,false);}
    body.append(tr);
  }table.append(body);
  get('pagination').textContent='第 '+page+' 頁／共 '+Math.max(1,Math.ceil(total/active.limit))+' 頁，'+total+' 筆';
  status.textContent=total===0?'查無符合篩選的授權紀錄。':'查詢完成。';
}
async function run(exporting){
  if(busy||!active||(exporting?caps?.canExportPeople:caps?.canReadPeople)!==true)return;
  busy=true;if(!exporting)clear();status.textContent=exporting?'產生 CSV 中…':'查詢中…';controls();
  try{
    const payload={...active,mode:person?'detail':'people',personId:person,page,sort:person?'recent':active.sort,direction:person?'desc':active.direction};
    const response=await fetch('/admin/venue-people/api/'+(exporting?'export':'read'),{method:'POST',credentials:'same-origin',cache:'no-store',headers:csrfHeaders(),body:JSON.stringify(payload)});
    if(!response.ok){clear();status.textContent=message(response.status);if([401,403].includes(response.status)){caps=null;active=null;person=null;get('permissions').textContent='登入／權限已失效或驗證遭拒，請重新登入或驗證區域權限。';}return;}
    if(exporting){const url=URL.createObjectURL(await response.blob());try{const a=document.createElement('a');a.href=url;a.download='venue-people.csv';a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}status.textContent='CSV 已產生（完整篩選結果，最多 1000 筆）；畫面保留原查詢。';}
    else render(await response.json());
  }catch{clear();status.textContent='查詢失敗或回應無效；請重新登入或稍後按「重試原查詢」，並非查無資料。';}
  finally{busy=false;controls();}
}
form.addEventListener('input',invalidate);
form.addEventListener('change',invalidate);
get('verify').addEventListener('click',()=>{void verify();});
get('retry').addEventListener('click',()=>{void run(false);});
form.addEventListener('submit',event=>{event.preventDefault();if(busy||caps?.canReadPeople!==true)return;try{active=selection();person=null;page=1;void run(false);}catch{clear();active=null;person=null;status.textContent='請選月份，或同時填入有效起日與較晚的結束日（不含）。';controls();}});
get('export').addEventListener('click',()=>{if(busy||caps?.canExportPeople!==true)return;try{if(!active){active=selection();page=1;}void run(true);}catch{clear();active=null;person=null;status.textContent='請檢查日期範圍。';controls();}});
get('previous').addEventListener('click',()=>{if(!busy&&active&&page>1){page--;void run(false);}});
get('next').addEventListener('click',()=>{if(!busy&&active&&page*active.limit<total&&page<10000){page++;void run(false);}});
get('back').addEventListener('click',()=>{if(!busy&&person){person=null;page=listPage;void run(false);}});
controls();
})();`;
const hash = (value: string) => createHash('sha256').update(value).digest('base64');
export const venuePeopleContentSecurityPolicy = `default-src 'none'; script-src 'sha256-${hash(venuePeoplePageScript)}'; style-src 'sha256-${hash(styles)}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;
export const renderVenuePeoplePage =
  (): string => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>團練場出席管理 · 人員與出席紀錄</title><style>${styles}</style></head><body>
<a class="skip" href="#main">跳至查詢</a><header><a href="/admin/">返回後台</a><h1>團練場出席管理 · 人員與出席紀錄</h1></header><main id="main">
<p>僅顯示在授權場地出席的既有學員；不含教練／志工名冊。查看姓名及出席沿用 checkin.read，CSV 另需 stats.export，兩者區域權限分開判定。</p>
<p>月份預設依 Asia/Taipei 今日月份。月份／日期均篩選每筆場地當地曆日 attendance_date（起日含、結束日不含），不是 Taipei 的 UTC 時間窗。跨場同日次數分計、日數依當地日期標籤去重；累計與最近出席皆限完整篩選範圍，不是生涯總數。</p>
<form id="filters"><label>場地所屬區域 UUID（必填）<input id="region" required maxlength="36" aria-describedby="permissions"></label><button type="button" id="verify">驗證區域權限</button><label>場地 UUID（選填；空白表示此區域授權場地）<input id="venue" maxlength="36"></label><label>月份<input id="month" type="month" value="${venuePeopleTaipeiMonth()}"></label><label>起日（含；與結束日一起填時取代月份）<input id="from" type="date"></label><label>結束日（不含）<input id="until" type="date"></label><label>搜尋既有學員姓名<input id="search" type="search" maxlength="80"></label>
<label>排序<select id="sort"><option value="recent">最近出席日</option><option value="name">姓名</option><option value="count">出席次數</option><option value="days">去重日數</option></select></label><label>方向<select id="direction"><option value="desc">遞減</option><option value="asc">遞增</option></select></label><label>每頁<select id="limit"><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label><button type="submit" id="read" disabled aria-describedby="permissions">查詢</button><button type="button" id="export" disabled aria-describedby="permissions">匯出 CSV（獨立授權，最多 1000 筆）</button></form>
<p id="permissions" role="status">請先填入區域 UUID 並驗證權限；讀取與匯出分開授權。</p><noscript>此頁需要 JavaScript 執行同源受控查詢，不會放寬 CSP 以提交表單。</noscript><p id="status" role="status" aria-live="polite">尚未查詢；不表示沒有紀錄。</p><button id="retry" type="button" disabled>重試原查詢</button><p id="summary"></p><section aria-label="授權出席結果"><table id="records"></table></section><nav aria-label="分頁與學員明細"><button id="back" type="button">回學員列表</button><button id="previous" type="button">上一頁</button><span id="pagination"></span><button id="next" type="button">下一頁</button></nav>
<p>明細只列授權場地的日期、場地、歷史時區、UTC 出席時間與簽到方式。既有出席未記錄身份 channel，不以目前 LINE／Telegram／WhatsApp 身份推測來源。</p><h2>人工補簽／作廢尚未開放</h2><button id="manual-add" type="button" disabled aria-describedby="manual-reason">人工補簽（未開放）</button><button id="manual-void" type="button" disabled aria-describedby="manual-reason">作廢出席（未開放）</button><p id="manual-reason">本頁只讀，不建立學員、不寫入日課、不提供遠端代學員 NFC 簽到。補簽／作廢仍需獨立寫入授權、志工對應、版本與持久冪等、原因及不可變稽核契約。</p></main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer><script>${venuePeoplePageScript}</script></body></html>`;
