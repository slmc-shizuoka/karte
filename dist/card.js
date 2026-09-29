const CARD_TYPES = [
  { match:"AO", code:"①", label:"AO", color:"#2f7d50" },
  { match:"DX", code:"②", label:"DX", color:"#2464a8" },
  { match:"Premium", code:"⑤", label:"Premium", color:"#79509e" },
  { match:"年払い", code:"⑯", label:"年払い", color:"#bd520b" },
  { match:"その他月額", code:"⑲", label:"その他月額", color:"#697586" }
];
const escapeHTML = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]);

export function normalizeWideArea(value) {
  return String(value ?? "").replaceAll("超高域", "超広域");
}

export function cardTypeForStatus(status) {
  const text = String(status || "未設定");
  // 複合区分は見本の色を優先順位で一つ選び、区分名そのものは省略しない。
  const selected = CARD_TYPES.find(type => text.includes(type.match));
  return selected ? { ...selected, status:text } : { code:"—", label:"その他", color:"#697586", status:text };
}

export function shouldPrepareCardAfterMemberSave(previousMember, nextMember) {
  return !previousMember || previousMember.status !== nextMember.status;
}

function blankRows(count, columns) {
  return Array.from({ length:count }, () => `<tr>${Array.from({ length:columns }, () => "<td>&nbsp;</td>").join("")}</tr>`).join("");
}

function yearTable(number) {
  return `<section class="karte-year">
    <div class="karte-year-heading"><strong>${number}年目</strong><span>西暦　＿＿＿＿ 年 〜</span></div>
    <table><thead><tr><th>月</th><th>日</th><th>誰</th><th>記号</th><th>メモ</th><th>担当</th></tr></thead>
    <tbody>${blankRows(12, 6)}</tbody></table>
  </section>`;
}

export function cardMarkup(member, details = {}) {
  if (!member?.memberId) return "";
  const type = cardTypeForStatus(member.status);
  const safe = value => escapeHTML(value || "");
  const memberId = safe(member.memberId);
  const kana = safe(details.kanaName);
  const store = safe(details.storeName);
  const shelf = safe(normalizeWideArea(member.shelf || "UNKNOWN"));
  const created = new Intl.DateTimeFormat("sv-SE", { timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
  const style = `style="--card-accent:${type.color}"`;
  const footer = "会員カルテ　個人情報を含みます。所定のレターケースに戻してください。施設外持ち出し禁止。";
  return `<div class="karte-pages" aria-label="${memberId} のA4両面カルテ">
    <article class="karte-page karte-front" ${style}>
      <div class="karte-status-band"><b>${type.code}</b><small>区分</small><strong>${safe(type.status)}</strong></div>
      <header class="karte-document-head"><div><strong>会員カルテ</strong><span>${store || "店舗名：＿＿＿＿＿＿＿＿"}</span></div><div class="karte-head-note">作成日 ${created}　表面<br><em>郵便番号・電話番号は書きません</em></div></header>
      <section class="karte-person-box">
        <div class="karte-id"><small>お客様番号</small><strong>${memberId}</strong><span>保存棚　${shelf}</span></div>
        <div class="karte-person-lines"><div><span>カナ名</span><strong>${kana}</strong></div><div><span>入会日</span><strong>${safe(details.joinDate)}</strong></div></div>
        <div class="karte-staff-lines"><div class="karte-address-check">${details.addressCheck ? "☑" : "□"}　要住所確認</div><div>SF担当　${safe(details.sfStaff)}</div><div>DX担当　${safe(details.dxStaff)}</div></div>
        <div class="karte-plan-line"><span>プラン名</span><strong>${safe(details.planName)}</strong></div>
      </section>
      <section class="karte-block karte-family"><h3>ご家族（この番号の方）<small>裏面の記録は「誰の分」を番号で書きます</small></h3><table><thead><tr><th>番号</th><th>カナ名</th><th>続柄</th><th>メモ</th></tr></thead><tbody><tr><td>1</td><td>${kana}</td><td>名義人本人</td><td></td></tr>${[2,3,4].map(n => `<tr><td>${n}</td><td></td><td></td><td></td></tr>`).join("")}</tbody></table></section>
      <section class="karte-block karte-courses"><h3>受講する講座<small>空欄は手書きで足す（今後の講座）</small></h3><table><thead><tr><th>講座</th><th>受ける方</th><th>開始時期</th><th>メモ</th></tr></thead><tbody><tr><td>安全講習 基礎編</td><td></td><td></td><td></td></tr><tr><td>スマートライフ学 必要論</td><td></td><td></td><td></td></tr>${blankRows(5, 4)}</tbody></table></section>
      <div class="karte-front-lower"><div><section class="karte-block karte-events"><h3>特別講座・イベント<small>自由に書く</small></h3><table><thead><tr><th>日付</th><th>参加した方</th><th>内容</th><th>担当</th></tr></thead><tbody>${blankRows(5, 4)}</tbody></table></section><section class="karte-block karte-contact"><h3>連絡の記録</h3><table><thead><tr><th>日付</th><th>担当</th><th>内容</th></tr></thead><tbody>${blankRows(5, 3)}</tbody></table></section></div><section class="karte-block karte-notes"><h3>メモ<small>ご希望・注意点など</small></h3><div>${Array.from({length:9}, () => "<i></i>").join("")}</div></section></div>
      <footer><span>${footer}</span><span>A4 両面</span></footer>
    </article>
    <article class="karte-page karte-back" ${style}>
      <header class="karte-document-head"><div><strong>来館の記録（4年分）</strong></div><div class="karte-head-note"><b>${memberId}　${kana}</b><br><em>来館のたびに1行。オリエン・受講・イベントをまとめて書く</em></div></header>
      <p class="karte-legend">記号：来＝通常のご来館　オ①②＝事前オリエン　受＝受講（安全＝安／必要論＝必 と回数）　入＝入門編　イ＝イベント</p>
      <div class="karte-years">${[1,2,3,4].map(yearTable).join("")}</div>
      <footer><span>${footer}</span><span>A4 両面</span></footer>
    </article>
  </div>`;
}
