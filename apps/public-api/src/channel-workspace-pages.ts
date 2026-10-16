import { lineUiText } from './line-ui-localization.js';
import { journalTexts } from './journal-locale.js';
import { uiText, uiDictionary } from './ui-localization.js';
import { whatsappBrowserBootstrap, whatsappLoginMarkup } from './whatsapp-browser-bootstrap.js';
import type { LearnerLocale } from './learner-locale.js';
import { telegramWorkspaceTexts } from './telegram-workspace-locale.js';
import { lineLoginScript } from './application-page.js';
import {
  renderTelegramWorkspacePage,
  telegramWorkspaceBootstrap,
  type TelegramWorkspacePage
} from './telegram-workspace-pages.js';
import { renderLearnerJournalPage } from './learner-journal-pages.js';
export type WorkspaceChannel = { platform: 'line'; liffId: string } | { platform: 'whatsapp' };
export type ChannelWorkspacePage = TelegramWorkspacePage | 'journal';
export const channelWorkspacePaths = {
  checkin: '/checkin',
  leaderboard: '/leaderboard',
  methods: '/method-analysis',
  achievements: '/achievements',
  history: '/achievements',
  journal: '/journal'
} as const;
export const renderChannelWorkspacePage = (
  channel: WorkspaceChannel,
  page: ChannelWorkspacePage,
  locale: LearnerLocale = 'zh_TW'
) => {
  const lang = locale;
  let html = (
    page === 'journal'
      ? renderLearnerJournalPage(lang, {
          lineStream: channel.platform === 'line',
          communityNotes: channel.platform === 'line'
        })
      : renderTelegramWorkspacePage(page, lang, { communityNotes: channel.platform === 'line' })
  )
    .replace(telegramWorkspaceBootstrap, 'CHANNEL_AUTH_BOOTSTRAP')
    .replaceAll('/telegram/', '/' + channel.platform + '/')
    .replace(
      '<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>',
      '<footer>' + lineUiText(lang, '白雁氣功｜氣功打卡小幫手') + '</footer>'
    );
  html = html
    .replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', '')
    .replaceAll('window.Telegram?.WebApp', 'undefined')
    .replaceAll('window.Telegram.WebApp', 'undefined');
  if (page === 'achievements') {
    const calendar =
      "const renderChannelCalendar=data=>{const root=$('channel-calendar');root.replaceChildren();const parts=data.month.split('-').map(Number),year=parts[0],month=parts[1]-1,first=(new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(year,month+1,0)).getUTCDate();for(const label of (locale==='en'?['Mon','Tue','Wed','Thu','Fri','Sat','Sun']:['一','二','三','四','五','六','日']))root.append(node('span',label,'cal-week'));for(let i=0;i<first;i++)root.append(node('span',''));for(let day=1;day<=days;day++){const date=data.month+'-'+String(day).padStart(2,'0'),entry=data.entries.find(e=>e.date===date),button=node('button',String(day)+(entry?' ✓':''),'cal-day'+(entry?' saved':''));button.type='button';button.setAttribute('aria-label',date+(entry?' '+t.earned:''));button.disabled=!entry;button.onclick=()=>{const target=Array.from($('historyEntries').children).find(e=>e.dataset.date===date);target?.scrollIntoView({behavior:'smooth',block:'start'});};root.append(button);}};\n";
    html = html
      .replace(
        '<div id="historyEntries"></div>',
        '<div id="channel-calendar" class="channel-calendar"></div><div id="historyEntries"></div>'
      )
      .replace(
        '</style>',
        ' .channel-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin:16px 0}.cal-week{text-align:center;font-size:12px}.cal-day{padding:6px 2px;min-width:0;white-space:normal;font-size:13px;background:#edf3ee;color:#203027}.cal-day.saved{background:#285c3b;color:white}</style>'
      )
      .replace('const loadMonthly = async () => {', calendar + 'const loadMonthly = async () => {')
      .replace(
        "entries($('historyEntries'),data.entries);",
        "entries($('historyEntries'),data.entries);renderChannelCalendar(data);"
      )
      .replace(
        "const card=node('article',undefined,'entry');card.append",
        "const card=node('article',undefined,'entry');card.dataset.date=entry.date;card.append"
      );
  }
  if (channel.platform === 'line') {
    const marker =
      page === 'journal' ? '<script>const journalLocale=' : '<script>const workspacePage=';
    if (!html.includes(marker) || !html.includes('CHANNEL_AUTH_BOOTSTRAP'))
      throw new Error('Workspace template changed');
    html = html
      .replace(
        marker,
        '<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>' + marker
      )
      .replace(
        'CHANNEL_AUTH_BOOTSTRAP',
        lineLoginScript(channel.liffId, lang) +
          "\nconst workspaceCredential='';const workspaceAuthorization=async()=>workspaceCredential;\n"
      );
    html = html
      .replace("history.replaceState(null, '', location.pathname + location.search);", '')
      .replace("history.replaceState(null,'',location.pathname+location.search);", '')
      .replace(
        'const validToken = /^[A-Za-z0-9_-]{43}$/.test(token)||!!undefined?.initData;',
        'const validToken = true;'
      )
      .replace('if(!/^[A-Za-z0-9_-]{43}$/.test(token)&&!undefined?.initData)', 'if(false)');
    html = html
      .replace(
        'const response=await fetch(path,',
        'await lineReady;const response=await fetch(path,'
      )
      .replace('const r=await fetch(path,', 'await lineReady;const r=await fetch(path,')
      .replaceAll(
        'JSON.stringify({token,locale,...values})',
        'JSON.stringify({idToken,locale,...values})'
      );
    if (page !== 'journal') {
      const previousClose =
        "const closeMiniapp=()=>{const app=undefined;if(!app?.initData||typeof app.close!=='function')return false;leaving=true;syncClosing();try{app.close();return true;}catch{leaving=false;syncClosing();return false;}};";
      const previousButton =
        "if($('return-chat')){$('return-chat').hidden=!undefined?.initData;$('return-chat').onclick=()=>{if(mayLeave())closeMiniapp();};}";
      if (!html.includes(previousClose) || !html.includes(previousButton))
        throw new Error('Workspace closing template changed');
      html = html
        .replace(
          previousClose,
          "const canCloseLine=()=>{try{return typeof liff!=='undefined'&&typeof liff.isInClient==='function'&&liff.isInClient()&&typeof liff.closeWindow==='function';}catch{return false;}};const closeMiniapp=()=>{if(!canCloseLine())return false;leaving=true;syncClosing();try{liff.closeWindow();return true;}catch{leaving=false;syncClosing();return false;}};"
        )
        .replace(
          previousButton,
          "if($('return-chat')){const button=$('return-chat');button.hidden=true;lineReady.then(()=>{button.hidden=!canCloseLine();}).catch(()=>{button.hidden=true;});button.onclick=()=>{if(mayLeave())closeMiniapp();};}"
        );
    }
    if (page === 'leaderboard') {
      const original = telegramWorkspaceTexts(lang),
        rankingPrivacy =
          lang === 'en'
            ? 'Shows verified LINE nicknames of approved LINE learners in the same region. Anonymous learner is used when unavailable; application names, email and phone are never used. Names do not determine identity or permissions. Up to 30 learners; equal days share a rank.'
            : uiText(
                lang,
                '僅顯示同地區已核准 LINE 學員的已驗證 LINE 暱稱；尚未取得暱稱時顯示匿名學員，不使用申請表姓名、Email 或電話。暱稱只是顯示資訊，不影響身份或權限。最多列出30位，同天數並列。'
              );
      html = html
        .replace(
          'workspaceText=' + JSON.stringify(original),
          'workspaceText=' + JSON.stringify({ ...original, rankingPrivacy })
        )
        .replaceAll(original.rankingPrivacy, rankingPrivacy);
    }
    // All three presentation languages are supported; the verified LINE subject remains unchanged.
  }
  if (channel.platform === 'whatsapp' && page !== 'journal') {
    const original = telegramWorkspaceTexts(lang),
      next = {
        ...original,
        saved:
          lang === 'en'
            ? 'Check-in saved on the website. No WhatsApp summary is sent.'
            : '打卡已儲存於網頁，不回傳 WhatsApp 聊天摘要。',
        expired:
          lang === 'en'
            ? 'Login expired or access unavailable. Send checkin in WhatsApp and open a new private link.'
            : '登入已到期或資格／同意無法使用，請回 WhatsApp 輸入 checkin 並開啟新連結。',
        savedRefresh:
          lang === 'en'
            ? 'Saved. Refresh failed; your saved input is retained. Reload before another correction.'
            : '已儲存，但重新整理失敗；已儲存的輸入保留，請重新載入後再修改。'
      };
    html = html.replace(
      'workspaceText=' + JSON.stringify(original),
      'workspaceText=' + JSON.stringify(uiDictionary(lang, next))
    );
  }
  if (channel.platform === 'whatsapp') {
    html = html
      .replace('</style>', '#wa-bookmark{overflow-wrap:anywhere}</style>')
      .replace('<main>', '<main>' + whatsappLoginMarkup(lang))
      .replace('CHANNEL_AUTH_BOOTSTRAP', whatsappBrowserBootstrap(lang));
    html = html
      .replace(
        'const validToken = /^[A-Za-z0-9_-]{43}$/.test(token)||!!undefined?.initData;',
        'const validToken = true;'
      )
      .replace('if(!/^[A-Za-z0-9_-]{43}$/.test(token)&&!undefined?.initData)', 'if(false)')
      .replaceAll('JSON.stringify({token,locale,...values})', 'JSON.stringify({locale,...values})')
      .replaceAll(
        "headers:{'content-type':'application/json'}",
        "credentials:'same-origin',headers:{'content-type':'application/json','x-whatsapp-csrf-token':whatsappCsrf()}"
      )
      .replace(
        'const body=await response.json();',
        'const body=await response.json();if(response.status===401)whatsappAuthExpired();'
      )
      .replace(
        "if(!r.ok){const e=new Error('journal');",
        "if(r.status===401)whatsappAuthExpired();if(!r.ok){const e=new Error('journal');"
      );
    if (page === 'journal')
      html = html.replace(
        'const mayLeave=()=>!busy&&(!dirty()||confirm(t.discard));',
        'const mayLeave=()=>!busy&&(!dirty()||confirm(t.discard));window.whatsappMayLeave=()=>{if(!mayLeave())return false;leaving=true;closing();return true;};window.whatsappLeaveCancelled=()=>{leaving=false;closing();};'
      );
    else
      html = html.replace(
        'const mayLeave = (includeZone=true) => !busy && (!dirty(includeZone)||window.confirm(t.discard));',
        'const mayLeave = (includeZone=true) => !busy && (!dirty(includeZone)||window.confirm(t.discard));window.whatsappMayLeave=()=>{if(!mayLeave())return false;leaving=true;syncClosing();return true;};window.whatsappLeaveCancelled=()=>{leaving=false;syncClosing();};'
      );
  }
  // The cross-author disclosure names both providers, not just the current reader channel.
  const authorNotice = journalTexts(lang).authorNameNotice;
  return html
    .replaceAll(JSON.stringify(authorNotice), JSON.stringify('AUTHOR_NOTICE_JSON_SLOT'))
    .replaceAll(authorNotice, 'AUTHOR_NOTICE_HTML_SLOT')
    .replaceAll('Telegram', channel.platform === 'line' ? 'LINE' : 'WhatsApp')
    .replaceAll(JSON.stringify('AUTHOR_NOTICE_JSON_SLOT'), JSON.stringify(authorNotice))
    .replaceAll('AUTHOR_NOTICE_HTML_SLOT', authorNotice);
};
