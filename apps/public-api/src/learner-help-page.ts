import type { FastifyInstance } from 'fastify';
import { htmlLocale, resolveLocale, supportedLocales } from './ui-localization.js';
import type { Locale } from './ui-localization.js';
import { helpLabel, learnerHelpContent, type HelpChannel } from './learner-help-content.js';

const escape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
export const renderLearnerHelpPage = (channel: HelpChannel, locale: Locale): string => {
  const c = learnerHelpContent(channel, locale);
  const step = (id: string, section: typeof c.start) =>
    `<section id="${id}" class="card${id === 'daily' ? ' daily' : ''}"><h2>${escape(section.title)}</h2><ol>${section.steps.map((text) => '<li>' + escape(text) + '</li>').join('')}</ol></section>`;
  return `<!doctype html><html lang="${htmlLocale(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${escape(c.title)}｜白雁氣功</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fa;color:#203247;font:16px/1.75 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:20px 16px}h1{font-size:1.65rem;line-height:1.4}h2{font-size:1.2rem}a{color:#164e83;overflow-wrap:anywhere}nav{display:flex;gap:8px;flex-wrap:wrap}nav a,.primary{display:inline-flex;align-items:center;min-height:44px;padding:8px 12px;border-radius:8px;background:#e8eef5;text-decoration:none}nav a[aria-current]{background:#082850;color:white}.primary{background:#285c3b;color:white;font-weight:600}.brand{color:#305888}.card{background:white;border:1px solid #dce4ec;border-radius:14px;margin:16px 0;padding:20px;overflow-wrap:anywhere}.daily{border:2px solid #285c3b}ol{padding-left:1.4rem}li{padding:5px 0}details{background:white;border:1px solid #dce4ec;border-radius:10px;margin:10px 0;padding:0 14px;overflow-wrap:anywhere}summary{cursor:pointer;min-height:48px;padding:12px 0;font-weight:600}details p{margin:0 0 16px}.notice{border-left:4px solid #b9770e;padding:10px 14px;background:#fff6df}.muted,footer{font-size:.9rem;color:#526477}footer{padding:20px 0}p{overflow-wrap:anywhere}@media(max-width:480px){main{padding:16px 12px}.card{padding:16px}h1{font-size:1.4rem}}
</style></head><body><main><p class="brand">白雁氣功｜氣功打卡小幫手</p><nav aria-label="Language">${supportedLocales.map((language) => `<a href="/${channel}/help?lang=${language}" lang="${htmlLocale(language)}"${language === locale ? ' aria-current="page"' : ''}>${{ zh_TW: '繁體中文', zh_CN: '简体中文', en: 'English' }[language]}</a>`).join('')}</nav><h1>${escape(c.title)}</h1><p>${escape(c.intro)}</p><a class="primary" href="#daily">${escape(c.dailyLink)}</a><nav aria-label="${escape(helpLabel(locale))}"><a href="#start">${escape(c.start.title)}</a><a href="#daily">${escape(c.daily.title)}</a><a href="#history">${escape(c.history.title)}</a></nav>${step('start', c.start)}${step('daily', c.daily)}<p class="notice">${escape(c.sharing)}</p>${step('history', c.history)}<section id="more"><h2>${escape(c.more)}</h2>${c.faqs.map((f) => `<details><summary>${escape(f.title)}</summary><p>${escape(f.body)}</p></details>`).join('')}</section><section class="card"><p>${escape(c.support)}</p><a href="/privacy?platform=${channel}&amp;lang=${locale}">${escape(c.privacy)}</a><p class="muted">${escape(c.policyNote)}</p></section><footer>白雁氣功｜氣功打卡小幫手</footer></main></body></html>`;
};
export const registerLearnerHelpPages = (app: FastifyInstance): void => {
  for (const channel of ['line', 'telegram', 'whatsapp'] as const)
    app.get('/' + channel + '/help', (request, reply) =>
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(renderLearnerHelpPage(channel, resolveLocale(request.query, request.headers.cookie)))
    );
};
