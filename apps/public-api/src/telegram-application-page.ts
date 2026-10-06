export const telegramApplicationPage = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow"><title>加入氣功小幫手</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #203027; background: #f8faf8; }
    main { background: white; padding: 1.5rem; border-radius: .7rem; border: 1px solid #dae5db; }
    label { display: block; margin: 1rem 0; } input, select { display: block; box-sizing: border-box; width: 100%; padding: .65rem; margin-top: .35rem; }
    button { padding: .7rem 1rem; background: #285c3b; border: 0; border-radius: .4rem; color: white; cursor: pointer; }
    button:disabled { opacity: .5; } #status { min-height: 2rem; }
  </style>
</head>
<body>
  <main>
    <h1>加入氣功小幫手</h1>
    <p>請填寫白雁氣功會員資料，供所在地區管理員人工核對。審核通過前無法打卡；請勿將此連結轉傳他人。</p>
    <form id="application">
      <label>學員姓名<input name="name" autocomplete="name" maxlength="150" required></label>
      <label>白雁官網註冊 Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>電話（含國碼，例如 +886912345678）<input name="phone" type="tel" autocomplete="tel" pattern="\\+[1-9][0-9]{6,14}" required></label>
      <label>所在地區<select name="region" required>
        <option value="">請選擇</option><option value="tw-general">台灣</option>
        <option value="my-general">馬來西亞</option><option value="sg-general">新加坡</option>
        <option value="hk-general">香港</option><option value="other-general">其它</option>
      </select></label>
      <button type="submit">提交審核申請</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>
  <script>
    const token = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    const form = document.getElementById('application');
    const status = document.getElementById('status');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      form.hidden = true; status.textContent = '連結無效，請回 Telegram 私聊重新輸入 /start。';
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      status.textContent = '送出中…';
      const data = Object.fromEntries(new FormData(form));
      try {
        const response = await fetch('/telegram/onboarding/apply', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, ...data })
        });
        if (!response.ok) throw new Error(response.status === 409 ? '連結已過期或資料無法受理，請回 Telegram 私聊重新輸入 /start。' : '提交失敗，請稍後再試。');
        form.hidden = true;
        status.textContent = '申請已送出，請等待地區管理員核對；審核前無法打卡。';
      } catch (error) { status.textContent = error.message; button.disabled = false; }
    });
  </script>
</body>
</html>`;
