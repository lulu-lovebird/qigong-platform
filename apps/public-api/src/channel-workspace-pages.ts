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
  const lang = channel.platform === 'line' ? 'zh_TW' : locale;
  let html = (
    page === 'journal' ? renderLearnerJournalPage(lang) : renderTelegramWorkspacePage(page, lang)
  )
    .replace(telegramWorkspaceBootstrap, 'CHANNEL_AUTH_BOOTSTRAP')
    .replaceAll('/telegram/', '/' + channel.platform + '/')
    .replace(
      '<footer>Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting</footer>',
      '<footer>白雁氣功｜氣功打卡小幫手</footer>'
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
        lineLoginScript(channel.liffId) +
          "\nconst workspaceCredential='';const workspaceAuthorization=async()=>workspaceCredential;\n"
      );
    html = html
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
    html = html.replace('<option value="en">English</option>', '');
  }
  if (channel.platform === 'whatsapp' && page !== 'journal') {
    const original = telegramWorkspaceTexts(lang),
      next = {
        ...original,
        saved:
          lang === 'en'
            ? 'Check-in saved. A private summary may be sent within the WhatsApp service window; no notes or feelings are sent.'
            : '打卡已儲存；僅在 WhatsApp 服務窗口內可傳送私人摘要，不含心得或感受。',
        savedRefresh:
          lang === 'en'
            ? 'Saved. Refresh failed; your saved input is retained. Reload before another correction.'
            : '已儲存，但重新整理失敗；已儲存的輸入保留，請重新載入後再修改。'
      };
    html = html.replace(
      'workspaceText=' + JSON.stringify(original),
      'workspaceText=' + JSON.stringify(next)
    );
  }
  if (channel.platform === 'whatsapp')
    html = html.replace(
      'CHANNEL_AUTH_BOOTSTRAP',
      "const workspaceCredential=/^([A-Za-z0-9_-]{43})(?:[?&]|$)/.exec(location.hash.slice(1))?.[1]||'';const workspaceAuthorization=async()=>workspaceCredential;history.replaceState(null,'',location.pathname+location.search);"
    );
  return html.replaceAll('Telegram', channel.platform === 'line' ? 'LINE' : 'WhatsApp');
};
