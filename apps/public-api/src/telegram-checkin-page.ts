export const telegramCheckinPage = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>氣功小幫手打卡</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #203027; background: #f8faf8; }
    main { background: white; padding: 1.5rem; border-radius: .7rem; border: 1px solid #dae5db; }
    label { display: block; margin: .6rem 0; } button { padding: .7rem 1rem; background: #285c3b; border: 0; border-radius: .4rem; color: white; cursor: pointer; }
  </style>
</head>
<body>
  <main><h1>每日練功打卡</h1>
    <p>請選擇本次練習的功法；每個練習日期只能打卡一次。昨天可在練習時區中午 12:00 前補登。</p>
    <form id="checkin"><fieldset id="methods"><legend>本次練習功法</legend></fieldset>
      <label><input type="checkbox" id="makeup"> 補登昨天（中午 12:00 前）</label>
      <button type="submit">確認打卡</button>
    </form><p id="status" role="status" aria-live="polite">載入功法中…</p>
  </main><footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
  <script>
    const token = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    const form = document.getElementById('checkin');
    const methods = document.getElementById('methods');
    const status = document.getElementById('status');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      form.hidden = true; status.textContent = '連結無效，請回 Telegram 輸入 /checkin。';
    } else {
      fetch('/telegram/checkin/methods', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
        .then(async response => { if (!response.ok) throw new Error('連結已過期，請回 Telegram 輸入 /checkin。'); return response.json(); })
        .then(data => {
          if (!data.methods.length) throw new Error('目前沒有可打卡的功法，請稍後再試。');
          for (const method of data.methods) {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox'; input.name = 'methods'; input.value = method.code;
            label.append(input, document.createTextNode(' ' + method.name_zh_tw));
            methods.append(label);
          }
          status.textContent = '';
        }).catch(error => { form.hidden = true; status.textContent = error.message; });
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const selected = [...form.querySelectorAll('input[name="methods"]:checked')].map(input => input.value);
      if (!selected.length) { status.textContent = '請至少選擇一項功法。'; return; }
      const button = form.querySelector('button'); button.disabled = true;
      try {
        const response = await fetch('/telegram/checkin/submit', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, methods: selected, makeup: document.getElementById('makeup').checked }) });
        if (!response.ok) throw new Error(response.status === 409 ? '此日期已打卡、補登時間已過或連結失效。' : '打卡失敗，請稍後再試。');
        const result = await response.json();
        form.hidden = true; status.textContent = '打卡成功：' + result.practiceDate + '（' + (result.entryKind === 'makeup' ? '補登' : '今日') + '）';
      } catch (error) { button.disabled = false; status.textContent = error.message; }
    });
  </script>
</body>
</html>`;
