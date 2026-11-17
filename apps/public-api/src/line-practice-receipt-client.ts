import { uiText, type Locale } from './ui-localization.js';
/** Runs inside the existing check-in controller; owns no learner credentials/drafts.
 * A failed/ambiguous SDK attempt never becomes a failed DB save or automatic retry. */
export const linePracticeReceiptClient = (locale: Locale) => {
  const failed =
    locale === 'en'
      ? 'Check-in saved. Chat delivery was not confirmed. Please check the conversation; do not submit the check-in again.'
      : uiText(locale, '打卡已儲存，但聊天摘要未確認送達。請先查看對話，不需要重新打卡。');
  return `const lineSavedDates=new Set(),lineReceiptAttempts=new Set(),lineReceiptSent=new Set();let lineDeliveryBusy=false;
const lineSaveResponseValid=value=>value&&typeof value.checkinId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.checkinId)&&Number.isInteger(value.version)&&value.version>=0&&typeof value.receiptQueued==='boolean';
const canCloseLine=()=>{try{return typeof liff!=='undefined'&&typeof liff.isInClient==='function'&&liff.isInClient()&&typeof liff.closeWindow==='function';}catch{return false;}};
const canSendLine=()=>{try{return typeof liff!=='undefined'&&typeof liff.isInClient==='function'&&liff.isInClient()&&typeof liff.sendMessages==='function';}catch{return false;}};
const sendLineSavedReceipt=async result=>{
 if(!result?.lineReceipt&&result?.receiptDelivery!=='liff')return true;
 lineSavedDates.add(selectedDate);const receipt=result?.lineReceipt;
 if(!receipt||typeof receipt.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.id)||typeof receipt.text!=='string'||!receipt.text||receipt.text.length>4000){status(${JSON.stringify(failed)},true);return false;}
 if(lineReceiptSent.has(receipt.id))return true;
 if(lineReceiptAttempts.has(receipt.id)||!canSendLine()){status(${JSON.stringify(failed)},true);return false;}
 lineReceiptAttempts.add(receipt.id);lineDeliveryBusy=true;syncClosing();
 try{await liff.sendMessages([{type:'text',text:receipt.text}]);lineReceiptSent.add(receipt.id);return true;}
 catch{status(${JSON.stringify(failed)},true);return false;}
 finally{lineDeliveryBusy=false;syncClosing();}
};
const closeMiniapp=()=>{if(lineDeliveryBusy||!canCloseLine())return false;leaving=true;syncClosing();try{liff.closeWindow();return true;}catch{leaving=false;syncClosing();return false;}};`;
};
