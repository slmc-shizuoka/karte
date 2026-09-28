const APP_PASSWORD = "1130";
const SHEET_BRIDGE_URL = "https://script.google.com/a/macros/pcdepot.jp/s/AKfycbx2_yqLe1z5a0x1mSC0aSRaVVGO-0y4Rar6alwxPju2e5Cp2nP_bllg0m2EVAmvr6SQbg/exec";
const STORAGE = {
  members: "karute.members.v1",
  shelves: "karute.shelves.v2",
  overrides: "karute.overrides.v1",
  movements: "karute.movements.v1"
};

let defaultShelves = ["UNKNOWN", "BASE"];
let shelfCatalog = { groups: [], labels: defaultShelves };
let baseMembers = [];
let members = [];
let shelves = [];
let overrides = {};
let movements = [];
let searchMode = "member";
let managePage = 1;
let sheetConnected = false;
let sheetSyncPromise = null;
let sheetSyncTimer = null;
let lastSheetSyncAt = 0;
const PAGE_SIZE = 30;
const AUTO_SYNC_INTERVAL = 30000;

const bridgePending = new Map();
let bridgeReadyResolve;
let bridgeReadyReject;
const bridgeReady = new Promise((resolve, reject) => { bridgeReadyResolve = resolve; bridgeReadyReject = reject; });

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const normalizeDigits = value => String(value ?? "").normalize("NFKC").replace(/\D/g, "");
const normalizePostal = value => {
  const digits = normalizeDigits(value).slice(0, 7);
  return digits.length > 3 ? `${digits.slice(0,3)}-${digits.slice(3)}` : digits;
};
const loadJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const saveJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const currentShelf = member => overrides[member.memberId]?.shelf || member.shelf || "UNKNOWN";

function initSheetBridge() {
  const iframe = $("#sheetBridge");
  window.addEventListener("message", event => {
    if (event.source !== iframe.contentWindow || !event.data) return;
    if (event.data.type === "karute-ready") {
      bridgeReadyResolve();
      return;
    }
    if (event.data.type !== "karute-response") return;
    const pending = bridgePending.get(event.data.id);
    if (!pending) return;
    bridgePending.delete(event.data.id);
    clearTimeout(pending.timer);
    if (event.data.ok) pending.resolve(event.data.result);
    else pending.reject(new Error(event.data.error || "スプレッドシートの処理に失敗しました。"));
  });
  if (!SHEET_BRIDGE_URL.startsWith("https://")) {
    bridgeReadyReject(new Error("スプレッドシート連携が未設定です。"));
    return;
  }
  iframe.src = SHEET_BRIDGE_URL;
}

async function sheetRequest(action, payload = {}) {
  await Promise.race([
    bridgeReady,
    new Promise((_, reject) => setTimeout(() => reject(new Error("スプレッドシートへの接続がタイムアウトしました。")), 15000))
  ]);
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      reject(new Error("スプレッドシートから応答がありません。"));
    }, 30000);
    bridgePending.set(id, { resolve, reject, timer });
    $("#sheetBridge").contentWindow.postMessage({ type:"karute-request", id, action, payload:{ ...payload, password:APP_PASSWORD } }, "*");
  });
}

function setConnectionStatus(title, detail, connected = false) {
  $("#connectionTitle").textContent = title;
  $("#connectionDetail").textContent = detail;
  sheetConnected = connected;
}

function connectedDetail() {
  const time = lastSheetSyncAt
    ? new Date(lastSheetSyncAt).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit", second:"2-digit" })
    : "―";
  return `アプリとシートを30秒ごとに自動同期します。最終同期 ${time}`;
}

function seedShelfRows() {
  return [
    { name:"共通", slot:"", label:"UNKNOWN", kind:"system" },
    { name:"共通", slot:"", label:"BASE", kind:"system" },
    ...(shelfCatalog.groups || []).flatMap(group => group.slots.map(slot => ({
      name:group.name, slot, label:`${group.name} / ${slot}`, kind:group.kind
    })))
  ];
}

function applySheetState(state) {
  members = Array.isArray(state.members) ? state.members : [];
  shelves = Array.isArray(state.shelves) && state.shelves.length ? state.shelves : ["UNKNOWN", "BASE"];
  movements = Array.isArray(state.movements) ? state.movements : [];
  overrides = {};
  saveJSON(STORAGE.members, members);
  saveJSON(STORAGE.shelves, shelves);
  saveJSON(STORAGE.overrides, overrides);
  saveJSON(STORAGE.movements, movements);
  refreshAll();
}

async function syncFromSheet({ initialize = false, silent = false } = {}) {
  if (sheetSyncPromise) return sheetSyncPromise;
  if (silent && (document.hidden || document.querySelector("dialog[open]") || bridgePending.size)) return;
  if (!silent) setConnectionStatus("Googleスプレッドシートへ接続中", "会員データと保存棚を読み込んでいます。");
  sheetSyncPromise = (async () => {
    try {
      let state = await sheetRequest("load");
      if (initialize && (!state.members?.length || !state.shelves?.length)) {
        state = await sheetRequest("initialize", { members:baseMembers, shelfRows:seedShelfRows() });
      }
      applySheetState(state);
      lastSheetSyncAt = Date.now();
      setConnectionStatus("Googleスプレッドシートと同期済み", connectedDetail(), true);
    } catch (error) {
      console.error(error);
      setConnectionStatus("スプレッドシートに接続できません", "検索はできますが、変更内容は保存されません。「今すぐ同期」で再接続してください。");
      if (!silent) toast(error.message || "スプレッドシートに接続できませんでした。");
    } finally {
      sheetSyncPromise = null;
    }
  })();
  return sheetSyncPromise;
}

async function connectSheet() {
  return syncFromSheet({ initialize:true });
}

function startAutoSync() {
  clearInterval(sheetSyncTimer);
  sheetSyncTimer = setInterval(() => syncFromSheet({ silent:true }), AUTO_SYNC_INTERVAL);
}

function stopAutoSync() {
  clearInterval(sheetSyncTimer);
  sheetSyncTimer = null;
}

async function boot() {
  initSheetBridge();
  try {
    const [memberResponse, shelfResponse] = await Promise.all([
      fetch("./data/members.json"),
      fetch("./data/shelves.json")
    ]);
    if (!memberResponse.ok || !shelfResponse.ok) throw new Error("app data failed");
    baseMembers = await memberResponse.json();
    shelfCatalog = await shelfResponse.json();
    defaultShelves = shelfCatalog.labels;
  } catch {
    baseMembers = [];
  }
  members = loadJSON(STORAGE.members, baseMembers);
  shelves = loadJSON(STORAGE.shelves, defaultShelves);
  overrides = loadJSON(STORAGE.overrides, {});
  movements = loadJSON(STORAGE.movements, []);
  bindEvents();
  refreshAll();
  if (sessionStorage.getItem("karute.auth") === "ok") unlock();
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", event => {
    event.preventDefault();
    if ($("#password").value === APP_PASSWORD) {
      sessionStorage.setItem("karute.auth", "ok");
      $("#loginError").textContent = "";
      $("#password").value = "";
      unlock();
    } else {
      $("#loginError").textContent = "パスワードが違います。";
      $("#password").select();
    }
  });
  $("#togglePassword").addEventListener("click", event => {
    const input = $("#password");
    input.type = input.type === "password" ? "text" : "password";
    event.currentTarget.textContent = input.type === "password" ? "表示" : "非表示";
  });
  $("#logoutButton").addEventListener("click", () => { sessionStorage.removeItem("karute.auth"); lock(); });
  $$(".tab").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  $$(".segment").forEach(button => button.addEventListener("click", () => setSearchMode(button.dataset.mode)));
  $("#searchForm").addEventListener("submit", event => { event.preventDefault(); runSearch(); });
  $("#results").addEventListener("click", handleResultClick);
  $("#manageSearch").addEventListener("input", () => { managePage = 1; renderMemberTable(); });
  $("#prevPage").addEventListener("click", () => { if (managePage > 1) { managePage--; renderMemberTable(); } });
  $("#nextPage").addEventListener("click", () => { managePage++; renderMemberTable(); });
  $("#addMemberButton").addEventListener("click", () => openMemberDialog());
  $("#memberTable").addEventListener("click", handleMemberTableClick);
  $("#memberForm").addEventListener("submit", saveMember);
  $("#addShelfButton").addEventListener("click", () => $("#shelfDialog").showModal());
  $("#shelfForm").addEventListener("submit", addShelf);
  $("#shelfList").addEventListener("click", removeShelf);
  $$(".close-dialog").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
  $("#exportButton").addEventListener("click", exportCSV);
  $("#importButton").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", importCSV);
  $("#syncButton").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = "同期中…";
    await syncFromSheet();
    event.currentTarget.disabled = false;
    event.currentTarget.textContent = "今すぐ同期";
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && sessionStorage.getItem("karute.auth") === "ok" && Date.now() - lastSheetSyncAt > 5000) {
      syncFromSheet({ silent:true });
    }
  });
  window.addEventListener("focus", () => {
    if (sessionStorage.getItem("karute.auth") === "ok" && Date.now() - lastSheetSyncAt > 5000) {
      syncFromSheet({ silent:true });
    }
  });
}

function unlock() {
  $("#loginView").hidden = true;
  $("#appView").hidden = false;
  $("#searchInput").focus();
  connectSheet();
  startAutoSync();
}
function lock() {
  stopAutoSync();
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#password").focus();
}
function showView(name) {
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.id === `${name}View`));
  if (name === "dashboard") renderDashboard();
  if (name === "manage") { renderMemberTable(); renderShelves(); }
}
function setSearchMode(mode) {
  searchMode = mode;
  $$(".segment").forEach(s => s.classList.toggle("is-active", s.dataset.mode === mode));
  $("#searchInput").placeholder = mode === "member" ? "会員番号を入力" : "郵便番号を入力（例：416-0000）";
  $("#searchHint").textContent = mode === "member" ? "数字のみでも検索できます。" : "ハイフンの有無にかかわらず検索できます。";
  $("#searchInput").value = "";
  $("#searchInput").focus();
}

function runSearch() {
  const raw = $("#searchInput").value.trim();
  const key = normalizeDigits(raw);
  if (!key) { renderNoResults("検索する番号を入力してください。"); return; }
  const found = searchMode === "member"
    ? members.filter(m => normalizeDigits(m.memberId) === key)
    : members.filter(m => normalizeDigits(m.postalCode) === key);
  renderResults(found);
}
function renderNoResults(message) {
  $("#searchEmpty").hidden = true;
  $("#results").innerHTML = `<div class="empty-state"><div class="empty-symbol">―</div><h3>該当する会員が見つかりません</h3><p>${escapeHTML(message)}</p></div>`;
}
function renderResults(found) {
  $("#searchEmpty").hidden = true;
  if (!found.length) { renderNoResults("入力内容を確認してください。"); return; }
  $("#results").innerHTML = found.map(member => {
    const shelf = currentShelf(member);
    return `<article class="member-card" data-id="${escapeHTML(member.memberId)}">
      <div class="member-primary"><p class="eyebrow">MEMBER NUMBER</p><p class="member-number">${escapeHTML(member.memberId)}</p></div>
      <div class="member-meta"><dl class="meta-grid"><dt>郵便番号</dt><dd>${escapeHTML(member.postalCode)}</dd><dt>地区グループ</dt><dd><span class="district-badge">${escapeHTML(member.districtGroup)}</span></dd><dt>会員ステータス</dt><dd><span class="status-badge">${escapeHTML(member.status || "未設定")}</span></dd><dt>住所地区</dt><dd>${escapeHTML(member.area || "―")}</dd></dl></div>
      <div class="shelf-control"><label for="shelf-${escapeHTML(member.memberId)}">現在の保存棚</label><select id="shelf-${escapeHTML(member.memberId)}">${shelfOptions(shelf, member)}</select><button class="save-shelf" data-action="save-shelf">保存棚を更新</button><div class="shelf-tag">現在：${escapeHTML(shelf)}</div></div>
    </article>`;
  }).join("");
}
function shelfOptions(selected, member = null) {
  const available = new Set(shelves);
  const official = new Set(shelfCatalog.labels || []);
  const groups = [];
  const system = ["UNKNOWN", "BASE"].filter(s => available.has(s));
  if (system.length) groups.push(["共通", system]);
  (shelfCatalog.groups || []).forEach(group => {
    if (member && group.kind === "district" && group.name !== member.districtGroup) return;
    const labels = group.slots.map(slot => `${group.name} / ${slot}`).filter(label => available.has(label));
    if (labels.length) groups.push([group.name, labels]);
  });
  const custom = shelves.filter(s => !official.has(s));
  if (custom.length) groups.push(["追加棚", custom]);
  const shown = new Set(groups.flatMap(([, values]) => values));
  if (selected && !shown.has(selected)) groups.unshift(["現在の登録", [selected]]);
  return groups.map(([name, values]) => `<optgroup label="${escapeHTML(name)}">${values.map(value => `<option${value === selected ? " selected" : ""}>${escapeHTML(value)}</option>`).join("")}</optgroup>`).join("");
}
async function handleResultClick(event) {
  const button = event.target.closest('[data-action="save-shelf"]');
  if (!button) return;
  const card = button.closest(".member-card");
  const member = members.find(m => String(m.memberId) === card.dataset.id);
  const nextShelf = $("select", card).value;
  const previousShelf = currentShelf(member);
  if (nextShelf === previousShelf) { toast("保存棚は変更されていません。 "); return; }
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const result = await sheetRequest("saveShelf", { memberId:member.memberId, districtGroup:member.districtGroup, shelf:nextShelf });
    member.shelf = result.shelf;
    member.updatedAt = result.changedAt;
    delete overrides[member.memberId];
    movements.unshift({ memberId:member.memberId, districtGroup:member.districtGroup, from:result.previous, to:result.shelf, changedAt:result.changedAt });
    movements = movements.slice(0, 1000);
    persistMembers();
    saveJSON(STORAGE.movements, movements);
    $(".shelf-tag", card).textContent = `現在：${result.shelf}`;
    lastSheetSyncAt = Date.now();
    setConnectionStatus("Googleスプレッドシートと同期済み", connectedDetail(), true);
    toast(`${result.shelf}へ更新しました。`);
  } catch (error) {
    $("select", card).value = previousShelf;
    toast(error.message || "保存できませんでした。");
  } finally {
    button.disabled = false;
    button.textContent = "保存棚を更新";
  }
}

function renderDashboard() {
  const movedIds = new Set(movements.map(m => String(m.memberId)));
  const districtCounts = {};
  members.forEach(m => { const district = m.districtGroup || "未設定"; districtCounts[district] = (districtCounts[district] || 0) + 1; });
  const shelfCounts = {};
  members.forEach(m => { const shelf = currentShelf(m); shelfCounts[shelf] = (shelfCounts[shelf] || 0) + 1; });
  const baseCount = shelfCounts.BASE || 0;
  const knownCount = members.length - (shelfCounts.UNKNOWN || 0);
  const todayMoves = movements.filter(m => new Date(m.changedAt).toDateString() === new Date().toDateString()).length;
  $("#kpiGrid").innerHTML = [
    ["来館確認済み", movedIds.size, "棚移動履歴のある会員"], ["本日の棚移動", todayMoves, "本日の更新件数"], ["BASE来館", baseCount, "現在BASEにあるカルテ"], ["保存棚登録済み", knownCount, `全${members.length.toLocaleString("ja-JP")}件`]
  ].map(([label,value,note]) => `<div class="kpi"><span>${label}</span><strong>${Number(value).toLocaleString("ja-JP")}</strong><span>${note}</span></div>`).join("");
  renderBars("#districtChart", districtCounts, "地区データはありません。");
  renderBars("#shelfChart", shelfCounts, "棚データはありません。");
  $("#movementList").innerHTML = movements.length ? movements.slice(0,10).map(m => `<div class="movement-row"><strong>${escapeHTML(m.memberId)}</strong><span class="movement-route">${escapeHTML(m.from)} → ${escapeHTML(m.to)}</span><span class="movement-date">${formatDate(m.changedAt)}・${escapeHTML(m.districtGroup)}</span></div>`).join("") : `<p class="quiet">棚移動履歴はまだありません。</p>`;
  $("#dashboardUpdated").textContent = `最終表示 ${new Date().toLocaleString("ja-JP", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}`;
}
function renderBars(selector, data, empty) {
  const entries = Object.entries(data).sort((a,b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([,v]) => v));
  $(selector).innerHTML = entries.length ? entries.map(([label,value]) => `<div class="bar-row"><span class="bar-label" title="${escapeHTML(label)}">${escapeHTML(label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, value / max * 100)}%"></div></div><span class="bar-value">${value}</span></div>`).join("") : `<p class="quiet">${empty}</p>`;
}

function filteredMembers() {
  const raw = $("#manageSearch").value.trim();
  const key = normalizeDigits(raw);
  return raw ? members.filter(m => (key && (normalizeDigits(m.memberId).includes(key) || normalizeDigits(m.postalCode).includes(key))) || String(m.status || "").includes(raw)) : members;
}
function renderMemberTable() {
  const filtered = filteredMembers();
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  managePage = Math.min(managePage, pages);
  const page = filtered.slice((managePage - 1) * PAGE_SIZE, managePage * PAGE_SIZE);
  $("#memberTable").innerHTML = page.map(m => `<tr data-id="${escapeHTML(m.memberId)}"><td><strong>${escapeHTML(m.memberId)}</strong></td><td>${escapeHTML(m.postalCode)}</td><td>${escapeHTML(m.districtGroup)}</td><td>${escapeHTML(m.status || "未設定")}</td><td>${escapeHTML(currentShelf(m))}</td><td><div class="row-actions"><button class="mini-button" data-action="edit">編集</button><button class="mini-button danger" data-action="delete">削除</button></div></td></tr>`).join("");
  $("#manageCount").textContent = `${filtered.length.toLocaleString("ja-JP")}件`;
  $("#pageLabel").textContent = `${managePage} / ${pages}`;
  $("#prevPage").disabled = managePage <= 1;
  $("#nextPage").disabled = managePage >= pages;
}
function openMemberDialog(member = null) {
  $("#memberDialogTitle").textContent = member ? "会員を編集" : "会員を追加";
  $("#originalMemberId").value = member?.memberId || "";
  $("#memberIdField").value = member?.memberId || "";
  $("#postalField").value = member?.postalCode || "";
  $("#districtField").value = member?.districtGroup || "";
  $("#statusField").value = member?.status || "未設定";
  $("#shelfField").innerHTML = shelfOptions(member ? currentShelf(member) : "UNKNOWN", member);
  $("#memberDialog").showModal();
}
async function handleMemberTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.closest("tr").dataset.id;
  const member = members.find(m => String(m.memberId) === id);
  if (button.dataset.action === "edit") openMemberDialog(member);
  if (button.dataset.action === "delete") {
    if (!confirm(`会員番号 ${id} を削除しますか？`)) return;
    button.disabled = true;
    try {
      await sheetRequest("deleteMember", { memberId:id });
      members = members.filter(m => String(m.memberId) !== id);
      delete overrides[id];
      persistMembers(); refreshAll(); toast("会員データを削除しました。");
    } catch (error) {
      button.disabled = false;
      toast(error.message || "削除できませんでした。");
    }
  }
}
async function saveMember(event) {
  event.preventDefault();
  const original = $("#originalMemberId").value;
  const id = normalizeDigits($("#memberIdField").value);
  const postalCode = normalizePostal($("#postalField").value);
  const districtGroup = $("#districtField").value.trim();
  const status = $("#statusField").value.trim();
  const shelf = $("#shelfField").value;
  if (!id || !postalCode || !districtGroup || !status) return;
  if (members.some(m => String(m.memberId) === id && String(m.memberId) !== original)) { toast("同じ会員番号が登録されています。"); return; }
  const record = { memberId:id, postalCode, districtGroup, status, area:"手動登録", shelf };
  const submit = event.submitter;
  submit.disabled = true;
  submit.textContent = "保存中…";
  try {
    await sheetRequest("upsertMember", { originalMemberId:original, member:record });
    if (original) members = members.map(m => String(m.memberId) === original ? record : m); else members.push(record);
    if (original && original !== id) delete overrides[original];
    delete overrides[id];
    persistMembers();
    $("#memberDialog").close(); refreshAll(); toast(original ? "会員データを更新しました。" : "会員データを追加しました。");
  } catch (error) {
    toast(error.message || "保存できませんでした。");
  } finally {
    submit.disabled = false;
    submit.textContent = "保存";
  }
}
function persistMembers() { saveJSON(STORAGE.members, members); saveJSON(STORAGE.overrides, overrides); }

function renderShelves() {
  const officialGroups = (shelfCatalog.groups || []).map(group => {
    const labels = group.slots.map(slot => `${group.name} / ${slot}`).filter(label => shelves.includes(label));
    if (!labels.length) return "";
    return `<details class="shelf-group"><summary><span>${escapeHTML(group.name)}</span><small>${labels.length}区画</small></summary><div class="shelf-group-items">${labels.map(label => `<div class="shelf-item"><span>${escapeHTML(label.split(" / ")[1])}</span><button data-shelf="${escapeHTML(label)}">削除</button></div>`).join("")}</div></details>`;
  }).join("");
  const official = new Set(shelfCatalog.labels || []);
  const custom = shelves.filter(s => !official.has(s));
  const common = ["UNKNOWN", "BASE"].filter(s => shelves.includes(s)).map(s => `<div class="shelf-item"><span>${escapeHTML(s)}</span>${s === "UNKNOWN" ? "" : `<button data-shelf="${escapeHTML(s)}">削除</button>`}</div>`).join("");
  const customMarkup = custom.length ? `<details class="shelf-group" open><summary><span>追加棚</span><small>${custom.length}件</small></summary><div class="shelf-group-items">${custom.map(s => `<div class="shelf-item"><span>${escapeHTML(s)}</span><button data-shelf="${escapeHTML(s)}">削除</button></div>`).join("")}</div></details>` : "";
  $("#shelfList").innerHTML = `<div class="shelf-group-items">${common}</div>${officialGroups}${customMarkup}`;
}
async function addShelf(event) {
  event.preventDefault();
  const name = $("#newShelfName").value.trim();
  if (!name || shelves.includes(name)) { toast("別の棚名を入力してください。"); return; }
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await sheetRequest("addShelf", { label:name });
    shelves.push(name); saveJSON(STORAGE.shelves, shelves);
    $("#newShelfName").value = ""; $("#shelfDialog").close(); renderShelves(); toast("保存棚を追加しました。");
  } catch (error) {
    toast(error.message || "保存棚を追加できませんでした。");
  } finally { submit.disabled = false; }
}
async function removeShelf(event) {
  const button = event.target.closest("[data-shelf]");
  if (!button) return;
  const name = button.dataset.shelf;
  if (members.some(m => currentShelf(m) === name)) { toast("使用中の棚は削除できません。"); return; }
  if (!confirm(`${name} を保存棚一覧から削除しますか？`)) return;
  button.disabled = true;
  try {
    await sheetRequest("deleteShelf", { label:name });
    shelves = shelves.filter(s => s !== name); saveJSON(STORAGE.shelves, shelves); renderShelves(); toast("保存棚を削除しました。");
  } catch (error) {
    button.disabled = false;
    toast(error.message || "保存棚を削除できませんでした。");
  }
}

function exportCSV() {
  const rows = [["会員番号","郵便番号","地区グループ","会員ステータス","保存棚"], ...members.map(m => [m.memberId,m.postalCode,m.districtGroup,m.status || "未設定",currentShelf(m)])];
  const csv = "\ufeff" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  const a = document.createElement("a"); a.href = url; a.download = `会員カルテデータ_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  toast("CSVを書き出しました。");
}
async function importCSV(event) {
  const file = event.target.files[0]; if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text.replace(/^\ufeff/, ""));
  const headers = rows.shift()?.map(h => h.trim()) || [];
  const col = name => headers.indexOf(name);
  if (["会員番号","郵便番号","地区グループ"].some(name => col(name) < 0)) { toast("必要な列が見つかりません。"); event.target.value = ""; return; }
  const imported = [];
  rows.forEach(row => {
    const id = normalizeDigits(row[col("会員番号")]); if (!id) return;
    const shelf = col("保存棚") >= 0 && row[col("保存棚")] ? row[col("保存棚")].trim() : "UNKNOWN";
    const status = col("会員ステータス") >= 0 && row[col("会員ステータス")] ? row[col("会員ステータス")].trim() : "未設定";
    imported.push({ memberId:id, postalCode:normalizePostal(row[col("郵便番号")]), districtGroup:(row[col("地区グループ")]||"").trim(), status, area:"CSV取込", shelf });
  });
  if (!imported.length) { toast("取り込める会員データがありません。"); event.target.value = ""; return; }
  if (!confirm(`現在の会員データを、CSVの${imported.length.toLocaleString("ja-JP")}件で置き換えますか？`)) { event.target.value = ""; return; }
  try {
    const state = await sheetRequest("replaceMembers", { members:imported });
    applySheetState(state);
    event.target.value = "";
    toast(`${members.length}件をスプレッドシートへ読み込みました。`);
  } catch (error) {
    event.target.value = "";
    toast(error.message || "CSVを読み込めませんでした。");
  }
}
function parseCSV(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for (let i=0;i<text.length;i++) { const c=text[i], n=text[i+1]; if (c==='"' && quoted && n==='"') { cell+='"'; i++; } else if (c==='"') quoted=!quoted; else if (c===',' && !quoted) { row.push(cell); cell=""; } else if ((c==='\n' || c==='\r') && !quoted) { if (c==='\r' && n==='\n') i++; row.push(cell); if (row.some(v=>v!=="")) rows.push(row); row=[]; cell=""; } else cell+=c; }
  row.push(cell); if (row.some(v=>v!=="")) rows.push(row); return rows;
}

function refreshAll() {
  $("#memberCount").textContent = `登録会員 ${members.length.toLocaleString("ja-JP")}件`;
  const districts = [...new Set(members.map(m => m.districtGroup).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ja"));
  $("#districtOptions").innerHTML = districts.map(d => `<option value="${escapeHTML(d)}"></option>`).join("");
  const statuses = [...new Set(members.flatMap(m => String(m.status || "未設定").split("・")).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ja"));
  $("#statusOptions").innerHTML = statuses.map(status => `<option value="${escapeHTML(status)}"></option>`).join("");
  renderDashboard(); renderMemberTable(); renderShelves();
}
function formatDate(iso) { return new Date(iso).toLocaleString("ja-JP", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
let toastTimer;
function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("is-visible"),2200); }

boot();
