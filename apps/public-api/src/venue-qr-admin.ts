/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from '@qigong/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseVenueReadRequest } from './venue-admin-read-contract.js';
import { readVenueQrAttendance } from './venue-qr.js';
import { csvCell } from './venue-attendance-report.js';

/** Credential accessor exists only inside admin-auth's private cookie boundary. */
export const registerVenueQrAdminRoutes = (
  app: FastifyInstance,
  pool: Pool,
  sessionFor: (request: FastifyRequest) => string | null,
  principalFor: (request: FastifyRequest) => Promise<string | null>
): void => {
  app.get('/admin/venue-qr', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (!(await principalFor(request))) return reply.code(401).send({ error: 'unauthenticated' });
    return reply
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(venueQrAdminPage);
  });
  for (const exporting of [false, true]) {
    app.post(
      '/admin/venue-qr/api/' + (exporting ? 'export' : 'read'),
      { bodyLimit: 4096 },
      async (request, reply) => {
        reply
          .header('cache-control', 'no-store')
          .header('referrer-policy', 'no-referrer')
          .header('x-content-type-options', 'nosniff');
        const session = sessionFor(request);
        if (!session) return reply.code(403).send({ error: 'invalid_session_or_csrf' });
        let selector;
        try {
          selector = parseVenueReadRequest(request.body);
          if (selector.operation !== (exporting ? 'attendance.export' : 'attendance.read'))
            throw new Error('invalid operation');
        } catch {
          return reply.code(400).send({ error: 'invalid_request' });
        }
        try {
          const data = await readVenueQrAttendance(pool, request.id, session, selector);
          if (data.state !== 'available' || data.operation === 'field.read')
            throw new Error('invalid result');
          if (!exporting) return reply.send(data);
          const rows = [
            ['場地當地日期', '學員姓名', '場地代碼', '場地名稱', '簽到方式', '距離（公尺）']
              .map((value) => csvCell(value))
              .join(','),
            ...data.rows.map((row) =>
              [
                csvCell(row.date, true),
                csvCell(row.learnerName),
                csvCell(row.field.code, true),
                csvCell(row.field.nameZhTw),
                csvCell(row.method),
                csvCell(row.distanceMeters)
              ].join(',')
            )
          ];
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', 'attachment; filename="venue-attendance.csv"')
            .send('\uFEFF' + rows.join('\r\n') + '\r\n');
        } catch (error) {
          if (error instanceof Error && error.message === 'unauthenticated')
            return reply.code(401).send({ error: 'unauthenticated' });
          if (error instanceof Error && 'code' in error && error.code === '42501')
            return reply.code(403).send({ error: 'forbidden' });
          if (error instanceof Error && 'code' in error && error.code === '54000')
            return reply.code(413).send({ error: 'export_too_large' });
          return reply.code(503).send({ error: 'venue_unavailable' });
        }
      }
    );
  }
};

const venueQrAdminPage = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>團練場出席查詢</title><style>
body{font:125%/1.6 system-ui;margin:1rem;max-width:65rem}input,button{font:inherit;min-height:48px;max-width:100%;margin:.3rem}label{display:block}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:.5rem}section{overflow:auto}:focus-visible{outline:3px solid #185}footer{margin-top:2rem;font-size:.8em}
</style></head><body><h1>團練場出席查詢</h1><p>既有區域 view 權限可看姓名／出席；CSV 另需 stats.export。日期採各場地當地日期，結束日不含當日。每頁 100 筆，匯出最多 1000 筆。</p>
<label>場地所屬區域 UUID <input id="region" required></label><label>開始日期 <input id="from" type="date" required></label><label>結束日期（不含）<input id="until" type="date" required></label><label>頁碼 <input id="page" type="number" value="1" min="1" max="10000"></label>
<button id="read">查詢</button><button id="export">匯出 CSV</button><p id="status" role="status" aria-live="polite"></p><section><table id="records"></table></section><a href="/admin/">回後台</a>
<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer><script>
const get=id=>document.getElementById(id);
async function run(exporting){
  get('read').disabled=true;get('export').disabled=true;get('records').replaceChildren();get('status').textContent='查詢中';
  try{
    const cookies=document.cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-qigong-admin-csrf='));
    if(cookies.length!==1)throw new Error('csrf');
    const input={operation:exporting?'attendance.export':'attendance.read',regionId:get('region').value,from:get('from').value,until:get('until').value,filters:{fieldId:null,method:null}};
    if(!exporting){input.page=Number(get('page').value);input.limit=100;}
    const response=await fetch('/admin/venue-qr/api/'+(exporting?'export':'read'),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':cookies[0].slice('__Host-qigong-admin-csrf='.length)},body:JSON.stringify(input)});
    if(!response.ok){get('status').textContent=response.status===413?'匯出超過 1000 筆，請縮短日期。':response.status===403?'權限／區域或 CSRF 不符。':response.status===401?'請重新登入。':'查詢失敗，請檢查日期或稍後再試。';return;}
    if(exporting){const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='venue-attendance.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);get('status').textContent='CSV 已產生。';return;}
    const data=await response.json();get('status').textContent='出席 '+data.totals.attendanceCount+' 次／'+data.totals.attendanceDays+' 日／'+data.totals.learnerCount+' 人';
    for(const cells of [['場地當地日期','姓名','場地','方式'],...data.rows.map(r=>[r.date,r.learnerName,r.field.nameZhTw,r.method])]){
      const tr=document.createElement('tr');for(const value of cells){const td=document.createElement('td');td.textContent=value;tr.append(td);}get('records').append(tr);
    }
  }catch{get('status').textContent='查詢失敗，請重新登入或稍後再試。';}
  finally{get('read').disabled=false;get('export').disabled=false;}
}
get('read').onclick=()=>run(false);get('export').onclick=()=>run(true);
</script></body></html>`;
