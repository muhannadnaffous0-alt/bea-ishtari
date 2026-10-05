import {
  auth, db, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, writeBatch, getCountFromServer
} from "./firebase.js";
import { $, esc, catName, ms, ago, fmtPrice, joinedTxt, isFeatured, ic, icSm, toast, sheet, errMsg } from "./shared.js";

const D = 86400000;
const A = { user: null, ok: false, tab: "overview", stats: null, reports: null, requests: null, ads: null, users: null, cfg: null, q: "", showClosed: false };

onAuthStateChanged(auth, async user => {
  A.user = user; A.ok = false;
  if (user) { try { A.ok = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (_) {} }
  render();
  if (A.ok) loadTab();
});

// ---------- التحميل ----------
async function loadTab() {
  try {
    if (A.tab === "overview") {
      const c = async q => (await getCountFromServer(q)).data().count;
      const [ads, users, reports, reqs] = await Promise.all([
        c(query(collection(db, "ads"), where("status", "==", "active"))),
        c(collection(db, "users")),
        c(query(collection(db, "reports"), where("status", "==", "open"))),
        c(query(collection(db, "featureRequests"), where("status", "==", "pending")))
      ]);
      const day = Date.now() - D;
      const recent = await getDocs(query(collection(db, "ads"), orderBy("createdAt", "desc"), limit(300)));
      const today = recent.docs.filter(d => ms(d.data().createdAt) > day).length;
      A.stats = { ads, users, reports, reqs, today };
    }
    if (A.tab === "reports") {
      const s = await getDocs(query(collection(db, "reports"), orderBy("at", "desc"), limit(300)));
      A.reports = s.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    if (A.tab === "requests") {
      const s = await getDocs(query(collection(db, "featureRequests"), orderBy("at", "desc"), limit(300)));
      A.requests = s.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    if (A.tab === "ads") {
      const s = await getDocs(query(collection(db, "ads"), orderBy("createdAt", "desc"), limit(500)));
      A.ads = s.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    if (A.tab === "users") {
      const s = await getDocs(query(collection(db, "users"), orderBy("joinedAt", "desc"), limit(500)));
      A.users = s.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    if (A.tab === "settings") {
      const d = await getDoc(doc(db, "config", "app"));
      A.cfg = { featurePlans: [{ days: 3, price: "2$" }, { days: 7, price: "4$" }, { days: 30, price: "12$" }], paymentInfo: "", safetyNote: "", ...(d.exists() ? d.data() : {}) };
    }
  } catch (e) { console.error(e); toast(errMsg(e)); }
  render();
}

// ---------- الشاشات ----------
const TABS = [["overview", "لمحة"], ["reports", "البلاغات"], ["requests", "طلبات التمييز"], ["ads", "الإعلانات"], ["users", "المستخدمين"], ["settings", "الإعدادات"]];
const loading = `<div class="loading"><div class="skel"></div><div class="skel"></div></div>`;
const statusPill = s => ({ open: '<span class="status pending">جديد</span>', resolved: '<span class="status ok">تمت المعالجة</span>', dismissed: '<span class="status">متجاهل</span>', pending: '<span class="status pending">بانتظار الموافقة</span>', approved: '<span class="status ok">مفعّل</span>', rejected: '<span class="status bad">مرفوض</span>', active: '<span class="status ok">فعّال</span>', paused: '<span class="status">متوقف</span>', removed: '<span class="status bad">محذوف</span>' }[s] || "");

function render() {
  const app = $("#app");
  if (!A.user) { app.innerHTML = head() + `<main><div class="card"><b>سجّل دخول بحساب المدير</b>
    <button class="btn gbtn" id="g">المتابعة بحساب Google</button>
    <div class="or">أو</div>
    <form id="lf" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="le">الإيميل</label><input id="le" type="email" dir="ltr"></div>
    <div class="field"><label for="lp">كلمة السر</label><input id="lp" type="password" dir="ltr"></div><button class="btn">دخول</button></form></div></main>`; return; }
  if (!A.ok) { app.innerHTML = head() + `<main><div class="card"><b>هالحساب مو مدير</b>
    <p style="margin:0">إذا هاد حسابك وبدك تصير المدير، انسخ المعرّف التالي وضيفه بـ Firebase Console ← Firestore ← مجموعة <b>admins</b> ← مستند اسمه هالمعرّف (الخطوة 6 بدليل التشغيل).</p>
    <div class="uid">${esc(A.user.uid)}</div><button class="btn ghost" id="cpuid">نسخ المعرّف</button>
    <button class="btn danger" id="lo">تسجيل الخروج</button></div></main>`; return; }
  const counts = { reports: A.stats && A.stats.reports, requests: A.stats && A.stats.reqs };
  app.innerHTML = head(true) + `<main>
    <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button data-tab="${k}" aria-pressed="${A.tab === k}">${n}${counts[k] ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("")}</div>
    ${({ overview: vOverview, reports: vReports, requests: vRequests, ads: vAds, users: vUsers, settings: vSettings })[A.tab]()}
  </main>`;
}
const head = (signed) => `<header class="top"><div class="brand"><h1>لوحة الإدارة<small>بيع واشتري في سوريا</small></h1>
  <div class="row"><a class="btn ghost sm" href="./">فتح التطبيق</a>${signed ? `<button class="btn ghost sm" id="lo">خروج</button>` : ""}</div></div></header>`;

function vOverview() {
  const s = A.stats; if (!s) return loading;
  return `<div class="kpis">
    <div class="kpi"><b>${s.ads}</b><span>إعلان فعّال</span></div>
    <div class="kpi"><b>${s.today}</b><span>إعلان جديد آخر 24 ساعة</span></div>
    <div class="kpi"><b>${s.users}</b><span>مستخدم مسجّل</span></div>
    <div class="kpi"><b>${s.reports}</b><span>بلاغ بانتظار المراجعة</span></div>
    <div class="kpi"><b>${s.reqs}</b><span>طلب تمييز بانتظارك</span></div></div>
    ${s.reports ? `<button class="btn" data-tab="reports">راجع البلاغات (${s.reports})</button>` : ""}
    ${s.reqs ? `<button class="btn warm" data-tab="requests">راجع طلبات التمييز (${s.reqs})</button>` : ""}
    <div class="notice">${ic("shield")}<div>المحادثات بين المستخدمين خاصة ولا حتى المدير بيشوفها. لما يوصلك بلاغ، احكم من محتوى الإعلان وسجل المعلن.</div></div>`;
}

function vReports() {
  if (!A.reports) return loading;
  const list = A.reports.filter(r => A.showClosed || r.status === "open");
  return `<div class="row" style="justify-content:space-between;align-items:center"><span class="meta">${list.length} بلاغ</span>
    <label class="opt" style="padding:6px 10px"><input type="checkbox" id="showclosed" ${A.showClosed ? "checked" : ""}> عرض المعالَجة</label></div>
    ${list.length ? list.map(r => `<div class="card"><div class="item"><div class="body">
      <div class="row" style="gap:6px;align-items:center">${statusPill(r.status)}<span class="meta">${ago(r.at)}</span></div>
      <h3>${esc(r.adTitle || "إعلان")}</h3>
      <div><b>السبب:</b> ${esc(r.reason)}</div>${r.note ? `<div class="meta">${esc(r.note)}</div>` : ""}
      ${r.status === "open" ? `<div class="row">
        <button class="btn ghost sm" data-viewad="${r.adId}">عرض الإعلان</button>
        <button class="btn danger sm" data-rremove="${r.id}">حذف الإعلان</button>
        <button class="btn danger sm" data-rban="${r.id}">إيقاف المعلن</button>
        <button class="btn ghost sm" data-rdismiss="${r.id}">تجاهل</button></div>` : ""}
    </div></div></div>`).join("") : `<div class="empty"><strong>ما في بلاغات جديدة</strong>كل شي تمام.</div>`}`;
}

function vRequests() {
  if (!A.requests) return loading;
  const list = A.requests.filter(r => A.showClosed || r.status === "pending");
  return `<div class="row" style="justify-content:space-between;align-items:center"><span class="meta">${list.length} طلب</span>
    <label class="opt" style="padding:6px 10px"><input type="checkbox" id="showclosed" ${A.showClosed ? "checked" : ""}> عرض القديمة</label></div>
    ${list.length ? list.map(r => `<div class="card"><div class="body" style="display:flex;flex-direction:column;gap:4px">
      <div class="row" style="gap:6px;align-items:center">${statusPill(r.status)}<span class="meta">${ago(r.at)}</span></div>
      <h3 style="margin:0;font-size:15px">${esc(r.adTitle)}</h3>
      <div>${esc(r.ownerName || "مستخدم")} طلب <b>${r.days} يوم</b> بسعر <b>${esc(r.price)}</b></div>
      ${r.note ? `<div class="meta">ملاحظة: ${esc(r.note)}</div>` : ""}
      ${r.status === "pending" ? `<div class="row"><button class="btn ghost sm" data-viewad="${r.adId}">عرض الإعلان</button>
        <button class="btn warm sm" data-approve="${r.id}">${ic("star")} تأكيد الدفع وتفعيل</button>
        <button class="btn danger sm" data-reject="${r.id}">رفض</button></div>` : ""}
    </div></div>`).join("") : `<div class="empty"><strong>ما في طلبات جديدة</strong>لما حدا يطلب تمييز إعلانه، بيظهر هون.</div>`}`;
}

function vAds() {
  if (!A.ads) return loading;
  const q = A.q.trim();
  const list = A.ads.filter(a => !q || (a.title + " " + (a.ownerName || "") + " " + a.city + " " + a.id).includes(q));
  return `<label class="search">${ic("search")}<input id="aq" type="search" placeholder="ابحث بالعنوان، اسم المعلن، المدينة، أو رقم الإعلان" value="${esc(A.q)}"></label>
    <span class="meta">${list.length} من آخر ${A.ads.length} إعلان</span>
    ${list.map(a => `<div class="card"><div class="item"><div class="thumb">${a.thumb ? `<img src="${a.thumb}" alt="">` : ic(a.cat)}</div><div class="body">
      <div class="row" style="gap:6px;align-items:center">${statusPill(a.status)}${isFeatured(a) ? '<span class="badge">مميز</span>' : ""}<span class="meta">${esc(catName(a.cat))} · ${esc(a.city)} · ${ago(a.createdAt)} · ${icSm("eye")} ${a.views || 0}</span></div>
      <h3>${esc(a.title)}</h3><div class="price">${fmtPrice(a.price, a.cur)}</div>
      <div class="meta">المعلن: <button class="linkbtn" data-userq="${esc(a.ownerName || "")}">${esc(a.ownerName || "مستخدم")}</button> · <span dir="ltr">${a.id.slice(0, 8).toUpperCase()}</span></div>
      <div class="row">
        <button class="btn ghost sm" data-viewad="${a.id}">عرض</button>
        ${a.status === "removed" ? `<button class="btn ghost sm" data-restore="${a.id}">استرجاع</button>` : `<button class="btn danger sm" data-remove="${a.id}">حذف من العرض</button>`}
        ${isFeatured(a) ? `<button class="btn ghost sm" data-unfeature="${a.id}">إلغاء التمييز</button>` : `<button class="btn warm sm" data-featuredays="${a.id}">${ic("star")} تمييز</button>`}
        <button class="btn danger sm" data-purge="${a.id}">حذف نهائي</button>
      </div></div></div></div>`).join("")}`;
}

function vUsers() {
  if (!A.users) return loading;
  const q = A.q.trim();
  const list = A.users.filter(u => !q || (u.name || "").includes(q) || (u.contactPhone || "").includes(q) || u.id.includes(q));
  return `<label class="search">${ic("search")}<input id="uq" type="search" placeholder="ابحث بالاسم أو الرقم أو المعرّف" value="${esc(A.q)}"></label>
    <span class="meta">${list.length} مستخدم</span>
    ${list.map(u => `<div class="card"><div class="seller"><div class="avatar">${esc((u.name || "؟")[0])}</div><div style="flex:1;min-width:0">
      <b>${esc(u.name || "مستخدم")}</b> ${u.banned ? '<span class="status bad">موقوف</span>' : ""}
      <div class="meta"><span>انضم ${u.joinedAt ? joinedTxt(u.joinedAt) : "—"}</span>${u.phoneVerified ? `<span class="verified">${icSm("check")} <span dir="ltr">${esc(u.contactPhone)}</span></span>` : "<span>غير موثّق</span>"}</div>
      <div class="row" style="margin-top:6px"><button class="btn ghost sm" data-userads="${u.id}">إعلاناته</button>
      ${u.banned ? `<button class="btn ghost sm" data-unban="${u.id}">إلغاء الإيقاف</button>` : `<button class="btn danger sm" data-ban="${u.id}">إيقاف الحساب</button>`}</div>
    </div></div></div>`).join("")}`;
}

function vSettings() {
  const c = A.cfg; if (!c) return loading;
  return `<form id="sf" class="card" novalidate>
    <b>باقات تمييز الإعلانات</b><p class="meta" style="margin:0">هي الأسعار اللي بتظهر للمستخدم لما يطلب تمييز إعلانه.</p>
    <div class="plans" id="plans">${c.featurePlans.map((p, i) => `<div class="row"><input class="field-in" data-pd="${i}" inputmode="numeric" value="${p.days}" aria-label="عدد الأيام" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--surface)"> يوم بسعر
      <input data-pp="${i}" value="${esc(p.price)}" aria-label="السعر" style="border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--surface)">
      <button type="button" class="btn danger sm" data-rmplan="${i}">حذف</button></div>`).join("")}</div>
    <button type="button" class="btn ghost sm" id="addplan" style="align-self:flex-start">+ إضافة باقة</button>
    <div class="field"><label for="pay">طريقة الدفع (بتظهر للمستخدم)</label><textarea id="pay" rows="3" placeholder="مثلاً: حوّل المبلغ عبر سيريتل كاش على الرقم 09xx xxx xxx واكتب رقم العملية بالملاحظة.">${esc(c.paymentInfo)}</textarea></div>
    <div class="field"><label for="safe">ملاحظة أمان إضافية (اختياري، بتظهر بصفحة كل إعلان)</label><textarea id="safe" rows="2">${esc(c.safetyNote)}</textarea></div>
    <button class="btn">حفظ الإعدادات</button></form>`;
}

// ---------- الأفعال ----------
async function removeAd(id, reason) { await updateDoc(doc(db, "ads", id), { status: "removed", removedReason: reason || "مخالف لشروط النشر" }); }
async function setBan(uid, ban) {
  await updateDoc(doc(db, "users", uid), { banned: ban });
  const ads = await getDocs(query(collection(db, "ads"), where("ownerId", "==", uid)));
  const b = writeBatch(db);
  ads.docs.forEach(d => {
    const a = d.data();
    if (ban && a.status !== "removed") b.update(d.ref, { status: "removed", removedReason: "حساب موقوف" });
    if (!ban && a.status === "removed" && a.removedReason === "حساب موقوف") b.update(d.ref, { status: "active", removedReason: "" });
  });
  await b.commit();
}
function confirmSheet(title, text, okLabel, fn, withReason) {
  sheet(`<h3>${title}</h3><p style="margin:0">${text}</p>${withReason ? `<div class="field"><label for="cr">السبب (بيشوفه المعلن)</label><input id="cr" value="${esc(withReason)}"></div>` : ""}
    <div class="row"><button class="btn danger" id="ok">${okLabel}</button><button class="btn ghost" data-close>إلغاء</button></div>`, (el, close) => {
    el.querySelector("#ok").onclick = async () => { el.querySelector("#ok").disabled = true; try { await fn(withReason ? el.querySelector("#cr").value.trim() : undefined); close(); } catch (e) { toast(errMsg(e)); el.querySelector("#ok").disabled = false; } };
  });
}
async function viewAd(id) {
  const d = await getDoc(doc(db, "ads", id));
  if (!d.exists()) return toast("الإعلان انحذف");
  const a = d.data();
  const imgs = await getDocs(collection(db, "ads", id, "images")).then(s => s.docs.map(x => x.data().data)).catch(() => []);
  const owner = await getDoc(doc(db, "users", a.ownerId)).then(x => x.data() || {}).catch(() => ({}));
  sheet(`<h3>${esc(a.title)}</h3>
    <div class="row" style="gap:6px">${statusPill(a.status)}<span class="meta">${esc(catName(a.cat))} · ${esc(a.city)}${a.area ? " · " + esc(a.area) : ""} · ${ago(a.createdAt)}</span></div>
    <div class="price">${fmtPrice(a.price, a.cur)}</div>
    ${imgs.length ? `<div class="gal">${imgs.map(u => `<img src="${u}" alt="" style="height:120px;border-radius:8px">`).join("")}</div>` : ""}
    <div style="white-space:pre-wrap">${esc(a.desc)}</div>
    <div class="card"><b>المعلن: ${esc(owner.name || a.ownerName || "")}</b><span class="meta">انضم ${owner.joinedAt ? joinedTxt(owner.joinedAt) : "—"} · ${owner.phoneVerified ? "رقم موثّق " + esc(owner.contactPhone) : "غير موثّق"}${owner.banned ? " · موقوف" : ""}</span>
      <span class="meta" dir="ltr" style="text-align:right">UID: ${esc(a.ownerId)}</span></div>
    <button class="btn ghost" data-close>إغلاق</button>`);
}

document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return; const d = t.dataset;
  try {
    if (t.id === "g") { await signInWithPopup(auth, new GoogleAuthProvider()); return; }
    if (t.id === "lo") { await signOut(auth); return; }
    if (t.id === "cpuid") { navigator.clipboard.writeText(A.user.uid).then(() => toast("تم النسخ")); return; }
    if (d.tab) { A.tab = d.tab; A.q = ""; A.showClosed = false; render(); loadTab(); return; }
    if (d.viewad) { viewAd(d.viewad); return; }
    if (d.rdismiss) { await updateDoc(doc(db, "reports", d.rdismiss), { status: "dismissed" }); toast("تم تجاهل البلاغ"); return loadTab(); }
    if (d.rremove) {
      const r = A.reports.find(x => x.id === d.rremove);
      return confirmSheet("حذف الإعلان", `رح يختفي «${esc(r.adTitle)}» من التطبيق، وبيشوف المعلن السبب.`, "احذف الإعلان", async reason => {
        await removeAd(r.adId, reason);
        const same = A.reports.filter(x => x.adId === r.adId && x.status === "open");
        for (const x of same) await updateDoc(doc(db, "reports", x.id), { status: "resolved" });
        toast("انحذف الإعلان"); loadTab();
      }, r.reason);
    }
    if (d.rban) {
      const r = A.reports.find(x => x.id === d.rban);
      return confirmSheet("إيقاف المعلن", "رح ينوقف الحساب وتختفي كل إعلاناته، وما بيقدر ينشر أو يراسل. فيك تلغي الإيقاف لاحقاً من «المستخدمين».", "أوقف الحساب", async () => {
        await setBan(r.adOwnerId, true);
        await updateDoc(doc(db, "reports", r.id), { status: "resolved" });
        toast("انوقف الحساب"); loadTab();
      });
    }
    if (d.approve) {
      const r = A.requests.find(x => x.id === d.approve);
      const ad = await getDoc(doc(db, "ads", r.adId));
      if (!ad.exists()) { await updateDoc(doc(db, "featureRequests", r.id), { status: "rejected" }); toast("الإعلان انحذف، انرفض الطلب"); return loadTab(); }
      const from = Math.max(Date.now(), ad.data().featuredUntil || 0);
      await updateDoc(doc(db, "ads", r.adId), { featuredUntil: from + r.days * D });
      await updateDoc(doc(db, "featureRequests", r.id), { status: "approved", approvedAt: Date.now() });
      toast(`تفعّل التمييز لمدة ${r.days} يوم`); return loadTab();
    }
    if (d.reject) { await updateDoc(doc(db, "featureRequests", d.reject), { status: "rejected" }); toast("انرفض الطلب"); return loadTab(); }
    if (d.remove) return confirmSheet("حذف من العرض", "الإعلان بيختفي من التطبيق وبيظهر للمعلن إنو انحذف من الإدارة. فيك تسترجعه لاحقاً.", "احذف", async reason => { await removeAd(d.remove, reason); toast("انحذف من العرض"); loadTab(); }, "مخالف لشروط النشر");
    if (d.restore) { await updateDoc(doc(db, "ads", d.restore), { status: "active", removedReason: "" }); toast("رجع الإعلان"); return loadTab(); }
    if (d.unfeature) { await updateDoc(doc(db, "ads", d.unfeature), { featuredUntil: 0 }); toast("انلغى التمييز"); return loadTab(); }
    if (d.featuredays) {
      return sheet(`<h3>تمييز الإعلان</h3><div class="field"><label for="fd">عدد الأيام</label><input id="fd" inputmode="numeric" value="7"></div>
        <div class="row"><button class="btn warm" id="fok">ميّز</button><button class="btn ghost" data-close>إلغاء</button></div>`, (el, close) => {
        el.querySelector("#fok").onclick = async () => { const n = +el.querySelector("#fd").value || 0; if (n < 1) return; await updateDoc(doc(db, "ads", d.featuredays), { featuredUntil: Date.now() + n * D }); close(); toast("صار الإعلان مميز"); loadTab(); };
      });
    }
    if (d.purge) return confirmSheet("حذف نهائي", "رح ينحذف الإعلان وصوره للأبد، وما فيك ترجعه.", "احذف نهائياً", async () => {
      const imgs = await getDocs(collection(db, "ads", d.purge, "images"));
      const b = writeBatch(db); imgs.docs.forEach(x => b.delete(x.ref)); b.delete(doc(db, "ads", d.purge)); await b.commit();
      toast("انحذف نهائياً"); loadTab();
    });
    if (d.ban) return confirmSheet("إيقاف الحساب", "رح تختفي كل إعلاناته وما بيقدر ينشر أو يراسل.", "أوقف الحساب", async () => { await setBan(d.ban, true); toast("انوقف الحساب"); loadTab(); });
    if (d.unban) { await setBan(d.unban, false); toast("انلغى الإيقاف ورجعت إعلاناته"); return loadTab(); }
    if (d.userads) { const u = A.users.find(x => x.id === d.userads); A.tab = "ads"; A.q = u.name || ""; render(); return loadTab(); }
    if (d.userq !== undefined) { A.tab = "users"; A.q = d.userq; render(); return loadTab(); }
    if (d.rmplan) { syncPlans(); A.cfg.featurePlans.splice(+d.rmplan, 1); render(); return; }
    if (t.id === "addplan") { syncPlans(); A.cfg.featurePlans.push({ days: 14, price: "" }); render(); return; }
  } catch (er) { toast(errMsg(er)); }
});
function syncPlans() {
  if (!$("#plans")) return;
  A.cfg.featurePlans = A.cfg.featurePlans.map((p, i) => ({ days: +(($(`[data-pd="${i}"]`) || {}).value) || p.days, price: (($(`[data-pp="${i}"]`) || {}).value ?? p.price).trim() }));
  A.cfg.paymentInfo = $("#pay").value; A.cfg.safetyNote = $("#safe").value;
}
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "lf") { try { await signInWithEmailAndPassword(auth, $("#le").value.trim(), $("#lp").value); } catch (er) { toast(errMsg(er)); } }
  if (e.target.id === "sf") {
    syncPlans();
    const plans = A.cfg.featurePlans.filter(p => p.days > 0 && p.price);
    try { await setDoc(doc(db, "config", "app"), { featurePlans: plans, paymentInfo: A.cfg.paymentInfo.trim(), safetyNote: A.cfg.safetyNote.trim() }); toast("انحفظت الإعدادات"); }
    catch (er) { toast(errMsg(er)); }
  }
});
let qt;
document.addEventListener("input", e => { if (e.target.id === "aq" || e.target.id === "uq") { A.q = e.target.value; clearTimeout(qt); qt = setTimeout(() => { const id = e.target.id, pos = e.target.selectionStart; render(); const el = document.getElementById(id); el.focus(); el.setSelectionRange(pos, pos); }, 250); } });
document.addEventListener("change", e => { if (e.target.id === "showclosed") { A.showClosed = e.target.checked; render(); } });
render();
