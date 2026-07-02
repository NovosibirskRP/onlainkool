// =========================================================
// НАСТРОЙКА SUPABASE — впиши свои значения из Project Settings → API
// =========================================================
const SUPABASE_URL = "https://fjndxzblhhklmichckka.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Af780eCTmG38Q3VK6JWFFw_ORNS-ihH";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================================
// СОСТОЯНИЕ
// =========================================================
let profile = null;       // текущий профиль (из таблицы profiles)
let isStaff = false;      // teacher/admin?
let isAdmin = false;
let subjectsCache = [];
let classesCache = [];
let studentsCache = [];   // все ученики (для форм у учителя)
let allProfilesCache = []; // для админа

const WEEKDAYS = [1,2,3,4,5]; // Пн–Пт
const SUBJECT_COLORS = ["#2D5DA1", "#2E7D6B", "#C99A3D", "#D1553F", "#6B4FA0", "#1B849C", "#B0553F", "#3E6E3A"];

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
// АВТОРИЗАЦИЯ (по касутajanimi / имени пользователя)
// =========================================================
const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox = document.getElementById("loginErrorMsg");
  errBox.hidden = true;

  // 1) находим email, привязанный к этому нику, через RPC-функцию в базе
  const { data: email, error: lookupError } = await sb.rpc("email_by_username", { uname: username });

  if (lookupError || !email) {
    errBox.textContent = t("loginError");
    errBox.hidden = false;
    return;
  }

  // 2) обычный вход по email+паролю (пользователь этого email не видит)
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
  isAdmin = profile.role === "admin";
  setLang(profile.lang || currentLang);

  loginScreen.hidden = true;
  appEl.hidden = false;

  document.getElementById("topbarUserName").textContent = profile.full_name;
  document.getElementById("topbarAvatar").textContent = initials(profile.full_name);
  document.querySelectorAll(".staff-only").forEach(el => el.hidden = !isStaff);
  document.querySelectorAll(".admin-only").forEach(el => el.hidden = !isAdmin);

  await preloadReferenceData();
  applyI18n();
  setActiveView("grades");
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("");
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
  if (isAdmin) {
    const { data: all } = await sb.from("profiles").select("*").order("full_name");
    allProfilesCache = all || [];
  }
}

function subjectName(s) { return currentLang === "ru" ? s.name_ru : s.name_et; }
function subjectColor(subjectId) {
  const idx = subjectsCache.findIndex(s => s.id === subjectId);
  return SUBJECT_COLORS[(idx >= 0 ? idx : 0) % SUBJECT_COLORS.length];
}

// =========================================================
// НАВИГАЦИЯ
// =========================================================
const VIEWS = ["grades", "homework", "remarks", "lessons", "schedule", "council", "admin"];

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
    admin: renderAdmin,
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

  box.innerHTML = data.map(r => `
    <div class="notice-card ${r.type === 'kiitus' ? 'is-translated' : ''}">
      <div class="notice-head">
        <span class="notice-title">
          <span class="tag ${r.type === 'kiitus' ? 'tag-kiitus' : 'tag-remark'}">${t(r.type === 'kiitus' ? 'type_kiitus' : 'type_remark')}</span>
          ${isStaff ? ` &middot; ${escapeHtml(r.profiles?.full_name || "—")}` : ""}
        </span>
        <span class="notice-date">${fmtDate(r.date)}</span>
      </div>
      <p class="notice-body">${escapeHtml(r.text)}</p>
    </div>`).join("");
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
// РАСПИСАНИЕ — сетка в стиле Edupage
// =========================================================
async function renderSchedule() {
  const box = document.getElementById("scheduleContent");
  box.innerHTML = `<div class="empty-state">${t("loading")}</div>`;

  let query = sb.from("schedule").select("*, subjects(name_et,name_ru)").order("start_time", { ascending: true });
  if (!isStaff) query = query.eq("class_id", profile.class_id);
  const { data, error } = await query;

  if (error) { box.innerHTML = emptyState("error_generic"); return; }

  const rows = data || [];
  if (rows.length === 0) { box.innerHTML = emptyState("schedule_empty"); return; }

  // уникальные тайм-слоты (начало урока), отсортированные
  const slots = [...new Set(rows.map(r => r.start_time))].sort();

  const byDayAndSlot = {};
  rows.forEach(r => { byDayAndSlot[`${r.weekday}_${r.start_time}`] = r; });

  let cells = `<div class="sg-cell sg-head sg-corner"></div>`;
  WEEKDAYS.forEach(d => { cells += `<div class="sg-cell sg-head">${t("weekday_" + d)}</div>`; });

  slots.forEach(slot => {
    cells += `<div class="sg-cell sg-time">${slot.slice(0,5)}</div>`;
    WEEKDAYS.forEach(d => {
      const lesson = byDayAndSlot[`${d}_${slot}`];
      if (!lesson) { cells += `<div class="sg-cell"></div>`; return; }
      const color = subjectColor(lesson.subject_id);
      cells += `<div class="sg-cell">
        <div class="lesson-block" style="background:${color}1A; border-left-color:${color}; color:${color};">
          <span class="lb-time">${lesson.start_time.slice(0,5)}–${lesson.end_time.slice(0,5)}</span>
          <span class="lb-subject" style="color:var(--ink)">${lesson.subjects ? subjectName(lesson.subjects) : "—"}</span>
          <span class="lb-meta" style="color:var(--ink-soft)">${escapeHtml(lesson.room || "")}</span>
        </div>
      </div>`;
    });
  });

  box.innerHTML = `<div class="schedule-wrap"><div class="schedule-grid">${cells}</div></div>`;
}

document.getElementById("addScheduleBtn").addEventListener("click", () => {
  openModal(t("add_new") + ": " + t("schedule_title"), [
    field("select", "class_id", t("select_class"), classesCache.map(c => [c.id, c.name])),
    field("select", "subject_id", t("select_subject"), subjectsCache.map(s => [s.id, subjectName(s)])),
    field("select", "weekday", "", WEEKDAYS.map(d => [d, t("weekday_" + d + "_full")])),
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
    <div class="notice-card ${c.is_translated ? 'is-translated' : ''}">
      <div class="notice-head">
        <span class="notice-title">${escapeHtml(currentLang === "ru" && c.title_ru ? c.title_ru : c.title_et)}</span>
        <span class="tag ${c.is_translated ? 'tag-yes' : 'tag-no'}">${t(c.is_translated ? "translated_yes" : "translated_no")}</span>
      </div>
      <p class="notice-date" style="margin-bottom:6px;">${fmtDate(c.date)}</p>
      <p class="notice-body">${escapeHtml((currentLang === "ru" && c.text_ru) ? c.text_ru : c.text_et)}</p>
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
// АДМИН — КЛАССЫ И АККАУНТЫ
// =========================================================
function renderAdmin() {
  if (!isAdmin) return;
  const box = document.getElementById("adminContent");

  const classPills = classesCache.length
    ? `<div class="pill-list">${classesCache.map(c => `
        <span class="pill">${escapeHtml(c.name)}
          <button type="button" class="btn-ghost" style="padding:0;font-size:14px;line-height:1;cursor:pointer;border:none;background:none;color:var(--coral);" data-del-class="${c.id}">&times;</button>
        </span>`).join("")}</div>`
    : `<div class="empty-state">${t("admin_no_classes")}</div>`;

  const accountsRows = allProfilesCache.length
    ? `<table class="data-table"><thead><tr>
        <th>${t("admin_full_name")}</th><th>${t("col_username")}</th><th>${t("col_role")}</th><th>${t("col_class")}</th>
      </tr></thead><tbody>
      ${allProfilesCache.map(p => `<tr>
        <td>${escapeHtml(p.full_name)}</td>
        <td>${escapeHtml(p.username || "—")}</td>
        <td><span class="tag tag-role">${t("role_" + p.role)}</span></td>
        <td>${escapeHtml(classesCache.find(c => c.id === p.class_id)?.name || "—")}</td>
      </tr>`).join("")}
      </tbody></table>`
    : `<div class="empty-state">${t("admin_accounts_empty")}</div>`;

  box.innerHTML = `
    <div class="admin-grid">
      <div class="admin-card">
        <h3>${t("admin_classes_title")}</h3>
        <p class="hint">${t("admin_classes_hint")}</p>
        ${classPills}
        <form id="addClassForm" style="display:flex; gap:8px; margin-top:14px;">
          <input type="text" id="newClassName" placeholder="${t("admin_class_name")}" required
            style="flex:1; padding:9px 11px; border:1px solid var(--border); border-radius:8px;" />
          <button type="submit" class="btn btn-gold btn-sm">${t("admin_add_class")}</button>
        </form>
      </div>

      <div class="admin-card">
        <h3>${t("admin_accounts_title")}</h3>
        <p class="hint">${t("admin_accounts_hint")}</p>
        <button id="openAddAccountBtn" class="btn btn-primary btn-sm">${t("admin_add_account")}</button>
      </div>

      <div class="admin-card admin-card-full">
        <h3>${t("admin_accounts_title")}</h3>
        ${accountsRows}
      </div>
    </div>`;

  document.getElementById("addClassForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newClassName").value.trim();
    if (!name) return;
    const { error } = await sb.from("classes").insert({ name });
    if (!error) {
      await preloadReferenceData();
      renderAdmin();
    }
  });

  box.querySelectorAll("[data-del-class]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await sb.from("classes").delete().eq("id", btn.dataset.delClass);
      await preloadReferenceData();
      renderAdmin();
    });
  });

  document.getElementById("openAddAccountBtn").addEventListener("click", openAddAccountModal);
}

function openAddAccountModal() {
  openModal(t("admin_add_account"), [
    field("text", "full_name", t("admin_full_name")),
    field("text", "username", t("col_username")),
    field("email", "email", t("admin_email")),
    field("password", "password", t("password")),
    field("select", "role", t("admin_role"), [
      ["student", t("role_student")], ["teacher", t("role_teacher")],
      ["parent", t("role_parent")], ["admin", t("role_admin")],
    ]),
    field("select", "class_id", t("admin_class_optional"),
      [["", t("admin_no_class")], ...classesCache.map(c => [c.id, c.name])], false),
  ], async (values) => {
    const errBox = ensureAdminErrorBox();
    errBox.hidden = true;
    try {
      // отдельный клиент, чтобы signUp не подменил сессию текущего админа
      const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });

      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
        email: values.email,
        password: values.password,
      });
      if (signUpError || !signUpData.user) throw signUpError || new Error("no user");

      const { error: profileError } = await sb.from("profiles").insert({
        id: signUpData.user.id,
        full_name: values.full_name,
        username: values.username,
        role: values.role,
        class_id: values.class_id || null,
        lang: currentLang,
      });
      if (profileError) throw profileError;

      await preloadReferenceData();
      renderAdmin();
    } catch (err) {
      errBox.textContent = t("admin_account_error");
      errBox.hidden = false;
      throw err;
    }
  });
}

function ensureAdminErrorBox() {
  let box = document.getElementById("modalAdminError");
  if (!box) {
    box = document.createElement("p");
    box.id = "modalAdminError";
    box.className = "error-text";
    box.hidden = true;
    document.getElementById("modalForm").prepend(box);
  }
  return box;
}

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
    try {
      await onSubmit(values);
      modalOverlay.hidden = true;
    } catch (err) {
      // ошибка уже показана внутри onSubmit (если нужно) — модалку не закрываем
    }
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
