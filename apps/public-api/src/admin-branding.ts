import { uiText } from './ui-localization.js';
import type { AdminLocale } from './admin-locale.js';

export const adminBrandColors = Object.freeze({
  primary: '#082850',
  secondary: '#305888',
  accent: '#98C0D8',
  deep: '#002048'
});
export const adminLogoUrl = 'https://e-qi.org/wp-content/uploads/2024/09/light-mode-logo.png';

// The logo is the only external image allowed. Scripts, connections and frames stay restricted.
export const adminContentSecurityPolicy = `default-src 'none'; img-src ${adminLogoUrl}; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

export const adminBrandStyles = `
:root { color-scheme:light; --brand-primary:${adminBrandColors.primary}; --brand-secondary:${adminBrandColors.secondary}; --brand-accent:${adminBrandColors.accent}; --brand-deep:${adminBrandColors.deep}; --surface:#ffffff; --surface-muted:#eef4f8; --canvas:#f7f9fc; --muted:var(--brand-secondary); --border:var(--brand-accent); }
.admin-logo { display:block; width:112px; height:auto; max-width:100%; aspect-ratio:1; object-fit:contain; margin:0 auto 1rem; border-radius:.65rem; background:var(--surface); }
:where(a,button,input,select,textarea,summary):focus-visible { outline:3px solid var(--brand-secondary); outline-offset:3px; }
input[type="checkbox"] { accent-color:var(--brand-primary); }
.brand-title { display:flex; align-items:center; gap:.45em; line-height:1; }
.brand-title .admin-logo { width:1em; height:1em; max-width:none; flex:0 0 1em; margin:0; border-radius:.12em; }
.brand-title-text { display:block; white-space:nowrap; }
`;

export const renderAdminLogo = (locale: AdminLocale) =>
  `<img class="admin-logo" src="${adminLogoUrl}" width="112" height="112" alt="${locale === 'en' ? 'Baiyin Qigong logo' : uiText(locale, '白雁氣功標誌')}" referrerpolicy="no-referrer" decoding="async">`;
