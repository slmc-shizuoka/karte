import test from "node:test";
import assert from "node:assert/strict";
import { cardMarkup, cardTypeForStatus, normalizeWideArea, shouldPrepareCardAfterMemberSave } from "../dist/card.js";

test("見本の5区分にそれぞれ固有の色と番号を割り当てる", () => {
  const statuses = ["AO", "DX", "Premium", "年払い", "その他月額"];
  const types = statuses.map(cardTypeForStatus);
  assert.equal(new Set(types.map(type => type.color)).size, 5);
  assert.deepEqual(types.map(type => type.code), ["①", "②", "⑤", "⑯", "⑲"]);
});

test("複合区分は元の区分名を残して色を選ぶ", () => {
  const type = cardTypeForStatus("Premium・年払い");
  assert.equal(type.code, "⑤");
  assert.equal(type.status, "Premium・年払い");
});

test("旧地区名を新地区名に統一する", () => {
  assert.equal(normalizeWideArea("超高域 / 1-2月"), "超広域 / 1-2月");
});

test("カルテはA4両面で郵便番号と電話番号を含めない", () => {
  const html = cardMarkup({ memberId:"12345671", status:"AO", shelf:"超広域 / 1-2月", postalCode:"111-2222" }, { kanaName:"ミホン タロウ", storeName:"店舗名" });
  assert.equal((html.match(/class="karte-page /g) || []).length, 2);
  assert.match(html, /来館の記録（4年分）/);
  assert.match(html, /ミホン タロウ/);
  assert.doesNotMatch(html, /111-2222/);
  assert.equal((html.match(/class="karte-year"/g) || []).length, 4);
  assert.equal((html.match(/<td>&nbsp;<\/td>/g) || []).length, 343);
});

test("選択した区分でカルテの番号と色を切り替える", () => {
  for (const status of ["AO", "DX", "Premium", "年払い", "その他月額"]) {
    const type = cardTypeForStatus(status);
    const html = cardMarkup({ memberId:"12345671", status, shelf:"UNKNOWN" });
    assert.match(html, new RegExp(`--card-accent:${type.color}`));
    assert.match(html, new RegExp(`<b>${type.code}</b>`));
  }
});

test("手入力項目をHTMLとして解釈しない", () => {
  const html = cardMarkup({ memberId:"12345671", status:"DX", shelf:"UNKNOWN" }, { kanaName:"<script>bad()</script>" });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("新規入会とステータス変更ではカルテを用意する", () => {
  assert.equal(shouldPrepareCardAfterMemberSave(null, { status:"AO" }), true);
  assert.equal(shouldPrepareCardAfterMemberSave({ status:"AO" }, { status:"DX" }), true);
  assert.equal(shouldPrepareCardAfterMemberSave({ status:"AO" }, { status:"AO" }), false);
});
