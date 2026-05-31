const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const state = {
  token: localStorage.getItem("eventshevent_token") || "",
  me: null,
  authMode: "login",
  profileOpen: false,
  studentView: "discover",
  masterTab: "applications",
  masterSearch: "",
  masterSelectedApplicationId: "",
  masterSelectedUserId: "",
  adminTab: "pending",
  adminSelectedEventId: "",
};

const venues = {
  "Ground Floor": ["Ground Floor Auditorium", "Waiting Area", "Main Lobby"],
  "First Floor": roomRange(1),
  "Second Floor": roomRange(2),
  "Third Floor": roomRange(3),
  "Fourth Floor": roomRange(4),
  "Fifth Floor": roomRange(5),
  "Sixth Floor": roomRange(6),
  Grounds: ["Mains Ground", "University Ground"],
};

const studentViews = [
  ["discover", "Discover Events"],
  ["host", "Host Event"],
  ["requested", "Requested Events"],
  ["applied", "Applied Events"],
  ["past", "Past Events"],
];

const statusLabels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const accountStatusLabels = {
  active: "Active",
  restricted: "Restricted",
  blocked: "Blocked",
};

initTheme();
boot();

document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;

  const action = control.dataset.action;
  event.preventDefault();

  try {
    if (action === "auth-mode") {
      state.authMode = control.dataset.mode;
      renderAuth();
    }

    if (action === "toggle-theme") toggleTheme();

    if (action === "toggle-profile") {
      state.profileOpen = !state.profileOpen;
      await renderDashboard();
    }

    if (action === "logout") logout();

    if (action === "retry-dashboard") {
      await renderDashboard();
    }

    if (action === "student-view") {
      state.studentView = control.dataset.view;
      await renderDashboard();
    }

    if (action === "master-tab") {
      state.masterTab = control.dataset.tab;
      state.masterSelectedApplicationId = "";
      state.masterSelectedUserId = "";
      await renderDashboard();
    }

    if (action === "select-application") {
      state.masterSelectedApplicationId = control.dataset.id;
      await renderDashboard();
    }

    if (action === "decide-application") {
      await api(`/api/master/applications/${control.dataset.id}/decide`, {
        method: "POST",
        body: { decision: control.dataset.decision },
      });
      state.masterSelectedApplicationId = "";
      showToast("Account application updated.");
      await renderDashboard();
    }

    if (action === "select-user") {
      state.masterSelectedUserId = control.dataset.id;
      await renderDashboard();
    }

    if (action === "change-user-role") {
      const nextRole = control.dataset.role;
      const label = roleTitleFor(nextRole).replace(" Portal", "");
      if (!window.confirm(`Change this account to ${label}?`)) return;

      await api(`/api/master/users/${control.dataset.id}/role`, {
        method: "PATCH",
        body: { role: nextRole },
      });
      state.masterTab = nextRole === "student" ? "students" : "administrators";
      state.masterSelectedUserId = control.dataset.id;
      showToast("Role updated.");
      await renderDashboard();
    }

    if (action === "change-user-status") {
      const nextStatus = control.dataset.status;
      if (!window.confirm(`Set this account to ${accountStatusLabels[nextStatus]}?`)) return;

      await api(`/api/master/users/${control.dataset.id}/status`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      showToast("Account status updated.");
      await renderDashboard();
    }

    if (action === "delete-user") {
      if (!window.confirm("Delete this account permanently from the approved-user list?")) return;

      await api(`/api/master/users/${control.dataset.id}`, { method: "DELETE" });
      state.masterSelectedUserId = "";
      showToast("Account deleted.");
      await renderDashboard();
    }

    if (action === "admin-tab") {
      state.adminTab = control.dataset.tab;
      state.adminSelectedEventId = "";
      await renderDashboard();
    }

    if (action === "select-event") {
      state.adminSelectedEventId = control.dataset.id;
      await renderDashboard();
    }

    if (action === "decide-event") {
      const note = document.querySelector(`[data-review-note="${control.dataset.id}"]`)?.value || "";
      await api(`/api/admin/events/${control.dataset.id}/decide`, {
        method: "POST",
        body: { decision: control.dataset.decision, note },
      });
      state.adminSelectedEventId = "";
      showToast(control.dataset.decision === "approve" ? "Event approved." : "Event rejected.");
      await renderDashboard();
    }

    if (action === "register-event") {
      await api(`/api/events/${control.dataset.id}/register`, { method: "POST" });
      showToast("You applied for this event.");
      await renderDashboard();
    }

    if (action === "unjoin-event") {
      await api(`/api/events/${control.dataset.id}/unjoin`, { method: "POST" });
      showToast("You unjoined this event.");
      await renderDashboard();
    }

    if (action === "vote-event") {
      const value = Number(control.dataset.value);
      await api(`/api/events/${control.dataset.id}/vote`, {
        method: "POST",
        body: { value },
      });
      showToast(value === 0 ? "Vote cleared." : "Vote updated.");
      await renderDashboard();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;

  event.preventDefault();

  try {
    if (form.dataset.form === "login") await submitLogin(form);
    if (form.dataset.form === "signup") await submitSignup(form);
    if (form.dataset.form === "event-request") await submitEventRequest(form);
    if (form.dataset.form === "master-search") {
      state.masterSearch = new FormData(form).get("q") || "";
      state.masterSelectedUserId = "";
      await renderDashboard();
    }
    if (form.dataset.form === "password") await submitPasswordChange(form);
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "event-floor") {
    updateVenueSelect(event.target.value);
  }

  if (event.target.id === "event-start") {
    updateEndTimeSelect(event.target.value);
  }

  if (event.target.matches("[data-file-status]")) {
    const target = document.querySelector(event.target.dataset.fileStatus);
    if (target) target.textContent = fileStatusText(event.target.files);
  }
});

async function boot() {
  if (!state.token) {
    renderAuth();
    return;
  }

  try {
    const data = await api("/api/me");
    state.me = data.user;
    await renderDashboard();
  } catch {
    logout(false);
  }
}

function initTheme() {
  const theme = localStorage.getItem("eventshevent_theme") || "light";
  document.body.dataset.theme = theme;
}

function toggleTheme() {
  const next = document.body.dataset.theme === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  localStorage.setItem("eventshevent_theme", next);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);

  if (options.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && path !== "/api/login") logout(false);
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The server took too long to respond. Refresh or redeploy and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function submitLogin(form) {
  const body = Object.fromEntries(new FormData(form));
  const data = await api("/api/login", { method: "POST", body });
  state.token = data.token;
  state.me = data.user;
  state.profileOpen = false;
  localStorage.setItem("eventshevent_token", state.token);
  showToast("Welcome to EventShevent.");
  await renderDashboard();
}

async function submitSignup(form) {
  const formData = new FormData(form);
  const file = form.querySelector('input[name="idCard"]')?.files?.[0];

  if (!file) throw new Error("Upload a college ID card image.");

  const idCardImage = await fileToDataUrl(file);
  await api("/api/signup", {
    method: "POST",
    body: {
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
      idCardImage,
    },
  });

  state.authMode = "login";
  showToast("Signup sent for master approval.");
  renderAuth();
}

async function submitEventRequest(form) {
  const formData = new FormData(form);
  const images = await filesToDataUrls(form.querySelector('input[name="images"]')?.files || [], 3);

  await api("/api/events/request", {
    method: "POST",
    body: {
      name: formData.get("name"),
      venueGroup: formData.get("venueGroup"),
      venue: formData.get("venue"),
      date: formData.get("date"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      description: formData.get("description"),
      remarks: formData.get("remarks"),
      images,
    },
  });

  state.studentView = "requested";
  showToast("Event request sent to administrators.");
  await renderDashboard();
}

async function submitPasswordChange(form) {
  const formData = new FormData(form);
  const userId = form.dataset.userId;
  const password = formData.get("password");
  await api(`/api/master/users/${userId}/password`, {
    method: "PATCH",
    body: { password },
  });
  showToast("Password updated.");
  await renderDashboard();
}

function logout(render = true) {
  state.token = "";
  state.me = null;
  state.profileOpen = false;
  localStorage.removeItem("eventshevent_token");
  if (render) renderAuth();
}

function renderAuth() {
  const isSignup = state.authMode === "signup";

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-visual">
        <div class="auth-brand">
          <span class="brand-mark">ES</span>
          <span>${brandName()}</span>
        </div>
        <div class="auth-copy">
          <h1>${brandName()}</h1>
          <p>College event requests, venue approvals, and student registrations in one calm portal.</p>
        </div>
      </section>
      <section class="auth-panel-wrap">
        <div class="auth-panel">
          <div class="button-row end">
            <button class="theme-switch" type="button" data-action="toggle-theme" aria-label="Toggle light and dark mode"><span></span></button>
          </div>
          <div class="segmented" role="tablist" aria-label="Authentication">
            <button type="button" data-action="auth-mode" data-mode="login" class="${!isSignup ? "active" : ""}">Login</button>
            <button type="button" data-action="auth-mode" data-mode="signup" class="${isSignup ? "active" : ""}">Sign up</button>
          </div>
          ${isSignup ? signupForm() : loginForm()}
        </div>
      </section>
    </main>
  `;
}

function loginForm() {
  return `
    <form class="form-grid" data-form="login">
      <div>
        <h2>Enter your portal</h2>
        <p>Students, administrators, and master control use the same login.</p>
      </div>
      <label>
        Email
        <input name="email" type="email" autocomplete="email" required>
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>
      <button class="btn full" type="submit">Login</button>
    </form>
  `;
}

function signupForm() {
  return `
    <form class="form-grid" data-form="signup">
      <div>
        <h2>Create account</h2>
        <p>The master account will approve you as student or administrator.</p>
      </div>
      <label>
        Email
        <input name="email" type="email" autocomplete="email" required>
      </label>
      <label>
        Password
        <input name="password" type="password" autocomplete="new-password" minlength="4" required>
      </label>
      <label>
        Confirm password
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="4" required>
      </label>
      <label>
        College ID card
        <input class="file-input" name="idCard" type="file" accept="image/*" capture="environment" data-file-status="#id-card-status" required>
        <span class="field-hint" id="id-card-status">Upload or click a picture of your ID card.</span>
      </label>
      <button class="btn full" type="submit">Send signup</button>
    </form>
  `;
}

async function renderDashboard() {
  if (!state.me) {
    renderAuth();
    return;
  }

  try {
    if (state.me.status === "restricted") {
      shell(`
        <div class="empty-state">
          <div>
            <h2>Account Restricted</h2>
            <p>Your account has been restricted by master control. You cannot use portal actions right now.</p>
          </div>
        </div>
      `);
      return;
    }

    if (state.me.role === "master") {
      await renderMaster();
    } else if (state.me.role === "administrator") {
      await renderAdministrator();
    } else {
      await renderStudent();
    }
  } catch (error) {
    renderDashboardError(error.message);
  }
}

function renderDashboardError(message) {
  shell(`
    <div class="empty-state">
      <div>
        <h2>Could not load this dashboard</h2>
        <p>${escapeHtml(message || "The server did not return the dashboard data.")}</p>
        <div class="button-row" style="justify-content: center; margin-top: 14px;">
          <button class="btn" type="button" data-action="retry-dashboard">Retry</button>
          <button class="btn secondary" type="button" data-action="logout">Log out</button>
        </div>
      </div>
    </div>
  `);
}

function shell(content, navItems = []) {
  const roleTitle = roleTitleFor(state.me.role);
  const nav = navItems.length
    ? `<aside class="sidebar">${navItems.map(([id, label]) => `
        <button type="button" class="${state.studentView === id ? "active" : ""}" data-action="student-view" data-view="${id}">${label}</button>
      `).join("")}</aside>`
    : "";

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <a class="app-brand" href="#" aria-label="EventShevent home">
          <span class="brand-mark">ES</span>
          <span>${brandName()}</span>
        </a>
        <span class="role-chip">${roleTitle}</span>
      </div>
      <div class="topbar-right">
        <button class="theme-switch" type="button" data-action="toggle-theme" aria-label="Toggle light and dark mode"><span></span></button>
        ${state.me.role === "master" ? `
          <button class="btn secondary" type="button" data-action="logout">Log out</button>
        ` : profileMenu()}
      </div>
    </header>
    <div class="layout" style="${navItems.length ? "" : "grid-template-columns: 1fr;"}">
      ${nav}
      <main class="main">
        <div class="main-inner">${content}</div>
      </main>
    </div>
  `;
}

function profileMenu() {
  const initial = state.me.email?.slice(0, 1)?.toUpperCase() || "U";

  return `
    <div class="profile-wrap">
      <button class="profile-button" type="button" data-action="toggle-profile" aria-label="Open profile menu">${escapeHtml(initial)}</button>
      <div class="profile-menu" ${state.profileOpen ? "" : "hidden"}>
        <div class="profile-email">
          <strong>${roleTitleFor(state.me.role)}</strong><br>
          ${escapeHtml(state.me.email)}
        </div>
        <button class="btn secondary full" type="button" data-action="logout">Log out</button>
      </div>
    </div>
  `;
}

async function renderMaster() {
  shell(`<div class="loading">Loading master control...</div>`);
  const tabs = `
    <div class="view-title">
      <div>
        <h2>Master Control</h2>
        <p>Approve accounts, review ID cards, and update user passwords.</p>
      </div>
    </div>
    <div class="tabbar">
      ${tabButton("master-tab", "applications", "Pending Applications", state.masterTab)}
      ${tabButton("master-tab", "students", "Students", state.masterTab)}
      ${tabButton("master-tab", "administrators", "Administrators", state.masterTab)}
    </div>
  `;

  if (state.masterTab === "applications") {
    const { applications } = await api("/api/master/applications");
    const selected = applications.find((item) => item.id === state.masterSelectedApplicationId) || applications[0];
    state.masterSelectedApplicationId = selected?.id || "";
    shell(tabs + masterApplications(applications, selected));
    return;
  }

  const role = state.masterTab === "students" ? "student" : "administrator";
  const { users } = await api(`/api/master/users?role=${role}&q=${encodeURIComponent(state.masterSearch)}`);
  const selected = users.find((item) => item.id === state.masterSelectedUserId) || users[0];
  state.masterSelectedUserId = selected?.id || "";
  shell(tabs + masterUsers(users, selected, role));
}

function masterApplications(applications, selected) {
  if (!applications.length) {
    return `<div class="empty-state">No pending account applications.</div>`;
  }

  return `
    <section class="split">
      <div class="panel">
        <h2>Queue</h2>
        <div class="list" style="margin-top: 14px;">
          ${applications.map((application) => `
            <button class="list-item ${selected?.id === application.id ? "active" : ""}" type="button" data-action="select-application" data-id="${application.id}">
              <strong>${escapeHtml(application.email)}</strong>
              <span class="meta">Requested ${formatDateTime(application.createdAt)}</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="detail-pane">
        ${selected ? `
          <h2>${escapeHtml(selected.email)}</h2>
          <div class="detail-grid">
            <div class="detail-box"><span>Password requested</span><strong>${escapeHtml(selected.password)}</strong></div>
            <div class="detail-box"><span>Status</span><strong>Pending</strong></div>
          </div>
          <img class="id-card-preview" alt="College ID card uploaded by ${escapeHtml(selected.email)}" src="${attr(selected.idCardImage)}">
          <div class="button-row">
            <button class="btn" type="button" data-action="decide-application" data-id="${selected.id}" data-decision="student">Mark student</button>
            <button class="btn gold" type="button" data-action="decide-application" data-id="${selected.id}" data-decision="administrator">Mark administrator</button>
            <button class="btn danger" type="button" data-action="decide-application" data-id="${selected.id}" data-decision="reject">Reject</button>
          </div>
        ` : ""}
      </div>
    </section>
  `;
}

function masterUsers(users, selected, role) {
  const title = role === "student" ? "Students" : "Administrators";

  return `
    <section class="split">
      <div class="panel">
        <h2>${title}</h2>
        <form class="search-row" data-form="master-search" style="margin-top: 14px;">
          <input name="q" type="search" placeholder="Search by email" value="${attr(state.masterSearch)}">
          <button class="btn secondary" type="submit">Search</button>
        </form>
        ${users.length ? `
          <div class="list">
            ${users.map((user) => `
              <button class="list-item ${selected?.id === user.id ? "active" : ""}" type="button" data-action="select-user" data-id="${user.id}">
                <strong>${escapeHtml(user.email)}</strong>
                <span class="meta">${accountStatusBadge(user.status)} Approved ${formatDateTime(user.approvedAt)}</span>
              </button>
            `).join("")}
          </div>
        ` : `<div class="empty-state">No ${title.toLowerCase()} found.</div>`}
      </div>
      <div class="detail-pane">
        ${selected ? `
          <h2>${escapeHtml(selected.email)}</h2>
          <div class="detail-grid">
            <div class="detail-box"><span>Role</span><strong>${escapeHtml(roleTitleFor(selected.role))}</strong></div>
            <div class="detail-box"><span>Status</span><strong>${accountStatusBadge(selected.status)}</strong></div>
            <div class="detail-box"><span>Current password</span><strong>${escapeHtml(selected.password)}</strong></div>
            <div class="detail-box"><span>Approved</span><strong>${formatDateTime(selected.approvedAt)}</strong></div>
          </div>
          <img class="id-card-preview" alt="College ID card uploaded by ${escapeHtml(selected.email)}" src="${attr(selected.idCardImage)}">
          <form class="form-grid" data-form="password" data-user-id="${selected.id}">
            <label>
              Change password
              <input name="password" type="text" value="${attr(selected.password)}" required>
            </label>
            <div class="button-row end">
              <button class="btn" type="submit">Save password</button>
            </div>
          </form>
          <div class="management-panel">
            <div>
              <h3>Change role</h3>
              <p>Use this if an account was approved into the wrong portal.</p>
            </div>
            <div class="button-row">
              <button class="btn secondary" type="button" data-action="change-user-role" data-id="${selected.id}" data-role="student" ${selected.role === "student" ? "disabled" : ""}>Change to student</button>
              <button class="btn gold" type="button" data-action="change-user-role" data-id="${selected.id}" data-role="administrator" ${selected.role === "administrator" ? "disabled" : ""}>Change to administrator</button>
            </div>
          </div>
          <div class="management-panel">
            <div>
              <h3>Account access</h3>
              <p>Restricted users can only see a restricted notice. Blocked users cannot log in.</p>
            </div>
            <div class="button-row">
              <button class="btn secondary" type="button" data-action="change-user-status" data-id="${selected.id}" data-status="active" ${selected.status === "active" ? "disabled" : ""}>Unrestrict</button>
              <button class="btn gold" type="button" data-action="change-user-status" data-id="${selected.id}" data-status="restricted" ${selected.status === "restricted" ? "disabled" : ""}>Restrict</button>
              <button class="btn danger" type="button" data-action="change-user-status" data-id="${selected.id}" data-status="blocked" ${selected.status === "blocked" ? "disabled" : ""}>Block</button>
            </div>
          </div>
          <div class="management-panel danger-zone">
            <div>
              <h3>Delete account</h3>
              <p>This removes the approved account. Hosted event history is kept for records.</p>
            </div>
            <button class="btn danger" type="button" data-action="delete-user" data-id="${selected.id}">Delete account</button>
          </div>
        ` : `<div class="empty-state">Select a user to view details.</div>`}
      </div>
    </section>
  `;
}

async function renderAdministrator() {
  shell(`<div class="loading">Loading administrator portal...</div>`);
  const { events } = await api(`/api/admin/events?status=${encodeURIComponent(state.adminTab)}`);
  const selected = events.find((item) => item.id === state.adminSelectedEventId) || events[0];
  state.adminSelectedEventId = selected?.id || "";

  shell(`
    <div class="view-title">
      <div>
        <h2>Administrator Portal</h2>
        <p>Review venue requests and keep track of accepted and rejected events.</p>
      </div>
    </div>
    <div class="tabbar">
      ${tabButton("admin-tab", "pending", "Pending Approval", state.adminTab)}
      ${tabButton("admin-tab", "approved", "Accepted Events", state.adminTab)}
      ${tabButton("admin-tab", "rejected", "Rejected Events", state.adminTab)}
    </div>
    ${adminEvents(events, selected)}
  `);
}

function adminEvents(events, selected) {
  if (!events.length) {
    return `<div class="empty-state">No ${statusLabels[state.adminTab].toLowerCase()} events.</div>`;
  }

  return `
    <section class="split">
      <div class="panel">
        <h2>${statusLabels[state.adminTab]} Events</h2>
        <div class="list" style="margin-top: 14px;">
          ${events.map((event) => `
            <button class="list-item ${selected?.id === event.id ? "active" : ""}" type="button" data-action="select-event" data-id="${event.id}">
              <strong>${escapeHtml(event.name)}</strong>
              <span class="meta">${escapeHtml(event.venue)} · ${formatDate(event.date)} · ${formatTime(event.startTime)}-${formatTime(event.endTime)}</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="detail-pane">
        ${selected ? eventDetail(selected, true) : ""}
      </div>
    </section>
  `;
}

function eventDetail(event, adminControls = false) {
  return `
    <h2>${escapeHtml(event.name)}</h2>
    <div class="meta" style="margin-top: 8px;">
      ${statusBadge(event.status)}
      <span>Hosted by ${escapeHtml(event.hostEmail)}</span>
      <span>${event.registrationCount || 0} registrations</span>
      <span>${event.upvotes || 0} upvotes</span>
      <span>${event.downvotes || 0} downvotes</span>
    </div>
    <div class="detail-grid">
      <div class="detail-box"><span>Venue</span><strong>${escapeHtml(event.venueGroup)} · ${escapeHtml(event.venue)}</strong></div>
      <div class="detail-box"><span>Date</span><strong>${formatDate(event.date)}</strong></div>
      <div class="detail-box"><span>Timing</span><strong>${formatTime(event.startTime)} to ${formatTime(event.endTime)}</strong></div>
      <div class="detail-box"><span>Requested</span><strong>${formatDateTime(event.createdAt)}</strong></div>
    </div>
    <div class="detail-box">
      <span>Description</span>
      <p>${escapeHtml(event.description)}</p>
    </div>
    ${event.remarks ? `<div class="detail-box" style="margin-top: 12px;"><span>Special remarks</span><p>${escapeHtml(event.remarks)}</p></div>` : ""}
    ${event.reviewNote ? `<div class="note" style="margin-top: 12px;">${escapeHtml(event.reviewNote)}</div>` : ""}
    ${event.images?.length ? `
      <div class="event-image-strip" style="margin-top: 12px;">
        ${event.images.map((image) => `<img src="${attr(image)}" alt="Uploaded event reference">`).join("")}
      </div>
    ` : ""}
    ${adminControls && event.status === "pending" ? `
      <label style="margin-top: 16px;">
        Review note
        <textarea data-review-note="${event.id}" placeholder="Optional note for this decision"></textarea>
      </label>
      <div class="button-row" style="margin-top: 12px;">
        <button class="btn" type="button" data-action="decide-event" data-id="${event.id}" data-decision="approve">Approve</button>
        <button class="btn danger" type="button" data-action="decide-event" data-id="${event.id}" data-decision="reject">Reject</button>
      </div>
    ` : ""}
  `;
}

async function renderStudent() {
  shell(`<div class="loading">Loading student portal...</div>`, studentViews);

  if (state.studentView === "host") {
    shell(studentHostForm(), studentViews);
    updateVenueSelect("Ground Floor");
    updateEndTimeSelect("08:00");
    return;
  }

  if (state.studentView === "requested") {
    const { events } = await api("/api/student/requests");
    shell(studentRequested(events), studentViews);
    return;
  }

  if (state.studentView === "past") {
    const [{ events: feed }, { events: requests }] = await Promise.all([
      api("/api/events/feed"),
      api("/api/student/requests"),
    ]);
    const combined = uniqueEvents([...feed, ...requests]).filter((event) => isPastEvent(event) && (event.isRegisteredByMe || event.isHostedByMe));
    shell(studentEventCollection("Past Events", "Events you hosted or applied for earlier.", combined, "No past events yet."), studentViews);
    return;
  }

  const { events } = await api("/api/events/feed");

  if (state.studentView === "applied") {
    const applied = events.filter((event) => event.isRegisteredByMe && !isPastEvent(event));
    shell(studentEventCollection("Applied Events", "Upcoming events you have applied to attend.", applied, "You have not applied for upcoming events."), studentViews);
    return;
  }

  const upcoming = events.filter((event) => !isPastEvent(event));
  shell(studentEventCollection("Discover Events", "Approved events open for student registration.", upcoming, "No approved upcoming events yet."), studentViews);
}

function studentHostForm() {
  return `
    <div class="view-title">
      <div>
        <h2>Host Event</h2>
        <p>Send an event and venue request to the administrators.</p>
      </div>
    </div>
    <section class="panel">
      <form class="form-grid" data-form="event-request">
        <label>
          Event name
          <input name="name" type="text" maxlength="90" required>
        </label>
        <div class="form-grid two">
          <label>
            Floor or area
            <select id="event-floor" name="venueGroup" required>
              ${Object.keys(venues).map((floor) => `<option value="${attr(floor)}">${escapeHtml(floor)}</option>`).join("")}
            </select>
          </label>
          <label>
            Room or venue
            <select id="event-venue" name="venue" required></select>
          </label>
        </div>
        <div class="form-grid two">
          <label>
            Event date
            <input name="date" type="date" min="${todayValue()}" required>
          </label>
          <span></span>
        </div>
        <div class="form-grid two">
          <label>
            Event start time
            <select id="event-start" name="startTime" required>
              ${timeOptions(480, 1050)}
            </select>
          </label>
          <label>
            Event end time
            <select id="event-end" name="endTime" required>
              ${timeOptions(510, 1080)}
            </select>
          </label>
        </div>
        <label>
          Describe your event
          <textarea name="description" maxlength="1200" required></textarea>
        </label>
        <label>
          Special remarks
          <textarea name="remarks" maxlength="900" placeholder="Equipment, seating, projector, power, setup notes"></textarea>
        </label>
        <label>
          Event images
          <input class="file-input" name="images" type="file" accept="image/*" multiple data-file-status="#event-image-status">
          <span class="field-hint" id="event-image-status">Optional, up to 3 images.</span>
        </label>
        <div class="button-row end">
          <button class="btn" type="submit">Apply</button>
        </div>
      </form>
    </section>
  `;
}

function studentRequested(events) {
  return studentEventCollection(
    "Requested Events",
    "Events you requested permission to host.",
    events,
    "You have not requested any events yet.",
    true,
  );
}

function studentEventCollection(title, subtitle, events, emptyText, includeAllStatuses = false) {
  return `
    <div class="view-title">
      <div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
    </div>
    ${events.length ? `
      <section class="event-grid">
        ${events.map((event) => eventCard(event, includeAllStatuses)).join("")}
      </section>
    ` : `<div class="empty-state">${emptyText}</div>`}
  `;
}

function eventCard(event, includeAllStatuses = false) {
  const canRegister = event.status === "approved" && !event.isHostedByMe && !event.isRegisteredByMe && !isPastEvent(event);
  const canUnjoin = event.status === "approved" && event.isRegisteredByMe && !isPastEvent(event);
  const action = canRegister
    ? `<button class="btn" type="button" data-action="register-event" data-id="${event.id}">Apply</button>`
    : canUnjoin
      ? `<button class="btn secondary" type="button" data-action="unjoin-event" data-id="${event.id}">Unjoin</button>`
      : disabledEventButton(event);
  const canVote = event.status === "approved" && !event.isHostedByMe && !isPastEvent(event);

  return `
    <article class="event-card">
      <div class="meta">
        ${includeAllStatuses ? statusBadge(event.status) : ""}
        ${event.isHostedByMe ? `<span class="badge success">Hosted Event</span>` : ""}
        ${event.isRegisteredByMe ? `<span class="badge success">Applied</span>` : ""}
        ${isPastEvent(event) ? `<span class="badge">Past</span>` : ""}
      </div>
      <div>
        <h3>${escapeHtml(event.name)}</h3>
        <p>${escapeHtml(event.venue)} · ${formatDate(event.date)} · ${formatTime(event.startTime)}-${formatTime(event.endTime)}</p>
      </div>
      <p>${escapeHtml(truncate(event.description, 150))}</p>
      <div class="vote-row">
        <button
          class="vote-button ${event.myVote === 1 ? "active" : ""}"
          type="button"
          ${canVote ? `data-action="vote-event" data-id="${event.id}" data-value="${event.myVote === 1 ? 0 : 1}"` : "disabled"}
        >Upvote ${event.upvotes || 0}</button>
        <button
          class="vote-button ${event.myVote === -1 ? "active" : ""}"
          type="button"
          ${canVote ? `data-action="vote-event" data-id="${event.id}" data-value="${event.myVote === -1 ? 0 : -1}"` : "disabled"}
        >Downvote ${event.downvotes || 0}</button>
      </div>
      ${event.images?.length ? `
        <div class="event-image-strip">
          ${event.images.slice(0, 3).map((image) => `<img src="${attr(image)}" alt="Uploaded event reference">`).join("")}
        </div>
      ` : ""}
      <div class="button-row">
        ${event.status === "approved" ? action : ""}
      </div>
    </article>
  `;
}

function disabledEventButton(event) {
  if (isPastEvent(event)) return `<button class="btn secondary" type="button" disabled>Closed</button>`;
  if (event.isHostedByMe) return `<button class="btn secondary" type="button" disabled>Hosted</button>`;
  if (event.isRegisteredByMe) return `<button class="btn secondary" type="button" disabled>Applied</button>`;
  return `<button class="btn secondary" type="button" disabled>Unavailable</button>`;
}

function tabButton(action, tab, label, activeTab) {
  return `<button type="button" data-action="${action}" data-tab="${tab}" class="${activeTab === tab ? "active" : ""}">${label}</button>`;
}

function statusBadge(status) {
  const classes = {
    approved: "success",
    pending: "warning",
    rejected: "danger",
  };
  return `<span class="badge ${classes[status] || ""}">${statusLabels[status] || status}</span>`;
}

function accountStatusBadge(status = "active") {
  const classes = {
    active: "success",
    restricted: "warning",
    blocked: "danger",
  };
  return `<span class="badge ${classes[status] || ""}">${accountStatusLabels[status] || status}</span>`;
}

function updateVenueSelect(group) {
  const select = document.querySelector("#event-venue");
  if (!select) return;
  select.innerHTML = (venues[group] || []).map((venue) => `<option value="${attr(venue)}">${escapeHtml(venue)}</option>`).join("");
}

function updateEndTimeSelect(startTime) {
  const select = document.querySelector("#event-end");
  if (!select) return;
  const start = toMinutes(startTime || "08:00");
  select.innerHTML = timeOptions(start + 30, 1080);
}

function timeOptions(startMinute, endMinute) {
  const options = [];
  for (let minute = startMinute; minute <= endMinute; minute += 30) {
    const value = fromMinutes(minute);
    options.push(`<option value="${value}">${formatTime(value)}</option>`);
  }
  return options.join("");
}

function roomRange(floor) {
  return Array.from({ length: 10 }, (_, index) => `Room ${floor}${String(index + 1).padStart(2, "0")}`);
}

function fileStatusText(files) {
  if (!files?.length) return "No file selected.";
  if (files.length === 1) return files[0].name;
  return `${Math.min(files.length, 3)} files selected.`;
}

async function filesToDataUrls(files, limit) {
  const selected = Array.from(files).slice(0, limit);
  return Promise.all(selected.map(fileToDataUrl));
}

async function fileToDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image file.`);
  }

  const compressed = await compressImage(file);
  if (compressed.length > 900000) {
    throw new Error(`${file.name} is still too large after compression. Try a smaller image.`);
  }

  return compressed;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.onload = () => {
        const maxSide = 1000;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function uniqueEvents(events) {
  const map = new Map();
  events.forEach((event) => map.set(event.id, { ...map.get(event.id), ...event }));
  return Array.from(map.values());
}

function isPastEvent(event) {
  return new Date(`${event.date}T${event.endTime}:00`).getTime() < Date.now();
}

function todayValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function formatDate(date) {
  if (!date) return "";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function toMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(minute) {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function roleTitleFor(role) {
  return {
    master: "Master Control",
    student: "Student Portal",
    administrator: "Administrator Portal",
  }[role] || role;
}

function brandName() {
  return `<span class="brand-event">Event</span><span class="brand-shevent">Shevent</span>`;
}

function truncate(text, length) {
  const value = String(text || "");
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

function attr(value) {
  return escapeHtml(value);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}
