import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardSnapshot, dashboardCsvRows, monthlyReport, monthlyReportCsvRows,
  toCsv, tokyoDayKey, trendRows, shelfOrderComparator
} from "../dist/analytics.js";

const now = new Date("2026-09-29T12:00:00+09:00");
const members = [
  { memberId:"1", districtGroup:"静岡", area:"静岡市葵区一番町", status:"AO", shelf:"9月" },
  { memberId:"2", districtGroup:"富士", area:"富士市中央町", status:"DX", shelf:"UNKNOWN" },
  { memberId:"3", districtGroup:"富士", area:"富士市中央町", status:"=危険", shelf:"9月" }
];
const movements = [
  { memberId:"1", districtGroup:"静岡", status:"AO", to:"9月", changedAt:"2026-09-28T23:50:00+09:00" },
  { memberId:"1", districtGroup:"静岡", status:"AO", to:"特別棚", changedAt:"2026-09-29T08:00:00+09:00" },
  { memberId:"2", districtGroup:"富士", status:"DX", to:"9月", changedAt:"2026-09-29T09:00:00+09:00" },
  { memberId:"3", districtGroup:"富士", status:"=危険", to:"9月", changedAt:"2026-08-31T23:59:00+09:00" }
];

test("日本時間の日付で月を区切る", () => {
  assert.equal(tokyoDayKey("2026-09-28T15:05:00Z"), "2026-09-29");
});

test("画面のKPIとCSVが同じ重複除外数を使う", () => {
  const data = dashboardSnapshot(members, movements, now);
  assert.equal(data.monthVisitors, 2);
  assert.equal(data.todayVisitors, 2);
  assert.equal(data.knownCount, 2);
  assert.equal(data.counts.district["富士"], 2);
  assert.equal(data.counts.municipality["静岡市"], 1);
  const rows = dashboardCsvRows(members, movements, "current", now);
  assert.deepEqual(rows.find(row => row[1] === "今月の来館数").slice(2, 5), ["全体", "2026-09", 2]);
  assert.ok(!rows.some(row => /BASE月間来館|番地別/.test(row[1])));
});

test("月次レポートは日別・区分別も会員番号で重複除外する", () => {
  const report = monthlyReport(members, movements, "2026-09", now);
  assert.equal(report.visitors, 2);
  assert.equal(report.movementCount, 3);
  assert.equal(report.activeDays, 2);
  assert.equal(report.days.find(day => day.key === "2026-09-29").visitors, 2);
  assert.deepEqual(report.categories.shelf.map(row => [row.label, row.count]), [["9月", 2], ["特別棚", 1]]);
  assert.equal(monthlyReportCsvRows(report).find(row => row[1] === "月間来館")[3], 2);
  assert.equal(report.categories.shelfDistrict.find(row => row.label === "静岡 / 特別棚").count, 1);
  assert.ok(!monthlyReportCsvRows(report).some(row => /BASE月間来館|番地別/.test(row[1])));
  assert.throws(() => monthlyReport(members, movements, "2026-10", now), /未来/);
});

test("棚は地区で絞れる", () => {
  const current = dashboardCsvRows(members, movements, "current", now, "富士");
  assert.deepEqual(current.filter(row => row[1] === "現在の保存棚別（富士）").map(row => [row[2], row[4]]), [["9月", 1], ["UNKNOWN", 1]]);
  const daily = dashboardCsvRows(members, movements, "daily", now, "富士");
  assert.ok(daily.some(row => row[1] === "移動先の保存棚別（富士）" && row[2] === "9月" && row[3] === "2026-09-29" && row[4] === 1));
  assert.ok(!daily.some(row => row[1] === "移動先の保存棚別（富士）" && row[2] === "特別棚"));
});

test("保存棚別は軒数ではなく保存棚一覧の順番で表示・出力する", () => {
  const order = ["UNKNOWN", "特別棚", "9月", "10月"];
  const compare = shelfOrderComparator(order);
  assert.deepEqual(["9月", "特別棚", "UNKNOWN"].sort(compare), ["UNKNOWN", "特別棚", "9月"]);
  const trend = trendRows(members, movements, "daily", "shelf", now, order);
  assert.deepEqual(trend.rows.map(row => row.label), ["特別棚", "9月"]);
  const currentCsv = dashboardCsvRows(members, movements, "current", now, "", order);
  assert.deepEqual(currentCsv.filter(row => row[1] === "現在の保存棚別").map(row => row[2]), ["UNKNOWN", "9月"]);
  const report = monthlyReport(members, movements, "2026-09", now, order);
  assert.deepEqual(report.categories.shelf.map(row => row.label), ["特別棚", "9月"]);
  assert.deepEqual(report.categories.shelfDistrict.map(row => row.label), ["静岡 / 特別棚", "静岡 / 9月", "富士 / 9月"]);
});

test("推移の表示値とCSVは同じデータを使用する", () => {
  const trend = trendRows(members, movements, "daily", "district", now);
  const shizuoka = trend.rows.find(row => row.label === "静岡");
  assert.equal(shizuoka.counts[27], 1);
  assert.equal(shizuoka.counts[28], 1);
  const rows = dashboardCsvRows(members, movements, "daily", now);
  assert.equal(rows.find(row => row[1] === "地区グループ別" && row[2] === "静岡" && row[3] === "2026-09-29")[4], 1);
});

test("CSVはUTF-8 BOM付きで、改行と数式を安全に書き出す", () => {
  const csv = toCsv([["区分", "軒数"], ["=HYPERLINK(\"x\")\n次行", 2]]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"'=HYPERLINK\(""x""\)\n次行","2"/);
  assert.ok(csv.includes("\r\n"));
});
