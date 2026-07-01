// =========================================================
// НАСТРОЙКА SUPABASE — впиши свои значения из Project Settings → API
// =========================================================
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================================
// СОСТОЯНИЕ
// =========================================================
let profile = null;       // текущий профиль (из таблицы profiles)
let isStaff = false;      // teacher/admin?
let subjectsCache = [];
let classesCache = [];
let studentsCache = [];   // все ученики (для форм у учителя)

const WEEKDAYS = [1,2,3,4,5]; // Пн–Пт

// =========================================================
// I18N ПРИМЕНЕНИЕ
// =========================================================
function applyI18n() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === currentLang);
  });
  if (profile) {
    document.getElementById("topbarWelcome").textContent = t("welcome") + ",";
    document.getElementById("roleBadge").textContent = t("role_" + profile.role);
    renderActiveView(); // перерисовать текущий раздел с новыми текстами
  }
}

document.querySelectorAll(".lang-btn").forEach(btn => {
  btn.addEventListener("click", () => { setLang(btn.dataset.lang); applyI18n(); });
});

// =========================================================
// АВТОРИЗАЦИЯ
// =========================================================
const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox = document.getElementById("loginErrorMsg");
  errBox.hidden = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errBox.textContent = t("loginError");
    errBox.hidden = false;
    return;
  }
  await onLoggedIn(data.user.id);
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  profile = null;
  appEl.hidden = true;
  loginScreen.hidden = false;
});

async function onLoggedIn(userId) {
  const { data, error } = await sb.from("profiles").select("*").eq("id", userId).single();
  if (error || !data) {
    document.getElementById("loginErrorMsg").textContent = t("error_generic");
    document.getElementById("loginErrorMsg").hidden = false;
    return;
  }
  profile = data;
  isStaff = profile.role === "teacher" || profile.role === "admin";
  setLang(profile.lang || currentLang);

  loginScreen.hidden = true;
  appEl.hidden = false;

  document.getElementById("topbarUserName").textContent = profile.full_name;
  document.querySelectorAll(".staff-only").forEach(el => el.hidden = !isStaff);

  await preloadReferenceData();
  applyI18n();
  setActiveView("grades");
}

// восстановление сессии при перезагрузке страницы
(async function initSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await onLoggedIn(session.user.id);
})();

// =========================================================
// СПРАВОЧНЫЕ ДАННЫЕ (предметы, классы, ученики) — нужны для форм
// =========================================================
async function preloadReferenceData() {
  const [{ data: subjects }, { data: classes }] = await Promise.all([
    sb.from("subjects").select("*").order("name_et"),
    sb.from("classes").select("*").order("name"),
  ]);
  subjectsCache = subjects || [];
  classesCache = classes || [];

  if (isStaff) {
    const { data: students } = await sb.from("profiles").select("*").eq("role", "student").order("full_name");
    studentsCache = students || [];
  }
}

function subjectName(s) { return currentLang === "ru" ? s.name_ru : s.name_et; }

// =========================================================
// НАВИГАЦИЯ
// =========================================================
const VIEWS = ["grades", "homework", "remarks", "lessons", "schedule", "council"];

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => setActiveView(btn.dataset.view));
});

function setActiveView(view) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  VIEWS.forEach(v => {
    document.getElementById("view" + capitalize(v)).hidden = v !== view;
  });
  window._activeView = view;
  renderActiveView();
}

function renderActiveView() {
  const view = window._activeView || "grades";
  const renderers = {
    grades: renderGrades,
    homework: renderHomework,
    remarks: renderRemarks,
    lessons: renderLessons,
    schedule: renderSchedule,
    council: renderCouncil,
  };
  renderers[view]?.();
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// =========================================================
// ОБЩИЕ ХЕЛПЕРЫ РЕНДЕРА
// =========================================================
function emptyState(key) {
  return `<div class="empty-state">${t(key)}</div>`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString(currentLang === "ru" ? "ru-RU" : "et-EE");
}

// =========================================================
// ОЦЕНКИ
// =========================================================
async function renderGrades() {
  const box = document.getElementById("gradesContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("grades").select("*, subjects(name_et,name_ru), profiles!grades_student_id_fkey(full_name)").order("date", { ascending: false });
  if (!isStaff) query = query.eq("student_id", profile.id);
  const { data, error } = await query;

  if (error || !data || data.length === 0) { box.innerHTML = emptyState("grades_empty"); return; }

  box.innerHTML = `<table class="data-table"><thead><tr>
    <th>${t("col_date")}</th><th>${t("col_subject")}</th>
    ${isStaff ? `<th>${t("col_student")}</th>` : ""}
    <th>${t("col_grade")}</th><th>${t("col_comment")}</th>
  </tr></thead><tbody>
  ${data.map(g => `<tr>
    <td>${fmtDate(g.date)}</td>
    <td>${g.subjects ? subjectName(g.subjects) : "—"}</td>
    ${isStaff ? `<td>${g.profiles?.full_name || "—"}</td>` : ""}
    <td><span class="grade-badge">${escapeHtml(g.grade)}</span></td>
    <td>${escapeHtml(g.comment || "—")}</td>
  </tr>`).join("")}
  </tbody></table>`;
}

document.getElementById("addGradeBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("grades_title"), [
    field("select", "student_id", t("select_student"), studentsCache.map(s => [s.id, s.full_name])),
    field("select", "subject_id", t("select_subject"), subjectsCache.map(s => [s.id, subjectName(s)])),
    field("text", "grade", t("col_grade")),
    field("text", "comment", t("col_comment"), null, false),
    field("date", "date", t("col_date")),
  ], async (values) => {
    await sb.from("grades").insert({ ...values, teacher_id: profile.id });
    renderGrades();
  });
});

// =========================================================
// ДОМАШНИЕ ЗАДАНИЯ
// =========================================================
async function renderHomework() {
  const box = document.getElementById("homeworkContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("homework").select("*, subjects(name_et,name_ru), classes(name)").order("due_date", { ascending: true });
  if (!isStaff) query = query.eq("class_id", profile.class_id);
  const { data, error } = await query;

  if (error || !data || data.length === 0) { box.innerHTML = emptyState("homework_empty"); return; }

  box.innerHTML = `<table class="data-table"><thead><tr>
    <th>${t("col_due")}</th><th>${t("col_subject")}</th><th>${t("col_description")}</th>
  </tr></thead><tbody>
  ${data.map(h => `<tr>
    <td>${fmtDate(h.due_date)}</td>
    <td>${h.subjects ? subjectName(h.subjects) : "—"}</td>
    <td>${escapeHtml(h.description)}</td>
  </tr>`).join("")}
  </tbody></table>`;
}

document.getElementById("addHomeworkBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("homework_title"), [
    field("select", "class_id", t("select_class"), classesCache.map(c => [c.id, c.name])),
    field("select", "subject_id", t("select_subject"), subjectsCache.map(s => [s.id, subjectName(s)])),
    field("textarea", "description", t("col_description")),
    field("date", "due_date", t("col_due")),
  ], async (values) => {
    await sb.from("homework").insert({ ...values, teacher_id: profile.id });
    renderHomework();
  });
});

// =========================================================
// ЗАМЕЧАНИЯ / KIITUS
// =========================================================
async function renderRemarks() {
  const box = document.getElementById("remarksContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("remarks").select("*, profiles!remarks_student_id_fkey(full_name)").order("date", { ascending: false });
  if (!isStaff) query = query.eq("student_id", profile.id);
  const { data, error } = await query;

  if (error || !data || data.length === 0) { box.innerHTML = emptyState("remarks_empty"); return; }

  box.innerHTML = `<table class="data-table"><thead><tr>
    <th>${t("col_date")}</th>
    ${isStaff ? `<th>${t("col_student")}</th>` : ""}
    <th></th><th>${t("col_comment")}</th>
  </tr></thead><tbody>
  ${data.map(r => `<tr>
    <td>${fmtDate(r.date)}</td>
    ${isStaff ? `<td>${r.profiles?.full_name || "—"}</td>` : ""}
    <td><span class="tag ${r.type === 'kiitus' ? 'tag-kiitus' : 'tag-remark'}">${t(r.type === 'kiitus' ? 'type_kiitus' : 'type_remark')}</span></td>
    <td>${escapeHtml(r.text)}</td>
  </tr>`).join("")}
  </tbody></table>`;
}

document.getElementById("addRemarkBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("remarks_title"), [
    field("select", "student_id", t("select_student"), studentsCache.map(s => [s.id, s.full_name])),
    field("select", "type", "", [["remark", t("type_remark")], ["kiitus", t("type_kiitus")]]),
    field("textarea", "text", t("col_comment")),
    field("date", "date", t("col_date")),
  ], async (values) => {
    await sb.from("remarks").insert({ ...values, teacher_id: profile.id });
    renderRemarks();
  });
});

// =========================================================
// TUNNIKIRJELDUSED (описания уроков)
// =========================================================
async function renderLessons() {
  const box = document.getElementById("lessonsContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("lessons").select("*, subjects(name_et,name_ru), classes(name)").order("date", { ascending: false });
  if (!isStaff) query = query.eq("class_id", profile.class_id);
  const { data, error } = await query;

  if (error || !data || data.length === 0) { box.innerHTML = emptyState("lessons_empty"); return; }

  box.innerHTML = `<table class="data-table"><thead><tr>
    <th>${t("col_date")}</th><th>${t("col_subject")}</th><th>${t("col_topic")}</th>
  </tr></thead><tbody>
  ${data.map(l => `<tr>
    <td>${fmtDate(l.date)}</td>
    <td>${l.subjects ? subjectName(l.subjects) : "—"}</td>
    <td>${escapeHtml(l.topic)}</td>
  </tr>`).join("")}
  </tbody></table>`;
}

document.getElementById("addLessonBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("lessons_title"), [
    field("select", "class_id", t("select_class"), classesCache.map(c => [c.id, c.name])),
    field("select", "subject_id", t("select_subject"), subjectsCache.map(s => [s.id, subjectName(s)])),
    field("text", "topic", t("col_topic")),
    field("date", "date", t("col_date")),
  ], async (values) => {
    await sb.from("lessons").insert({ ...values, teacher_id: profile.id });
    renderLessons();
  });
});

// =========================================================
// РАСПИСАНИЕ
// =========================================================
async function renderSchedule() {
  const box = document.getElementById("scheduleContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("schedule").select("*, subjects(name_et,name_ru)").order("start_time", { ascending: true });
  if (!isStaff) query = query.eq("class_id", profile.class_id);
  const { data, error } = await query;

  if (error) { box.innerHTML = emptyState("error_generic"); return; }

  const byDay = {};
  WEEKDAYS.forEach(d => byDay[d] = []);
  (data || []).forEach(s => { if (byDay[s.weekday]) byDay[s.weekday].push(s); });

  box.innerHTML = `<div class="schedule-grid">${WEEKDAYS.map(d => `
    <div class="schedule-day">
      <div class="day-head">${t("weekday_" + d)}</div>
      ${byDay[d].length === 0 ? `<div class="day-empty"></div>` : byDay[d].map(s => `
        <div class="lesson-block">
          <span class="lb-time">${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
          <span class="lb-subject">${s.subjects ? subjectName(s.subjects) : "—"}</span>
          <span class="lb-meta">${escapeHtml(s.room || "")}</span>
        </div>`).join("")}
    </div>`).join("")}</div>`;
}

document.getElementById("addScheduleBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("schedule_title"), [
    field("select", "class_id", t("select_class"), classesCache.map(c => [c.id, c.name])),
    field("select", "subject_id", t("select_subject"), subjectsCache.map(s => [s.id, subjectName(s)])),
    field("select", "weekday", "", WEEKDAYS.map(d => [d, t("weekday_" + d)])),
    field("time", "start_time", "Start"),
    field("time", "end_time", "End"),
    field("text", "room", "Room", null, false),
  ], async (values) => {
    values.weekday = parseInt(values.weekday, 10);
    await sb.from("schedule").insert({ ...values, teacher_id: profile.id });
    renderSchedule();
  });
});

// =========================================================
// ÕPPENÕUKOGU OTSUS (решения педсовета)
// =========================================================
async function renderCouncil() {
  const box = document.getElementById("councilContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("council_decisions").select("*").order("date", { ascending: false });
  if (!isStaff) query = query.or(`student_id.eq.${profile.id},student_id.is.null`);
  const { data, error } = await query;

  if (error || !data || data.length === 0) { box.innerHTML = emptyState("council_empty"); return; }

  box.innerHTML = data.map(c => `
    <div class="empty-state" style="text-align:left; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="color:var(--ink)">${escapeHtml(currentLang === "ru" && c.title_ru ? c.title_ru : c.title_et)}</strong>
        <span class="tag ${c.is_translated ? 'tag-yes' : 'tag-no'}">${t(c.is_translated ? "translated_yes" : "translated_no")}</span>
      </div>
      <p style="margin:0; color:var(--ink-soft); font-size:13px;">${fmtDate(c.date)}</p>
      <p style="margin:8px 0 0; color:var(--ink);">${escapeHtml((currentLang === "ru" && c.text_ru) ? c.text_ru : c.text_et)}</p>
    </div>`).join("");
}

document.getElementById("addCouncilBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("council_title"), [
    field("select", "student_id", t("select_student"), [["", "—"], ...studentsCache.map(s => [s.id, s.full_name])], false),
    field("text", "title_et", "Title (ET)"),
    field("text", "title_ru", "Title (RU)", null, false),
    field("textarea", "text_et", "Text (ET)"),
    field("textarea", "text_ru", "Text (RU)", null, false),
    field("checkbox", "is_translated", t("translated_yes")),
    field("date", "date", t("col_date")),
  ], async (values) => {
    values.is_translated = !!values.is_translated;
    if (!values.student_id) values.student_id = null;
    await sb.from("council_decisions").insert({ ...values, teacher_id: profile.id });
    renderCouncil();
  });
});

// =========================================================
// УНИВЕРСАЛЬНОЕ МОДАЛЬНОЕ ОКНО
// =========================================================
const modalOverlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const modalForm = document.getElementById("modalForm");

function field(type, name, label, options, required = true) {
  return { type, name, label, options, required };
}

function openModal(title, fields, onSubmit) {
  modalTitle.textContent = title;
  modalForm.innerHTML = fields.map(f => {
    const req = f.required ? "required" : "";
    if (f.type === "select") {
      return `<label>${f.label}<select name="${f.name}" ${req}>
        ${f.options.map(([v, l]) => `<option value="${v}">${escapeHtml(String(l))}</option>`).join("")}
      </select></label>`;
    }
    if (f.type === "textarea") {
      return `<label>${f.label}<textarea name="${f.name}" ${req}></textarea></label>`;
    }
    if (f.type === "checkbox") {
      return `<label style="flex-direction:row; align-items:center; gap:8px;"><input type="checkbox" name="${f.name}" style="width:auto;" />${f.label}</label>`;
    }
    return `<label>${f.label}<input type="${f.type}" name="${f.name}" ${req} /></label>`;
  }).join("") + `
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="modalCancelBtn">${t("cancel")}</button>
      <button type="submit" class="btn btn-primary">${t("save")}</button>
    </div>`;

  modalOverlay.hidden = false;

  document.getElementById("modalCancelBtn").onclick = () => { modalOverlay.hidden = true; };

  modalForm.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(modalForm);
    const values = {};
    fields.forEach(f => {
      values[f.name] = f.type === "checkbox" ? fd.get(f.name) === "on" : fd.get(f.name);
    });
    await onSubmit(values);
    modalOverlay.hidden = true;
  };
}

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) modalOverlay.hidden = true;
});

// =========================================================
// БЕЗОПАСНОСТЬ ВЫВОДА
// =========================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}