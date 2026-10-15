import { z } from 'zod';
import type { LearnerLocale } from './learner-locale.js';
export const communityNoticeVersion = 'student-community-notes-v1';
export const communityNoticeSchema = z.literal(communityNoticeVersion).optional();
export const communityNoteTexts = (locale: LearnerLocale) =>
  locale === 'en'
    ? {
        notice: 'Practice reflections are shared with all learners',
        detail:
          'Writing and submitting a new reflection shares it with approved learners, including the sharing nickname, practice methods, selected feelings, practice region/date and practice statistics. Leave it blank if you do not want to share. External sharing stays off.',
        existing:
          'Existing private reflections and author-controlled sharing keep their visibility. Manage previously shared reflections in My reflections.',
        sharedSaved:
          'Saved and shared with learners. Chat summaries do not include reflections or feelings.',
        privateSaved: 'Saved privately. This existing record was not automatically published.',
        manualSaved:
          'Saved. Your existing sharing choices were preserved; manage the shared snapshot in My reflections.'
      }
    : {
        notice: '打卡心得供所有學員閱讀',
        detail:
          '填寫並送出新心得後，已核准學員可閱讀心得，並看到暱稱、功法、勾選感受、練功地區／日期與練功統計。不想分享請勿填寫心得；外部分享維持關閉。',
        existing:
          '舊有私人心得不會因修改自動公開；曾自行調整或撤回分享的內容，請至「我的心得」管理。',
        sharedSaved: '打卡已儲存，心得已分享到學員心得流；聊天摘要不包含心得或感受。',
        privateSaved: '已儲存為私人紀錄；這筆既有紀錄沒有自動公開。',
        manualSaved: '已儲存，並保留原分享設定；請至「我的心得」管理已分享版本。'
      };
