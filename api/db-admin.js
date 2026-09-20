/**
 * Volta Vercel API — GET /api/db-admin
 * ====================================
 * Vercel serverless mirror of the Next.js route src/app/api/db-admin/route.ts.
 * Serves the bilingual (EN/AR) database admin console (formerly the static
 * public/db-admin.html file) as an HTML string, byte-faithfully, with
 * Content-Type "text/html; charset=utf-8" + no-store. All of the console's
 * fetch() calls are same-origin relative paths (/api/db/...) served by the
 * matching Vercel functions, so nothing else changes.
 *
 * ACCESS (optional light protection):
 *   • If the ADMIN_KEY environment variable is SET, requests must append
 *     ?key=<ADMIN_KEY> — a wrong or missing key gets a 401 HTML page.
 *   • If ADMIN_KEY is NOT set (sandbox default), the console is OPEN.
 *
 * GET handler only — every other method answers 405 plain text.
 */

const UNAUTHORIZED_HTML =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
  '<title>401 — Unauthorized</title></head>' +
  '<body style="font-family:system-ui,sans-serif;background:#0b0e17;color:#e9edf7;' +
  'display:grid;place-items:center;min-height:100vh;margin:0">' +
  '<p>Unauthorized — append <code>?key=...</code> to the URL.</p></body></html>';

// The full admin console, embedded byte-faithfully (backslashes, backticks
// and dollar-brace sequences are escaped inside the template literal below;
// the string VALUE equals the original db-admin.html file).
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Volta DB Admin — قاعدة بيانات فولتا</title>
<style>
  :root{
    --bg:#0b0e17; --panel:#121828; --panel2:#0e1322; --line:#232b42;
    --text:#e9edf7; --muted:#93a0b8; --amber:#f0b429; --amber-soft:rgba(240,180,41,.12);
    --peri:#93a9e6; --peri-soft:rgba(147,169,230,.12);
    --green:#2fd57c; --red:#ff5c5c; --radius:14px;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:radial-gradient(1200px 500px at 80% -10%, rgba(147,169,230,.08), transparent 60%),
               radial-gradient(900px 400px at 0% 110%, rgba(240,180,41,.06), transparent 60%), var(--bg);
    color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Cairo",sans-serif;
    min-height:100vh; padding:20px;
  }
  .wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
  header.top{display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:12px}
  .logo{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--amber),#b8860b);
        display:grid;place-items:center;font-weight:800;color:#141414;font-size:20px;letter-spacing:-1px}
  h1{font-size:20px;font-weight:800;letter-spacing:.4px}
  h1 small{display:block;font-size:12px;font-weight:500;color:var(--muted);letter-spacing:.2px}
  .btn{
    border:1px solid var(--line);background:var(--panel);color:var(--text);padding:9px 14px;
    border-radius:10px;cursor:pointer;font-weight:600;font-size:13px;min-height:38px;transition:.15s;
    display:inline-flex;align-items:center;gap:7px;
  }
  .btn:hover{border-color:var(--peri);transform:translateY(-1px)}
  .btn.primary{background:linear-gradient(135deg,var(--amber),#c98f10);border-color:transparent;color:#161616}
  .btn.peri{background:linear-gradient(135deg,var(--peri),#6f86c9);border-color:transparent;color:#10141f}
  .btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
  .card h2{font-size:14px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--peri);margin-bottom:12px}
  /* stats */
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;position:relative;overflow:hidden}
  .stat::after{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--amber),var(--peri))}
  .stat .num{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums}
  .stat .lbl{color:var(--muted);font-size:12px;margin-top:2px}
  .stat .sub{margin-top:8px;font-size:11.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:5px}
  .chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px}
  .chip b{color:var(--amber)}
  /* panels */
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:860px){.grid2{grid-template-columns:1fr}}
  label.fld{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:10px 0 5px;text-transform:uppercase;letter-spacing:.5px}
  textarea,input[type=text],select{
    width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    border-radius:10px;padding:10px 12px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  select,input[type=text]{font-family:inherit}
  textarea{min-height:150px;resize:vertical}
  textarea:focus,input:focus,select:focus{outline:none;border-color:var(--peri)}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
  .seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .seg button{border:0;background:transparent;color:var(--muted);padding:9px 16px;cursor:pointer;font-weight:700;font-size:13px;min-height:38px}
  .seg button.on{background:var(--peri-soft);color:var(--peri)}
  .filelbl{position:relative;overflow:hidden}
  .filelbl input{position:absolute;inset:0;opacity:0;cursor:pointer}
  .hint{font-size:12px;color:var(--muted);margin-top:8px}
  .preview{max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:10px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{position:sticky;top:0;background:var(--panel2);color:var(--muted);text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--line)}
  td{padding:8px 10px;border-bottom:1px solid rgba(35,43,66,.55);vertical-align:top}
  tr:last-child td{border-bottom:0}
  .tag{display:inline-block;background:var(--peri-soft);color:var(--peri);border-radius:999px;padding:0 8px;margin:1px 2px 1px 0;font-size:11px}
  .tag.amber{background:var(--amber-soft);color:var(--amber)}
  /* report */
  .report{margin-top:12px;border:1px solid var(--line);border-radius:10px;padding:12px;display:none}
  .report.ok{border-color:rgba(47,213,124,.4)}
  .report .big{font-size:15px;font-weight:800;margin-bottom:6px}
  .errs{max-height:160px;overflow-y:auto;margin-top:8px;font-size:12px;color:var(--red)}
  .errs div{padding:3px 0;border-bottom:1px dashed rgba(255,92,92,.2)}
  .oktext{color:var(--green)}
  /* browser */
  .toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
  .toolbar input[type=text]{flex:1;min-width:180px;font-family:inherit}
  .pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;font-size:12.5px;color:var(--muted)}
  .pager .btn{padding:6px 11px;min-height:32px}
  .scrollbox{max-height:430px;overflow-y:auto;border:1px solid var(--line);border-radius:10px}
  .num{font-variant-numeric:tabular-nums}
  ::-webkit-scrollbar{width:9px;height:9px}
  ::-webkit-scrollbar-thumb{background:#2a3350;border-radius:99px}
  ::-webkit-scrollbar-track{background:transparent}
  footer.bot{color:var(--muted);font-size:11.5px;text-align:center;padding:8px 0 4px}
  .spin{display:inline-block;width:13px;height:13px;border:2px solid rgba(255,255,255,.25);border-top-color:var(--peri);border-radius:50%;animation:sp .7s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="wrap">

  <header class="top">
    <div class="brand">
      <div class="logo">V</div>
      <h1>VOLTA DB ADMIN <small>Enormous Database Console · قاعدة البيانات الضخمة</small></h1>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn peri" id="btn-export-w" title="Download all workouts as JSON">⬇ Export Workouts (تصدير التمارين)</button>
      <button class="btn peri" id="btn-export-m" title="Download all meals as JSON">⬇ Export Meals (تصدير الوجبات)</button>
      <button class="btn" id="btn-refresh">↻ Refresh (تحديث)</button>
    </div>
  </header>

  <!-- ═══ STATS ═══ -->
  <section class="stats" id="stats" aria-label="Database statistics">
    <div class="stat"><div class="num" id="st-workouts">–</div><div class="lbl">Workouts (التمارين)</div><div class="sub" id="st-workouts-sub">loading…</div></div>
    <div class="stat"><div class="num" id="st-meals">–</div><div class="lbl">Meals (الوجبات)</div><div class="sub" id="st-meals-sub">loading…</div></div>
    <div class="stat"><div class="num" id="st-cats">–</div><div class="lbl">Workout Categories (أقسام التمارين)</div><div class="sub" id="st-cats-sub"></div></div>
    <div class="stat"><div class="num" id="st-cuis">–</div><div class="lbl">Cuisines (المطابخ)</div><div class="sub" id="st-cuis-sub"></div></div>
  </section>

  <!-- ═══ ACCURACY & SAFETY ═══ -->
  <section class="card" id="accuracy">
    <h2>Accuracy &amp; Safety (الدقة والسلامة)</h2>
    <p class="hint" style="margin-top:-6px">Live verification of the whole database — calorie math, level safety, allergen labels.
      (تحقّق حيّ من قاعدة البيانات كاملة — حسابات السعرات، سلامة المستويات، ملصقات الحساسية.)</p>
    <div class="row" style="margin-bottom:10px">
      <button class="btn peri" id="btn-verify">🛡 Run Verification (تشغيل الفحص)</button>
      <span id="verify-verdict" style="font-weight:700"></span>
    </div>
    <div class="scrollbox" style="max-height:260px">
      <table>
        <thead><tr><th>Check (الفحص)</th><th>Result (النتيجة)</th><th>Flagged (الملاحظ)</th><th style="width:45%">Details (التفاصيل)</th></tr></thead>
        <tbody id="verify-body"><tr><td style="color:var(--muted)">Press “Run Verification”. (اضغط تشغيل الفحص.)</td></tr></tbody>
      </table>
    </div>
  </section>

  <!-- ═══ BULK IMPORT ═══ -->
  <section class="grid2">
    <div class="card">
      <h2>Bulk Import (استيراد بالجملة)</h2>

      <label class="fld">Target (الهدف)</label>
      <div class="seg" id="import-target">
        <button class="on" data-t="workouts">🏋️ Workouts — التمارين</button>
        <button data-t="meals">🥗 Meals — الوجبات</button>
      </div>

      <label class="fld">Paste JSON or CSV (الصق JSON أو CSV)</label>
      <textarea id="import-text" placeholder='{"items":[{"name":"Barbell Squat — Power Reset","category":"Legs","level":"Advanced","caloriesPerMin":10.5,"muscleGroups":["Legs"],"equipment":["Barbell"],"instructions":["Scheme: 5×5 · rest 90 sec"],"tags":["Strength"]}]}'
        ></textarea>

      <div class="row">
        <span class="btn filelbl">📂 Upload .json / .csv (تحميل ملف)<input type="file" id="import-file" accept=".json,.csv,text/csv,application/json"></span>
        <button class="btn" id="btn-preview">👁 Preview 5 rows (معاينة)</button>
        <button class="btn primary" id="btn-import">⬆ Import (استيراد)</button>
      </div>
      <p class="hint">CSV needs a header row: name,category,level,caloriesPerMin,muscleGroups,equipment,instructions,tags —
        or for meals: name,type,cuisine,calories,protein,carbs,fat,ingredients,tags.
        Arrays accept JSON or pipe-separated (“a|b”). Existing slugs are updated — re-importing never duplicates.
        (للـ CSV: صف العناوين مطلوب — التكرار لا يُنشئ نسخاً مضاعفة.)</p>

      <div class="report" id="import-report"></div>
    </div>

    <div class="card">
      <h2>Preview (معاينة أول ٥ صفوف)</h2>
      <div class="preview" id="preview"><table><tbody><tr><td style="color:var(--muted)">Paste data or upload a file, then press Preview.
        (الصق البيانات أو حمّل ملفاً ثم اضغط معاينة.)</td></tr></tbody></table></div>
    </div>
  </section>

  <!-- ═══ BROWSER ═══ -->
  <section class="card">
    <h2 id="browser-title">Database Browser (استعراض قاعدة البيانات)</h2>
    <div class="toolbar">
      <div class="seg" id="browse-target">
        <button class="on" data-t="workouts">🏋️ Workouts</button>
        <button data-t="meals">🥗 Meals</button>
      </div>
      <input type="text" id="browse-q" placeholder="Search by name… (ابحث بالاسم)">
      <select id="browse-filter" style="max-width:200px"><option value="">All categories / types (الكل)</option></select>
      <select id="browse-limit" style="max-width:120px">
        <option>10</option><option selected>25</option><option>50</option><option>100</option><option>200</option>
      </select>
    </div>
    <div class="scrollbox">
      <table>
        <thead id="browser-head"></thead>
        <tbody id="browser-body"><tr><td style="color:var(--muted)">Loading… (جارٍ التحميل)</td></tr></tbody>
      </table>
    </div>
    <div class="pager">
      <span id="pager-info">–</span>
      <button class="btn" id="pg-prev">‹ Prev</button>
      <button class="btn" id="pg-next">Next ›</button>
    </div>
  </section>

  <footer class="bot">Volta enormous-database console · additive infrastructure — the app's IndexedDB seeding is untouched ·
    (أداة إدارية — لا تؤثر على عمل التطبيق)</footer>
</div>

<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = { importType: "workouts", browseType: "workouts", page: 1, q: "", filter: "", limit: 25, total: 0, totalPages: 1 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, bad) {
    var r = $("import-report");
    r.style.display = "block"; r.classList.remove("ok");
    r.innerHTML = '<div class="big">' + esc(msg) + "</div>";
    if (bad) r.querySelector(".big").style.color = "var(--red)";
  }

  // ─── mini CSV parser (matches server-side behaviour) ────────────────────
  function parseCsv(text) {
    var rows = [], cur = [], field = "", q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cur.push(field); field = ""; }
      else if (ch === "\\n" || ch === "\\r") {
        if (ch === "\\r" && text.charAt(i + 1) === "\\n") i++;
        cur.push(field); field = "";
        if (cur.length > 1 || cur[0] !== "") rows.push(cur);
        cur = [];
      } else field += ch;
    }
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
    if (rows.length < 2) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    return rows.slice(1).map(function (cells) {
      var o = {}; head.forEach(function (h, j) { o[h] = (cells[j] || "").trim(); }); return o;
    });
  }
  function extractRows(text) {
    var t = (text || "").trim();
    if (!t) return null;
    if (t.charAt(0) === "{" || t.charAt(0) === "[") {
      try {
        var p = JSON.parse(t);
        if (Array.isArray(p)) return { rows: p, format: "json" };
        if (p && typeof p === "object" && Array.isArray(p.items)) return { rows: p.items, format: "json" };
        if (p && typeof p === "object") return { rows: [p], format: "json" };
      } catch (e) { /* fall through to CSV */ }
    }
    var rows = parseCsv(t);
    return rows.length ? { rows: rows, format: "csv" } : null;
  }

  // ─── stats ───────────────────────────────────────────────────────────────
  function loadStats() {
    return fetch("/api/db/stats").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "stats failed");
      $("st-workouts").textContent = d.workouts.total.toLocaleString();
      $("st-meals").textContent = d.meals.total.toLocaleString();
      $("st-cats").textContent = d.workouts.categories.length;
      $("st-cuis").textContent = d.meals.cuisines.length;
      $("st-workouts-sub").innerHTML = d.workouts.categories.map(function (c) {
        return '<span class="chip">' + esc(c.key) + " <b>" + c.count + "</b></span>"; }).join("");
      $("st-meals-sub").innerHTML = d.meals.types.map(function (t) {
        return '<span class="chip">' + esc(t.key) + " <b>" + t.count + "</b></span>"; }).join("");
      $("st-cats-sub").innerHTML = "by category (حسب القسم)";
      $("st-cuis-sub").innerHTML = "by cuisine (حسب المطبخ)";
    }).catch(function (e) { toast("Stats error: " + e.message, true); });
  }

  // ─── browser ─────────────────────────────────────────────────────────────
  var HEADS = {
    workouts: ["Name (الاسم)", "Category (القسم)", "Level (المستوى)", "Equipment (الأدوات)", "kcal/min", "Tags (وسوم)", "Source"],
    meals: ["Name (الاسم)", "Type (النوع)", "Cuisine (المطبخ)", "kcal", "P/C/F", "Tags (وسوم)", "Source"]
  };
  function loadBrowser() {
    var t = state.browseType;
    var url = "/api/db/" + t + "?page=" + state.page + "&limit=" + state.limit;
    if (state.q) url += "&q=" + encodeURIComponent(state.q);
    if (state.filter) url += "&" + (t === "workouts" ? "category=" : "type=") + encodeURIComponent(state.filter);
    $("browser-head").innerHTML = "<tr>" + HEADS[t].map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr>";
    $("browser-body").innerHTML = '<tr><td style="color:var(--muted)"><span class="spin"></span> Loading… (جارٍ التحميل)</td></tr>';
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "query failed");
      state.total = d.total; state.totalPages = d.totalPages;
      $("pager-info").textContent = d.total.toLocaleString() + " rows · page " + d.page + " / " + d.totalPages +
        " (صفحة " + d.page + " من " + d.totalPages + ")";
      if (!d.items.length) {
        $("browser-body").innerHTML = '<tr><td style="color:var(--muted)">No rows match. (لا توجد نتائج)</td></tr>';
        return;
      }
      $("browser-body").innerHTML = d.items.map(function (r) {
        return t === "workouts" ? workoutRow(r) : mealRow(r);
      }).join("");
    }).catch(function (e) {
      $("browser-body").innerHTML = '<tr><td style="color:var(--red)">Error: ' + esc(e.message) + "</td></tr>";
    });
  }
  function workoutRow(r) {
    return "<tr><td><b>" + esc(r.name) + "</b></td><td>" + esc(r.category) + "</td><td>" + esc(r.level) +
      "</td><td>" + r.equipment.map(function (x) { return '<span class="tag">' + esc(x) + "</span>"; }).join("") +
      '</td><td class="num">' + r.caloriesPerMin +
      "</td><td>" + r.tags.map(function (x) { return '<span class="tag amber">' + esc(x) + "</span>"; }).join("") +
      "</td><td>" + esc(r.source) + "</td></tr>";
  }
  function mealRow(r) {
    return "<tr><td><b>" + esc(r.name) + "</b></td><td>" + esc(r.type) + "</td><td>" + esc(r.cuisine) +
      '</td><td class="num">' + r.calories + '</td><td class="num">' + r.protein + "/" + r.carbs + "/" + r.fat +
      "</td><td>" + r.tags.map(function (x) { return '<span class="tag amber">' + esc(x) + "</span>"; }).join("") +
      "</td><td>" + esc(r.source) + "</td></tr>";
  }
  function loadFilterOptions() {
    fetch("/api/db/stats").then(function (r) { return r.json(); }).then(function (d) {
      var sel = $("browse-filter");
      sel.innerHTML = '<option value="">All categories / types (الكل)</option>';
      var list = state.browseType === "workouts" ? d.workouts.categories : d.meals.types;
      list.forEach(function (c) {
        var o = document.createElement("option"); o.value = c.key;
        o.textContent = c.key + " (" + c.count + ")"; sel.appendChild(o);
      });
    }).catch(function () {});
  }

  // ─── preview + import ────────────────────────────────────────────────────
  function renderPreview() {
    var ex = extractRows($("import-text").value);
    var box = $("preview");
    if (!ex || !ex.rows.length) {
      box.innerHTML = '<table><tbody><tr><td style="color:var(--red)">No rows detected — paste JSON or CSV with a header row. ' +
        "(لم يتم التعرف على صفوف — الصق JSON أو CSV مع صف عناوين.)</td></tr></tbody></table>";
      return;
    }
    var first = ex.rows[0] || {};
    var cols = Object.keys(first).slice(0, 8);
    var head = "<tr>" + cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr>";
    var body = ex.rows.slice(0, 5).map(function (r) {
      return "<tr>" + cols.map(function (c) { return "<td>" + esc(r[c]) + "</td>"; }).join("") + "</tr>";
    }).join("");
    box.innerHTML = '<table><thead>' + head + "</thead><tbody>" + body + "</tbody></table>" +
      '<div style="padding:8px 10px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)">' +
      ex.rows.length.toLocaleString() + " rows detected · format: " + ex.format +
      " (عدد الصفوف المكتشفة: " + ex.rows.length.toLocaleString() + ")</div>";
  }
  function runImport() {
    var text = $("import-text").value;
    var ex = extractRows(text);
    if (!ex || !ex.rows.length) { toast("Nothing to import — paste JSON/CSV first. (لا يوجد ما يتم استيراده)", true); return; }
    var btn = $("btn-import"); btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> Importing… (جارٍ الاستيراد)';
    var t0 = Date.now();
    fetch("/api/db/" + state.importType, {
      method: "POST", headers: { "Content-Type": ex.format === "csv" ? "text/csv" : "application/json" }, body: text
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        btn.disabled = false; btn.innerHTML = "⬆ Import (استيراد)";
        var j = res.j;
        var r = $("import-report");
        r.style.display = "block";
        if (!res.j || res.j.ok === false) {
          r.className = "report"; r.classList.remove("ok");
          r.innerHTML = '<div class="big" style="color:var(--red)">Import failed (HTTP ' + res.status + "): " + esc((j && j.error) || "unknown") + "</div>";
          return;
        }
        r.className = "report ok";
        var html = '<div class="big oktext">✔ Import finished in ' + ((Date.now() - t0) / 1000).toFixed(1) + "s — " +
          "inserted " + j.inserted + " · updated " + j.updated + " · skipped " + j.skipped +
          " (أُضيف " + j.inserted + " · حُدّث " + j.updated + " · تجاهُل " + j.skipped + ")</div>";
        if (j.errors && j.errors.length) {
          html += '<div style="color:var(--muted);font-size:12px">' + j.errors.length + " row(s) with errors (صفوف بها أخطاء):</div>" +
            '<div class="errs">' + j.errors.slice(0, 100).map(function (e) {
              return "<div>Row " + e.row + " — " + esc(e.message) + "</div>"; }).join("") + "</div>";
        }
        r.innerHTML = html;
        loadStats(); loadFilterOptions(); loadBrowser(); loadVerify();
      })
      .catch(function (e) {
        btn.disabled = false; btn.innerHTML = "⬆ Import (استيراد)";
        toast("Import error: " + e.message, true);
      });
  }

  // ─── export ──────────────────────────────────────────────────────────────
  function exportJson(type, btn) {
    var old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Exporting…';
    fetch("/api/db/export?type=" + type).then(function (r) { return r.json(); }).then(function (d) {
      btn.disabled = false; btn.innerHTML = old;
      if (!d.ok) { toast("Export failed: " + (d.error || "unknown"), true); return; }
      var blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "volta-" + type + "-export.json";
      document.body.appendChild(a); a.click(); a.remove();
      toast("Exported " + d.count + " " + type + " → " + a.download + " (تم التصدير)", false);
      var r = $("import-report"); r.className = "report ok"; r.style.display = "block";
      r.innerHTML = '<div class="big oktext">✔ Exported ' + d.count + " " + esc(type) + " → " + esc(a.download) +
        " (تم تنزيل " + d.count + " سجلاً)</div>";
    }).catch(function (e) { btn.disabled = false; btn.innerHTML = old; toast("Export error: " + e.message, true); });
  }

  // ─── accuracy & safety verification ────────────────────────────────
  function loadVerify() {
    var body = $("verify-body");
    body.innerHTML = '<tr><td style="color:var(--muted)">Checking… (جارٍ الفحص)</td></tr>';
    fetch("/api/db/verify").then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { body.innerHTML = '<tr><td style="color:#ff6b6b">Verify failed: ' + esc(d.error || "unknown") + '</td></tr>'; return; }
      var okIcon = '<span style="color:#4ade80">✔ PASS</span>';
      var badIcon = '<span style="color:#ff6b6b">✘ FAIL</span>';
      body.innerHTML = d.checks.map(function (c) {
        var det = (c.samples && c.samples.length)
          ? c.samples.map(esc).join(" · ")
          : esc(c.note || (c.flagged === 0 ? "All " + c.total + " rows clean" : ""));
        return "<tr><td>" + esc(c.label) + "</td><td>" + (c.status === "pass" ? okIcon : badIcon) +
          "</td><td>" + c.flagged + " / " + c.total + "</td><td style=\\"color:var(--muted);font-size:11px\\">" + det + "</td></tr>";
      }).join("");
      var v = $("verify-verdict");
      v.style.color = d.passed ? "#4ade80" : "#ff6b6b";
      v.textContent = d.passed ? "✔ ALL CHECKS PASSED (كل الفحوصات ناجحة)" : "✘ ISSUES FOUND (توجد ملاحظات)";
    }).catch(function (e) {
      body.innerHTML = '<tr><td>Verify error: ' + esc(e.message) + '</td></tr>';
    });
  }

  // ─── wiring ──────────────────────────────────────────────────────────────
  function segWire(id, onPick) {
    $(id).addEventListener("click", function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      Array.prototype.forEach.call($(id).children, function (x) { x.classList.remove("on"); });
      b.classList.add("on"); onPick(b.getAttribute("data-t"));
    });
  }
  segWire("import-target", function (t) { state.importType = t; });
  segWire("browse-target", function (t) {
    state.browseType = t; state.page = 1; state.filter = "";
    $("browser-title").textContent = t === "workouts" ? "Workout Browser (استعراض التمارين)" : "Meal Browser (استعراض الوجبات)";
    loadFilterOptions(); loadBrowser();
  });
  $("btn-preview").addEventListener("click", renderPreview);
  $("btn-import").addEventListener("click", runImport);
  $("btn-refresh").addEventListener("click", function () { loadStats(); loadFilterOptions(); loadBrowser(); loadVerify(); });
  $("btn-verify").addEventListener("click", loadVerify);
  $("btn-export-w").addEventListener("click", function () { exportJson("workouts", this); });
  $("btn-export-m").addEventListener("click", function () { exportJson("meals", this); });
  $("import-file").addEventListener("change", function (ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { $("import-text").value = String(reader.result || ""); renderPreview(); };
    reader.readAsText(f);
  });
  var qTimer = null;
  $("browse-q").addEventListener("input", function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { state.q = $("browse-q").value.trim(); state.page = 1; loadBrowser(); }, 300);
  });
  $("browse-filter").addEventListener("change", function () { state.filter = this.value; state.page = 1; loadBrowser(); });
  $("browse-limit").addEventListener("change", function () { state.limit = parseInt(this.value, 10) || 25; state.page = 1; loadBrowser(); });
  $("pg-prev").addEventListener("click", function () { if (state.page > 1) { state.page--; loadBrowser(); } });
  $("pg-next").addEventListener("click", function () { if (state.page < state.totalPages) { state.page++; loadBrowser(); } });

  loadStats(); loadFilterOptions(); loadBrowser(); loadVerify();
})();
</script>
</body>
</html>
`;

module.exports = async (req, res) => {
  // GET only — every other method answers 405 plain text.
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed — GET only');
    return;
  }

  // Optional light protection: when ADMIN_KEY is set, require ?key=<ADMIN_KEY>.
  // When it is unset (sandbox default) the console is open.
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey) {
    let provided = null;
    try {
      provided = new URL(req.url, 'http://localhost').searchParams.get('key');
    } catch (e) {
      provided = null;
    }
    if (provided !== adminKey) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(UNAUTHORIZED_HTML);
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(ADMIN_HTML);
};
