import type { LearnerLocale } from './learner-locale.js';
const english = {
  title: 'Baiyin Qigong Check-in Helper — Supplemental Notice',
  brand: 'Baiyin Qigong',
  official: 'Website privacy policy',
  draft: 'Not published: review only; acceptance is unavailable.',
  accept:
    'I have read and agree to this supplement. New practice dates, methods and reflections are shared with eligible learners and authorized staff.',
  reflections:
    'Optional: if I provide health-related reflections or feelings, I explicitly agree to their processing and sharing within this service. Without this choice, practice-only features remain available.',
  submit: 'Agree and continue',
  decline: 'Do not agree',
  accepted: 'Accepted. Return to the chatbot and send join or checkin to continue.',
  unavailable:
    'Open this page using the private policy link from your chatbot. Your eligibility may be unavailable.',
  failed: 'Unable to complete this operation. Your selections are retained.',
  conflict: 'The policy or data changed. Preserve your inputs and reload.',
  language: 'Language',
  discard: 'Discard your unsaved changes?',
  privacyRequired: 'Please read and agree to the Check-in Helper supplement before continuing.',
  privacyLink: 'Read the supplement and confirm',
  suspended:
    'Your learner eligibility is unavailable. Contact your regional administrator or the privacy representative.',
  privacyHelp: 'Reply privacy to read the supplement or update reflection consent.',
  sharing:
    'New check-ins and corrections to new shared entries are shared with eligible learners and authorized staff. Old private entries stay private. External access requires separate permission.',
  reflectionRequired:
    'Reflection consent is unavailable. Reply privacy in the chatbot to review it. You may still check in without reflections or feelings.',
  learnerAccess: 'Learner eligibility',
  sharedHistory: 'Shared practice history',
  policyAdmin: 'Policy publication',
  query: 'Learner name',
  apply: 'Apply filter',
  reload: 'Reload',
  previous: 'Previous',
  next: 'Next',
  reason: 'Reason for suspension',
  suspend: 'Suspend eligibility',
  cancel: 'Cancel',
  active: 'Active',
  inactive: 'Suspended',
  confirmSuspend:
    'Suspend this learner? They lose access and their shares disappear from other learners. Records are not deleted.',
  suspendHelp:
    'Only learners within your management scope appear. Suspension closes access, hides learner-facing shares and preserves authorized staff history. This is not account/data deletion.',
  published: 'Published',
  publish: 'Publish reviewed notice',
  publishReason: 'Operator review and publication reason',
  confirmPublish:
    'Publish this version? Existing and new learners must accept it; new check-ins become shared by default.',
  policyHelp:
    'Verify the complete documents and operator approval before publishing. Publication is separate from application deployment.',
  saved: 'Saved.',
  loading: 'Loading…',
  empty: 'No records.',
  invalid: 'Check required values and limits.',
  staffHelp:
    'Shared content only, including suspended-author history. This does not grant access to private originals.',
  contact: 'Privacy contact'
};
const chinese: Record<keyof typeof english, string> = {
  title: '白雁氣功打卡小幫手使用及資料分享補充說明',
  brand: '白雁氣功',
  official: '官網隱私政策',
  draft: '尚未發布：僅供審閱，目前不能同意此版本。',
  accept:
    '我已閱讀並同意本補充說明，了解後續新增的練習日期、功法及心得，將分享給具有效資格的學員及授權工作人員。',
  reflections:
    '選填：若我提供涉及健康的心得或感受，我明確同意於小幫手服務及分享範圍內處理這些資料。不勾選仍可使用不含心得／感受的打卡功能。',
  submit: '同意並繼續',
  decline: '不同意',
  accepted: '已記錄同意。請返回聊天室，輸入「加入」或「打卡」繼續。',
  unavailable: '請從 Chatbot 提供的私人政策連結開啟；也可能是學員資格已失效。',
  failed: '操作未完成，選取已保留，請稍後重試。',
  conflict: '政策或資料已變更，請先保留輸入再重新載入。',
  language: '語言',
  discard: '確定放棄尚未儲存的修改？',
  privacyRequired: '繼續前，請先閱讀並同意氣功打卡小幫手補充說明。',
  privacyLink: '閱讀補充說明並確認',
  suspended: '學員使用資格已失效，請聯絡地區管理員或隱私窗口。',
  privacyHelp: '輸入「隱私」可閱讀補充說明或調整心得／感受同意。',
  sharing:
    '新打卡及新分享紀錄的更正會提供給有效學員與授權工作人員；舊私密紀錄保持私密，外部讀取仍需另外同意。',
  reflectionRequired:
    '尚未同意心得／感受處理，請回聊天室輸入「隱私」確認。仍可不填心得／感受進行打卡。',
  learnerAccess: '學員使用資格',
  sharedHistory: '共享打卡歷史',
  policyAdmin: '政策發布',
  query: '學員姓名',
  apply: '套用篩選',
  reload: '重新載入',
  previous: '上一頁',
  next: '下一頁',
  reason: '停用資格理由',
  suspend: '停用使用資格',
  cancel: '取消',
  active: '有效',
  inactive: '已停用',
  confirmSuspend: '確定停用此學員？本人失去使用資格，其他學員看不到其分享，但不刪除歷史紀錄。',
  suspendHelp:
    '僅列出管理範圍內的學員。停用會關閉使用資格、隱藏學員端分享，管理端仍依權限保留歷史查閱；不是刪除帳號或資料。',
  published: '已發布',
  publish: '發布已審閱的補充說明',
  publishReason: '營運者審閱及發布理由',
  confirmPublish: '確認發布此版本？新舊學員均須確認，新打卡將預設分享。',
  policyHelp: '發布前須核對完整文件及營運者核准。部署程式不會自動發布政策。',
  saved: '已儲存。',
  loading: '載入中…',
  empty: '目前沒有紀錄。',
  invalid: '請檢查必填資料及限制。',
  staffHelp: '僅閱讀共享內容，包含停用學員的共享歷史；不因此取得私密原稿權限。',
  contact: '隱私聯絡窗口'
};
export const learnerPrivacyTexts = (locale: LearnerLocale) => (locale === 'en' ? english : chinese);
