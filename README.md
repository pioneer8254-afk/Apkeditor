# APK Editor

رابط فارسی برای تبدیل پروژه وب به APK اندروید. کاربر فایل HTML یا ZIP را داخل برنامه انتخاب می‌کند؛ برنامه پروژه را به API می‌فرستد، GitHub Actions با Android SDK/Gradle آن را کامپایل می‌کند و APK از همان صفحه دریافت می‌شود.

## معماری

- رابط کاربری: `index.html`، پیش‌نمایش و آماده‌سازی پروژه در مرورگر.
- API: Cloudflare Worker در `worker/src/index.js`.
- ذخیره موقت سورس: Cloudflare R2 (فایل‌ها به‌صورت خصوصی ذخیره می‌شوند).
- صف و وضعیت: Cloudflare KV.
- کامپایل واقعی: GitHub Actions workflow با نام `build-user-apk.yml`.
- خروجی: APK آزمایشی Debug داخل Artifact کوتاه‌مدت؛ Worker آن را به کاربر تحویل می‌دهد.

## راه‌اندازی یک‌باره سرویس (لازم برای فعال شدن دکمه ساخت)

این مخزن کد کامل برنامه و API را دارد، اما Worker و منابع Cloudflare به حساب مالک نیاز دارند و از داخل GitHub قابل ایجاد خودکار نیستند.

### ۱) ساخت منابع Cloudflare

1. یک حساب Cloudflare باز کن و از بخش R2 یک bucket خصوصی با نام `apkeditor-projects` بساز.
2. از بخش Workers & Pages یک KV namespace بساز.
3. شناسه KV را در `worker/wrangler.toml` جایگزین `REPLACE_WITH_KV_NAMESPACE_ID` کن.
4. در ترمینال پوشه `worker` اجرا کن: `npm install` سپس `npx wrangler deploy`.
5. در Cloudflare Worker → Settings → Variables and Secrets، متغیرها/Secrets زیر را اضافه کن:
   - `GITHUB_TOKEN` (Secret): Fine-grained PAT با دسترسی Actions: Read and write و Metadata: Read برای مخزن APK Editor.
   - `GITHUB_REPOSITORY` (Variable): `pioneer8254-afk/Apkeditor`
   - `GITHUB_BRANCH` (Variable): `main`
   - `R2_ACCOUNT_ID` (Variable): شناسه حساب Cloudflare
   - `R2_ACCESS_KEY_ID` (Secret): کلید دسترسی R2
   - `R2_SECRET_ACCESS_KEY` (Secret): کلید محرمانه R2
   - `R2_BUCKET` (Variable): `apkeditor-projects`
6. برای دسترسی R2، کلید با مجوز Object Read & Write فقط روی همین bucket بساز. bucket را Public نکن.

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

- محدودیت حجم ورودی: 25 MB؛ TTL داده وضعیت یک روز؛ Artifact خروجی یک روز.
- سورس در R2 خصوصی ذخیره می‌شود. برای پاک‌سازی منظم، Lifecycle Rule روی bucket تنظیم کن تا اشیای `sources/` را بعد از ۱ روز حذف کند.
- قبل از استفاده عمومی، روی Worker محدودیت نرخ (Rate Limiting) و کنترل سوءاستفاده فعال کن؛ API عمومی بدون محدودیت نرخ برای استفاده عمومی مناسب نیست.
- فقط پروژه‌های وب قابل اعتماد را بساز. پروژه‌های وب پیچیده ممکن است به تنظیمات native یا افزونه‌های اختصاصی نیاز داشته باشند.
- خروجی فعلی Debug APK است و برای نصب آزمایشی مناسب است.
