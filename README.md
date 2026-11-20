# APK Editor

رابط فارسی برای تبدیل پروژه وب به APK اندروید. کاربر فایل HTML یا ZIP را داخل برنامه انتخاب می‌کند؛ برنامه پروژه را به API می‌فرستد، GitHub Actions با Android SDK/Gradle آن را کامپایل می‌کند و APK از همان صفحه دریافت می‌شود.

## معماری

- رابط کاربری: `index.html`، پیش‌نمایش و آماده‌سازی پروژه در مرورگر.
- API: Cloudflare Worker در `worker/src/index.js`.
- ذخیره موقت سورس: Cloudflare KV (بدون نیاز به R2؛ فایل سورس پس از callback حذف می‌شود).
- صف و وضعیت: Cloudflare KV.
- کامپایل واقعی: GitHub Actions workflow با نام `build-user-apk.yml`.
- خروجی: APK آزمایشی Debug داخل Artifact کوتاه‌مدت؛ Worker آن را به کاربر تحویل می‌دهد.

## راه‌اندازی یک‌باره سرویس (لازم برای فعال شدن دکمه ساخت)

این مخزن کد کامل برنامه و API را دارد، اما Worker و منابع Cloudflare به حساب مالک نیاز دارند و از داخل GitHub قابل ایجاد خودکار نیستند.

### ۱) ساخت منابع Cloudflare

1. R2 لازم نیست. KV namespace با نام `apkeditor-build-status` ساخته شده و شناسه آن در `worker/wrangler.toml` ثبت شده است.
2. در ترمینال پوشه `worker` اجرا کن: `npm install` سپس `npx wrangler deploy`.
3. در Cloudflare Worker → Settings → Variables and Secrets، متغیرها/Secrets زیر را اضافه کن:
   - `GITHUB_TOKEN` (Secret): Fine-grained PAT با دسترسی Actions: Read and write و Metadata: Read برای مخزن APK Editor.
   - `GITHUB_REPOSITORY` (Variable): `pioneer8254-afk/Apkeditor`
   - `GITHUB_BRANCH` (Variable): `main`


### ۲) اتصال رابط به Worker

در `index.html` مقدار زیر را با نشانی Worker خودت جایگزین کن:
`const base=window.APK_EDITOR_API||'';`
به شکل:
`const base=window.APK_EDITOR_API||'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev';`

سپس فایل را commit کن و GitHub Pages را از Settings → Pages روی GitHub Actions فعال کن.

### ۳) ساخت APK

کاربر فقط این مراحل را در سایت/اپ انجام می‌دهد:
1. انتخاب HTML یا ZIP (ZIP باید شامل `index.html` در ریشه پروژه باشد).
2. وارد کردن نام برنامه و Package ID مانند `com.example.myapp`.
3. انتخاب اختیاری آیکون PNG/JPG.
4. زدن «ساخت APK» و منتظر ماندن تا دانلود خودکار فایل ZIP خروجی.

داخل فایل ZIP خروجی، `app-debug.apk` قرار دارد. این نسخه APK امضاشده Release برای Google Play نیست؛ برای انتشار باید کلید امضای Release و فرایند امن مدیریت keystore اضافه شود.

## امنیت و محدودیت‌ها

- محدودیت حجم ورودی: 18 MiB؛ چون داده در KV به‌صورت Base64 ذخیره می‌شود و سقف هر مقدار KV برابر 25 MiB است. TTL داده‌ها یک روز است.
- سورس پس از پایان build و callback از KV حذف می‌شود؛ در صورت توقف غیرمنتظره، TTL یک‌روزه پاک‌سازی می‌کند.
- قبل از استفاده عمومی، روی Worker محدودیت نرخ (Rate Limiting) و کنترل سوءاستفاده فعال کن؛ API عمومی بدون محدودیت نرخ برای استفاده عمومی مناسب نیست.
- فقط پروژه‌های وب قابل اعتماد را بساز. پروژه‌های وب پیچیده ممکن است به تنظیمات native یا افزونه‌های اختصاصی نیاز داشته باشند.
- خروجی فعلی Debug APK است و برای نصب آزمایشی مناسب است.
