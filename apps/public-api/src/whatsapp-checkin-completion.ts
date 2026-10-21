import type { LearnerLocale } from './learner-locale.js';
import { uiDictionary } from './ui-localization.js';

export const whatsappCompletionTexts = (locale: LearnerLocale) =>
  locale === 'en'
    ? {
        title: 'Check-in completed',
        encouragement: 'Keep it up tomorrow!',
        record: 'This saved check-in',
        date: 'Practice date',
        zone: 'Practice time zone',
        methods: 'Practice methods',
        regular: 'Check-in',
        makeup: 'Makeup check-in',
        corrected: 'Correction',
        close: 'Done / close',
        edit: 'Return to editing',
        waiting: 'Saved. This page will try to close after 3 seconds.',
        manual:
          'Saved. If this page stays open, use your browser’s close or back control to return to WhatsApp.',
        unsaved:
          'This check-in is saved. Other unsaved changes remain; return to editing before leaving.',
        refresh:
          'This check-in is saved, but refreshing failed. The confirmed record remains here; automatic closing is paused.',
        unconfirmed:
          'The save result could not be confirmed. Your input is retained. Retry without changing it to safely check the same request.'
      }
    : uiDictionary(locale, {
        title: '已完成打卡',
        encouragement: '明天繼續加油！',
        record: '本次已儲存的打卡紀錄',
        date: '練習日期',
        zone: '練習時區',
        methods: '練習功法',
        regular: '打卡',
        makeup: '補登',
        corrected: '更正',
        close: '完成／關閉',
        edit: '返回編輯',
        waiting: '已儲存，3秒後將嘗試關閉此頁。',
        manual: '已儲存。若頁面仍開啟，請使用瀏覽器的關閉或返回按鈕回到 WhatsApp。',
        unsaved: '本次打卡已儲存，另有未儲存內容；請先返回編輯再離開。',
        refresh: '本次打卡已儲存，但重新整理失敗；已確認的紀錄保留於此，自動關閉已暫停。',
        unconfirmed: '尚未確認儲存結果，輸入內容已保留；請勿變更內容，重試可安全確認同一筆請求。'
      });

export const whatsappCompletionBootstrap = (locale: LearnerLocale) => `
    const waCompletionText=${JSON.stringify(whatsappCompletionTexts(locale)).replaceAll('<', '\\u003c')};
    let waCompletionActive=false,waCompletionRefreshError=false,waCompletionTimer=null,waCompletionGeneration=0;
    const waCancelCompletionTimer=()=>{waCompletionGeneration++;if(waCompletionTimer!==null)clearTimeout(waCompletionTimer);waCompletionTimer=null;};
    const waDismissCompletion=()=>{waCancelCompletionTimer();waCompletionActive=false;$('wa-completion').hidden=true;$('editor').hidden=false;};
    const waCaptureSaved=draft=>({date:selectedDate,timezone:profile.timezone,version:draft.version,action:entryFor(selectedDate)?'corrected':selectedDate===profile.today?'regular':'makeup',methods:draft.methods.map(code=>profile.methods.find(method=>method.code===code)?.name||code)});
    const waValidateSaved=(result,saved)=>{if(!result||typeof result.checkinId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.checkinId)||!Number.isSafeInteger(result.version)||result.version<=saved.version||result.action!==saved.action||result.receiptQueued!==false)throw Error('unconfirmed_whatsapp_save');};
    const waAttemptCompletionClose=()=>{
      waCancelCompletionTimer();if(!waCompletionActive||leaving)return;
      if(busy||writing||dirty()){$('wa-completion-hint').textContent=waCompletionText.unsaved;return;}
      if(typeof whatsappAuthenticated!=='undefined'&&!whatsappAuthenticated){waDismissCompletion();return;}
      try{if(typeof window.close==='function'){leaving=true;syncClosing();window.close();}}catch{/* Browser close support is not guaranteed. */}
      if(window.closed!==true){leaving=false;syncClosing();$('wa-completion-hint').textContent=waCompletionText.manual;}
    };
    const waShowCompletion=(saved,result)=>{
      waCancelCompletionTimer();waCompletionActive=true;waCompletionRefreshError=false;
      const record=$('wa-completion-record');record.replaceChildren();
      for(const text of [waCompletionText.date+': '+saved.date,waCompletionText.zone+': '+saved.timezone,waCompletionText[result.action],waCompletionText.methods+': '+saved.methods.join('、')])record.append(node('p',text));
      $('wa-completion-hint').textContent=waCompletionText.waiting;$('editor').hidden=true;$('wa-completion').hidden=false;
      $('wa-completion').focus?.();$('wa-completion').scrollIntoView?.({behavior:'smooth',block:'start'});
    };
    const waCompletionRefreshFailed=()=>{waCompletionRefreshError=true;waCancelCompletionTimer();if(typeof whatsappAuthenticated!=='undefined'&&!whatsappAuthenticated){waDismissCompletion();return;}$('wa-completion-hint').textContent=waCompletionText.refresh;};
    const waCompletionReady=()=>{
      if(!waCompletionActive||waCompletionRefreshError)return;
      waCancelCompletionTimer();const generation=waCompletionGeneration;
      if(busy||writing||dirty()){$('wa-completion-hint').textContent=waCompletionText.unsaved;return;}
      waCompletionTimer=setTimeout(()=>{if(generation===waCompletionGeneration&&waCompletionActive)waAttemptCompletionClose();},3000);
    };
    $('wa-completion-close').onclick=waAttemptCompletionClose;
    $('wa-completion-edit').onclick=()=>{waDismissCompletion();renderEditor();};
    window.addEventListener('pagehide',waCancelCompletionTimer);
`;

export const addWhatsAppCheckinCompletion = (html: string, locale: LearnerLocale): string => {
  const t = whatsappCompletionTexts(locale);
  const panel = `<section id="wa-completion" class="card wa-completion" role="status" aria-live="polite" tabindex="-1" hidden><h2>${t.title}</h2><p class="success">${t.encouragement}</p><h3>${t.record}</h3><div id="wa-completion-record"></div><p id="wa-completion-hint" class="hint"></p><div class="row"><button id="wa-completion-close" type="button">${t.close}</button><button id="wa-completion-edit" type="button" class="secondary">${t.edit}</button></div></section>`;
  const edits: ReadonlyArray<readonly [string, string]> = [
    [
      '</style>',
      '.wa-completion{overflow-wrap:anywhere}.wa-completion button{min-height:44px;white-space:normal}</style>'
    ],
    ['<fieldset id="editor"', panel + '<fieldset id="editor"'],
    [
      '    const selectDate=date=>',
      whatsappCompletionBootstrap(locale) + '\n    const selectDate=date=>'
    ],
    [
      'if(busy||needsRefresh||!profile?.confirmed||!editOpen())return;capture();',
      'if(waCompletionActive||busy||needsRefresh||!profile?.confirmed||!editOpen())return;capture();'
    ],
    [
      "writing=true;setBusy(true);$('submit').textContent=t.busy;",
      "writing=true;setBusy(true);$('submit').textContent=t.busy;const waSaved=waCaptureSaved(draft);"
    ],
    [
      'draft.version=result.version;draft.requestId=null;',
      'waValidateSaved(result,waSaved);draft.version=result.version;draft.requestId=null;'
    ],
    [
      'writing=false;setBusy(false);if(!preserved&&!dirty()&&closeMiniapp())return;',
      'writing=false;setBusy(false);waShowCompletion(waSaved,result);'
    ],
    [
      'catch{needsRefresh=true;status(t.savedRefresh,true);}',
      'catch{needsRefresh=true;waCompletionRefreshFailed();status(t.savedRefresh,true);}'
    ],
    [
      '}catch(error){showError(error);}finally{writing=false;setBusy(false);renderEditor();}',
      '}catch(error){if([401,403,409].includes(error.status))showError(error);else status(waCompletionText.unconfirmed,true);}finally{writing=false;setBusy(false);renderEditor();waCompletionReady();}'
    ]
  ];
  let result = html;
  for (const [before, after] of edits) {
    if (result.split(before).length !== 2) throw Error('WhatsApp completion template changed');
    result = result.replace(before, () => after);
  }
  return result;
};
