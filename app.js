import {
  auth, db, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile, signOut,
  RecaptchaVerifier, linkWithPhoneNumber,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, increment, writeBatch, startAfter
} from "./firebase.js";
import {
  $, $$, esc, CATS, CAT_KEYS, catName, CITIES, BRANDS, COND_CATS, condName, REPORT_REASONS,
  ms, ago, fmtPrice, joinedTxt, isFeatured, ic, icSm, toast, sheet, compressImage, thumbFromDataUrl, errMsg
} from "./shared.js";

const PAGE = 40;            // عدد الإعلانات بكل دفعة (أقل = قراءات أقل من الحصة المجانية)
const MAX_IMGS = 6;
const D = 86400000;

// ---------------- الحالة ----------------
const S = {
  user: null, profile: null, isAdmin: false,
  ads: [], featured: [], cursor: null, hasMore: false, adsReady: false,
  cache: new Map(),            // id -> ad
  favs: new Set(), searches: [], chats: [], myAds: [],
  cfg: { featurePlans: [{ days: 3, price: "2$" }, { days: 7, price: "4$" }, { days: 30, price: "12$" }], paymentInfo: "", safetyNote: "" },
  view: "home", ctx: null, draft: null, busy: false,
  filt: { q: "", cat: "all", city: "", cond: "", brand: "", min: "", max: "", sort: "new" },
  detail: null, sellerPage: null, msgs: [], favAds: []
};
const stack = [];
let unsubUser = [], unsubChat = null, pendingName = "";
try { const c = localStorage.getItem("city"); if (c) S.filt.city = c; } catch (_) {}

// ---------------- البيانات العامة ----------------
const adFrom = d => { const a = { id: d.id, ...d.data() }; S.cache.set(a.id, a); return a; };

onSnapshot(query(collection(db, "ads"), where("status", "==", "active"), orderBy("bumpedAt", "desc"), limit(PAGE)), snap => {
  S.ads = snap.docs.map(adFrom);
  S.cursor = snap.docs[snap.docs.length - 1] || null;
  S.hasMore = snap.size === PAGE;
  S.adsReady = true;
  if (["home", "favs"].includes(S.view)) render();
}, e => { console.error(e); S.adsReady = true; render(); toast(errMsg(e)); });

onSnapshot(query(collection(db, "ads"), where("featuredUntil", ">", Date.now()), limit(20)), snap => {
  S.featured = snap.docs.map(adFrom).filter(a => a.status === "active");
  if (S.view === "home") render();
}, e => console.warn("featured", e));

onSnapshot(doc(db, "config", "app"), d => { if (d.exists()) S.cfg = { ...S.cfg, ...d.data() }; }, () => {});

async function loadMore() {
  if (!S.cursor) return;
  const snap = await getDocs(query(collection(db, "ads"), where("status", "==", "active"), orderBy("bumpedAt", "desc"), startAfter(S.cursor), limit(PAGE)));
  S.ads = S.ads.concat(snap.docs.map(adFrom));
  S.cursor = snap.docs[snap.docs.length - 1] || S.cursor;
  S.hasMore = snap.size === PAGE;
  render();
}

// ---------------- المستخدم ----------------
getRedirectResult(auth).catch(e => toast(errMsg(e)));
onAuthStateChanged(auth, async user => {
  unsubUser.forEach(u => u()); unsubUser = [];
  S.user = user; S.profile = null; S.isAdmin = false; S.favs = new Set(); S.searches = []; S.chats = []; S.myAds = [];
  if (!user) { render(); return; }
  const uref = doc(db, "users", user.uid);
  try {
    const u = await getDoc(uref);
    if (!u.exists()) {
      await setDoc(uref, {
        name: (pendingName || user.displayName || (user.email || "مستخدم").split("@")[0]).slice(0, 40), joinedAt: serverTimestamp(),
        phoneVerified: false, allowCall: false, contactPhone: "", banned: false
      });
    }
  } catch (e) { console.error(e); }
  try { S.isAdmin = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (_) { S.isAdmin = false; }

  unsubUser.push(onSnapshot(uref, d => { S.profile = d.exists() ? d.data() : null; render(); }));
  unsubUser.push(onSnapshot(collection(db, "users", user.uid, "favorites"), s => { S.favs = new Set(s.docs.map(d => d.id)); if (S.view === "favs") loadFavAds(); else render(); }));
  unsubUser.push(onSnapshot(collection(db, "users", user.uid, "searches"), s => { S.searches = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }));
  unsubUser.push(onSnapshot(query(collection(db, "chats"), where("participants", "array-contains", user.uid), orderBy("lastAt", "desc"), limit(100)),
    s => { S.chats = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }, e => console.warn("chats", e)));
  unsubUser.push(onSnapshot(query(collection(db, "ads"), where("ownerId", "==", user.uid)), s => {
    S.myAds = s.docs.map(adFrom).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)); if (S.view === "profile") render();
  }));
  render();
});
const me = () => S.user && S.user.uid;
const banned = () => S.profile && S.profile.banned;
function needAuth(after) { if (S.user) { if (banned()) { toast("حسابك موقوف. تواصل مع إدارة التطبيق."); return false; } return true; } authSheet(after); return false; }

// ---------------- الفلترة والتنبيهات ----------------
function matches(a, f) {
  if (a.status !== "active") return false;
  if (f.cat && f.cat !== "all" && a.cat !== f.cat) return false;
  if (f.city && a.city !== f.city) return false;
  if (f.cond && a.cond !== f.cond) return false;
  if (f.brand && a.brand !== f.brand) return false;
  if (f.q) { const q = f.q.trim(); if (q && !((a.title || "") + " " + (a.desc || "") + " " + (a.brand || "") + " " + (a.area || "")).includes(q)) return false; }
  const usd = a.cur === "$";
  if (f.min && (!usd || a.price < +f.min)) return false;
  if (f.max && (!usd || a.price > +f.max)) return false;
  return true;
}
function results() {
  const f = S.filt;
  const featured = S.featured.filter(a => matches(a, f));
  const fIds = new Set(featured.map(a => a.id));
  let r = S.ads.filter(a => !fIds.has(a.id) && matches(a, f));
  const sorters = { new: (x, y) => ms(y.bumpedAt) - ms(x.bumpedAt), low: (x, y) => (x.price || 0) - (y.price || 0), high: (x, y) => (y.price || 0) - (x.price || 0), views: (x, y) => (y.views || 0) - (x.views || 0) };
  r.sort(sorters[f.sort]);
  return [...featured.sort(() => Math.random() - .5), ...r];
}
const searchFilt = s => ({ q: s.q || "", cat: s.cat || "all", city: s.city || "", cond: "", brand: "", min: "", max: "" });
function newAlerts() {
  const out = [];
  S.searches.filter(s => s.alert).forEach(s => {
    S.ads.forEach(a => { if (a.ownerId !== me() && ms(a.createdAt) > ms(s.lastSeen) && matches(a, searchFilt(s))) out.push({ s, a }); });
  });
  return out;
}

// ---------------- عناصر ----------------
const thumb = a => a.thumb ? `<img src="${a.thumb}" alt="" loading="lazy">` : ic(a.cat);
function adCard(a, opts = {}) {
  const fav = S.favs.has(a.id);
  return `<div style="position:relative"><button class="ad ${isFeatured(a) ? "featured" : ""}" data-open="${a.id}">
   <div class="thumb">${thumb(a)}</div>
   <div class="adbody">
     <div class="row" style="gap:4px">${isFeatured(a) ? '<span class="badge">مميز</span>' : ""}${a.cond ? `<span class="badge cond">${condName(a.cond)}</span>` : ""}${a.status === "paused" ? '<span class="badge paused">متوقف</span>' : ""}${a.status === "removed" ? '<span class="badge paused">محذوف من الإدارة</span>' : ""}</div>
     <h3>${esc(a.title)}</h3>
     <div class="price">${fmtPrice(a.price, a.cur)}</div>
     <div class="meta"><span>${esc(a.city)}${a.area ? " · " + esc(a.area) : ""}</span><span>${ago(a.bumpedAt)}</span></div>
   </div></button>
   ${opts.noFav ? "" : `<button class="favbtn" data-fav="${a.id}" aria-pressed="${fav}" aria-label="${fav ? "إزالة من المفضلة" : "أضف للمفضلة"}">${ic(fav ? "heartF" : "heart")}</button>`}</div>`;
}
const header = (title, sub, right = "") => `<header class="top"><div class="brand"><h1>${title}<small>${sub}</small></h1>${right}</div></header>`;
const backHeader = (right = "", label = "رجوع") => `<header class="top"><div class="brand"><button class="back" data-act="back">${ic("back")} ${label}</button><div class="row">${right}</div></div></header>`;
const empty = (t, s, extra = "") => `<div class="empty"><strong>${t}</strong>${s}${extra}</div>`;

// ---------------- الشاشات ----------------
function vHome() {
  const f = S.filt, al = S.user ? newAlerts().length : 0;
  const chips = [];
  if (f.cond) chips.push(["cond", "الحالة: <b>" + condName(f.cond) + "</b>"]);
  if (f.brand) chips.push(["brand", "الماركة: <b>" + esc(f.brand) + "</b>"]);
  if (f.min || f.max) chips.push(["price", "السعر: <b>" + (f.min || "0") + " – " + (f.max || "∞") + " $</b>"]);
  const sortN = { new: "الأحدث", low: "الأرخص", high: "الأغلى", views: "الأكثر مشاهدة" };
  const r = results();
  let list;
  if (!S.adsReady) list = `<div class="loading"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
  else if (!r.length) list = empty("ما في إعلانات مطابقة", S.ads.length ? "جرّب توسّع البحث، أو احفظه ليوصلك تنبيه أول ما ينزل إعلان جديد." : "كن أول واحد بينشر إعلان!", `<div style="margin-top:10px"><button class="btn warm" data-nav="post">${ic("plus")} أضف إعلان</button></div>`);
  else list = r.map(a => adCard(a)).join("") + (S.hasMore ? `<button class="btn ghost more" data-act="more">عرض إعلانات أقدم</button>` : "");
  return `<header class="top">
    <div class="brand"><h1>بيع واشتري<small>في سوريا · إعلانات مبوبة مجانية</small></h1>
      <div class="row">${S.isAdmin ? `<a class="iconbtn" href="admin.html" aria-label="لوحة الإدارة" style="color:inherit">${ic("admin")}</a>` : ""}
      <button class="iconbtn" data-act="notifs" aria-label="التنبيهات">${ic("bell")}${al ? '<span class="dot"></span>' : ""}</button></div></div>
    <div class="searchrow"><label class="search">${ic("search")}<input id="q" type="search" placeholder="ابحث عن سيارة، شقة، موبايل…" value="${esc(f.q)}" enterkeyhint="search"></label>
      <button class="iconbtn" style="width:44px;height:44px" data-act="filters" aria-label="الفلترة">${ic("filter")}</button></div>
  </header>
  <main>
    ${installBar()}
    <div class="cats" role="group" aria-label="الأقسام">${CATS.map(([k, n]) => `<button class="cat" data-cat="${k}" aria-pressed="${f.cat === k}">${ic(k)}<span>${n.split(" ")[0]}</span></button>`).join("")}</div>
    <div class="row" style="align-items:center;justify-content:space-between">
      <button class="chip" data-act="city">${icSm("pin")} ${f.city ? esc(f.city) : "كل المحافظات"}</button>
      <button class="chip" data-act="sort">ترتيب: <b>${sortN[f.sort]}</b></button>
    </div>
    ${chips.length ? `<div class="chips">${chips.map(([k, t]) => `<button class="chip" data-clear="${k}">${t} ✕</button>`).join("")}</div>` : ""}
    <div class="sechead"><h2>${f.cat === "all" ? (f.q ? "نتائج البحث" : "أحدث الإعلانات") : esc(catName(f.cat))}</h2>
      <button data-act="savesearch">حفظ البحث وتفعيل التنبيه</button></div>
    <div class="list">${list}</div>
  </main>`;
}

function vDetail() {
  const a = S.detail;
  if (!a) return backHeader() + `<main><div class="loading"><div class="skel" style="height:260px"></div><div class="skel"></div></div></main>`;
  if (a.missing) return backHeader() + `<main>${empty("الإعلان غير متوفر", "يمكن انحذف أو انباع.")}</main>`;
  const s = a.seller || {}, mine = a.ownerId === me(), fav = S.favs.has(a.id), gi = S.ctx.img || 0, imgs = a.images || [];
  const img = imgs[gi] ? `<img src="${imgs[gi]}" alt="${esc(a.title)}">` : (a.thumb ? `<img src="${a.thumb}" alt="">` : ic(a.cat));
  const right = `<button class="iconbtn" data-fav="${a.id}" aria-pressed="${fav}" aria-label="مفضلة" style="color:${fav ? "var(--danger)" : "inherit"}">${ic(fav ? "heartF" : "heart")}</button>
     ${mine ? "" : `<button class="iconbtn" data-act="report" aria-label="إبلاغ">${ic("flag")}</button>`}`;
  return backHeader(right) + `
  <main>
    <div class="hero-img">${img}</div>
    ${imgs.length > 1 ? `<div class="gal">${imgs.map((u, i) => `<button data-img="${i}" aria-pressed="${i === gi}"><img src="${u}" alt=""></button>`).join("")}</div>` : ""}
    <div style="display:flex;flex-direction:column;gap:4px">
      <div class="row" style="gap:4px">${isFeatured(a) ? '<span class="badge">إعلان مميز</span>' : ""}<span class="badge cond">${esc(catName(a.cat))}</span>${a.cond ? `<span class="badge cond">${condName(a.cond)}</span>` : ""}${a.status !== "active" ? `<span class="badge paused">${a.status === "paused" ? "متوقف" : "محذوف"}</span>` : ""}</div>
      <h2 style="font-family:var(--display);font-size:21px;margin:4px 0 0;line-height:1.4;text-wrap:balance">${esc(a.title)}</h2>
      <div class="price" style="font-size:22px">${fmtPrice(a.price, a.cur)}</div>
      <div class="meta"><span>${icSm("pin")} ${esc(a.city)}${a.area ? " · " + esc(a.area) : ""}</span><span>${ago(a.bumpedAt)}</span><span>${icSm("eye")} ${a.views || 0} مشاهدة</span></div>
    </div>
    <div class="card"><b>الوصف</b><div style="white-space:pre-wrap">${esc(a.desc) || '<span class="meta">ما في وصف.</span>'}</div>
      <dl class="dl">${a.brand ? `<dt>الماركة</dt><dd>${esc(a.brand)}</dd>` : ""}<dt>رقم الإعلان</dt><dd style="font-variant-numeric:tabular-nums;direction:ltr;text-align:right">${a.id.slice(0, 8).toUpperCase()}</dd></dl></div>
    <button class="card seller" data-seller="${a.ownerId}" style="text-align:right;flex-direction:row">
      <div class="avatar">${esc((s.name || a.ownerName || "؟")[0])}</div>
      <div style="flex:1;min-width:0"><b>${esc(s.name || a.ownerName || "مستخدم")}</b>
        <div class="meta">${s.joinedAt ? `<span>عضو منذ ${joinedTxt(s.joinedAt)}</span>` : ""}${a.rating ? `<span><span class="stars">★</span> ${a.rating.avg} (${a.rating.n})</span>` : ""}</div>
        ${s.phoneVerified ? `<span class="verified">${ic("check")} رقم الهاتف موثّق</span>` : `<span class="meta">رقم الهاتف غير موثّق</span>`}</div>
    </button>
    ${mine ? `<div class="notice">${ic("eye")}<div>هذا إعلانك. تقدر تديره من صفحة <b>حسابي</b>.</div></div>` : `
    <div class="row"><button class="btn" data-act="startchat">${ic("chat")} دردشة مع البائع</button>
      ${s.allowCall && s.contactPhone ? `<button class="btn ghost" data-act="call">${ic("phone")} اتصال</button>` : ""}</div>
    ${s.allowCall && s.contactPhone ? "" : `<p class="meta" style="margin:-6px 0 0">البائع بيستقبل التواصل عبر الدردشة فقط، ورقمك ما بيظهر له.</p>`}`}
    ${safetyTip()}
    ${mine ? "" : `<button class="btn danger" data-act="report">${ic("flag")} الإبلاغ عن هذا الإعلان</button>`}
  </main>`;
}
const safetyTip = () => `<div class="tip"><strong>${ic("shield", "width:16px;height:16px;vertical-align:-3px")} نصائح أمان</strong>
  <ul><li>قابل البائع بمكان عام ومزدحم، ويفضّل بالنهار.</li><li>افحص الغرض قبل ما تدفع، وما تحوّل أي مبلغ مقدماً.</li><li>للعقارات والسيارات: تأكد من الأوراق الرسمية عند الجهة المختصة.</li><li>ما تشارك أي رمز تحقق بيوصلك على موبايلك.</li></ul>${S.cfg.safetyNote ? `<p style="margin:6px 0 0">${esc(S.cfg.safetyNote)}</p>` : ""}</div>`;

function vPost() {
  if (!S.user) return header("أضف إعلانك مجاناً", "صوّر، اكتب، وانشر خلال دقائق") + `<main>${empty("سجّل دخول لتنشر إعلان", "التسجيل مجاني وبياخد أقل من دقيقة.", `<div style="margin-top:10px"><button class="btn" data-act="login">تسجيل الدخول</button></div>`)}</main>`;
  if (banned()) return header("أضف إعلان", "") + `<main>${empty("حسابك موقوف", "ما فيك تنشر إعلانات حالياً. تواصل مع إدارة التطبيق.")}</main>`;
  const editing = S.ctx && S.ctx.edit;
  const d = S.draft;
  if (!d) return backHeader() + `<main><div class="loading"><div class="skel"></div></div></main>`;
  const brands = BRANDS[d.cat] || [];
  const p = S.profile || {};
  return (editing ? backHeader("", "تعديل الإعلان") : header("أضف إعلانك مجاناً", "صوّر، اكتب، وانشر خلال دقائق")) + `
  <main>
   <form id="pf" class="card" novalidate>
    <div class="field"><label>الصور (حتى ${MAX_IMGS})</label>
      <div class="photos">${d.imgs.map((u, i) => `<div class="ph"><img src="${u}" alt=""><button type="button" data-rmimg="${i}" aria-label="حذف الصورة">✕</button></div>`).join("")}
      ${d.imgs.length < MAX_IMGS ? `<label class="addph" for="pimg">${ic("camera")}<span>إضافة صورة</span></label>` : ""}</div>
      <input id="pimg" type="file" accept="image/*" multiple hidden>
      <span class="meta">أول صورة بتطلع بالقائمة. منضغط الصور تلقائياً لتنرفع بسرعة.</span></div>
    <div class="field"><label for="pcat">القسم</label><select id="pcat">${CATS.slice(1).map(([k, n]) => `<option value="${k}" ${d.cat === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="field"><label for="ptitle">عنوان الإعلان</label><input id="ptitle" maxlength="80" placeholder="مثلاً: هيونداي أفانتي 2012 بحالة ممتازة" value="${esc(d.title)}"></div>
    <div class="grid2">
      <div class="field"><label for="pprice">السعر</label><input id="pprice" inputmode="numeric" placeholder="0" value="${esc(d.price)}"></div>
      <div class="field"><label for="pcur">العملة</label><select id="pcur"><option value="$" ${d.cur === "$" ? "selected" : ""}>دولار $</option><option value="ل.س" ${d.cur === "ل.س" ? "selected" : ""}>ليرة سورية</option><option value="" ${d.cur === "" ? "selected" : ""}>حسب الاتفاق</option></select></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="pcity">المحافظة</label><select id="pcity">${CITIES.map(c => `<option ${d.city === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label for="parea">المنطقة / الحي</label><input id="parea" maxlength="40" placeholder="اختياري" value="${esc(d.area)}"></div>
    </div>
    ${COND_CATS.includes(d.cat) ? `<div class="field"><label>الحالة</label><div class="seg">${["new", "used"].map(c => `<button type="button" data-cond="${c}" aria-pressed="${d.cond === c}">${condName(c)}</button>`).join("")}</div></div>` : ""}
    ${brands.length ? `<div class="field"><label for="pbrand">الماركة</label><select id="pbrand"><option value="">اختر</option>${brands.map(b => `<option ${d.brand === b ? "selected" : ""}>${b}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label for="pdesc">الوصف</label><textarea id="pdesc" rows="5" maxlength="3000" placeholder="اذكر الحالة، المواصفات، وسبب البيع">${esc(d.desc)}</textarea></div>
    <div class="notice">${ic("phone")}<div>${p.allowCall && p.contactPhone ? `زر الاتصال ظاهر على إعلاناتك بالرقم <b dir="ltr">${esc(p.contactPhone)}</b>.` : "المشترين بيتواصلوا معك بالدردشة فقط."} فيك تغيّر هالشي من <b>حسابي</b>.</div></div>
    <p id="perr" class="meta" style="color:var(--danger);margin:0" hidden></p>
    <button class="btn warm" type="submit" ${S.busy ? "disabled" : ""}>${S.busy ? "عم ننشر…" : editing ? "حفظ التعديلات" : "انشر الإعلان"}</button>
   </form>
  </main>`;
}

function vFavs() {
  if (!S.user) return header("المفضلة", "إعلاناتك المحفوظة وعمليات البحث") + `<main>${empty("سجّل دخول لتحفظ إعلانات", "المفضلة وتنبيهات البحث بتنحفظ بحسابك وبتلاقيها على أي جهاز.", `<div style="margin-top:10px"><button class="btn" data-act="login">تسجيل الدخول</button></div>`)}</main>`;
  const favs = S.favAds;
  return header("المفضلة", "إعلاناتك المحفوظة وعمليات البحث") + `
  <main>
   <div class="sechead"><h2>عمليات بحث محفوظة</h2><span>${S.searches.length}</span></div>
   ${S.searches.length ? `<div class="list">${S.searches.map(s => {
     const n = S.ads.filter(a => matches(a, searchFilt(s))).length;
     const nw = S.ads.filter(a => a.ownerId !== me() && ms(a.createdAt) > ms(s.lastSeen) && matches(a, searchFilt(s))).length;
     return `<div class="card saved"><button class="t" data-runsaved="${s.id}" style="background:none;border:0;padding:0;text-align:right;flex:1;min-width:0">
       <b>${esc(s.q || "كل الإعلانات")}${s.cat && s.cat !== "all" ? " · " + esc(catName(s.cat)) : ""} ${nw ? `<span class="unread" style="display:inline-grid">${nw} جديد</span>` : ""}</b><span>${s.city ? esc(s.city) : "كل المحافظات"} · ${n} إعلان حالياً</span></button>
       <div class="row" style="align-items:center"><span class="meta">تنبيه</span><button class="switch" role="switch" aria-checked="${!!s.alert}" data-alert="${s.id}" aria-label="تنبيهات"></button>
       <button class="btn danger sm" data-delsaved="${s.id}">حذف</button></div></div>`;
   }).join("")}</div>` : empty("ما في بحث محفوظ", "من الصفحة الرئيسية اضغط «حفظ البحث» ليوصلك تنبيه بالإعلانات الجديدة.")}
   <div class="sechead"><h2>إعلانات مفضّلة</h2><span>${S.favs.size}</span></div>
   <div class="list">${favs === null ? `<div class="loading"><div class="skel"></div></div>` : favs.length ? favs.map(a => adCard(a)).join("") : empty("ما في إعلانات بالمفضلة", "اضغط على القلب بأي إعلان لتحفظه هون.")}</div>
  </main>`;
}
async function loadFavAds() {
  S.favAds = null; if (S.view === "favs") render();
  const ids = [...S.favs];
  const out = await Promise.all(ids.map(async id => {
    if (S.cache.has(id)) return S.cache.get(id);
    try { const d = await getDoc(doc(db, "ads", id)); return d.exists() ? adFrom(d) : null; } catch (_) { return null; }
  }));
  S.favAds = out.filter(Boolean);
  if (S.view === "favs") render();
}

function vChats() {
  if (!S.user) return header("الرسائل", "تواصل بدون ما تشارك رقمك") + `<main>${empty("سجّل دخول لتشوف رسائلك", "", `<div style="margin-top:10px"><button class="btn" data-act="login">تسجيل الدخول</button></div>`)}</main>`;
  return header("الرسائل", "تواصل بدون ما تشارك رقمك") + `
  <main><div class="list chatlist">${S.chats.length ? S.chats.map(c => {
    const other = c.participants.find(p => p !== me());
    const name = (c.names || {})[other] || "مستخدم", un = (c.unread || {})[me()] || 0;
    return `<button class="ci" data-chat="${c.id}"><div class="thumb" style="width:52px;height:52px">${c.adThumb ? `<img src="${c.adThumb}" alt="">` : ic("chat")}</div>
      <div class="t"><b>${esc(name)}</b><span>${esc(c.adTitle)}</span><span>${c.lastFrom === me() ? "أنت: " : ""}${esc(c.lastMsg || "")}</span></div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span class="meta">${ago(c.lastAt)}</span>${un ? `<span class="unread">${un}</span>` : ""}</div></button>`;
  }).join("") : empty("ما في محادثات بعد", "افتح أي إعلان واضغط «دردشة مع البائع».")}</div></main>`;
}

function vChat() {
  const c = S.chats.find(x => x.id === S.ctx.id) || S.ctx.chat;
  if (!c) return backHeader() + `<main><div class="loading"><div class="skel"></div></div></main>`;
  const other = c.participants.find(p => p !== me());
  const name = (c.names || {})[other] || "مستخدم";
  const op = S.ctx.otherProfile || {};
  return `<header class="top"><div class="brand"><button class="back" data-act="back">${ic("back")} ${esc(name)}</button>
    ${op.allowCall && op.contactPhone ? `<button class="iconbtn" data-act="callchat" aria-label="اتصال">${ic("phone")}</button>` : ""}</div>
    <button data-open="${c.adId}" style="padding:6px;display:flex;gap:10px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;text-align:right">
     <div class="thumb" style="width:40px;height:40px">${c.adThumb ? `<img src="${c.adThumb}" alt="">` : ic("other")}</div>
     <div style="min-width:0;flex:1"><b style="font-size:13.5px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.adTitle)}</b><span class="meta">اضغط لفتح الإعلان</span></div></button></header>
  <main style="gap:8px">
   <div class="notice">${ic("shield")}<div>رقمك مخفي. لا تحوّل أي مبلغ قبل ما تشوف الغرض بعينك.</div></div>
   <div class="msgs" id="msgs">${S.msgs.map(m => `<div class="msg ${m.from === me() ? "me" : "them"}">${esc(m.text)}<time>${new Date(ms(m.at)).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("") || `<p class="meta" style="text-align:center">ابدأ المحادثة برسالة.</p>`}</div>
   <div class="quick">${["لسا متوفر؟", "آخر سعر؟", "وين بقدر شوفه؟", "في توصيل؟"].map(q => `<button data-quick="${q}">${q}</button>`).join("")}</div>
   <form class="composer" id="cf"><input id="cm" placeholder="اكتب رسالة…" autocomplete="off" maxlength="1000"><button class="btn" type="submit" aria-label="إرسال">${ic("send")}</button></form>
  </main>`;
}

function vProfile() {
  if (!S.user) return header("حسابي", "إدارة إعلاناتك وملفك") + `<main>${empty("أهلاً فيك", "سجّل دخول لتنشر إعلانات وتتابعها وتتواصل مع البائعين.", `<div style="margin-top:10px"><button class="btn" data-act="login">تسجيل الدخول / إنشاء حساب</button></div>`)}${safetyTip()}</main>`;
  const p = S.profile || {}, mine = S.myAds;
  const tv = mine.reduce((s, a) => s + (a.views || 0), 0);
  return header("حسابي", "إدارة إعلاناتك وملفك", `<button class="iconbtn" data-act="logout" aria-label="تسجيل الخروج">${ic("logout")}</button>`) + `
  <main>
   ${p.banned ? `<div class="notice" style="background:var(--apricot-soft)">${ic("shield")}<div>حسابك موقوف من الإدارة. إعلاناتك مخفية وما فيك تنشر أو تراسل.</div></div>` : ""}
   <div class="card"><div class="seller"><div class="avatar">${esc((p.name || "أ")[0])}</div><div style="flex:1;min-width:0">
     <input id="myname" aria-label="الاسم" maxlength="40" value="${esc(p.name || "")}" style="font-weight:700;border:0;background:none;padding:0;width:100%;outline:0">
     <div class="meta">${p.joinedAt ? "عضو منذ " + joinedTxt(p.joinedAt) : ""} · <span dir="ltr">${esc(S.user.email || S.user.phoneNumber || "")}</span></div>
     ${p.phoneVerified ? `<span class="verified">${ic("check")} رقم الهاتف موثّق</span>` : `<button class="btn ghost sm" data-act="verify" style="margin-top:4px">${ic("check")} وثّق رقم هاتفك</button>`}</div></div>
     <div class="stats"><div><b>${mine.filter(a => a.status === "active").length}</b><span>إعلانات فعّالة</span></div><div><b>${tv}</b><span>مشاهدات</span></div><div><b>${S.favs.size}</b><span>بالمفضلة</span></div></div></div>
   ${S.isAdmin ? `<a class="btn" href="admin.html">${ic("admin")} لوحة الإدارة</a>` : ""}
   <div class="sechead"><h2>إعلاناتي</h2><span>${mine.length}</span></div>
   ${mine.length ? mine.map(a => {
     const chatsN = S.chats.filter(c => c.adId === a.id).length;
     const pend = (S.ctx && S.ctx.pendingFeature || {})[a.id];
     return `<div class="card myad">${adCard(a, { noFav: true })}
     <div class="meta"><span>${icSm("eye")} ${a.views || 0} مشاهدة</span><span>${chatsN} محادثة</span><span>نُشر ${ago(a.createdAt)}</span>${isFeatured(a) ? `<span>مميز حتى ${new Date(a.featuredUntil).toLocaleDateString("ar-SY")}</span>` : ""}</div>
     ${a.status === "removed" ? `<p class="meta" style="color:var(--danger);margin:0">انحذف هالإعلان من الإدارة${a.removedReason ? ": " + esc(a.removedReason) : ""}.</p>` : `<div class="row">
       <button class="btn ghost sm" data-edit="${a.id}">تعديل</button>
       <button class="btn ghost sm" data-renew="${a.id}">تجديد</button>
       <button class="btn ghost sm" data-pause="${a.id}">${a.status === "paused" ? "تفعيل" : "إيقاف"}</button>
       ${isFeatured(a) ? "" : pend ? `<span class="status pending" style="align-self:center">طلب التمييز قيد المراجعة</span>` : `<button class="btn warm sm" data-feature="${a.id}">${ic("star")} تمييز</button>`}
       <button class="btn danger sm" data-del="${a.id}">حذف</button></div>`}
     <div data-confirm="${a.id}" hidden class="notice" style="background:var(--apricot-soft)"><div style="flex:1">متأكد بدك تحذف الإعلان؟ ما فيك ترجعه.</div><button class="btn danger sm" data-delyes="${a.id}">احذف</button><button class="btn ghost sm" data-delno="${a.id}">إلغاء</button></div>
   </div>`; }).join("") : empty("ما نشرت ولا إعلان بعد", "", `<div style="margin-top:10px"><button class="btn warm" data-nav="post">${ic("plus")} أضف إعلانك الأول</button></div>`)}
   <div class="card"><b>إعدادات التواصل</b>
     <div class="saved"><div class="t"><b>إظهار زر الاتصال على إعلاناتي</b><span>${p.phoneVerified ? "بيظهر رقمك الموثّق للمشترين." : "لازم توثّق رقمك أول."}</span></div>
     <button class="switch" role="switch" aria-checked="${!!p.allowCall}" data-act="togglecall" aria-label="السماح بالاتصال"></button></div></div>
   <button class="btn ghost" data-act="safety">${ic("shield")} نصائح الأمان للبيع والشراء</button>
  </main>`;
}

function vSeller() {
  const sp = S.sellerPage;
  if (!sp) return backHeader() + `<main><div class="loading"><div class="skel"></div></div></main>`;
  const s = sp.profile || { name: "مستخدم" };
  const r = sp.rating;
  return backHeader() + `
  <main><div class="card" style="align-items:center;text-align:center"><div class="avatar" style="width:72px;height:72px;font-size:30px">${esc((s.name || "؟")[0])}</div>
   <h2 style="font-family:var(--display);margin:0">${esc(s.name)}</h2>
   <div class="meta" style="justify-content:center">${s.joinedAt ? `<span>عضو منذ ${joinedTxt(s.joinedAt)}</span>` : ""}<span>${sp.ads.length} إعلان</span></div>
   ${s.phoneVerified ? `<span class="verified">${ic("check")} رقم الهاتف موثّق</span>` : `<span class="meta">رقم الهاتف غير موثّق</span>`}
   ${r.n ? `<div><span class="stars">${"★".repeat(Math.round(r.avg))}${"☆".repeat(5 - Math.round(r.avg))}</span> <b>${r.avg}</b> <span class="meta">من ${r.n} تقييم</span></div>` : `<span class="meta">ما في تقييمات بعد</span>`}
   ${sp.id !== me() ? `<button class="btn ghost sm" data-act="rate">${sp.myRating ? "عدّل تقييمك" : "قيّم هذا البائع"}</button>` : ""}</div>
   ${sp.reviews.length ? `<div class="card"><b>آخر التقييمات</b>${sp.reviews.slice(0, 10).map(x => `<div><span class="stars">${"★".repeat(x.stars)}</span> <span class="meta">${ago(x.at)}</span>${x.text ? `<div>${esc(x.text)}</div>` : ""}</div>`).join("")}</div>` : ""}
   <div class="sechead"><h2>إعلانات البائع</h2></div><div class="list">${sp.ads.map(a => adCard(a)).join("") || empty("ما في إعلانات فعّالة", "")}</div></main>`;
}

const VIEWS = { home: vHome, detail: vDetail, post: vPost, favs: vFavs, chats: vChats, chat: vChat, profile: vProfile, seller: vSeller };

// ---------------- التنقل والرسم ----------------
function go(view, ctx, push = true) {
  if (push) stack.push({ view: S.view, ctx: S.ctx });
  leaveView();
  S.view = view; S.ctx = ctx || null;
  enterView(); render(); window.scrollTo(0, 0);
}
function back() { const p = stack.pop() || { view: "home" }; leaveView(); S.view = p.view; S.ctx = p.ctx; enterView(); render(); window.scrollTo(0, 0); }
function leaveView() { if (unsubChat) { unsubChat(); unsubChat = null; } if (S.view === "post") S.draft = null; }
function enterView() {
  if (S.view === "detail") openDetail(S.ctx.id);
  if (S.view === "post") initDraft();
  if (S.view === "favs" && S.user) loadFavAds();
  if (S.view === "seller") loadSeller(S.ctx.seller);
  if (S.view === "chat") openChat(S.ctx.id);
  if (S.view === "profile" && S.user) loadPendingFeatures();
}

function render() {
  if (S.view === "post") syncDraft();
  const ae = document.activeElement, keep = ae && ae.id && ["INPUT", "TEXTAREA"].includes(ae.tagName) ? { id: ae.id, v: ae.value, s: ae.selectionStart } : null;
  $("#app").innerHTML = VIEWS[S.view]();
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.s, keep.s); } catch (_) {} } }
  const top = { home: "home", detail: "home", seller: "home", favs: "favs", post: "post", chats: "chats", chat: "chats", profile: "profile" }[S.view];
  const unread = S.chats.reduce((s, c) => s + ((c.unread || {})[me()] || 0), 0);
  $("#nav").innerHTML = [["home", "الرئيسية", "home"], ["favs", "المفضلة", "heart"], ["post", "أضف إعلان", "plus"], ["chats", "الرسائل", "chat"], ["profile", "حسابي", "user"]].map(([k, n, i]) =>
    k === "post" ? `<button class="post" data-nav="post" ${top === k ? 'aria-current="page"' : ""}><span class="plus">${ic(i)}</span>${n}</button>` :
    `<button data-nav="${k}" ${top === k ? 'aria-current="page"' : ""}>${ic(i)}${n}${k === "chats" && unread ? '<span class="dot"></span>' : ""}</button>`).join("");
  if (S.view === "chat") { const m = $("#msgs"); m && m.lastElementChild && m.lastElementChild.scrollIntoView({ block: "end" }); }
  document.title = unread ? `(${unread}) بيع واشتري في سوريا` : "بيع واشتري في سوريا";
}

// ---------------- تحميل التفاصيل ----------------
const viewed = new Set(JSON.parse(sessionStorage.getItem("viewed") || "[]"));
async function openDetail(id) {
  S.detail = null;
  try {
    const d = await getDoc(doc(db, "ads", id));
    if (!d.exists()) { S.detail = { missing: true }; render(); return; }
    const a = adFrom(d);
    const [imgs, seller, rating] = await Promise.all([
      getDocs(collection(db, "ads", id, "images")).then(s => s.docs.sort((x, y) => (x.data().i || 0) - (y.data().i || 0)).map(x => x.data().data)).catch(() => []),
      getDoc(doc(db, "users", a.ownerId)).then(x => x.exists() ? x.data() : null).catch(() => null),
      loadRating(a.ownerId)
    ]);
    if (S.view !== "detail" || S.ctx.id !== id) return;
    S.detail = { ...a, images: imgs, seller, rating: rating.n ? rating : null };
    render();
    if (a.ownerId !== me() && !viewed.has(id) && a.status === "active") {
      viewed.add(id); try { sessionStorage.setItem("viewed", JSON.stringify([...viewed])); } catch (_) {}
      updateDoc(doc(db, "ads", id), { views: increment(1) }).catch(() => {});
    }
  } catch (e) { S.detail = { missing: true }; render(); }
}
async function loadRating(uid) {
  try {
    const s = await getDocs(collection(db, "users", uid, "ratings"));
    const list = s.docs.map(d => ({ by: d.id, ...d.data() })).sort((a, b) => ms(b.at) - ms(a.at));
    const n = list.length, avg = n ? Math.round(list.reduce((t, x) => t + x.stars, 0) / n * 10) / 10 : 0;
    return { n, avg, list };
  } catch (_) { return { n: 0, avg: 0, list: [] }; }
}
async function loadSeller(id) {
  S.sellerPage = null;
  const [p, ads, r] = await Promise.all([
    getDoc(doc(db, "users", id)).then(x => x.exists() ? x.data() : null).catch(() => null),
    getDocs(query(collection(db, "ads"), where("ownerId", "==", id), where("status", "==", "active"))).then(s => s.docs.map(adFrom)).catch(() => []),
    loadRating(id)
  ]);
  if (S.view !== "seller") return;
  S.sellerPage = { id, profile: p, ads: ads.sort((a, b) => ms(b.bumpedAt) - ms(a.bumpedAt)), rating: r, reviews: r.list, myRating: r.list.find(x => x.by === me()) };
  render();
}

// ---------------- الإعلان: نشر وتعديل ----------------
async function initDraft() {
  const id = S.ctx && S.ctx.edit;
  if (!id) { S.draft = { cat: "cars", title: "", price: "", cur: "$", city: S.filt.city || "دمشق", area: "", cond: "used", brand: "", desc: "", imgs: [] }; return; }
  const a = S.cache.get(id);
  const imgs = await getDocs(collection(db, "ads", id, "images")).then(s => s.docs.sort((x, y) => (x.data().i || 0) - (y.data().i || 0)).map(x => x.data().data)).catch(() => []);
  S.draft = { cat: a.cat, title: a.title, price: a.price ? String(a.price) : "", cur: a.cur, city: a.city, area: a.area || "", cond: a.cond || "", brand: a.brand || "", desc: a.desc || "", imgs, origImgCount: imgs.length };
  render();
}
function syncDraft() {
  const d = S.draft; if (!d || !$("#pf")) return;
  const v = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
  d.cat = v("pcat") ?? d.cat; d.title = v("ptitle") ?? d.title; d.price = v("pprice") ?? d.price; d.cur = v("pcur") ?? d.cur;
  d.city = v("pcity") ?? d.city; d.area = v("parea") ?? d.area; d.brand = v("pbrand") ?? (BRANDS[d.cat] ? d.brand : ""); d.desc = v("pdesc") ?? d.desc;
}
async function submitAd() {
  syncDraft();
  const d = S.draft, err = $("#perr");
  const show = t => { err.textContent = t; err.hidden = false; err.scrollIntoView({ block: "center" }); };
  const title = d.title.trim();
  if (title.length < 5) return show("اكتب عنوان واضح من 5 أحرف على الأقل.");
  const price = +String(d.price).replace(/[^\d]/g, "") || 0;
  if (d.cur !== "" && !price && !["jobs", "services"].includes(d.cat)) return show("حط السعر، أو اختار «حسب الاتفاق» من خانة العملة.");
  if (!d.imgs.length && !["jobs", "services"].includes(d.cat)) return show("أضف صورة وحدة على الأقل، الإعلانات المصوّرة بتنباع أسرع.");
  S.busy = true; render();
  const editing = S.ctx && S.ctx.edit;
  const body = {
    cat: d.cat, title, price, cur: d.cur, city: d.city, area: d.area.trim(), cond: COND_CATS.includes(d.cat) ? (d.cond || "used") : "",
    brand: BRANDS[d.cat] ? d.brand : "", desc: d.desc.trim(), thumb: d.imgs[0] ? await thumbFromDataUrl(d.imgs[0]) : "", imageCount: d.imgs.length,
    ownerName: (S.profile && S.profile.name) || "مستخدم"
  };
  try {
    let id = editing;
    if (editing) {
      await updateDoc(doc(db, "ads", id), body);
    } else {
      const ref = doc(collection(db, "ads"));
      id = ref.id;
      await setDoc(ref, { ...body, ownerId: me(), status: "active", views: 0, featuredUntil: 0, createdAt: serverTimestamp(), bumpedAt: serverTimestamp() });
    }
    // الصور: كل صورة بمستند منفصل
    for (let i = 0; i < d.imgs.length; i++) await setDoc(doc(db, "ads", id, "images", "i" + i), { i, data: d.imgs[i] });
    for (let i = d.imgs.length; i < (d.origImgCount || 0); i++) await deleteDoc(doc(db, "ads", id, "images", "i" + i));
    S.busy = false; S.draft = null;
    if (editing) { toast("انحفظت التعديلات"); back(); }
    else { stack.length = 0; go("detail", { id }, false); toast("انتشر إعلانك"); }
  } catch (e) { S.busy = false; render(); show(errMsg(e)); }
}
async function deleteAd(id) {
  try {
    const imgs = await getDocs(collection(db, "ads", id, "images"));
    const b = writeBatch(db); imgs.docs.forEach(x => b.delete(x.ref)); b.delete(doc(db, "ads", id)); await b.commit();
    toast("انحذف الإعلان");
  } catch (e) { toast(errMsg(e)); }
}
async function loadPendingFeatures() {
  try {
    const s = await getDocs(query(collection(db, "featureRequests"), where("ownerId", "==", me()), where("status", "==", "pending")));
    const m = {}; s.docs.forEach(d => m[d.data().adId] = true);
    if (S.view === "profile") { S.ctx = { ...(S.ctx || {}), pendingFeature: m }; render(); }
  } catch (_) {}
}

// ---------------- الدردشة ----------------
async function startChat(a) {
  const id = a.id + "_" + me();
  const existing = S.chats.find(c => c.id === id);
  if (!existing) {
    try {
      const ref = doc(db, "chats", id), snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          adId: a.id, adTitle: a.title, adThumb: a.thumb || "", participants: [me(), a.ownerId], buyerId: me(), sellerId: a.ownerId,
          names: { [me()]: (S.profile && S.profile.name) || "مستخدم", [a.ownerId]: (a.seller && a.seller.name) || a.ownerName || "البائع" },
          unread: { [me()]: 0, [a.ownerId]: 0 }, lastMsg: "", lastFrom: "", lastAt: serverTimestamp(), createdAt: serverTimestamp()
        });
      }
    } catch (e) { toast(errMsg(e)); return; }
  }
  go("chat", { id });
}
async function openChat(id) {
  S.msgs = [];
  unsubChat = onSnapshot(query(collection(db, "chats", id, "messages"), orderBy("at", "asc"), limit(500)), s => {
    S.msgs = s.docs.map(d => d.data()); if (S.view === "chat") render();
  }, e => toast(errMsg(e)));
  let c = S.chats.find(x => x.id === id);
  if (!c) { try { const d = await getDoc(doc(db, "chats", id)); if (d.exists()) c = { id, ...d.data() }; S.ctx.chat = c; } catch (_) {} }
  if (!c) return;
  if ((c.unread || {})[me()]) updateDoc(doc(db, "chats", id), { ["unread." + me()]: 0 }).catch(() => {});
  const other = c.participants.find(p => p !== me());
  getDoc(doc(db, "users", other)).then(x => { if (S.view === "chat" && S.ctx.id === id) { S.ctx.otherProfile = x.data(); render(); } }).catch(() => {});
  render();
}
async function sendMsg(text) {
  const id = S.ctx.id, c = S.chats.find(x => x.id === id) || S.ctx.chat;
  if (!c) return;
  const other = c.participants.find(p => p !== me());
  try {
    await addDoc(collection(db, "chats", id, "messages"), { from: me(), text, at: serverTimestamp() });
    await updateDoc(doc(db, "chats", id), { lastMsg: text.slice(0, 120), lastFrom: me(), lastAt: serverTimestamp(), ["unread." + other]: increment(1), ["unread." + me()]: 0 });
  } catch (e) { toast(errMsg(e)); }
}

// ---------------- النوافذ ----------------
function authSheet(after) {
  let mode = "login";
  sheet(`<h3>أهلاً فيك</h3><p class="meta" style="margin:0">سجّل دخول لتنشر إعلانات، تحفظ المفضلة، وتراسل البائعين.</p>
   <button class="btn gbtn" id="gsign"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" fill="#4285F4"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" fill="#34A853"/><path d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9L6.4 14Z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5L6.4 10C7.2 7.8 9.4 6 12 6Z" fill="#EA4335"/></svg> المتابعة بحساب Google</button>
   <div class="or">أو بالإيميل</div>
   <div class="seg authtabs"><button type="button" data-m="login" aria-pressed="true">تسجيل الدخول</button><button type="button" data-m="signup" aria-pressed="false">حساب جديد</button></div>
   <form id="af" style="display:flex;flex-direction:column;gap:10px" novalidate>
     <div class="field" id="anamef" hidden><label for="aname">اسمك</label><input id="aname" maxlength="40" autocomplete="name"></div>
     <div class="field"><label for="aemail">الإيميل</label><input id="aemail" type="email" dir="ltr" autocomplete="email"></div>
     <div class="field"><label for="apass">كلمة السر</label><input id="apass" type="password" dir="ltr" autocomplete="current-password"></div>
     <p id="aerr" class="meta" style="color:var(--danger);margin:0" hidden></p>
     <button class="btn" type="submit" id="ago">دخول</button>
     <button class="linkbtn" type="button" id="aforgot">نسيت كلمة السر؟</button>
   </form>`, (el, close) => {
    const err = t => { const e = el.querySelector("#aerr"); e.textContent = t; e.hidden = !t; };
    const done = () => { close(); after && setTimeout(after, 400); };
    el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
      mode = b.dataset.m; el.querySelectorAll("[data-m]").forEach(x => x.setAttribute("aria-pressed", x === b));
      el.querySelector("#anamef").hidden = mode !== "signup"; el.querySelector("#ago").textContent = mode === "signup" ? "إنشاء الحساب" : "دخول";
      el.querySelector("#aforgot").hidden = mode === "signup"; err("");
    });
    el.querySelector("#gsign").onclick = async () => {
      const prov = new GoogleAuthProvider();
      try { await signInWithPopup(auth, prov); done(); }
      catch (e) { if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) signInWithRedirect(auth, prov); else if (e.code !== "auth/popup-closed-by-user") err(errMsg(e)); }
    };
    el.querySelector("#aforgot").onclick = async () => {
      const em = el.querySelector("#aemail").value.trim(); if (!em) return err("اكتب إيميلك أول، وبعدين اضغط «نسيت كلمة السر».");
      try { await sendPasswordResetEmail(auth, em); err(""); toast("بعتنالك رابط لتغيير كلمة السر على إيميلك"); } catch (e) { err(errMsg(e)); }
    };
    el.querySelector("#af").onsubmit = async ev => {
      ev.preventDefault();
      const em = el.querySelector("#aemail").value.trim(), pw = el.querySelector("#apass").value, nm = el.querySelector("#aname").value.trim();
      if (mode === "signup" && nm.length < 2) return err("اكتب اسمك (حرفين على الأقل).");
      const btn = el.querySelector("#ago"); btn.disabled = true;
      try {
        if (mode === "signup") { pendingName = nm; const c = await createUserWithEmailAndPassword(auth, em, pw); updateProfile(c.user, { displayName: nm }).catch(() => {}); }
        else await signInWithEmailAndPassword(auth, em, pw);
        done();
      } catch (e) { err(errMsg(e)); btn.disabled = false; }
    };
  });
}
function filtersSheet() {
  const f = S.filt; const brands = f.cat !== "all" ? (BRANDS[f.cat] || []) : [...new Set(Object.values(BRANDS).flat())];
  sheet(`<h3>الفلترة</h3>
   <div class="field"><label for="fcat">القسم</label><select id="fcat">${CATS.map(([k, n]) => `<option value="${k}" ${f.cat === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
   <div class="field"><label for="fcity">الموقع</label><select id="fcity"><option value="">كل المحافظات</option>${CITIES.map(c => `<option ${f.city === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
   <div class="field"><label>الحالة</label><div class="seg" id="fcond">${[["", "الكل"], ["new", "جديد"], ["used", "مستعمل"]].map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${f.cond === k}">${n}</button>`).join("")}</div></div>
   <div class="field"><label for="fbrand">الماركة</label><select id="fbrand"><option value="">الكل</option>${brands.map(b => `<option ${f.brand === b ? "selected" : ""}>${b}</option>`).join("")}</select></div>
   <div class="field"><label>السعر بالدولار</label><div class="grid2"><input id="fmin" inputmode="numeric" placeholder="من" value="${esc(f.min)}"><input id="fmax" inputmode="numeric" placeholder="إلى" value="${esc(f.max)}"></div></div>
   <div class="row"><button class="btn" id="fapply">عرض النتائج</button><button class="btn ghost" id="freset">مسح الكل</button></div>`, (el, close) => {
    let cond = f.cond;
    el.querySelectorAll("#fcond button").forEach(b => b.onclick = () => { cond = b.dataset.v; el.querySelectorAll("#fcond button").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    el.querySelector("#fapply").onclick = () => { Object.assign(S.filt, { cat: el.querySelector("#fcat").value, city: el.querySelector("#fcity").value, cond, brand: el.querySelector("#fbrand").value, min: el.querySelector("#fmin").value.replace(/\D/g, ""), max: el.querySelector("#fmax").value.replace(/\D/g, "") }); saveCity(); close(); render(); };
    el.querySelector("#freset").onclick = () => { Object.assign(S.filt, { cat: "all", city: "", cond: "", brand: "", min: "", max: "" }); saveCity(); close(); render(); };
  });
}
const saveCity = () => { try { localStorage.setItem("city", S.filt.city); } catch (_) {} };
function citySheet() {
  sheet(`<h3>اختر محافظتك</h3><p class="meta" style="margin:0">منعرض لك إعلانات منطقتك، ومنتذكر اختيارك للمرة الجاية.</p>
   <div class="grid2">${["", ...CITIES].map(c => `<button class="opt" data-c="${c}" style="justify-content:center;${S.filt.city === c ? "border-color:var(--accent);color:var(--accent);font-weight:700" : ""}">${c || "كل المحافظات"}</button>`).join("")}</div>`, (el, close) => {
    el.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { S.filt.city = b.dataset.c; saveCity(); close(); render(); });
  });
}
function sortSheet() {
  sheet(`<h3>ترتيب النتائج</h3>${[["new", "الأحدث"], ["low", "السعر: من الأقل"], ["high", "السعر: من الأعلى"], ["views", "الأكثر مشاهدة"]].map(([k, n]) => `<label class="opt"><input type="radio" name="srt" value="${k}" ${S.filt.sort === k ? "checked" : ""}> ${n}</label>`).join("")}
   <p class="meta" style="margin:0">الإعلانات المميزة بتضل بأعلى النتائج.</p>`, (el, close) => { el.querySelectorAll("input").forEach(i => i.onchange = () => { S.filt.sort = i.value; close(); render(); }); });
}
function reportSheet(a) {
  sheet(`<h3>الإبلاغ عن إعلان</h3><p class="meta" style="margin:0">إدارة التطبيق بتراجع البلاغ، وما منكشف هويتك للمعلن.</p>
   ${REPORT_REASONS.map((r, i) => `<label class="opt"><input type="radio" name="rr" value="${r}" ${i === 0 ? "checked" : ""}> ${r}</label>`).join("")}
   <div class="field"><label for="rnote">تفاصيل إضافية (اختياري)</label><textarea id="rnote" rows="2" maxlength="500"></textarea></div>
   <div class="tip"><strong>انتبه:</strong> أي حدا بيطلب منك تحويل عربون قبل ما تشوف الغرض، أو رمز تحقق وصلك على موبايلك، غالباً محتال.</div>
   <div class="row"><button class="btn" id="rsend">إرسال البلاغ</button><button class="btn ghost" data-close>إلغاء</button></div>`, (el, close) => {
    el.querySelector("#rsend").onclick = async () => {
      try {
        await addDoc(collection(db, "reports"), { adId: a.id, adTitle: a.title, adOwnerId: a.ownerId, reporterId: me(), reason: el.querySelector("input:checked").value, note: el.querySelector("#rnote").value.trim(), status: "open", at: serverTimestamp() });
        close(); toast("وصل بلاغك للإدارة، شكراً لمساعدتك");
      } catch (e) { toast(errMsg(e)); }
    };
  });
}
function featureSheet(id) {
  const a = S.cache.get(id), plans = S.cfg.featurePlans || [];
  sheet(`<h3>ميّز إعلانك</h3><p class="meta" style="margin:0">الإعلان المميز بيطلع بأعلى نتائج البحث بإطار ملوّن، وبيجيب مشاهدات أكتر.</p>
   ${plans.map((p, i) => `<label class="opt plan"><span><input type="radio" name="fp" value="${i}" ${i === Math.min(1, plans.length - 1) ? "checked" : ""}> ${p.days} ${p.days > 10 ? "يوم" : "أيام"}</span><b>${esc(p.price)}</b></label>`).join("")}
   <div class="notice">${ic("shield")}<div><b>طريقة الدفع:</b> ${S.cfg.paymentInfo ? esc(S.cfg.paymentInfo) : "رح تتواصل معك الإدارة لتأكيد الدفع."}<br>بعد ما تدفع، الإدارة بتفعّل التمييز وبيظهر على إعلانك.</div></div>
   <div class="field"><label for="fnote">رقم العملية أو ملاحظة للإدارة (اختياري)</label><input id="fnote" maxlength="120"></div>
   <div class="row"><button class="btn warm" id="fpay">${ic("star")} أرسل طلب التمييز</button><button class="btn ghost" data-close>إلغاء</button></div>`, (el, close) => {
    el.querySelector("#fpay").onclick = async () => {
      const p = plans[+(el.querySelector("input[name=fp]:checked") || { value: 0 }).value];
      try {
        await addDoc(collection(db, "featureRequests"), { adId: id, adTitle: a.title, ownerId: me(), ownerName: (S.profile && S.profile.name) || "", days: p.days, price: p.price, note: el.querySelector("#fnote").value.trim(), status: "pending", at: serverTimestamp() });
        close(); toast("وصل طلبك للإدارة"); loadPendingFeatures();
      } catch (e) { toast(errMsg(e)); }
    };
  });
}
function safetySheet() {
  sheet(`<h3>نصائح الأمان</h3>
   <div class="tip"><strong>للمشتري</strong><ul><li>شوف الغرض وجرّبه قبل الدفع.</li><li>ما تدفع عربون أو تحوّل مصاري لشخص ما بتعرفه.</li><li>قابل البائع بمكان عام، وخود حدا معك للمشتريات الكبيرة.</li><li>للسيارات والعقارات: تحقق من الأوراق بالدوائر الرسمية قبل أي اتفاق.</li></ul></div>
   <div class="tip"><strong>للبائع</strong><ul><li>استلم المبلغ كامل قبل تسليم الغرض.</li><li>انتبه من الإيصالات أو صور التحويل المزورة.</li><li>ما تعطي رموز التحقق اللي بتوصلك برسالة لأي حدا.</li></ul></div>
   <p class="meta" style="margin:0">إذا شكّيت بإعلان أو مستخدم، استعمل زر «الإبلاغ» بصفحة الإعلان.</p>
   <button class="btn" data-close>تمام</button>`);
}
let verifier = null;
function verifySheet() {
  sheet(`<h3>توثيق رقم الهاتف</h3><p class="meta" style="margin:0">رح نبعتلك رسالة فيها رمز. الرقم الموثّق بيظهر علامة ثقة جنب اسمك، وما بينعرض للناس إلا إذا فعّلت زر الاتصال.</p>
   <div class="field"><label for="vph">رقم الموبايل</label><input id="vph" dir="ltr" inputmode="tel" placeholder="+963 9xx xxx xxx" value="+963"></div>
   <div class="field" id="vcodef" hidden><label for="vcode">رمز التحقق</label><input id="vcode" dir="ltr" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
   <p id="verr" class="meta" style="color:var(--danger);margin:0" hidden></p>
   <button class="btn" id="vgo">إرسال الرمز</button>`, (el, close) => {
    let conf = null;
    const err = t => { const e = el.querySelector("#verr"); e.textContent = t; e.hidden = !t; };
    const btn = el.querySelector("#vgo");
    btn.onclick = async () => {
      btn.disabled = true; err("");
      try {
        if (!conf) {
          let ph = el.querySelector("#vph").value.replace(/[\s-]/g, "");
          if (ph.startsWith("09")) ph = "+963" + ph.slice(1);
          if (!/^\+\d{9,15}$/.test(ph)) { err("اكتب الرقم مع رمز الدولة، مثل ‎+963944123456"); btn.disabled = false; return; }
          if (!verifier) verifier = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
          conf = await linkWithPhoneNumber(auth.currentUser, ph, verifier);
          el.querySelector("#vcodef").hidden = false; btn.textContent = "تأكيد الرمز"; el.querySelector("#vcode").focus();
        } else {
          const r = await conf.confirm(el.querySelector("#vcode").value.trim());
          await r.user.getIdToken(true);
          await updateDoc(doc(db, "users", me()), { phoneVerified: true, contactPhone: r.user.phoneNumber });
          close(); toast("تم توثيق رقمك");
        }
      } catch (e) { err(errMsg(e)); if (verifier) { try { verifier.clear(); } catch (_) {} verifier = null; } }
      btn.disabled = false;
    };
  });
}
function callSheet(name, phone) {
  sheet(`<h3>الاتصال بـ ${esc(name)}</h3><div class="numbox"><span>${esc(phone)}</span><a class="btn sm" href="tel:${esc(phone.replace(/\s/g, ""))}">اتصال</a></div>
   <button class="btn ghost" id="cpy">نسخ الرقم</button>
   <p class="meta" style="margin:0">تذكّر نصائح الأمان قبل أي اتفاق.</p><button class="btn ghost" data-close>إغلاق</button>`, el => {
    el.querySelector("#cpy").onclick = () => navigator.clipboard.writeText(phone).then(() => toast("تم نسخ الرقم"), () => {});
  });
}
function notifSheet() {
  if (!S.user) return authSheet();
  const items = newAlerts().sort((x, y) => ms(y.a.createdAt) - ms(x.a.createdAt));
  sheet(`<h3>التنبيهات</h3>${items.length ? items.slice(0, 30).map(n => `<button class="opt" data-open-n="${n.a.id}" style="flex-direction:column;align-items:flex-start;text-align:right"><b>جديد يطابق بحثك «${esc(n.s.q || catName(n.s.cat))}»</b><span class="meta">${esc(n.a.title)} · ${esc(n.a.city)} · ${ago(n.a.createdAt)}</span></button>`).join("") + `<button class="btn ghost" id="nread">تعليم الكل كمقروء</button>` : empty("ما في تنبيهات جديدة", "فعّل التنبيه على بحث محفوظ، ورح نخبرك أول ما ينزل إعلان مطابق.")}
   <button class="btn ghost" data-close>إغلاق</button>`, (el, close) => {
    const markAll = () => S.searches.filter(s => s.alert).forEach(s => updateDoc(doc(db, "users", me(), "searches", s.id), { lastSeen: Date.now() }).catch(() => {}));
    el.querySelectorAll("[data-open-n]").forEach(b => b.onclick = () => { close(); openAd(b.dataset.openN); });
    const r = el.querySelector("#nread"); if (r) r.onclick = () => { markAll(); close(); };
  });
}
function rateSheet(sp) {
  let v = sp.myRating ? sp.myRating.stars : 5;
  sheet(`<h3>قيّم ${esc((sp.profile || {}).name || "البائع")}</h3><div class="row" style="justify-content:center;font-size:32px">${[1, 2, 3, 4, 5].map(i => `<button data-r="${i}" style="border:0;background:none;color:var(--apricot)" aria-label="${i} نجوم">${i <= v ? "★" : "☆"}</button>`).join("")}</div>
   <div class="field"><label for="rtxt">تعليقك</label><textarea id="rtxt" rows="2" maxlength="300" placeholder="كيف كانت تجربتك مع البائع؟">${esc(sp.myRating ? sp.myRating.text : "")}</textarea></div><button class="btn" id="rgo">إرسال التقييم</button>`, (el, close) => {
    const paint = () => el.querySelectorAll("[data-r]").forEach(b => b.textContent = +b.dataset.r <= v ? "★" : "☆");
    el.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { v = +b.dataset.r; paint(); });
    el.querySelector("#rgo").onclick = async () => {
      try { await setDoc(doc(db, "users", sp.id, "ratings", me()), { stars: v, text: el.querySelector("#rtxt").value.trim(), at: serverTimestamp() }); close(); toast("شكراً، انضاف تقييمك"); loadSeller(sp.id); }
      catch (e) { toast(errMsg(e)); }
    };
  });
}

// ---------------- التثبيت على الموبايل ----------------
let installEvt = null, installHidden = false;
try { installHidden = localStorage.getItem("hideInstall") === "1"; } catch (_) {}
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (S.view === "home") render(); });
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function installBar() {
  if (installHidden || standalone()) return "";
  if (installEvt) return `<div class="installbar"><span>ثبّت التطبيق على شاشتك ليفتح أسرع</span><div class="row"><button class="btn" data-act="install">تثبيت</button><button class="linkbtn" style="color:inherit" data-act="hideinstall">✕</button></div></div>`;
  if (isIOS) return `<div class="installbar"><span>لتثبيت التطبيق: اضغط زر المشاركة بسفاري، بعدين «إضافة إلى الشاشة الرئيسية».</span><button class="linkbtn" style="color:inherit" data-act="hideinstall">✕</button></div>`;
  return "";
}

// ---------------- الأحداث ----------------
function openAd(id) { go("detail", { id }); }
async function toggleFav(id) {
  if (!needAuth()) return;
  const ref = doc(db, "users", me(), "favorites", id);
  try { if (S.favs.has(id)) { await deleteDoc(ref); toast("انشال من المفضلة"); } else { await setDoc(ref, { at: serverTimestamp() }); toast("انحفظ بالمفضلة"); } }
  catch (e) { toast(errMsg(e)); }
}

document.addEventListener("click", async e => {
  const t = e.target.closest("button,[data-open]"); if (!t) return; const d = t.dataset;
  if (d.fav) { e.stopPropagation(); toggleFav(d.fav); return; }
  if (d.open) { openAd(d.open); return; }
  if (d.nav) { if (d.nav === "post" && S.user && banned()) { toast("حسابك موقوف"); } stack.length = 0; go(d.nav, null, false); return; }
  if (d.cat) { S.filt.cat = d.cat; S.filt.brand = ""; render(); return; }
  if (d.clear) { if (d.clear === "price") { S.filt.min = S.filt.max = ""; } else S.filt[d.clear] = ""; render(); return; }
  if (d.img) { S.ctx.img = +d.img; render(); return; }
  if (d.chat) { go("chat", { id: d.chat }); return; }
  if (d.seller) { go("seller", { seller: d.seller }); return; }
  if (d.runsaved) { const s = S.searches.find(x => x.id === d.runsaved); Object.assign(S.filt, searchFilt(s)); updateDoc(doc(db, "users", me(), "searches", s.id), { lastSeen: Date.now() }).catch(() => {}); stack.length = 0; go("home", null, false); return; }
  if (d.alert) { const s = S.searches.find(x => x.id === d.alert); updateDoc(doc(db, "users", me(), "searches", s.id), { alert: !s.alert, lastSeen: Date.now() }).then(() => toast(!s.alert ? "التنبيهات مفعّلة" : "التنبيهات متوقفة")).catch(er => toast(errMsg(er))); return; }
  if (d.delsaved) { deleteDoc(doc(db, "users", me(), "searches", d.delsaved)).catch(er => toast(errMsg(er))); return; }
  if (d.cond) { S.draft.cond = d.cond; render(); return; }
  if (d.rmimg) { S.draft.imgs.splice(+d.rmimg, 1); render(); return; }
  if (d.edit) { go("post", { edit: d.edit }); return; }
  if (d.renew) {
    const a = S.cache.get(d.renew);
    if (Date.now() - ms(a.bumpedAt) < D) { toast("فيك تجدد الإعلان مرة كل 24 ساعة"); return; }
    updateDoc(doc(db, "ads", d.renew), { bumpedAt: serverTimestamp() }).then(() => toast("تجدّد الإعلان وطلع بأول النتائج")).catch(er => toast(errMsg(er))); return;
  }
  if (d.pause) { const a = S.cache.get(d.pause); const st = a.status === "paused" ? "active" : "paused"; updateDoc(doc(db, "ads", d.pause), { status: st }).then(() => toast(st === "paused" ? "توقف الإعلان وصار مخفي عن البحث" : "رجع الإعلان فعّال")).catch(er => toast(errMsg(er))); return; }
  if (d.feature) { featureSheet(d.feature); return; }
  if (d.del) { $(`[data-confirm="${d.del}"]`).hidden = false; return; }
  if (d.delno) { $(`[data-confirm="${d.delno}"]`).hidden = true; return; }
  if (d.delyes) { deleteAd(d.delyes); return; }
  if (d.quick) { $("#cm").value = d.quick; $("#cm").focus(); return; }
  const act = d.act; if (!act) return;
  const a = S.detail;
  switch (act) {
    case "back": back(); break;
    case "more": loadMore(); break;
    case "login": authSheet(); break;
    case "logout": await signOut(auth); stack.length = 0; go("home", null, false); toast("سجّلت خروج"); break;
    case "filters": filtersSheet(); break;
    case "city": citySheet(); break;
    case "sort": sortSheet(); break;
    case "notifs": notifSheet(); break;
    case "savesearch": {
      if (!needAuth()) break;
      const f = S.filt;
      if (S.searches.some(s => (s.q || "") === f.q && (s.cat || "all") === f.cat && (s.city || "") === f.city)) { toast("هالبحث محفوظ من قبل"); break; }
      if (S.searches.length >= 20) { toast("وصلت للحد الأقصى (20 بحث). احذف بحث قديم من المفضلة."); break; }
      addDoc(collection(db, "users", me(), "searches"), { q: f.q, cat: f.cat, city: f.city, alert: true, lastSeen: Date.now(), at: serverTimestamp() })
        .then(() => toast("انحفظ البحث، ورح يوصلك تنبيه بالجديد")).catch(er => toast(errMsg(er)));
      break;
    }
    case "report": if (needAuth()) reportSheet(a); break;
    case "startchat": if (needAuth()) startChat(a); break;
    case "call": callSheet(a.seller.name, a.seller.contactPhone); break;
    case "callchat": { const op = S.ctx.otherProfile; callSheet(op.name, op.contactPhone); break; }
    case "verify": verifySheet(); break;
    case "safety": safetySheet(); break;
    case "rate": if (needAuth()) rateSheet(S.sellerPage); break;
    case "togglecall": {
      const p = S.profile; if (!p.phoneVerified && !p.allowCall) { toast("وثّق رقمك أول"); verifySheet(); break; }
      updateDoc(doc(db, "users", me()), { allowCall: !p.allowCall }).catch(er => toast(errMsg(er))); break;
    }
    case "install": if (installEvt) { installEvt.prompt(); installEvt = null; render(); } break;
    case "hideinstall": installHidden = true; try { localStorage.setItem("hideInstall", "1"); } catch (_) {} render(); break;
  }
});
let qt;
document.addEventListener("input", e => { if (e.target.id === "q") { S.filt.q = e.target.value; clearTimeout(qt); qt = setTimeout(render, 250); } });
document.addEventListener("change", async e => {
  const id = e.target.id;
  if (id === "pcat") { syncDraft(); S.draft.brand = ""; S.draft.cond = COND_CATS.includes(S.draft.cat) ? (S.draft.cond || "used") : ""; render(); }
  if (id === "myname") { const n = e.target.value.trim(); if (n.length >= 2) updateDoc(doc(db, "users", me()), { name: n }).then(() => toast("انحفظ الاسم")).catch(er => toast(errMsg(er))); }
  if (id === "pimg") {
    syncDraft();
    const files = [...e.target.files].slice(0, MAX_IMGS - S.draft.imgs.length);
    toast("عم نجهّز الصور…");
    const arr = await Promise.all(files.map(f => compressImage(f, 1100, 0.72, 240000)));
    S.draft.imgs.push(...arr.filter(Boolean)); render();
  }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "pf") { if (!S.busy) submitAd(); return; }
  if (e.target.id === "cf") { const inp = $("#cm"), t = inp.value.trim(); if (!t) return; if (banned()) { toast("حسابك موقوف"); return; } inp.value = ""; sendMsg(t); }
});
const net = () => { $("#offline").hidden = navigator.onLine; };
addEventListener("online", net); addEventListener("offline", net); net();

render();
