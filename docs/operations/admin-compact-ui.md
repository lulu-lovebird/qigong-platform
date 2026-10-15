# Compact Web Admin — local implementation

## Status and boundary

Deployed after separate user authorization: **`a952176` / same schema36**. See [deployment, final restore and rollback evidence](admin-compact-ui-deployment.md). This change is admin presentation/navigation only: no migration, dependency, API authorization, learner UI, notification configuration, legal-text or provider/Console change.

## Shared density and grouping

`admin-layout-styles.ts` is the common admin stylesheet, replacing the previous inline shell density rules rather than adding a second overriding theme. Brand colors/logo, external-image-only CSP exception, source attribution and existing routes remain unchanged.

Desktop defaults:

- 224px sidebar;34px minimum menu/control rows and2px within-group link gaps. Four small group headings, clear current-page indicator, sticky independently scrollable sidebar.
- 14px admin body/form text,13px labels,34px single-line controls/buttons,72px resizable textareas. Short date/number/code fields use bounded widths; name/reason fields and readonly copy areas no longer indiscriminately fill a large page.
- Cards use14px padding and12px spacing; table cell padding is reduced. Empty status/error regions retain their DOM/accessibility roles without reserving blank vertical space.
- Policy reading keeps16px type,1.65 line height and bounded readable line length. Dangerous access removal retains its distinct border, warning and confirmation flow.

Menu order:

| Group                | Items                                                       |
| -------------------- | ----------------------------------------------------------- |
| Reports & analysis   | Overview, leaderboard, method analysis                      |
| Learner management   | Pending learner applications, eligibility, LINE invitations |
| Reflections & tags   | Private journal, shared history, quick tags                 |
| System & preferences | Admin access, policy publication, personal notifications    |

Group labels support Traditional Chinese, Simplified Chinese and English. Existing per-link server/capability visibility remains authoritative; groups with no visible links stay hidden, including before capability responses or on request failure. Grouping is not an authorization grant and does not replace server checks.

## Responsive and interaction details

At≤760px, a native `details`/`summary` menu starts collapsed after enhancement and displays the current page. Without JavaScript, the initially open navigation remains available. Keyboard activation/focus uses native browser behavior; changing back to desktop opens the menu. Unsubmitted page data is not recreated or discarded by toggling navigation.

Small-screen **or coarse-pointer** controls use44px minimum targets and16px input/select/textarea text through shared tokens, including the sidebar language selector. Phone forms stack; wide touch tablets retain desktop navigation but use touch density. Focus outlines, semantic labels, disabled states, current-page indicator and live/error regions remain.

Per-page changes cover three-language quick tags and their active/order controls, reviewer preference checkboxes and short confirmation code, admin access panels, learner eligibility reasons, policy reasons and standalone access-request forms. Pages already using shared filters/buttons inherit density without changing their payload or runtime code. Existing unsaved-edit vetoes still guard language switches, links, reload and logout.

## Verification

- Full dedicated PostgreSQL16 `pnpm verify`: **738 tests** (API547 / database183 / config2 / identity6), format/lint/source typecheck/build passing.
- Nine new whole-shell tests cover exact group/route order in three languages, server-gated admin access, deferred/failed capability links, empty groups, native disclosure resizing, unsaved navigation veto and shared desktop/touch tokens.
- Existing access, journal, reviewer, branding, CSRF/scope/version and private-content tests remain. The obsolete assertion requiring all mobile access actions to be100% wide was updated to the planned wrapping compact action row plus44px touch density; functional authorization/input assertions were not relaxed.
- Chrome: **117 layouts** =13 pages ×3 languages ×390/820/1280 widths, plus **3 wide-touch-tablet layouts** and **6 edge layouts**, **126 total**. Edge checks cover320px phones,540px-high desktop sidebar scrolling,768px coarse-pointer tablets and dirty-form preservation across phone/desktop resizing. The browser used the actual compiled app and restricted runtime against an independent synthetic PostgreSQL16 database, not API failure shells. Reports, rosters, access edit panels, tags, private/shared journals, eligibility, invitations, notifications, policy and standalone draft access requests were rendered.
- Browser assertions cover three-language routes/groups, actual positive API responses, desktop34–36px links, touch44px targets/16px inputs, no horizontal document overflow, native Enter open/close with visible keyboard focus, cancelled dirty-tag navigation, loaded logo, and no uncaught exception or admin-API failure. Original synthetic identity/reflection text remains literal.
- Provider/OIDC authentication was mocked; the localhost-only proxy forwards its synthetic sessions/Origin and serves the same public logo bytes locally. This is not live Authgear/provider or real-device acceptance. No real notifications or production writes were made.
- Browser-driver corrections supplied Enter key text, activated/focused the test tab, set explicit screen dimensions and accepted beforeunload only for test teardown. A default favicon404 is not classified as an API failure; logo loading is separately asserted. The actual mobile language-font override found during this work was removed in favor of shared font tokens.
- Extra all-test TypeScript retains the10 pre-existing errors. Passing isolated tests does not establish a fix for the earlier timestamp intermittency.

Evidence: `/tmp/qigong-admin-compact-{verify-final,all-types,cdp}.log`, measurement JSON, preview/CDP scripts and48 screenshots (including three touch-tablet and six edge views). Edge evidence is `/tmp/qigong-admin-compact-edge-cdp.log`. Preview/test containers are separate so browser fixtures do not interfere with the test suite.

The separately approved publication passed exact-SHA CI, preserved-data/recovery checks and matching schema36 API/worker. Future releases require their own approval and verification. No database migration is needed for this UI-only release. Preserve and exclude unrelated `docs/operations/web-admin-permissions-review.md`.
