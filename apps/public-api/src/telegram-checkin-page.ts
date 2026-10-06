export const telegramCheckinPage = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>氣功小幫手打卡</title>
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
    .status { margin: 12px 0; } footer { color: #6b7280; font-size: 12px; text-align: center; }
    @media (max-width: 480px) { .container { padding: 14px; } .card { padding: 16px; margin-bottom: 12px; } }
  </style>
</head>
<body><div class="container">
  <section class="card"><h1>練功打卡</h1><p class="muted">選擇練功日期與功法；每個日期只記錄一次。補登及更正昨天的功法須在練習時區中午 12:00 前。</p>
    <p id="stats" class="hint" hidden></p><div id="dateTabs" class="date-tabs" hidden>
      <button id="todayTab" class="date-tab active" type="button">今天</button>
      <button id="makeupTab" class="date-tab makeup" type="button">補登昨天</button></div>
    <p id="dateStatus" class="muted"></p></section>
  <form id="checkin" class="card" hidden><h2 id="formHeading">練習功法（可複選）</h2><div id="methods"></div>
    <button id="submitButton" class="action" type="submit">完成打卡</button></form>
  <p id="status" class="status" role="status" aria-live="polite">載入打卡資料中…</p>
  <section id="historyCard" class="card" hidden><h2>近期打卡紀錄</h2><p class="muted">最近 14 筆；在期限內可更正誤選的功法。</p><div id="entries"></div></section>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
</div><script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const form = document.getElementById('checkin');
  const methods = document.getElementById('methods');
  const status = document.getElementById('status');
  const dateStatus = document.getElementById('dateStatus');
  const todayTab = document.getElementById('todayTab');
  const makeupTab = document.getElementById('makeupTab');
  let historyData;
  let selectedDate = 'today';
  let editing = null;
  const post = async (route, payload) => {
    const response = await fetch('/telegram/checkin/' + route, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, ...payload })
    });
    if (!response.ok) throw new Error(response.status === 409 || response.status === 403
      ? '連結失效、日期已打卡或更正期限已過。請回 Telegram 輸入 /checkin 取得新連結。'
      : '操作失敗，請稍後再試。');
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
    document.getElementById('stats').textContent = '🔥 連續 ' + historyData.currentStreak + ' 天 · 總計 ' + historyData.totalDays + ' 天 · 練功時區：' + historyData.timezone;
    document.getElementById('dateTabs').hidden = false;
    todayTab.classList.toggle('active', selectedDate === 'today');
    makeupTab.classList.toggle('active', selectedDate === 'makeup');
    makeupTab.disabled = !historyData.makeupOpen;
    makeupTab.textContent = historyData.makeupOpen ? '補登昨天' : '補登已截止';
    const existing = checkinForDate();
    const date = selectedDate === 'today' ? historyData.today : yesterday();
    dateStatus.textContent = existing ? date + ' 已打卡。' + (existing.editable ? '可更正所選功法。' : '')
      : selectedDate === 'makeup' ? date + ' 尚未打卡，可於中午 12:00 前補登。' : date + ' 尚未打卡。';
    form.hidden = !!existing && editing !== existing.id;
    document.getElementById('formHeading').textContent = editing ? '更正 ' + date + ' 的功法' : '練習功法（可複選）';
    document.getElementById('submitButton').textContent = editing ? '儲存更正' : '完成 ' + date + (selectedDate === 'makeup' ? ' 補登' : ' 打卡');
    const entries = document.getElementById('entries');
    entries.replaceChildren();
    for (const entry of historyData.entries) {
      const row = document.createElement('div'); row.className = 'entry';
      const heading = document.createElement('strong'); heading.textContent = entry.practice_date + (entry.entry_kind === 'makeup' ? '（補登）' : '');
      const description = document.createElement('div'); description.textContent = entry.method_names.join('、');
      row.append(heading, description);
      if (entry.editable) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '更正功法';
        button.addEventListener('click', () => {
          selectedDate = entry.practice_date === historyData.today ? 'today' : 'makeup';
          editing = entry.id; selectMethods(entry.method_codes); render(); form.scrollIntoView({ behavior: 'smooth' });
        });
        row.append(button);
      }
      entries.append(row);
    }
    document.getElementById('historyCard').hidden = false;
    if (!historyData.entries.length) entries.textContent = '尚無打卡紀錄。';
  };
  for (const [button, date] of [[todayTab, 'today'], [makeupTab, 'makeup']]) {
    button.addEventListener('click', () => {
      selectedDate = date; editing = null;
      selectMethods(checkinForDate()?.method_codes ?? []); render();
    });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) status.textContent = '連結無效，請回 Telegram 輸入 /checkin。';
  else Promise.all([post('methods', {}), post('history', {})]).then(([catalog, history]) => {
    if (!catalog.methods.length) throw new Error('目前沒有可打卡的功法，請稍後再試。');
    const groups = new Map();
    for (const method of catalog.methods) {
      if (method.parent_code) {
        if (!groups.has(method.parent_code)) groups.set(method.parent_code, { code: method.parent_code, name: method.parent_name_zh_tw, children: [] });
        groups.get(method.parent_code).children.push(method);
      }
    }
    const makeLabel = (method, name) => {
      const label = document.createElement('label'); label.className = 'method';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.value = method.code;
      label.append(input, document.createTextNode(method.name_zh_tw)); return label;
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
      toggle.setAttribute('aria-label', '展開' + group.name); toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = '+';
      const parentLabel = makeLabel({ code: group.code, name_zh_tw: group.name }, 'group');
      const hint = document.createElement('span'); hint.className = 'method-hint'; hint.textContent = ' 勾選即全選子功法'; parentLabel.append(hint);
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
    historyData = history; status.textContent = ''; render();
  }).catch(error => { status.textContent = error.message; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const selected = selectedMethods();
    if (!selected.length) { status.textContent = '請至少選擇一項功法。'; return; }
    const button = document.getElementById('submitButton'); button.disabled = true;
    try {
      const corrected = !!editing;
      await post(corrected ? 'correct' : 'submit', corrected
        ? { checkinId: editing, methods: selected }
        : { methods: selected, makeup: selectedDate === 'makeup' });
      historyData = await post('history', {});
      editing = null; status.textContent = corrected ? '更正已儲存。' : '打卡成功！'; render();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
</script></body></html>`;
