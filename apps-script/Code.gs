const APP_PASSWORD = '1130';
const API_TOKEN = '4e639916d328ef1241a82fffcadef71b96aca376b77485c16a6e9cefe08a86bf';
const SITE_ORIGIN = 'https://member-karute-shelf.motoya-serizawa.chatgpt.site';

function doGet() {
  return HtmlService.createHtmlOutput('<p>会員カルテデータ連携</p>').setTitle('会員カルテデータ連携');
}

function doPost(e) {
  const id = clean_(e && e.parameter && e.parameter.id);
  const format = clean_(e && e.parameter && e.parameter.format);
  try {
    const action = clean_(e && e.parameter && e.parameter.action);
    const payload = JSON.parse((e && e.parameter && e.parameter.payload) || '{}');
    return response_({ type:'karute-response', id, ok:true, result:api(action, payload) }, format);
  } catch (error) {
    return response_({ type:'karute-response', id, ok:false, error:error.message || String(error) }, format);
  }
}

function response_(message, format) {
  if (format === 'json') return ContentService.createTextOutput(JSON.stringify(message)).setMimeType(ContentService.MimeType.JSON);
  return responseHtml_(message);
}

function responseHtml_(message) {
  const serialized = JSON.stringify(message).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = `<!doctype html><html><body><script>
  parent.parent.postMessage(${serialized}, ${JSON.stringify(SITE_ORIGIN)});
  <\/script></body></html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const members = getOrCreateSheet_(ss, '会員データ', ['会員番号','郵便番号','地区グループ','会員ステータス','住所地区','保存棚','更新日時']);
  migrateMemberStatusColumn_(members);
  const shelves = getOrCreateSheet_(ss, '保存棚一覧', ['棚名','区画','保存場所','種別']);
  const movements = getOrCreateSheet_(ss, '棚移動履歴', ['更新日時','会員番号','地区グループ','移動元','移動先','会員ステータス']);
  if (movements.getLastColumn() < 6) movements.getRange(1, 6).setValue('会員ステータス');
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('karute.db.version') !== '3') {
    [members, shelves, movements].forEach(sheet => {
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,1,sheet.getLastColumn()).setBackground('#e8ece8').setFontWeight('bold');
      sheet.autoResizeColumns(1, sheet.getLastColumn());
    });
    members.getRange('A:B').setNumberFormat('@');
    members.getRange('C:F').setNumberFormat('@');
    shelves.getRange('A:D').setNumberFormat('@');
    props.setProperty('karute.db.version', '3');
  }
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== '会員データ' || e.range.getRow() < 2 || e.range.getColumn() > 6) return;
  const startRow = e.range.getRow();
  const rowCount = e.range.getNumRows();
  sheet.getRange(startRow, 7, rowCount, 1).setValues(Array.from({ length:rowCount }, () => [new Date()]));
  if (e.range.getColumn() === 6 && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) {
    const memberId = clean_(sheet.getRange(startRow, 1).getDisplayValue());
    const districtGroup = clean_(sheet.getRange(startRow, 3).getDisplayValue());
    const status = clean_(sheet.getRange(startRow, 4).getDisplayValue()) || '未設定';
    const previous = clean_(e.oldValue || 'UNKNOWN') || 'UNKNOWN';
    const next = clean_(e.value || e.range.getDisplayValue() || 'UNKNOWN') || 'UNKNOWN';
    if (memberId && previous !== next) {
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName('棚移動履歴').appendRow([new Date(), memberId, districtGroup, previous, next, status]);
    }
  }
}

function api(action, payload) {
  if (!payload || String(payload.password || '') !== APP_PASSWORD || String(payload.apiToken || '') !== API_TOKEN) {
    throw new Error('認証に失敗しました。');
  }
  setupDatabase();
  switch (action) {
    case 'load': return loadState_();
    case 'initialize': return initialize_(payload);
    case 'replaceMembers': return replaceMembers_(payload);
    case 'saveShelf': return saveShelf_(payload);
    case 'upsertMember': return upsertMember_(payload);
    case 'deleteMember': return deleteMember_(payload);
    case 'addShelf': return addShelf_(payload);
    case 'deleteShelf': return deleteShelf_(payload);
    default: throw new Error('未対応の操作です。');
  }
}

function initialize_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const memberSheet = ss.getSheetByName('会員データ');
    const shelfSheet = ss.getSheetByName('保存棚一覧');
    if (memberSheet.getLastRow() < 2 && Array.isArray(payload.members) && payload.members.length) {
      const rows = payload.members.map(member => [
        clean_(member.memberId), clean_(member.postalCode), clean_(member.districtGroup),
        clean_(member.status || '未設定'), clean_(member.area), clean_(member.shelf || 'UNKNOWN'), new Date()
      ]).filter(row => row[0]);
      writeRows_(memberSheet, rows, 7);
      memberSheet.autoResizeColumns(1, 7);
    }
    if (shelfSheet.getLastRow() < 2 && Array.isArray(payload.shelfRows) && payload.shelfRows.length) {
      const rows = payload.shelfRows.map(row => [
        clean_(row.name), clean_(row.slot), clean_(row.label), clean_(row.kind)
      ]).filter(row => row[2]);
      writeRows_(shelfSheet, rows, 4);
      shelfSheet.autoResizeColumns(1, 4);
    }
    return loadState_();
  } finally { lock.releaseLock(); }
}

function replaceMembers_(payload) {
  if (!Array.isArray(payload.members)) throw new Error('会員データがありません。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('会員データ');
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).clearContent();
    const rows = payload.members.map(member => [
      clean_(member.memberId), clean_(member.postalCode), clean_(member.districtGroup),
      clean_(member.status || '未設定'), clean_(member.area || 'CSV取込'), clean_(member.shelf || 'UNKNOWN'), new Date()
    ]).filter(row => row[0]);
    writeRows_(sheet, rows, 7);
    return loadState_();
  } finally { lock.releaseLock(); }
}

function loadState_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const memberRows = readRows_(ss.getSheetByName('会員データ'), 7);
  const shelfRows = readRows_(ss.getSheetByName('保存棚一覧'), 4);
  const movementRows = readRows_(ss.getSheetByName('棚移動履歴'), 6);
  return {
    members: memberRows.map(row => ({
      memberId: String(row[0] || ''),
      postalCode: String(row[1] || ''),
      districtGroup: String(row[2] || ''),
      status: String(row[3] || '未設定'),
      area: String(row[4] || ''),
      shelf: String(row[5] || 'UNKNOWN'),
      updatedAt: asIso_(row[6])
    })).filter(row => row.memberId),
    shelves: shelfRows.map(row => String(row[2] || '')).filter(Boolean),
    shelfRows: shelfRows.map(row => ({ name:String(row[0] || ''), slot:String(row[1] || ''), label:String(row[2] || ''), kind:String(row[3] || '') })).filter(row => row.label),
    movements: movementRows.map(row => ({
      changedAt: asIso_(row[0]),
      memberId: String(row[1] || ''),
      districtGroup: String(row[2] || ''),
      from: String(row[3] || ''),
      to: String(row[4] || ''),
      status: String(row[5] || '')
    })).filter(row => row.memberId).reverse()
  };
}

function saveShelf_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('会員データ');
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    const row = findMemberRow_(sheet, payload.memberId);
    if (!row) throw new Error('会員番号が見つかりません。');
    const previous = String(sheet.getRange(row,6).getDisplayValue() || 'UNKNOWN');
    const next = clean_(payload.shelf);
    if (!next) throw new Error('保存棚を選択してください。');
    sheet.getRange(row,6,1,2).setValues([[next, new Date()]]);
    ss.getSheetByName('棚移動履歴').appendRow([new Date(), String(payload.memberId), clean_(payload.districtGroup), previous, next, clean_(sheet.getRange(row,4).getDisplayValue()) || '未設定']);
    return { previous, shelf:next, changedAt:new Date().toISOString() };
  } finally { lock.releaseLock(); }
}

function upsertMember_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('会員データ');
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    const member = payload.member || {};
    const memberId = clean_(member.memberId);
    if (!memberId) throw new Error('会員番号を入力してください。');
    let row = payload.originalMemberId ? findMemberRow_(sheet, payload.originalMemberId) : findMemberRow_(sheet, memberId);
    const values = [[memberId, clean_(member.postalCode), clean_(member.districtGroup), clean_(member.status || '未設定'), clean_(member.area || '手動登録'), clean_(member.shelf || 'UNKNOWN'), new Date()]];
    if (row) sheet.getRange(row,1,1,7).setValues(values); else { sheet.appendRow(values[0]); row = sheet.getLastRow(); }
    return { row, memberId };
  } finally { lock.releaseLock(); }
}

function deleteMember_(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('会員データ');
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    const row = findMemberRow_(sheet, payload.memberId);
    if (!row) throw new Error('会員番号が見つかりません。');
    sheet.deleteRow(row);
    return { memberId:String(payload.memberId) };
  } finally { lock.releaseLock(); }
}

function addShelf_(payload) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('保存棚一覧');
  const label = clean_(payload.label);
  if (!label) throw new Error('棚名を入力してください。');
  const existing = readRows_(sheet,4).some(row => String(row[2]) === label);
  if (existing) throw new Error('同じ保存棚が登録されています。');
  sheet.appendRow(['追加棚', label, label, 'custom']);
  return { label };
}

function deleteShelf_(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const label = clean_(payload.label);
  if (readRows_(ss.getSheetByName('会員データ'),7).some(row => String(row[5]) === label)) throw new Error('使用中の棚は削除できません。');
  const sheet = ss.getSheetByName('保存棚一覧');
  const rows = readRows_(sheet,4);
  const index = rows.findIndex(row => String(row[2]) === label);
  if (index < 0) throw new Error('保存棚が見つかりません。');
  sheet.deleteRow(index + 2);
  return { label };
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    const sheets = ss.getSheets();
    if (name === '会員データ' && sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0]; sheet.setName(name);
    } else sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) sheet.getRange(1,1,1,headers.length).setValues([headers]);
  return sheet;
}

function migrateMemberStatusColumn_(sheet) {
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 6)).getDisplayValues()[0];
  if (current[3] === '会員ステータス') return;
  sheet.insertColumnBefore(4);
  sheet.getRange(1, 1, 1, 7).setValues([['会員番号','郵便番号','地区グループ','会員ステータス','住所地区','保存棚','更新日時']]);
  if (sheet.getLastRow() > 1) {
    const statusRange = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1);
    const values = statusRange.getDisplayValues().map(row => [row[0] || '未設定']);
    statusRange.setValues(values);
  }
}

function readRows_(sheet, width) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,width).getValues();
}

function writeRows_(sheet, rows, width) {
  if (!rows.length) return;
  const requiredRows = rows.length + 1;
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  const chunkSize = 1000;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    sheet.getRange(offset + 2, 1, chunk.length, width).setValues(chunk);
  }
}

function findMemberRow_(sheet, memberId) {
  const target = String(memberId || '');
  const ids = sheet.getLastRow() < 2 ? [] : sheet.getRange(2,1,sheet.getLastRow()-1,1).getDisplayValues();
  const index = ids.findIndex(row => String(row[0]) === target);
  return index < 0 ? 0 : index + 2;
}

function clean_(value) { return String(value == null ? '' : value).trim(); }
function asIso_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? String(value) : date.toISOString();
}
