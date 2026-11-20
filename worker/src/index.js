const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const randomId = () => crypto.randomUUID().replace(/-/g, "");
async function github(env, path, init = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "APK-Editor-Builder",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error("GitHub API: " + response.status + " " + (await response.text()).slice(0, 300));
  return response.status === 204 ? null : response.json();
}
function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/build" && request.method === "POST") {
        const form = await request.formData();
        const project = form.get("project");
        if (!(project instanceof File)) return json({ error: "فایل پروژه ارسال نشده است." }, 400);
        // KV has a 25 MiB value limit; base64 expands the input by roughly one third.
        if (project.size > 18 * 1024 * 1024) return json({ error: "حداکثر حجم فایل پروژه در نسخه رایگان ۱۸ مگابایت است." }, 413);
        const appName = String(form.get("appName") || "My Web App").slice(0, 40);
        const packageId = String(form.get("packageId") || "");
        if (!/^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageId) || packageId.length > 180) {
          return json({ error: "شناسه برنامه معتبر نیست." }, 400);
        }
        const id = randomId();
        const secret = randomId();
        const bytes = new Uint8Array(await project.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const encoded = btoa(binary);
        await env.BUILDS.put("source:" + id, encoded, { expirationTtl: 86400 });
        await env.BUILDS.put(id, JSON.stringify({
          status: "queued", createdAt: Date.now(), callbackSecret: secret,
          sourceSecret: secret, appName, packageId,
        }), { expirationTtl: 86400 });
        const sourceUrl = new URL("/api/source/" + id, url.origin);
        sourceUrl.searchParams.set("key", secret);
        const callbackUrl = new URL("/api/callback", url.origin).toString();
        try {
          await github(env, `/repos/${env.GITHUB_REPOSITORY}/actions/workflows/build-user-apk.yml/dispatches`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ref: env.GITHUB_BRANCH || "main",
              inputs: { build_id: id, source_url: sourceUrl.toString(), callback_url: callbackUrl, callback_secret: secret },
            }),
          });
        } catch (error) {
          await env.BUILDS.delete("source:" + id);
          await env.BUILDS.put(id, JSON.stringify({ status: "failed", error: "ارسال درخواست به GitHub Actions ناموفق بود: " + error.message }), { expirationTtl: 86400 });
          return json({ error: "سرویس ساخت نتوانست اجرای کامپایل را آغاز کند. تنظیمات GitHub را بررسی کنید." }, 502);
        }
        return json({ buildId: id, status: "queued" }, 202);
      }
      const sourceMatch = url.pathname.match(/^\\/api\\/source\\/([a-f0-9]{32})$/);
      if (sourceMatch && request.method === "GET") {
        const id = sourceMatch[1];
        const raw = await env.BUILDS.get(id);
        if (!raw) return json({ error: "لینک دریافت سورس منقضی شده است." }, 404);
        const item = JSON.parse(raw);
        if (!item.sourceSecret || url.searchParams.get("key") !== item.sourceSecret) return json({ error: "دسترسی غیرمجاز." }, 401);
        const encoded = await env.BUILDS.get("source:" + id);
        if (!encoded) return json({ error: "فایل پروژه پیدا نشد." }, 404);
        return new Response(decodeBase64(encoded), {
          headers: { "content-type": "application/zip", "cache-control": "no-store" },
        });
      }
      if (url.pathname === "/api/callback" && request.method === "POST") {
        const body = await request.json();
        const raw = await env.BUILDS.get(body.build_id);
        if (!raw) return json({ error: "ساخت پیدا نشد." }, 404);
        const item = JSON.parse(raw);
        if (!body.secret || body.secret !== item.callbackSecret) return json({ error: "دسترسی غیرمجاز." }, 401);
        item.status = body.status === "completed" ? "completed" : "failed";
        item.runId = Number(body.run_id) || null;
        item.error = String(body.error || "").slice(0, 1000);
        item.completedAt = Date.now();
        await env.BUILDS.delete("source:" + body.build_id);
        await env.BUILDS.put(body.build_id, JSON.stringify(item), { expirationTtl: 86400 });
        return json({ ok: true });
      }
      const match = url.pathname.match(/^\\/api\\/build\\/([a-f0-9]{32})(\\/download)?$/);
      if (match && request.method === "GET") {
        const id = match[1];
        const raw = await env.BUILDS.get(id);
        if (!raw) return json({ error: "درخواست ساخت پیدا نشد یا منقضی شده است." }, 404);
        const item = JSON.parse(raw);
        if (match[2]) {
          if (item.status !== "completed" || !item.runId) return json({ error: "فایل هنوز آماده نیست." }, 409);
          const data = await github(env, `/repos/${env.GITHUB_REPOSITORY}/actions/runs/${item.runId}/artifacts`);
          const artifact = data.artifacts?.find((entry) => entry.name === "apk-output" && !entry.expired);
          if (!artifact) return json({ error: "فایل خروجی در GitHub Actions پیدا نشد." }, 404);
          const response = await fetch(artifact.archive_download_url, {
            headers: { Authorization: "Bearer " + env.GITHUB_TOKEN, Accept: "application/vnd.github+json" },
          });
          if (!response.ok) return json({ error: "دریافت فایل خروجی از سرور ناموفق بود." }, 502);
          return new Response(response.body, {
            headers: { ...cors, "content-type": "application/zip", 'content-disposition': 'attachment; filename="apk-output.zip"', "cache-control": "no-store" },
          });
        }
        return json({ status: item.status, error: item.error || null });
      }
      return json({ error: "مسیر پیدا نشد." }, 404);
    } catch (error) {
      return json({ error: error.message || "خطای داخلی سرویس ساخت." }, 500);
    }
  },
};
