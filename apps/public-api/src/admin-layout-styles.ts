// Admin-only density rules. Learner pages and brand/security policy are independent.
export const adminLayoutStyles = String.raw`
:root { --admin-input-font:.875rem; --admin-control-height:34px; --admin-control-padding:.3rem .55rem; --admin-gap:.65rem; --admin-card-padding:.875rem; --admin-textarea-height:4.5rem; }
* { box-sizing:border-box; } body { margin:0; color:var(--brand-primary); background:var(--canvas); font-family:system-ui,sans-serif; font-size:.875rem; line-height:1.45; }
a { color:var(--brand-primary); } .shell { display:grid; grid-template-columns:14rem minmax(0,1fr); min-height:100vh; align-items:start; }
.sidebar { position:sticky; top:0; height:100vh; height:100dvh; overflow-y:auto; overscroll-behavior:contain; background:var(--brand-deep); color:var(--surface-muted); padding:1rem .75rem; }
.brand { font-size:1.2rem; font-weight:700; margin-bottom:.75rem; } .brand small { display:block; margin-top:.2rem; font-size:.75rem; opacity:.8; font-weight:400; }
.sidebar .languages { margin-bottom:.75rem; } .sidebar .languages select { width:100%; border-color:var(--brand-accent); background:var(--surface-muted); color:var(--brand-deep); font-size:var(--admin-input-font); }
.sidebar .languages select:focus-visible,.sidebar #logout:focus-visible { outline:2px solid var(--surface-muted); outline-offset:3px; }
.sidebar #logout { margin-top:.75rem; width:100%; border-color:var(--brand-accent); background:transparent; color:var(--surface-muted); }
.nav-disclosure { min-width:0; } .nav-disclosure > summary { display:none; }
#admin-navigation { display:grid; gap:.75rem; } .nav-group { min-width:0; } .nav-group[hidden],.journal-nav[hidden] { display:none !important; }
.nav-group-title { display:flex; align-items:center; justify-content:space-between; gap:.5rem; min-height:var(--admin-control-height); padding:.4rem .625rem; color:var(--brand-accent); font-size:.875rem; line-height:1.3; font-weight:600; border:1px solid var(--brand-secondary); border-radius:.35rem; list-style:none; overflow-wrap:anywhere; }
.nav-group-title::-webkit-details-marker { display:none; } .nav-group-title::marker { content:''; } .nav-group-title::after { content:'+'; flex:0 0 auto; } .nav-group[open] > .nav-group-title::after { content:'−'; }
.nav-group[data-current-group] > .nav-group-title { box-shadow:inset 3px 0 0 var(--brand-accent); }
.nav-group-links { display:grid; gap:2px; margin:.25rem 0 0 .5rem; padding-left:.25rem; border-left:1px solid var(--brand-secondary); }
.nav-group:not([open]) > .nav-group-links { display:none; }
#admin-navigation a { display:flex; align-items:center; min-height:34px; color:var(--brand-accent); padding:6px 10px; line-height:1.35; text-decoration:none; border-radius:.35rem; overflow-wrap:anywhere; }
#admin-navigation a:hover,#admin-navigation a[aria-current="page"] { background:var(--brand-secondary); color:white; }
#admin-navigation a[aria-current="page"] { font-weight:700; box-shadow:inset 3px 0 0 var(--brand-accent); }
.workspace { padding:1rem clamp(.875rem,2vw,1.5rem); min-width:0; } header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.65rem; margin-bottom:.875rem; }
h1 { font-size:1.4rem; line-height:1.3; margin:0; } h2 { font-size:1.05rem; margin:0 0 .65rem; } h3 { font-size:.95rem; margin:.5rem 0; } p { margin:.45rem 0 .65rem; }
button { cursor:pointer; min-height:var(--admin-control-height); padding:var(--admin-control-padding); border-radius:.35rem; border:1px solid var(--brand-primary); background:var(--brand-primary); color:white; font:inherit; line-height:1.35; }
button:disabled { opacity:.45; cursor:default; } button.secondary,button.reject { background:white; color:var(--brand-primary); } button.reject { color:var(--brand-deep); border-color:var(--brand-deep); border-width:2px; font-weight:700; }
input,select,textarea { font:inherit; font-size:var(--admin-input-font); line-height:1.35; min-width:0; max-width:100%; padding:var(--admin-control-padding); border:1px solid var(--brand-secondary); border-radius:.3rem; background:white; color:var(--brand-primary); }
input:not([type="checkbox"]):not([type="radio"]),select { min-height:var(--admin-control-height); }
textarea { display:block; width:100%; min-height:var(--admin-textarea-height); resize:vertical; }
textarea[readonly] { max-width:42rem; min-height:3.5rem; } input[inputmode="numeric"][maxlength="6"] { width:8rem; }
input[type="checkbox"],input[type="radio"] { width:1rem; height:1rem; min-height:0; padding:0; margin:.15rem 0; flex:0 0 1rem; }
label { display:grid; gap:.25rem; min-width:0; font-size:.8125rem; }
fieldset { min-width:0; } .filters { display:flex; flex-wrap:wrap; align-items:end; gap:var(--admin-gap); margin-bottom:.75rem; }
.filters input { width:12rem; } .filters select { width:11rem; min-width:0; }
.filters input[type="date"] { width:9.5rem; } .filters input[type="number"] { width:6rem; }
.filters :is(input[name="reason"],input[name="label"]) { width:14rem; }
.card,article { min-width:0; background:white; border:1px solid var(--border); border-radius:.5rem; padding:var(--admin-card-padding); margin-bottom:.75rem; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; } .kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.65rem; }
.kpi strong { display:block; font-size:1.7rem; line-height:1.3; color:var(--brand-primary); } .muted,.meta { color:var(--muted); }
#status,#journal-status { min-height:0; white-space:pre-wrap; overflow-wrap:anywhere; } #status:empty,#journal-status:empty { margin:0; }
#status[data-error="true"],#journal-status[data-error="true"] { color:var(--brand-deep); font-weight:700; border-left:3px solid var(--brand-deep); padding-left:.65rem; }
.table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; font-size:.875rem; } th,td { text-align:left; padding:.4rem .55rem; border-bottom:1px solid var(--border); vertical-align:top; white-space:nowrap; } th { color:var(--muted); background:var(--surface-muted); }
.pager { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; margin-top:.65rem; }
.chart { width:100%; height:210px; } .chart text { fill:var(--brand-primary); } .bar { background:var(--brand-accent); height:.5rem; border-radius:.25rem; } .bar span { display:block; height:100%; background:var(--brand-secondary); border-radius:inherit; }
.actions,.batch { display:flex; flex-wrap:wrap; align-items:center; gap:.4rem; } .batch { margin-bottom:.65rem; } .batch label { display:flex; align-items:center; gap:.4rem; } .select-application { margin-right:.4rem; } .actions input { width:min(22rem,100%); }
footer { font-size:.75rem; color:var(--muted); margin-top:1.25rem; } details summary { cursor:pointer; } .skip { position:absolute; left:-9999px; } .skip:focus { left:1rem; top:1rem; background:white; padding:.75rem; z-index:2; }
.access-account { overflow-wrap:anywhere; } .access-account [hidden] { display:none !important; }
.access-account-header,.access-grant-header { display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:.5rem; } .access-email { margin:.2rem 0; }
.access-statuses { display:flex; flex-wrap:wrap; gap:.3rem; } .access-badge { font-size:.75rem; padding:.15rem .45rem; border-radius:1rem; background:var(--surface-muted); border:1px solid var(--border); }
.access-details { margin:.65rem 0; padding:.55rem; background:var(--surface-muted); border-radius:.35rem; } .access-details p,.access-grant p { margin:.3rem 0; }
.access-grants { display:grid; gap:.55rem; } .access-grants h3 { margin:.3rem 0; } .access-grant { border:1px solid var(--border); border-radius:.4rem; padding:.65rem; }
.access-grant-actions { display:flex; flex-wrap:wrap; align-items:start; gap:.4rem; } .access-grant-actions > fieldset { flex-basis:100%; order:1; } .access-account-actions { margin-top:.65rem; }
.access-action-panel { min-width:0; width:100%; border:1px solid var(--brand-secondary); border-radius:.4rem; padding:.75rem; margin:.5rem 0 0; background:var(--surface-muted); } .access-action-panel legend { font-weight:700; padding:0 .35rem; } .access-target { font-weight:600; }
.access-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--admin-gap); } .access-action-panel select,.access-action-panel textarea { width:100%; } .access-action-panel .actions { justify-content:flex-end; margin-top:.65rem; }
.access-account .access-danger-button { background:white; color:var(--brand-deep); border-color:var(--brand-deep); border-width:2px; font-weight:700; } .access-danger-zone { margin-top:.875rem; padding:.75rem; border:2px dashed var(--brand-deep); border-radius:.4rem; background:var(--surface-muted); } .access-danger-zone h3 { color:var(--brand-deep); }
.access-error { color:var(--brand-deep); font-weight:700; min-height:1.25rem; } .access-error:empty { min-height:0; margin:0; } .access-notice { padding:.55rem; background:var(--surface-muted); border-radius:.35rem; } .access-account button:focus-visible,.access-account textarea:focus-visible,.access-account select:focus-visible { outline:2px solid var(--brand-primary); outline-offset:3px; }
.admin-policy-document { max-width:76ch; font-size:1rem; line-height:1.65; } #policy-fields,.eligibility-panel { max-width:42rem; border:1px solid var(--border); border-radius:.4rem; padding:.75rem; margin:.65rem 0; background:var(--surface-muted); } #policy-fields button,.eligibility-panel button { margin-top:.5rem; }
.pending-page { max-width:38rem; margin:1.25rem auto; padding:1rem; } .pending-page .admin-logo { width:64px; margin-bottom:.75rem; } .pending-page label { margin:.65rem 0; } .pending-page :is(input,select,textarea) { width:100%; } .pending-page .actions { margin-top:.65rem; } .pending-page #logout,.pending-page #refresh { background:white; color:var(--brand-primary); }
@media(max-width:1000px) { .kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:760px) {
 .shell { display:block; } .sidebar { position:static; height:auto; overflow:visible; padding:.75rem; } .brand { margin-bottom:.5rem; } .sidebar .languages { margin-bottom:.5rem; }
 .nav-disclosure > summary { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.4rem; min-height:44px; padding:.5rem .625rem; color:var(--surface-muted); border:1px solid var(--brand-secondary); border-radius:.35rem; }
 .nav-disclosure > summary::after { content:'▾'; } .nav-disclosure[open] > summary::after { content:'▴'; } .nav-disclosure > summary span { min-width:0; flex:1; font-size:.8125rem; color:var(--brand-accent); }
 #admin-navigation { padding-top:.65rem; gap:.65rem; } #admin-navigation a { min-height:44px; } .workspace { padding:.875rem; } .grid,.access-form-grid { grid-template-columns:1fr; }
 .access-account-header,.access-grant-header { flex-direction:column; } .access-action-panel .actions button { flex:1 1 auto; } h1 { font-size:1.3rem; }
 .filters label { flex:1 1 9rem; } .filters :is(input,select) { width:100%; } .filters input[type="checkbox"] { width:1rem; } .pending-page { margin:.5rem auto; }
}
@media(max-width:760px),(pointer:coarse) { :root { --admin-control-height:44px; --admin-input-font:1rem; } #admin-navigation a { min-height:44px; } .batch label { min-height:44px; } .access-details summary { min-height:44px; padding:.65rem 0; } }
.sidebar :where(a,button,select,summary):focus-visible { outline:3px solid var(--brand-accent); outline-offset:3px; }
`;
