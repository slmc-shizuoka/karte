const TOKYO_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"
});

export const REPORT_DIMENSIONS = [
  { key:"municipality", title:"市町村別" },
  { key:"address", title:"住所地区別" },
  { key:"block", title:"番地別" },
  { key:"district", title:"地区グループ別" },
  { key:"shelf", title:"移動先の保存棚別" },
  { key:"shelfDistrict", title:"地区グループ×移動先の保存棚別" },
  { key:"status", title:"会員ステータス別" }
];

export function tokyoDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(TOKYO_DATE.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function tokyoMonthKey(value) {
  return tokyoDayKey(value).slice(0, 7);
}

export function normalizedAddressArea(area) {
  const value = String(area || "").trim();
  return !value || value === "手動登録" || value === "CSV取込" ? "住所地区未設定" : value;
}

export function blockFromArea(area) {
  const value = normalizedAddressArea(area);
  return /[0-9０-９]|丁目|番地/.test(value) ? value : "番地未登録";
}

export function municipalityFromArea(area) {
  const value = normalizedAddressArea(area);
  if (value === "住所地区未設定") return value;
  const match = value.match(/^(.+?市|.+?区|.+?[町村])/);
  return match?.[1] || value;
}

const sortedCounts = counts => Object.entries(counts).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
export function shelfOrderComparator(shelves, dimension = "shelf") {
  const positions = new Map(shelves.map((label, index) => [String(label), index]));
  const shelfLabel = label => {
    const value = String(label);
    const divider = value.indexOf(" / ");
    return dimension === "shelfDistrict" && divider >= 0 ? value.slice(divider + 3) : value;
  };
  return (a, b) => {
    const first = shelfLabel(a);
    const second = shelfLabel(b);
    const firstIndex = positions.get(first) ?? Number.POSITIVE_INFINITY;
    const secondIndex = positions.get(second) ?? Number.POSITIVE_INFINITY;
    return (firstIndex === secondIndex ? 0 : firstIndex - secondIndex)
      || first.localeCompare(second, "ja", { numeric:true })
      || String(a).localeCompare(String(b), "ja", { numeric:true });
  };
}
const sortedCategoryCounts = (counts, dimension, shelves) => {
  if (!["shelf", "shelfDistrict"].includes(dimension)) return sortedCounts(counts);
  const compare = shelfOrderComparator(shelves, dimension);
  return Object.entries(counts).sort((a, b) => compare(a[0], b[0]));
};
const countValues = (values, labelFor) => {
  const counts = {};
  values.forEach(value => {
    const label = String(labelFor(value) || "未設定");
    counts[label] = (counts[label] || 0) + 1;
  });
  return counts;
};
const memberLookup = members => new Map(members.map(member => [String(member.memberId), member]));
const uniqueVisitors = entries => new Set(entries.map(entry => String(entry.memberId || "")).filter(Boolean)).size;

function categoryFor(dimension, move, member) {
  if (dimension === "municipality") return municipalityFromArea(member?.area);
  if (dimension === "address") return normalizedAddressArea(member?.area);
  if (dimension === "block") return blockFromArea(member?.area);
  if (dimension === "district") return move.districtGroup || member?.districtGroup || "未設定";
  if (dimension === "shelf") return move.to || "未設定";
  if (dimension === "shelfDistrict") return `${move.districtGroup || member?.districtGroup || "未設定"} / ${move.to || "未設定"}`;
  if (dimension === "status") return move.status || member?.status || "未設定";
  throw new Error(`Unknown dimension: ${dimension}`);
}

export function visitCountsByCategory(entries, members, dimension) {
  const lookup = memberLookup(members);
  const groups = new Map();
  entries.forEach(move => {
    const id = String(move.memberId || "");
    if (!id) return;
    const label = String(categoryFor(dimension, move, lookup.get(id)) || "未設定");
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label).add(id);
  });
  return Object.fromEntries([...groups].map(([label, ids]) => [label, ids.size]));
}

export function dashboardSnapshot(members, movements, now = new Date()) {
  const shelfFor = member => String(member.shelf || "UNKNOWN");
  const visitedMembers = members.filter(member => shelfFor(member) !== "UNKNOWN");
  const month = tokyoMonthKey(now);
  const day = tokyoDayKey(now);
  const monthlyMovements = movements.filter(move => tokyoMonthKey(move.changedAt) === month);
  const dailyMovements = monthlyMovements.filter(move => tokyoDayKey(move.changedAt) === day);
  const shelf = countValues(members, shelfFor);
  return {
    month, day,
    monthVisitors:uniqueVisitors(monthlyMovements),
    todayVisitors:uniqueVisitors(dailyMovements),
    knownCount:members.length - (shelf.UNKNOWN || 0),
    counts:{
      municipality:countValues(visitedMembers, member => municipalityFromArea(member.area)),
      address:countValues(visitedMembers, member => normalizedAddressArea(member.area)),
      block:countValues(visitedMembers, member => blockFromArea(member.area)),
      district:countValues(members, member => member.districtGroup || "未設定"),
      shelf,
      shelfDistrict:countValues(members, member => `${member.districtGroup || "未設定"} / ${shelfFor(member)}`),
      status:visitCountsByCategory(monthlyMovements, members, "status")
    }
  };
}

export function trendBuckets(mode, now = new Date()) {
  const [year, month, day] = tokyoDayKey(now).split("-").map(Number);
  if (mode === "monthly") {
    return Array.from({ length:6 }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1 - (5 - index), 1));
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      return { key, label:`${String(date.getUTCFullYear()).slice(-2)}年${date.getUTCMonth() + 1}月` };
    });
  }
  if (mode === "daily") {
    return Array.from({ length:day }, (_, index) => ({
      key:`${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
      label:`${index + 1}日`
    }));
  }
  throw new Error(`Unknown trend mode: ${mode}`);
}

export function trendRows(members, movements, mode, dimension, now = new Date(), shelves = []) {
  const buckets = trendBuckets(mode, now);
  const keys = new Set(buckets.map(bucket => bucket.key));
  const lookup = memberLookup(members);
  const series = new Map();
  movements.forEach(move => {
    const id = String(move.memberId || "");
    if (!id) return;
    const key = mode === "monthly" ? tokyoMonthKey(move.changedAt) : tokyoDayKey(move.changedAt);
    if (!keys.has(key)) return;
    const label = String(categoryFor(dimension, move, lookup.get(id)) || "未設定");
    if (!series.has(label)) series.set(label, new Map());
    if (!series.get(label).has(key)) series.get(label).set(key, new Set());
    series.get(label).get(key).add(id);
  });
  const compare = shelfOrderComparator(shelves, dimension);
  const rows = [...series].map(([label, values]) => {
    const counts = buckets.map(bucket => values.get(bucket.key)?.size || 0);
    return { label, counts, total:counts.reduce((sum, count) => sum + count, 0) };
  }).filter(row => row.total > 0).sort((a,b) => ["shelf", "shelfDistrict"].includes(dimension)
    ? compare(a.label, b.label)
    : b.total - a.total || a.label.localeCompare(b.label, "ja"));
  return { buckets, rows };
}

export function monthlyReport(members, movements, month, now = new Date(), shelves = []) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("対象月を選択してください。");
  if (month > tokyoMonthKey(now)) throw new Error("未来の月は選択できません。");
  const entries = movements.filter(move => tokyoMonthKey(move.changedAt) === month && String(move.memberId || ""));
  const [year, monthNumber] = month.split("-").map(Number);
  const endDay = month === tokyoMonthKey(now)
    ? Number(tokyoDayKey(now).slice(-2))
    : new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length:endDay }, (_, index) => {
    const key = `${month}-${String(index + 1).padStart(2, "0")}`;
    return { key, label:`${index + 1}日`, visitors:uniqueVisitors(entries.filter(move => tokyoDayKey(move.changedAt) === key)) };
  });
  return {
    month, label:`${year}年${monthNumber}月`, visitors:uniqueVisitors(entries),
    baseVisitors:uniqueVisitors(entries), movementCount:entries.length,
    activeDays:days.filter(day => day.visitors > 0).length,
    days,
    categories:Object.fromEntries(REPORT_DIMENSIONS.map(dimension => [
      dimension.key, sortedCategoryCounts(visitCountsByCategory(entries, members, dimension.key), dimension.key, shelves).map(([label, count]) => ({ label, count }))
    ]))
  };
}

export function dashboardCsvRows(members, movements, mode, now = new Date(), shelfDistrict = "", shelves = []) {
  const snapshot = dashboardSnapshot(members, movements, now);
  const rows = [["画面", "集計項目", "区分", "期間", "軒数", "集計方法"]];
  rows.push(["共通", "今月の来館", "全体", snapshot.month, snapshot.monthVisitors, "棚移動履歴・会員番号重複除外"]);
  rows.push(["共通", "本日の来館", "全体", snapshot.day, snapshot.todayVisitors, "棚移動履歴・会員番号重複除外"]);
  rows.push(["共通", "BASE月間来館", "全体", snapshot.month, snapshot.monthVisitors, "今月の来館数と同じ"]);
  rows.push(["共通", "保存棚登録済み", "全体", snapshot.day, snapshot.knownCount, "現在の会員データ"]);
  for (const dimension of REPORT_DIMENSIONS) {
    if (mode === "current") {
      const period = dimension.key === "status" ? snapshot.month : snapshot.day;
      const method = dimension.key === "status" ? "今月の棚移動・会員番号重複除外"
        : ["municipality", "address", "block"].includes(dimension.key) ? "現在の保存棚登録済み会員データ" : "現在の会員データ";
      const title = dimension.key === "shelf" ? `現在の保存棚別${shelfDistrict ? `（${shelfDistrict}）` : ""}` : dimension.key === "shelfDistrict" ? "地区グループ×現在の保存棚別" : dimension.title;
      const counts = dimension.key === "shelf" && shelfDistrict
        ? countValues(members.filter(member => String(member.districtGroup || "未設定") === shelfDistrict), member => member.shelf || "UNKNOWN")
        : snapshot.counts[dimension.key];
      for (const [label, count] of sortedCategoryCounts(counts, dimension.key, shelves)) {
        rows.push(["現在", title, label, period, count, method]);
      }
    } else {
      const lookup = memberLookup(members);
      const matchingMovements = dimension.key === "shelf" && shelfDistrict
        ? movements.filter(move => String(move.districtGroup || lookup.get(String(move.memberId))?.districtGroup || "未設定") === shelfDistrict)
        : movements;
      const trend = trendRows(members, matchingMovements, mode, dimension.key, now, shelves);
      for (const row of trend.rows) {
        trend.buckets.forEach((bucket, index) => {
          const title = dimension.key === "shelf" && shelfDistrict ? `${dimension.title}（${shelfDistrict}）` : dimension.title;
          rows.push([mode === "monthly" ? "月間推移" : "日別推移", title, row.label, bucket.key, row.counts[index], "期間・区分内で会員番号重複除外"]);
        });
      }
    }
  }
  return rows;
}

export function monthlyReportCsvRows(report) {
  const rows = [["対象月", "集計項目", "区分", "軒数", "集計方法"]];
  rows.push([report.month, "月間来館", "全体", report.visitors, "棚移動履歴・会員番号重複除外"]);
  rows.push([report.month, "BASE月間来館", "全体", report.baseVisitors, "月間来館と同じ"]);
  rows.push([report.month, "棚移動記録", "全体", report.movementCount, "履歴の行数"]);
  report.days.forEach(day => rows.push([report.month, "日別来館", day.key, day.visitors, "同日内で会員番号重複除外"]));
  REPORT_DIMENSIONS.forEach(dimension => report.categories[dimension.key].forEach(row => {
    rows.push([report.month, dimension.title, row.label, row.count, "区分内で会員番号重複除外"]);
  }));
  return rows;
}

export function toCsv(rows) {
  const cell = value => {
    const raw = String(value ?? "");
    const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\ufeff" + rows.map(row => row.map(cell).join(",")).join("\r\n");
}
