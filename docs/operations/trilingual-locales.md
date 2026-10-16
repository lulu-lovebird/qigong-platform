# Three-language interfaces: Traditional Chinese, Simplified Chinese and English

## Status and scope

Initial three-language release: `2ec42e2acfcbf2ccd34662ff7b5a17a3ab514d67` / schema35. Current production is `6a2ae3f` / schema36 with [compact admin UI](admin-compact-ui.md) and [near-real-time receipts](realtime-practice-receipts.md); the previous `2f5a4eb` release added [editable quick-tag translations](feeling-tag-locales.md); the design/verification below records the initial35 release. See [deployment, final restoration and verification](trilingual-locales-deployment.md). Provider configuration and legal-policy publication remain separate; WhatsApp is still unconfigured and policy remains draft.

Canonical locales are `zh_TW`, `zh_CN` and `en`. LINE, Telegram and WhatsApp learner pages and the administration interface expose all three choices. Simplified Chinese is a language choice, not a Singapore/Malaysia region rule, identity claim, enrollment assignment, time zone or permission.

The existing LINE invitation → helper chat → learner-initiated check-in → close → same-chat receipt flow was subsequently accepted by the user. The new language implementation retains that fixed helper-chat destination and its native/manual fallbacks.

## Preferences and controls

- Anonymous HTML resolves an explicit supported `lang` query, then its presentation cookie, then the existing Traditional default. Invalid values never become SQL identifiers or translation keys.
- Learner presentation uses `__Host-qigong-learner-locale`; administration continues using its separate admin-locale cookie. Cookies are Secure, same-site, presentation-only and not authentication. Existing session/CSRF cookies are preserved without duplicate locale cookies.
- Recipient preferences remain independent per verified provider subject. A presentation query/cookie alone does not rewrite another channel's database preference. No region-based backfill occurs.
- LINE `/line/preferences/language` resolves the subject from a server-verified ID token, checks Origin and rejects browser-subject injection. A read omits `locale`; a write supplies a canonical locale. LIFF can retrieve the saved preference when neither an explicit query nor a recognized presentation cookie is present. Login redirects and this continuation preserve only the captured private bearer fragment, not arbitrary callback query parameters.
- Telegram private `/language zh_TW`, `/language zh_CN`, `/language en` retain signed-update checks, deduplication and stale-update protection. WhatsApp signed private `language <locale>` retains configured account/phone verification and replay checks.
- Application and workspace switches warn before discarding unsent details/drafts. Cancelling retains the text and selected locale. Saving a language does not submit an application or practice entry, opt into reminders, or subscribe an administrator.
- Bot workspace links carry the chosen locale. Practice summaries, reminder jobs and review alerts accept all three locales. New LINE receipt payloads read the saved LINE preference; existing queued payloads are not rewritten.
- Reviewer binding challenges capture the admin interface locale in a new nullable column; historical challenges stay NULL with the old fallback. Two-sided confirmation, scope checks and individual subscriptions remain authoritative.

## Translation and content boundary

`ui-localization.ts` supplies the shared locale schema and helpers. The six existing dictionaries retain key parity. `ui-zh-cn.ts` contains development-time OpenCC reference conversions of source-owned phrases; no runtime conversion service or new dependency is installed. Existing English dictionaries are retained; `line-ui-localization.ts` supplies the previously missing LINE English interface and bot text.

`uiTemplate` converts only template-literal static fragments. Interpolated names, reasons, tokens and JSON values remain byte-for-byte unchanged. JSON presentation has an explicit whitelist of live system-label DTO paths, not recursive string replacement. Current built-in catalog labels have Simplified display mappings; unknown/custom names fall back to their original text until an explicit mapping is provided. Editable source labels and historical publication method/tag snapshots are not rewritten.

For reproducible maintenance, with an explicitly installed OpenCC CLI run `node scripts/generate-ui-zh-cn.mjs --check`; omit `--check` to regenerate, then review the mapping and run verification. The generator reads source/catalog definitions only and uses the existing configured Prettier. It does not read legal documents, tests, databases or learner content.

Names, Email, phone, reflections, reasons, codes, dates, identity authority and database records are not translated. Neither locale nor display metadata authorizes, links or merges identities. RLS, Origin/CSRF, eligibility, version/idempotency, locks, invitation quota, privacy gates and manual publication withdrawal protections remain in force.

## Legal and WhatsApp boundaries

The Simplified interface clearly identifies the original Traditional legal document. It does not manufacture an approved Simplified legal translation. `baiyin-checkin-supplement-v1`, its existing SHA-256, original legal files and policy publication state remain unchanged. Acceptance stores the document language (`zh_TW` for the current Chinese document), not a fictitious `zh_CN` document. Formal translation/publication requires review and separate approval.

WhatsApp remains unconfigured. Simplified decision-template delivery requires the approved `zh_CN` variation of the configured template names and the explicit optional `WHATSAPP_TEMPLATE_LANGUAGE_ZH_CN=zh_CN` setting. Without it, a Simplified send fails closed instead of substituting a Traditional template. This work does not activate Meta assets, extend the messaging window or restore WhatsApp practice summaries.

## Schema and recovery

Only new `0035_simplified_chinese_locale.sql` is added; historical0001–0034 and dependency manifests/lockfiles are unchanged. It expands locale constraints/allowlists, permits verified LINE preferences and adds nullable binding-challenge locale. Existing function ownership/ACL/RLS semantics are retained; new restricted functions revoke PUBLIC execution.

The initial matching API required exact35 (current36 compatibility is documented with quick-tag translations), architecture `phase-20-simplified-chinese`; the worker checks `ops.locale_schema_ready()`. Migration34 builds fail readiness on35. This is an exact-version coordinated release, not an online expand-compatible deployment. A later deployment needs maintenance/drain, final encrypted backups plus actual restore rehearsal, matching API/worker, preservation checks and separately approved activation.

Do not roll a35 database back by swapping only binaries or deleting migration history. Downgrade requires matching34 database/API/worker and approved reconciliation of post-release writes, including language choices that34 cannot represent. Never silently discard new writes or downgrade a user's language choice.

## Local verification

- Dedicated PostgreSQL16 suite cluster, full `pnpm verify`: **721 tests** (API533, database180, config2, identity6), format/lint/source typecheck/build passing.
- Schema34→35→repeat rehearsal preserves every pre-existing application-table data fingerprint except the intentional platform metadata update. The new nullable challenge column is excluded only from that table's old-row fingerprint; existing preference locale columns remain included. No preference, private reflection, publication or legal-acceptance backfill.
- Positive HTTP/signed-command tests cover all provider choices, LINE Origin/subject injection, Simplified catalog display, original verified names/reflections, localized receipts, reminder preview without opt-in, three-language reviewer binding/preferences and mock OIDC admin cookie continuity.
- Whole-HTML VM tests cover three-channel Simplified rendering, all choices and cancelled drafts; complete invitation scripts cover saved-language fragment continuation and explicit-choice precedence without early approval/navigation.
- Chrome390/1280: **180 layouts** across30 pages ×3 locales ×2 widths, no document overflow or uncaught runtime exception. Learner SDK/data are synthetic; admin pages use intentional API-failure shells. Visible source-owned Simplified text was compared with the reference conversion; only the intentionally original legal document and language self-name retain Traditional characters. Mock catalog values are not English SQL-catalog acceptance evidence.
- A repeat full run on55462 reproduced the pre-existing `learner-privacy` suspension/channel timestamp constraint failure. The isolated11-test suite then passed; the final complete run on a new independent PostgreSQL16 cluster55465 passed all721 without modifying that fixture, constraints or authorization assertions. This is not evidence that the intermittent root cause is fixed.
- Extra all-test `tsc -p tsconfig.eslint.json --noEmit` retains the10 documented pre-existing errors; it is not claimed passing.

Local evidence: `/tmp/qigong-locale-{verify-final,verify-repeat-failure,privacy-isolated,all-types,cdp}.log`, preview/CDP scripts and Simplified mobile screenshots. Browser mocks are not LINE/TG/WA provider delivery or real-device acceptance. Local/clone validation made no production or Console writes; the separately approved schema/API/worker deployment is recorded above. Notification flags and actual-learner content were not changed by deployment. Exclude unrelated `docs/operations/web-admin-permissions-review.md` from any later release.
