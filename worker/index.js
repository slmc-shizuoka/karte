const jsonHeaders = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};
const allowedActions = new Set([
  "load", "initialize", "replaceMembers", "saveShelf", "upsertMember",
  "deleteMember", "addShelf", "deleteShelf"
]);

async function sheetApi(request, env) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ ok:false, error:"この画面から操作してください。" }, { status:403, headers:jsonHeaders });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ ok:false, error:"リクエスト形式が正しくありません。" }, { status:415, headers:jsonHeaders });
  }
  try {
    const body = await request.text();
    if (body.length > 4_000_000) throw new Error("データ量が大きすぎます。");
    const { action, payload } = JSON.parse(body);
    if (!allowedActions.has(action) || !payload || typeof payload !== "object") {
      return Response.json({ ok:false, error:"操作を確認できません。" }, { status:400, headers:jsonHeaders });
    }
    if (!env.SHEETS_BRIDGE_URL || !env.SHEETS_API_TOKEN) {
      throw new Error("スプレッドシート連携の設定を確認してください。");
    }
    const form = new URLSearchParams({
      id:crypto.randomUUID(),
      action,
      format:"json",
      payload:JSON.stringify({ ...payload, apiToken:env.SHEETS_API_TOKEN })
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    let upstream;
    try {
      upstream = await fetch(env.SHEETS_BRIDGE_URL, {
        method:"POST", body:form, redirect:"follow", signal:controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) throw new Error("スプレッドシートの応答を受け取れませんでした。");
    const result = await upstream.json();
    if (typeof result?.ok !== "boolean") throw new Error("スプレッドシートの応答を確認できませんでした。");
    return Response.json(result, { status:result.ok ? 200 : 400, headers:jsonHeaders });
  } catch (error) {
    const message = error.name === "AbortError" ? "同期に時間がかかっています。自動で再試行します。" : error.message;
    return Response.json({ ok:false, error:message || "スプレッドシートに接続できませんでした。" }, { status:502, headers:jsonHeaders });
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/sheet") {
      if (request.method !== "POST") return new Response("Method not allowed", { status:405 });
      return sheetApi(request, env);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status:405 });
    }
    const asset = STATIC_FILES[path];
    if (!asset) return new Response("Not found", { status:404 });
    return new Response(request.method === "HEAD" ? null : asset.body, {
      headers:{
        "content-type":asset.type,
        "cache-control":"no-store",
        "x-content-type-options":"nosniff"
      }
    });
  }
};
