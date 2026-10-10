import type { LearnerTextKey } from './learner-locale.js';
import { learnerPrivacyTexts } from './learner-privacy-locale.js';
import {
  lineLoginScript,
  languageSwitchScript,
  pageTexts,
  type LearnerPageChannel
} from './application-page.js';

export const renderCheckinPage = (channel: LearnerPageChannel) => {
  const texts = pageTexts(channel);
  const t = (key: LearnerTextKey) => texts[key];
  return `<!doctype html>
<html lang="${channel.locale === 'en' && channel.platform !== 'line' ? 'en' : 'zh-Hant'}">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>${t('checkinTitle')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }
    .container { max-width: 640px; margin: 0 auto; padding: 20px; }
    .card { background: #fff; border-radius: 14px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,.08); margin-bottom: 16px; }
    h1 { font-size: 24px; margin: 0 0 8px; } h2 { font-size: 16px; margin: 0 0 12px; }
    .muted { color: #6b7280; font-size: 14px; } .hint { background: #eff6ff; color: #1d4ed8; padding: 10px 12px; border-radius: 10px; font-size: 14px; }
    .date-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border-radius: 12px; background: #f3f4f6; margin: 14px 0; }
    .date-tab { background: transparent; color: #374151; padding: 10px; border: 0; border-radius: 9px; }
    .date-tab.active { background: #0d6efd; color: white; } .date-tab.makeup.active { background: #b45309; }
    .method { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .method:last-child { border: 0; } .method input { width: 18px; height: 18px; }
    .method-group { border-bottom: 1px solid #f3f4f6; padding: 4px 0; }
    .method-group:last-child { border: 0; } .method-row { display: flex; align-items: center; gap: 10px; }
    .method-row .method { flex: 1; border: 0; } .child-list { margin-left: 40px; }
    .toggle-btn { width: 30px; height: 30px; border: 1px solid #d1d5db; background: white; border-radius: 8px; }
    .toggle-spacer { width: 30px; flex-shrink: 0; } .method-hint { color: #9ca3af; font-size: 12px; }
    button { cursor: pointer; font: inherit; } .action { width: 100%; background: #0d6efd; color: white; border: 0; border-radius: 12px; padding: 14px; font-weight: 600; }
    .action:disabled { background: #9ca3af; } .entry { border-top: 1px solid #f3f4f6; padding: 12px 0; }
    .entry button { background: white; border: 1px solid #0d6efd; border-radius: 8px; color: #0d6efd; padding: 6px 10px; margin-top: 8px; }
    .feelings { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; } .feelings button,.feeling-chip { border:1px solid #a5b4c8; border-radius:16px; padding:5px 10px; background:white; } .feelings button[aria-pressed="true"] { background:#dbeafe; border-color:#2563eb; } .feeling-chip { display:inline-block; margin:4px; } textarea { width:100%; min-height:100px; font:inherit; padding:10px; box-sizing:border-box; } .practice-note { white-space:pre-wrap; overflow-wrap:anywhere; }
    .status { margin: 12px 0; } footer { color: #6b7280; font-size: 12px; text-align: center; }
    @media (max-width: 480px) { .container { padding: 14px; } .card { padding: 16px; margin-bottom: 12px; } }
  </style>
${channel.platform === 'line' ? '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' : ''}
</head>
<body><div class="container">
${channel.platform !== 'line' ? `<nav><button id="languageSwitch" type="button">${channel.locale === 'en' ? '繁體中文' : 'English'}</button></nav>` : ''}
  <section class="card"><h1>${t('checkinHeading')}</h1><p class="muted">${t('checkinIntro')}</p>
    <p id="stats" class="hint" hidden></p><div id="dateTabs" class="date-tabs" hidden>
      <button id="todayTab" class="date-tab active" type="button">${t('today')}</button>
      <button id="makeupTab" class="date-tab makeup" type="button">${t('yesterday')}</button></div>
    <p id="dateStatus" class="muted"></p></section>
  <form id="checkin" class="card" hidden><h2 id="formHeading">${t('methodsHeading')}</h2><div id="methods"></div>
    <section><h2>${t('noteHeading')}</h2><p>${t('feelingsLabel')}</p><div id="feelingTags" class="feelings"></div><label for="practiceNote">${t('noteLabel')}</label><textarea id="practiceNote" placeholder="${t('notePlaceholder')}" aria-describedby="noteCount notePrivacy"></textarea><p id="noteCount" class="muted" aria-live="polite"></p><p id="notePrivacy" class="muted">${t('notePrivacy')}</p><p id="reflectionPrivacy" class="muted" hidden></p></section>
    <button id="submitButton" class="action" type="submit">${t('submit')}</button></form>
  <p id="status" class="status" role="status" aria-live="polite">${t('loading')}</p>
  <section id="historyCard" class="card" hidden><h2>${t('historyHeading')}</h2><p class="muted">${t('historyIntro')}</p><div id="entries"></div></section>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
</div><script>
  ${
    channel.platform === 'line'
      ? lineLoginScript(channel.liffId)
      : `const tg = ${channel.platform === 'telegram' ? 'window.Telegram?.WebApp' : 'undefined'};
  if (tg) { tg.ready(); tg.expand(); }
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);`
  }
  const ui = ${JSON.stringify(texts).replaceAll('<', '\\u003c')};
  const privacyUi=${JSON.stringify(learnerPrivacyTexts(channel.platform === 'line' ? 'zh_TW' : (channel.locale ?? 'zh_TW')))};
  const format = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), ui[key]);
  const form = document.getElementById('checkin');
  const methods = document.getElementById('methods');
  const status = document.getElementById('status');
  const dateStatus = document.getElementById('dateStatus');
  const todayTab = document.getElementById('todayTab');
  const makeupTab = document.getElementById('makeupTab');
  let historyData;
  let selectedDate = 'today';
  let editing = null;
  const practiceNote = document.getElementById('practiceNote');
  const feelings = document.getElementById('feelingTags');
  let selectedFeelings = new Set();
  const noteDrafts = new Map();
  const rememberNote = () => noteDrafts.set(selectedDate,{text:practiceNote.value,ids:[...selectedFeelings]});
  const updateNoteCount = () => document.getElementById('noteCount').textContent=format('noteLength',{count:[...practiceNote.value].length});
  practiceNote.addEventListener('input',updateNoteCount);
  const restoreNote = entry => {
    const draft=noteDrafts.get(selectedDate);
    practiceNote.value=draft?.text ?? entry?.practice_note ?? '';
    selectedFeelings=new Set(draft?.ids ?? (entry?.feeling_tags ?? []).map(tag=>tag.id));
    updateNoteCount();
  };
  const renderFeelings = () => {
    feelings.replaceChildren();
    const choices=new Map((historyData.feelingTags ?? []).map(tag=>[tag.id,tag]));
    for(const tag of checkinForDate()?.feeling_tags ?? []) choices.set(tag.id,tag);
    for(const tag of choices.values()) {
      const button=document.createElement('button');button.type='button';button.disabled=historyData.privacy?.reflectionConsent===false;button.textContent=tag.name;button.setAttribute('aria-pressed',String(selectedFeelings.has(tag.id)));
      button.addEventListener('click',()=>{if(selectedFeelings.has(tag.id))selectedFeelings.delete(tag.id);else selectedFeelings.add(tag.id);renderFeelings();});
      feelings.append(button);
    }
  };
  const post = async (route, payload) => {
    const response = await fetch('/${channel.platform}/checkin/' + route, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ${channel.platform === 'line' ? 'idToken' : 'token'}, ${channel.platform !== 'line' && channel.locale === 'en' ? 'locale: "en",' : ''} ...payload })
    });
    if (!response.ok) throw new Error(response.status === 409 || response.status === 403
      ? ui.checkinConflict
      : ui.operationFailed);
    return response.json();
  };
  const checkinForDate = () => historyData.entries.find(entry => entry.practice_date === (
    selectedDate === 'today' ? historyData.today : yesterday()));
  const yesterday = () => {
    const day = new Date(historyData.today + 'T00:00:00Z');
    day.setUTCDate(day.getUTCDate() - 1);
    return day.toISOString().slice(0, 10);
  };
  const selectedMethods = () => [...form.querySelectorAll('input[name="methods"]:checked')].map(input => input.value);
  const selectMethods = codes => {
    for (const input of form.querySelectorAll('input[name="methods"]')) input.checked = codes.includes(input.value);
    updateGroups();
  };
  const updateGroups = () => {
    for (const group of methods.querySelectorAll('.method-group')) {
      const children = [...group.querySelectorAll('input[name="methods"]')];
      const parent = group.querySelector('input[name="group"]');
      parent.checked = children.every(input => input.checked);
      parent.indeterminate = !parent.checked && children.some(input => input.checked);
    }
  };
  const render = () => {
    document.getElementById('stats').hidden = false;
    document.getElementById('stats').textContent = format('stats', { streak: historyData.currentStreak, total: historyData.totalDays, zone: historyData.timezone });
    document.getElementById('dateTabs').hidden = false;
    todayTab.classList.toggle('active', selectedDate === 'today');
    makeupTab.classList.toggle('active', selectedDate === 'makeup');
    makeupTab.disabled = !historyData.makeupOpen;
    makeupTab.textContent = historyData.makeupOpen ? ui.yesterday : ui.makeupClosed;
    const existing = checkinForDate();
    practiceNote.disabled=historyData.privacy?.reflectionConsent===false;
    document.getElementById('notePrivacy').textContent=historyData.privacy?.active?privacyUi.sharing:ui.notePrivacy;
    const reflectionHint=document.getElementById('reflectionPrivacy');if(reflectionHint){reflectionHint.hidden=historyData.privacy?.reflectionConsent!==false;reflectionHint.textContent=privacyUi.reflectionRequired;}
    renderFeelings(); updateNoteCount();
    const date = selectedDate === 'today' ? historyData.today : yesterday();
    dateStatus.textContent = existing ? format('alreadyRecorded', { date }) + (existing.editable ? ui.canCorrect : '')
      : format(selectedDate === 'makeup' ? 'makeupAvailable' : 'notRecorded', { date });
    form.hidden = !!existing && editing !== existing.id;
    document.getElementById('formHeading').textContent = editing ? format('correcting', { date }) : ui.methodsHeading;
    document.getElementById('submitButton').textContent = editing ? ui.saveCorrection : format(selectedDate === 'makeup' ? 'completeMakeup' : 'completeDate', { date });
    const entries = document.getElementById('entries');
    entries.replaceChildren();
    for (const entry of historyData.entries) {
      const row = document.createElement('div'); row.className = 'entry';
      const heading = document.createElement('strong'); heading.textContent = entry.practice_date + (entry.entry_kind === 'makeup' ? ui.makeupEntry : '');
      const description = document.createElement('div'); description.textContent = entry.method_names.join('、');
      row.append(heading, description);
      for(const tag of entry.feeling_tags ?? []) { const chip=document.createElement('span');chip.className='feeling-chip';chip.textContent=tag.name;row.append(chip); }
      if(entry.practice_note) { const note=document.createElement('p');note.className='practice-note';note.textContent=entry.practice_note;row.append(note); }
      if (entry.editable) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = ui.correctMethods;
        button.addEventListener('click', () => {
          rememberNote();
          selectedDate = entry.practice_date === historyData.today ? 'today' : 'makeup';
          restoreNote(entry);
          editing = entry.id; selectMethods(entry.method_codes); render(); form.scrollIntoView({ behavior: 'smooth' });
        });
        row.append(button);
      }
      entries.append(row);
    }
    document.getElementById('historyCard').hidden = false;
    if (!historyData.entries.length) entries.textContent = ui.noHistory;
  };
  for (const [button, date] of [[todayTab, 'today'], [makeupTab, 'makeup']]) {
    button.addEventListener('click', () => {
      rememberNote(); selectedDate = date; editing = null; restoreNote(checkinForDate());
      selectMethods(checkinForDate()?.method_codes ?? []); render();
    });
  }
  const load = () => Promise.all([post('methods', {}), post('history', {})]).then(([catalog, history]) => {
    if (!catalog.methods.length) throw new Error(ui.noMethods);
    const groups = new Map();
    for (const method of catalog.methods) {
      if (method.parent_code) {
        if (!groups.has(method.parent_code)) groups.set(method.parent_code, { code: method.parent_code, name: ${channel.platform !== 'line' && channel.locale === 'en' ? 'method.parent_name_en || method.parent_name_zh_tw' : 'method.parent_name_zh_tw'}, children: [] });
        groups.get(method.parent_code).children.push(method);
      }
    }
    const makeLabel = (method, name) => {
      const label = document.createElement('label'); label.className = 'method';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.value = method.code;
      label.append(input, document.createTextNode(${channel.platform !== 'line' && channel.locale === 'en' ? 'method.name_en || method.name_zh_tw' : 'method.name_zh_tw'})); return label;
    };
    for (const method of catalog.methods) {
      if (!method.parent_code) {
        const row = document.createElement('div'); row.className = 'method-row';
        const spacer = document.createElement('span'); spacer.className = 'toggle-spacer';
        row.append(spacer, makeLabel(method, 'methods')); methods.append(row);
        continue;
      }
      const group = groups.get(method.parent_code);
      if (group.rendered) continue;
      group.rendered = true;
      const container = document.createElement('div'); container.className = 'method-group';
      const row = document.createElement('div'); row.className = 'method-row';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'toggle-btn';
      toggle.setAttribute('aria-label', ui.expand + group.name); toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = '+';
      const parentLabel = makeLabel({ code: group.code, name_zh_tw: group.name }, 'group');
      const hint = document.createElement('span'); hint.className = 'method-hint'; hint.textContent = ui.selectGroup; parentLabel.append(hint);
      const childList = document.createElement('div'); childList.className = 'child-list'; childList.hidden = true;
      for (const child of group.children) childList.append(makeLabel(child, 'methods'));
      const parentInput = parentLabel.querySelector('input');
      parentInput.addEventListener('change', () => {
        for (const input of childList.querySelectorAll('input')) input.checked = parentInput.checked;
        updateGroups();
      });
      childList.addEventListener('change', updateGroups);
      toggle.addEventListener('click', () => {
        childList.hidden = !childList.hidden;
        toggle.textContent = childList.hidden ? '+' : '−';
        toggle.setAttribute('aria-expanded', String(!childList.hidden));
      });
      row.append(toggle, parentLabel); container.append(row, childList); methods.append(container);
    }
    updateGroups();
    historyData = history; restoreNote(checkinForDate()); status.textContent = ''; render();
  });
  ${
    channel.platform === 'line'
      ? `lineReady.then(load).catch(error => { status.textContent = error.message; });`
      : `if (!/^[A-Za-z0-9_-]{43}$/.test(token)) status.textContent = ui.invalidCheckin;
  else load().catch(error => { status.textContent = error.message; });`
  }
  ${channel.platform !== 'line' ? languageSwitchScript(channel.platform, channel.locale ?? 'zh_TW') : ''}
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = selectedMethods();
    if (!selected.length) { status.textContent = ui.selectAtLeastOne; return; }
    if([...practiceNote.value].length>1000) {status.textContent=ui.noteTooLong;return;}
    const noteFields=historyData.privacy?.reflectionConsent===false?{}:{practiceNote:practiceNote.value,feelingTagIds:[...selectedFeelings]};
    const button = document.getElementById('submitButton'); button.disabled = true;
    try {
      const corrected = !!editing;
      await post(corrected ? 'correct' : 'submit', corrected
        ? { checkinId: editing, methods: selected, ...noteFields }
        : { methods: selected, makeup: selectedDate === 'makeup', ...noteFields });
      historyData = await post('history', {});
      noteDrafts.delete(selectedDate); restoreNote(checkinForDate());
      editing = null; status.textContent = corrected ? ui.corrected : ui.checkedIn; render();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
</script></body></html>`;
};
