// ثوابت ودوال مشتركة بين التطبيق ولوحة الإدارة
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const CATS = [
  ["all", "الكل"], ["cars", "سيارات"], ["realestate", "عقارات"], ["phones", "موبايلات وإلكترونيات"],
  ["furniture", "أثاث"], ["jobs", "وظائف"], ["services", "خدمات"], ["animals", "حيوانات"], ["other", "أخرى"]
];
export const CAT_KEYS = CATS.slice(1).map(c => c[0]);
export const catName = k => (CATS.find(c => c[0] === k) || [, "أخرى"])[1];
export const CITIES = ["دمشق", "ريف دمشق", "حلب", "حمص", "حماة", "اللاذقية", "طرطوس", "إدلب", "درعا", "السويداء", "القنيطرة", "دير الزور", "الرقة", "الحسكة"];
export const BRANDS = {
  cars: ["كيا", "هيونداي", "تويوتا", "نيسان", "مرسيدس", "بي إم دبليو", "شيري", "سابا", "بيجو", "أخرى"],
  phones: ["سامسونج", "آيفون", "شاومي", "هواوي", "أوبو", "ريلمي", "لينوفو", "ديل", "إتش بي", "أخرى"],
  furniture: ["خشب زان", "خشب سويدي", "MDF", "ألمنيوم", "أخرى"]
};
export const COND_CATS = ["cars", "phones", "furniture", "animals", "other"];
export const condName = c => c === "new" ? "جديد" : c === "used" ? "مستعمل" : "";
export const REPORT_REASONS = ["احتيال أو طلب دفع مسبق", "سعر غير حقيقي أو مضلل", "الغرض مباع أو الإعلان مكرر", "صور أو محتوى غير لائق", "قسم خاطئ", "سبب آخر"];

export const ms = t => !t ? Date.now() : typeof t === "number" ? t : t.toMillis ? t.toMillis() : Date.now();
export const ago = t => {
  const m = Math.round((Date.now() - ms(t)) / 60000);
  if (m < 1) return "الآن"; if (m < 60) return `منذ ${m} د`;
  const h = Math.round(m / 60); if (h < 24) return `منذ ${h} س`;
  const d = Math.round(h / 24); return d < 30 ? `منذ ${d} يوم` : new Date(ms(t)).toLocaleDateString("ar-SY");
};
export const fmtPrice = (p, c) => !p ? (c === "" ? "حسب الاتفاق" : "مجاناً") : (c === "$" ? "$" + Number(p).toLocaleString("en-US") : Number(p).toLocaleString("en-US") + " ل.س");
export const joinedTxt = t => new Date(ms(t)).toLocaleDateString("ar-SY", { year: "numeric", month: "long" });
export const isFeatured = a => (a.featuredUntil || 0) > Date.now();

const I = {
  search: '<path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Zm4 4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  heartF: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  chat: '<path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  user: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  back: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M12 21s-6-6-6-11a6 6 0 1 1 12 0c0 5-6 11-6 11Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="none" stroke="currentColor" stroke-width="2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" stroke-width="2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  flag: '<path d="M5 21V4h12l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  check: '<path d="M12 2l2.4 2.2 3.2-.4.9 3.1 2.9 1.5-1.2 3 1.2 3-2.9 1.5-.9 3.1-3.2-.4L12 22l-2.4-2.2-3.2.4-.9-3.1-2.9-1.5 1.2-3-1.2-3 2.9-1.5.9-3.1 3.2.4L12 2Zm-3.5 10 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  send: '<path d="M20 4 3 11l7 2 2 7 8-16Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  admin: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Zm-3 9 2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  all: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2"/>',
  cars: '<path d="M3 15v-3l2-5h14l2 5v3h-2m-14 0H3m2 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m6 0a2 2 0 1 0 4 0m-4 0a2 2 0 1 1 4 0m-6 0h2M4 12h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  realestate: '<path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-6h4v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  phones: '<path d="M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  furniture: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v5H3zM5 16v3m14-3v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  jobs: '<path d="M3 8h18v11H3zM9 8V5h6v3M3 13h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  services: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  animals: '<path d="M12 13c3 0 5 3 5 5s-2 2-5 2-5 0-5-2 2-5 5-5ZM6 9a1.8 2.3 0 1 0 0 .1M18 9a1.8 2.3 0 1 0 0 .1M9.5 5a1.8 2.3 0 1 0 0 .1M14.5 5a1.8 2.3 0 1 0 0 .1" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  other: '<path d="M5 12h.01M12 12h.01M19 12h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>'
};
export const ic = (n, style = "") => `<svg viewBox="0 0 24 24" aria-hidden="true"${style ? ` style="${style}"` : ""}>${I[n] || I.other}</svg>`;
export const icSm = n => ic(n, "width:14px;height:14px;vertical-align:-2px");

let tt;
export function toast(t) {
  $$(".toast").forEach(x => x.remove());
  const d = document.createElement("div"); d.className = "toast"; d.setAttribute("role", "status"); d.textContent = t;
  document.body.appendChild(d); clearTimeout(tt); tt = setTimeout(() => d.remove(), 2800);
}
export function sheet(html, onMount) {
  const bg = document.createElement("div"); bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  onMount && onMount(bg.firstChild, close);
  return close;
}

// ضغط الصور قبل الرفع: صورة كبيرة للإعلان + مصغّرة للقائمة
export function compressImage(file, maxSide, quality, maxBytes) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let side = maxSide, q = quality, out;
        for (let i = 0; i < 6; i++) {
          const sc = Math.min(1, side / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL("image/jpeg", q);
          if (out.length <= maxBytes) break;
          side = Math.round(side * 0.8); q = Math.max(0.45, q - 0.08);
        }
        res(out);
      };
      img.onerror = () => res(null);
      img.src = r.result;
    };
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
}
export const thumbFromDataUrl = (dataUrl) => new Promise(res => {
  const img = new Image();
  img.onload = () => {
    const s = 260, sc = Math.min(1, s / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.6));
  };
  img.onerror = () => res("");
  img.src = dataUrl;
});

export const errMsg = e => {
  const c = e && e.code || "";
  const map = {
    "auth/invalid-email": "الإيميل مو صحيح.",
    "auth/missing-password": "اكتب كلمة السر.",
    "auth/weak-password": "كلمة السر لازم تكون 6 أحرف أو أكتر.",
    "auth/email-already-in-use": "هالإيميل مسجّل من قبل. جرّب «تسجيل الدخول».",
    "auth/invalid-credential": "الإيميل أو كلمة السر غلط.",
    "auth/wrong-password": "كلمة السر غلط.",
    "auth/user-not-found": "ما في حساب بهالإيميل.",
    "auth/too-many-requests": "محاولات كتير. استنى شوي وجرّب مرة تانية.",
    "auth/network-request-failed": "في مشكلة بالاتصال بالنت. تأكد من الاتصال وجرّب مرة تانية.",
    "auth/invalid-phone-number": "رقم الهاتف مو صحيح. اكتبه مع رمز الدولة، مثل ‎+963944123456",
    "auth/invalid-verification-code": "رمز التحقق غلط.",
    "auth/provider-already-linked": "حسابك موثّق برقم من قبل.",
    "auth/credential-already-in-use": "هالرقم مربوط بحساب تاني.",
    "auth/operation-not-allowed": "طريقة الدخول هي مو مفعّلة بإعدادات Firebase.",
    "auth/billing-not-enabled": "رسائل التحقق بتحتاج تفعيل خطة Blaze بمشروع Firebase.",
    "permission-denied": "ما عندك صلاحية لهالعملية.",
    "unavailable": "ما في اتصال بالسيرفر حالياً. رح نعيد المحاولة تلقائياً.",
    "resource-exhausted": "تجاوزنا الحد المسموح حالياً. جرّب بعد شوي."
  };
  return map[c] || "صار خطأ غير متوقع" + (c ? ` (${c})` : "") + ". جرّب مرة تانية.";
};
