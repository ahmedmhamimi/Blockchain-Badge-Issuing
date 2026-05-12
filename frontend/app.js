// =============================================================================
// app.js — Badge NFT Platform frontend
// All API calls use fetch + async/await.
// Auth state lives in localStorage under 'badge_nft_auth'.
// =============================================================================

const API = "http://localhost:3000";

// ── App state ─────────────────────────────────────────────────────────────────
let state = {
  token:         null,
  role:          null,
  walletAddress: null,
  username:      null,
  studentName:   null
};

let _allBadges        = [];
let _myBadges         = [];
let _students         = [];
let _hardhatAccounts  = [];
let _freeAccounts     = [];

// ── Auth helpers ──────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${state.token}`
  };
}

function saveSession(data) {
  state = { ...state, ...data };
  localStorage.setItem("badge_nft_auth", JSON.stringify(state));
}

function clearSession() {
  state = { token: null, role: null, walletAddress: null, username: null, studentName: null };
  localStorage.removeItem("badge_nft_auth");
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem("badge_nft_auth") || "null");
    if (saved && saved.token) { state = saved; return true; }
  } catch { /* ignore */ }
  return false;
}

// ── API wrapper ───────────────────────────────────────────────────────────────

async function apiFetch(method, path, body) {
  const opts = {
    method,
    headers: state.token ? authHeaders() : { "Content-Type": "application/json" }
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(API + path, opts);
  const data = await res.json();
  return { status: res.status, data };
}

// ── Message helpers ───────────────────────────────────────────────────────────

function setMsg(elId, text, isErr) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text;
  el.className   = "msg " + (isErr ? "err" : "ok");
}

function clearMsg(elId) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = ""; el.className = "msg"; }
}

// ── Chain status ──────────────────────────────────────────────────────────────

async function loadChainStatus() {
  try {
    const { data } = await apiFetch("GET", "/api/health");
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    if (data.ok) {
      dot.className   = "status-dot ok";
      txt.textContent = `Block #${data.blockNumber} · ${data.totalBadgesMinted} badges · ${data.contractAddress.slice(0, 8)}…`;
    } else {
      dot.className   = "status-dot error";
      txt.textContent = "Chain error";
    }
  } catch {
    document.getElementById("statusDot").className    = "status-dot error";
    document.getElementById("statusText").textContent = "Chain offline";
  }
}

// ── Login / Logout ────────────────────────────────────────────────────────────

async function login() {
  clearMsg("loginMsg");
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username || !password) return setMsg("loginMsg", "Enter username and password.", true);

  const { data } = await apiFetch("POST", "/api/auth/login", { username, password });
  if (!data.ok) return setMsg("loginMsg", data.message, true);

  saveSession({
    token:         data.token,
    role:          data.role,
    walletAddress: data.walletAddress,
    username:      data.username,
    studentName:   data.studentName
  });

  renderTopbar();
  showDashboard();
}

function logout() {
  clearSession();
  _allBadges = []; _myBadges = []; _students = [];
  _hardhatAccounts = []; _freeAccounts = [];

  show("panelLogin");
  hide("panelIssuer");
  hide("panelStudent");
  document.getElementById("topbarRight").innerHTML = "";
  document.getElementById("loginPassword").value   = "";
}

// ── Topbar ────────────────────────────────────────────────────────────────────

function renderTopbar() {
  const roleLabel   = state.role === "issuer" ? "Issuer" : "Student";
  const displayName = state.studentName || state.username;
  document.getElementById("topbarRight").innerHTML = `
    <div class="user-chip">
      <span class="role-badge ${state.role}">${roleLabel}</span>
      <span>${displayName}</span>
      <span style="color:var(--text3);font-size:11px;font-family:'DM Mono',monospace;">
        ${state.walletAddress ? state.walletAddress.slice(0, 6) + "…" : ""}
      </span>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="logout()">Sign out</button>
  `;
}

// ── Dashboard routing ─────────────────────────────────────────────────────────

function showDashboard() {
  hide("panelLogin");
  if (state.role === "issuer") {
    show("panelIssuer");
    hide("panelStudent");
    switchTab("tabMint", document.querySelector('#panelIssuer .tab[data-tab="tabMint"]'));
    loadIssuerData();
  } else {
    hide("panelIssuer");
    show("panelStudent");
    switchTabStudent("tabMyBadges", document.querySelector('#panelStudent .tab[data-tab="tabMyBadges"]'));
    loadMyBadges();
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tabId, btn) {
  document.querySelectorAll("#panelIssuer .tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll("#panelIssuer .tab").forEach(t => t.classList.remove("active"));
  const target = document.getElementById(tabId);
  target.classList.remove("hidden");
  target.classList.add("active");
  if (btn) btn.classList.add("active");
}

function switchTabStudent(tabId, btn) {
  document.querySelectorAll("#panelStudent .tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll("#panelStudent .tab").forEach(t => t.classList.remove("active"));
  const target = document.getElementById(tabId);
  target.classList.remove("hidden");
  target.classList.add("active");
  if (btn) btn.classList.add("active");
}

// ── Nonce tracker ─────────────────────────────────────────────────────────────

async function refreshNonce() {
  const valEl  = document.getElementById("nonceValue");
  const addrEl = document.getElementById("nonceAddress");
  if (!valEl) return;
  valEl.textContent = "…";
  try {
    const { data } = await apiFetch("GET", "/api/chain/nonce");
    if (data.ok) {
      valEl.textContent  = data.nonce;
      if (addrEl) addrEl.textContent = data.issuerAddress.slice(0, 10) + "…" + data.issuerAddress.slice(-6);
    } else {
      valEl.textContent = "err";
    }
  } catch {
    valEl.textContent = "—";
  }
}

// ── Issuer: load initial data ─────────────────────────────────────────────────

async function loadIssuerData() {
  await loadStudents();
  await loadFreeAccounts();
  await refreshNonce();
}

// ── Students (issuer) ─────────────────────────────────────────────────────────

async function loadStudents() {
  const { data } = await apiFetch("GET", "/api/auth/students");
  if (!data.ok) return;
  _students = data.students;
  renderStudentList();
  populateRecipientDropdown();
  populateGalleryDropdown();
}

function renderStudentList() {
  const el = document.getElementById("studentList");
  if (!_students.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👤</div>No students registered yet.</div>`;
    return;
  }
  el.innerHTML = _students.map(s => `
    <div class="student-row">
      <div class="student-row-left">
        <span class="student-name">${esc(s.studentName)}</span>
        <span class="student-username">@${esc(s.username)}</span>
        <span class="student-wallet">${esc(s.walletAddress)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="prefillMintForm('${esc(s.walletAddress)}','${esc(s.studentName)}')">
        Mint Badge
      </button>
    </div>
  `).join("");
}

function populateRecipientDropdown() {
  const sel = document.getElementById("mintRecipientSelect");
  sel.innerHTML = `<option value="">— Select registered student —</option>`;
  _students.forEach(s => {
    const opt = document.createElement("option");
    opt.value        = s.walletAddress;
    opt.dataset.name = s.studentName;
    opt.textContent  = `${s.studentName} (${s.walletAddress.slice(0, 8)}…)`;
    sel.appendChild(opt);
  });
}

function onRecipientSelect() {
  const sel = document.getElementById("mintRecipientSelect");
  const opt = sel.options[sel.selectedIndex];
  if (opt.value) {
    document.getElementById("mintRecipient").value   = opt.value;
    document.getElementById("mintStudentName").value = opt.dataset.name || "";
  }
}

function populateGalleryDropdown() {
  const sel = document.getElementById("galleryAddress");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— Select a student wallet —</option>`;
  _students.forEach(s => {
    const opt = document.createElement("option");
    opt.value       = s.walletAddress;
    opt.textContent = `${s.studentName} — ${s.walletAddress.slice(0, 10)}…${s.walletAddress.slice(-6)}`;
    if (s.walletAddress === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function prefillMintForm(wallet, name) {
  switchTab("tabMint", document.querySelector('#panelIssuer .tab[data-tab="tabMint"]'));
  document.getElementById("mintRecipient").value   = wallet;
  document.getElementById("mintStudentName").value = name;
}

// ── Free accounts (for student registration) ──────────────────────────────────

async function loadFreeAccounts() {
  const { data } = await apiFetch("GET", "/api/auth/free-accounts");
  if (!data.ok) return;
  _freeAccounts = data.freeAccounts;
  renderFreeAccountsInfo();
}

function renderFreeAccountsInfo() {
  const infoEl = document.getElementById("freeAccountsInfo");
  if (!infoEl) return;

  if (_freeAccounts.length === 0) {
    infoEl.innerHTML = `<span style="color:var(--danger);">⚠ No free wallet slots left. All 9 student accounts are registered.</span>`;
    infoEl.style.display = "block";
  } else {
    infoEl.innerHTML = `<span style="color:var(--success);">✓ ${_freeAccounts.length} wallet slot${_freeAccounts.length !== 1 ? "s" : ""} available</span>`;
    infoEl.style.display = "block";
  }

  const sel = document.getElementById("regWalletSelect");
  sel.innerHTML = "";

  if (_freeAccounts.length === 0) {
    sel.innerHTML = `<option value="">— No free accounts —</option>`;
  } else {
    _freeAccounts.forEach((a, i) => {
      const opt = document.createElement("option");
      opt.value       = a.address;
      opt.textContent = `${a.label}: ${a.address.slice(0, 10)}…${a.address.slice(-6)}`;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
    onWalletSelect();
  }
}

function onWalletSelect() {
  const val = document.getElementById("regWalletSelect").value;
  if (val) document.getElementById("regWallet").value = val;
}

// ── Register student ──────────────────────────────────────────────────────────

async function showRegisterForm() {
  show("registerForm");
  await loadFreeAccounts();
}

function hideRegisterForm() {
  hide("registerForm");
  clearMsg("regMsg");
}

async function registerStudent() {
  clearMsg("regMsg");
  const username    = document.getElementById("regUsername").value.trim();
  const password    = document.getElementById("regPassword").value;
  const studentName = document.getElementById("regStudentName").value.trim();
  const wallet      = document.getElementById("regWallet").value.trim();

  if (!username || !password || !studentName)
    return setMsg("regMsg", "Username, password and full name are required.", true);
  if (!wallet)
    return setMsg("regMsg", "No free wallet account available.", true);
  if (password.length < 6)
    return setMsg("regMsg", "Password must be at least 6 characters.", true);

  const btn = document.getElementById("regBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Registering…"; }

  const { data } = await apiFetch("POST", "/api/auth/register-student", {
    username, password, studentName, walletAddress: wallet
  });

  if (btn) { btn.disabled = false; btn.textContent = "Register Student"; }
  if (!data.ok) return setMsg("regMsg", data.message, true);

  setMsg("regMsg", `✓ Student "${studentName}" registered — wallet ${wallet.slice(0, 8)}…`, false);
  document.getElementById("regUsername").value    = "";
  document.getElementById("regPassword").value    = "";
  document.getElementById("regStudentName").value = "";
  document.getElementById("regWallet").value      = "";

  await loadStudents();
  await loadFreeAccounts();
}

// ── Change password ───────────────────────────────────────────────────────────

async function changePassword() {
  clearMsg("pwdMsg");
  const currentPassword = document.getElementById("pwdCurrent").value;
  const newPassword     = document.getElementById("pwdNew").value;
  if (!currentPassword || !newPassword) return setMsg("pwdMsg", "Both fields required.", true);

  const { data } = await apiFetch("POST", "/api/auth/change-password", { currentPassword, newPassword });
  if (!data.ok) return setMsg("pwdMsg", data.message, true);
  setMsg("pwdMsg", "Password updated successfully.", false);
  document.getElementById("pwdCurrent").value = "";
  document.getElementById("pwdNew").value     = "";
}

// ── Mint badge ────────────────────────────────────────────────────────────────

async function mintBadge() {
  clearMsg("mintMsg");
  hide("mintResult");

  const recipient   = document.getElementById("mintRecipient").value.trim();
  const studentName = document.getElementById("mintStudentName").value.trim();
  const courseName  = document.getElementById("mintCourseName").value.trim();
  const category    = document.getElementById("mintCategory").value;
  const grade       = document.getElementById("mintGrade").value;

  if (!recipient || !studentName || !courseName)
    return setMsg("mintMsg", "Recipient, student name and course name are required.", true);

  const btn = document.getElementById("mintBtn");
  btn.disabled    = true;
  btn.textContent = "Minting…";

  const { data } = await apiFetch("POST", "/api/badges/mint", {
    recipient, studentName, courseName, category, grade
  });

  btn.disabled    = false;
  btn.textContent = "Mint Badge →";

  if (!data.ok) return setMsg("mintMsg", data.message, true);

  document.getElementById("mintResultId").textContent    = `#${data.tokenId}`;
  document.getElementById("mintResultTx").textContent    = data.txHash;
  document.getElementById("mintResultBlock").textContent = data.blockNumber;
  show("mintResult");
  setMsg("mintMsg", "", false);
  refreshNonce();
}

// ── Gallery (issuer) ──────────────────────────────────────────────────────────

async function loadBadgesForAddress() {
  const address = document.getElementById("galleryAddress").value.trim();
  if (!address) return;

  const { data } = await apiFetch("GET", `/api/badges/owner/${address}`);
  if (!data.ok) {
    document.getElementById("badgeGrid").innerHTML =
      `<div class="empty-state">${esc(data.message)}</div>`;
    return;
  }
  _allBadges = data.badges;
  renderBadgeGrid("badgeGrid", _allBadges, "gallerySortBar", "gallerySummary", true);
}

function sortGallery(by, btn) {
  document.querySelectorAll("#gallerySortBar .sort-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  _allBadges = sortBadges(_allBadges, by);
  renderBadgeGrid("badgeGrid", _allBadges, "gallerySortBar", "gallerySummary", true);
}

// ── My Badges (student) ───────────────────────────────────────────────────────

async function loadMyBadges() {
  if (!state.walletAddress) return;
  const { data } = await apiFetch("GET", `/api/badges/owner/${state.walletAddress}`);
  if (!data.ok) {
    document.getElementById("myBadgeGrid").innerHTML =
      `<div class="empty-state">${esc(data.message)}</div>`;
    return;
  }
  _myBadges = data.badges;
  renderBadgeGrid("myBadgeGrid", _myBadges, "studentSortBar", "studentSummary", false);
}

function sortStudentGallery(by, btn) {
  document.querySelectorAll("#studentSortBar .sort-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  _myBadges = sortBadges(_myBadges, by);
  renderBadgeGrid("myBadgeGrid", _myBadges, "studentSortBar", "studentSummary", false);
}

// ── Badge rendering ───────────────────────────────────────────────────────────

const GRADE_ORDER = { Gold: 0, Silver: 1, Bronze: 2 };
const CATEGORY_ICONS = {
  "Blockchain":   "⛓",
  "Web Dev":      "🌐",
  "Security":     "🔒",
  "Data Science": "📊"
};

function sortBadges(badges, by) {
  return [...badges].sort((a, b) => {
    if (by === "grade")  return (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3);
    if (by === "date")   return b.issuedAt - a.issuedAt;
    if (by === "course") return a.courseName.localeCompare(b.courseName);
    return 0;
  });
}

function renderBadgeGrid(gridId, badges, sortBarId, summaryId, showRevoke) {
  const grid    = document.getElementById(gridId);
  const sortBar = document.getElementById(sortBarId);
  const summary = document.getElementById(summaryId);

  if (!badges.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎖️</div>No badges found.</div>`;
    sortBar.style.display = "none";
    summary.classList.add("hidden");
    return;
  }

  sortBar.style.display = "flex";

  const gold   = badges.filter(b => b.grade === "Gold").length;
  const silver = badges.filter(b => b.grade === "Silver").length;
  const bronze = badges.filter(b => b.grade === "Bronze").length;
  summary.textContent = `${badges.length} badge${badges.length !== 1 ? "s" : ""} · 🥇 ${gold} Gold · 🥈 ${silver} Silver · 🥉 ${bronze} Bronze`;
  summary.classList.remove("hidden");

  grid.innerHTML = sortBadges(badges, "grade").map(badge => renderBadgeCard(badge, showRevoke)).join("");
}

function renderBadgeCard(badge, showRevoke) {
  const icon    = CATEGORY_ICONS[badge.category] || "🎖️";
  const catClass = badge.category.replace(/\s/g, "\\ ");
  const date    = new Date(badge.issuedAt * 1000).toLocaleDateString();
  const revoked = badge.revoked;

  return `
    <div class="badge-card ${revoked ? "revoked" : ""}" onclick="openBadgeModal(${badge.tokenId})">
      <div class="badge-card-accent accent-${badge.category}"></div>
      ${revoked ? `<div class="revoked-ribbon">Revoked</div>` : ""}
      <div class="badge-card-body">
        <div class="badge-header">
          <span class="badge-icon">${icon}</span>
          <span class="grade-pill grade-${badge.grade}">${badge.grade}</span>
        </div>
        <div class="badge-course">${esc(badge.courseName)}</div>
        <div class="badge-student">${esc(badge.studentName)}</div>
        <div class="badge-meta">
          <span class="badge-tag cat-${catClass}">${esc(badge.category)}</span>
          <span class="badge-tag">${esc(date)}</span>
        </div>
        <div class="badge-token-id">Token #${badge.tokenId}</div>
        ${showRevoke && !revoked && state.role === "issuer"
          ? `<button class="btn btn-danger btn-sm" style="margin-top:12px;width:100%;"
               onclick="event.stopPropagation();openRevokeModal(${badge.tokenId})">
               Revoke Badge
             </button>`
          : ""}
      </div>
    </div>
  `;
}

// ── Badge detail modal ────────────────────────────────────────────────────────

async function openBadgeModal(tokenId) {
  const { data } = await apiFetch("GET", `/api/badges/${tokenId}`);
  if (!data.ok) return;

  const b       = data.badge;
  const icon    = CATEGORY_ICONS[b.category] || "🎖️";
  const date    = new Date(b.issuedAt * 1000).toLocaleString();
  const metaUri = `${API}/api/metadata/${tokenId}`;

  let metaJson = "";
  try {
    const r = await fetch(metaUri);
    const m = await r.json();
    metaJson = JSON.stringify(m, null, 2);
  } catch { metaJson = "Could not load metadata."; }

  document.getElementById("modalContent").innerHTML = `
    <div class="modal-badge-header">
      <div class="badge-icon">${icon}</div>
      <div>
        <div class="modal-badge-title">${esc(b.courseName)}</div>
        <div class="modal-badge-sub">${esc(b.studentName)} · <span class="grade-pill grade-${b.grade}">${b.grade}</span></div>
      </div>
    </div>
    ${b.revoked ? `<div style="background:var(--danger-bg);color:var(--danger);border:1.5px solid rgba(153,27,27,.2);border-radius:8px;padding:10px 14px;font-weight:600;font-size:13px;margin-bottom:14px;">⛔ REVOKED${b.revocationReason ? " — " + esc(b.revocationReason) : ""}</div>` : ""}
    <div class="modal-attrs">
      <div class="modal-attr"><span class="modal-attr-key">Token ID</span><span class="modal-attr-val">#${b.tokenId}</span></div>
      <div class="modal-attr"><span class="modal-attr-key">Category</span><span class="modal-attr-val">${esc(b.category)}</span></div>
      <div class="modal-attr"><span class="modal-attr-key">Grade</span><span class="modal-attr-val"><span class="grade-pill grade-${b.grade}">${b.grade}</span></span></div>
      <div class="modal-attr"><span class="modal-attr-key">Recipient</span><span class="modal-attr-val" style="font-family:'DM Mono',monospace;font-size:11px;">${esc(b.recipient)}</span></div>
      <div class="modal-attr"><span class="modal-attr-key">Issued</span><span class="modal-attr-val">${date}</span></div>
    </div>
    <div class="metadata-title">Token URI Metadata</div>
    <a class="metadata-uri-link" href="${metaUri}" target="_blank">${metaUri}</a>
    <pre class="metadata-json">${esc(metaJson)}</pre>
  `;
  show("modalOverlay");
}

function closeModal() { hide("modalOverlay"); }

// ── Revoke modal ──────────────────────────────────────────────────────────────

function openRevokeModal(tokenId) {
  document.getElementById("modalContent").innerHTML = `
    <h3 style="font-family:'Fraunces',serif;margin-bottom:14px;font-size:19px;">Revoke Badge #${tokenId}</h3>
    <p style="color:var(--text2);margin-bottom:18px;font-size:13px;line-height:1.6;">
      Revoking marks the badge as invalid on-chain. The original record stays permanently for audit — nothing is deleted from the blockchain.
    </p>
    <div class="form-group" style="margin-bottom:18px;">
      <label>Reason for revocation</label>
      <input type="text" id="revokeReason" placeholder="e.g. Academic misconduct" />
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-danger" onclick="doRevoke(${tokenId})">Confirm Revoke</button>
      <button class="btn btn-ghost"  onclick="closeModal()">Cancel</button>
    </div>
    <div class="msg" id="revokeMsg"></div>
  `;
  show("modalOverlay");
}

async function doRevoke(tokenId) {
  clearMsg("revokeMsg");
  const reason = document.getElementById("revokeReason").value.trim();
  if (!reason) return setMsg("revokeMsg", "Reason is required.", true);

  const { data } = await apiFetch("POST", "/api/badges/revoke", { tokenId, reason });
  if (!data.ok)   return setMsg("revokeMsg", data.message, true);

  closeModal();
  const galleryAddr = document.getElementById("galleryAddress")?.value?.trim();
  if (galleryAddr) await loadBadgesForAddress();
  if (state.role === "student") await loadMyBadges();
}

// ── History ───────────────────────────────────────────────────────────────────

async function loadHistory() {
  const el = document.getElementById("historyList");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  const { data } = await apiFetch("GET", "/api/badges/history");
  if (!data.ok) {
    el.innerHTML = `<div class="empty-state">${esc(data.message)}</div>`;
    return;
  }

  if (!data.history.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div>No events yet.</div>`;
    return;
  }

  el.innerHTML = [...data.history].reverse().map(e => {
    const isMint  = e.event === "BadgeMinted";
    const label   = isMint ? "Badge Minted" : "Badge Revoked";
    const detail  = isMint
      ? `Token #${e.tokenId} · ${esc(e.courseName)} · ${esc(e.category)} → ${e.recipient.slice(0, 10)}…`
      : `Token #${e.tokenId} · ${esc(e.reason || "")}`;
    const time    = e.timestampISO ? new Date(e.timestampISO).toLocaleString() : `Block ${e.blockNumber}`;

    return `
      <div class="history-row">
        <div class="history-icon-wrap ${isMint ? "mint" : "revoke"}">${isMint ? "🪙" : "⛔"}</div>
        <div class="history-body">
          <div class="history-event" style="color:${isMint ? "var(--success)" : "var(--danger)"};">${label}</div>
          <div class="history-detail">${detail}</div>
          <div class="history-detail" style="margin-top:2px;">
            Tx: <span style="font-family:'DM Mono',monospace;">${e.txHash.slice(0, 18)}…</span>
          </div>
        </div>
        <div class="history-meta">${time}<br/>Block ${e.blockNumber}</div>
      </div>
    `;
  }).join("");
}

// ── Chain Explorer ────────────────────────────────────────────────────────────

let _chainView = "blocks"; // "blocks" | "ledger"

function switchChainView(view) {
  _chainView = view;
  document.querySelectorAll(".chain-view-btn").forEach(b => b.classList.remove("active"));
  const btn = document.querySelector(`.chain-view-btn[data-view="${view}"]`);
  if (btn) btn.classList.add("active");

  const blocksPane = document.getElementById("chainBlocksPane");
  const ledgerPane = document.getElementById("chainLedgerPane");
  if (view === "blocks") {
    blocksPane.classList.remove("hidden");
    ledgerPane.classList.add("hidden");
    loadChainBlocks();
  } else {
    blocksPane.classList.add("hidden");
    ledgerPane.classList.remove("hidden");
    loadChainLedger();
  }
}

async function loadBlockchain() {
  // Entry point called by the tab's Refresh button — reload whichever view is active
  if (_chainView === "ledger") {
    loadChainLedger();
  } else {
    loadChainBlocks();
  }
}

// ── Blocks view ───────────────────────────────────────────────────────────────

async function loadChainBlocks() {
  const wrap = document.getElementById("chainBlocksPane");
  wrap.innerHTML = `<div class="chain-loading"><span class="chain-loading-spinner"></span>Fetching chain data…</div>`;

  try {
    const { data } = await apiFetch("GET", "/api/chain/blocks");
    if (!data.ok) {
      wrap.innerHTML = `<div class="chain-loading chain-error">⚠ ${esc(data.message)}</div>`;
      return;
    }

    // Update stats bar
    renderChainStats(data);

    const blocks = [...data.blocks].reverse(); // newest first
    if (!blocks.length) {
      wrap.innerHTML = `<div class="chain-loading">No blocks yet.</div>`;
      return;
    }

    let html = `<div class="chain-blocks-list">`;
    blocks.forEach((block, idx) => {
      const isDeployment = block.isDeployment;
      const hasEvents    = block.events.length > 0;
      const time         = new Date(block.timestampISO).toLocaleString();
      const shortHash    = block.hash ? block.hash.slice(0, 10) + "…" + block.hash.slice(-6) : "—";
      const parentShort  = block.parentHash ? block.parentHash.slice(0, 10) + "…" + block.parentHash.slice(-6) : "—";
      const gasUsedNum   = parseInt(block.gasUsed, 10);
      const gasLimitNum  = parseInt(block.gasLimit, 10);
      const gasPct       = gasLimitNum > 0 ? Math.round((gasUsedNum / gasLimitNum) * 100) : 0;

      const blockTag = isDeployment
        ? `<span class="block-badge deploy">DEPLOY</span>`
        : hasEvents
          ? `<span class="block-badge tx">TX</span>`
          : `<span class="block-badge empty">EMPTY</span>`;

      html += `
        <div class="chain-block ${isDeployment ? "is-deploy" : ""} ${hasEvents ? "has-events" : ""}">
          <div class="chain-block-header">
            <div class="chain-block-num-wrap">
              ${blockTag}
              <span class="chain-block-num">Block #${block.number}</span>
            </div>
            <div class="chain-block-hash" title="${block.hash}">${shortHash}</div>
            <div class="chain-block-time">${time}</div>
          </div>

          <div class="chain-block-meta-row">
            <div class="chain-meta-cell">
              <span class="chain-meta-label">Parent Hash</span>
              <span class="chain-meta-val mono" title="${block.parentHash}">${parentShort}</span>
            </div>
            <div class="chain-meta-cell">
              <span class="chain-meta-label">Miner</span>
              <span class="chain-meta-val mono">${block.miner ? block.miner.slice(0, 10) + "…" : "—"}</span>
            </div>
            <div class="chain-meta-cell">
              <span class="chain-meta-label">Gas Used</span>
              <span class="chain-meta-val">${gasUsedNum.toLocaleString()} <span class="chain-gas-pct">(${gasPct}%)</span></span>
            </div>
            <div class="chain-meta-cell">
              <span class="chain-meta-label">Txns</span>
              <span class="chain-meta-val">${block.txCount}</span>
            </div>
          </div>

          ${isDeployment ? `
            <div class="chain-deploy-row">
              <span class="chain-deploy-icon">📄</span>
              <div class="chain-deploy-body">
                <div class="chain-deploy-label">Contract Deployed</div>
                <div class="chain-deploy-addr mono">${esc(data.contractAddress)}</div>
              </div>
            </div>
          ` : ""}

          ${block.events.length > 0 ? `
            <div class="chain-tx-list">
              ${block.events.map(e => renderChainTx(e)).join("")}
            </div>
          ` : (!isDeployment ? `
            <div class="chain-block-empty">No BadgeNFT events in this block</div>
          ` : "")}
        </div>
      `;

      // Chain link connector (not after last)
      if (idx < blocks.length - 1) {
        const nextBlock = blocks[idx + 1];
        const gap = block.number - nextBlock.number;
        html += `
          <div class="chain-link">
            <div class="chain-link-line"></div>
            <div class="chain-link-label">
              ${gap > 1
                ? `<span class="chain-link-gap">${gap - 1} skipped block${gap > 2 ? "s" : ""}</span>`
                : `<span class="chain-link-arrow">↑</span>`}
            </div>
            <div class="chain-link-line"></div>
          </div>
        `;
      }
    });
    html += `</div>`;
    wrap.innerHTML = html;

  } catch (err) {
    wrap.innerHTML = `<div class="chain-loading chain-error">⚠ ${esc(String(err))}</div>`;
  }
}

function renderChainTx(e) {
  const isMint   = e.event === "BadgeMinted";
  const fnName   = isMint ? "mintBadge()" : "revokeBadge()";
  const detail   = isMint
    ? `Token #${e.tokenId} · ${esc(e.courseName || "—")} · ${esc(e.category || "")} · ${e.recipient ? e.recipient.slice(0, 12) + "…" : "—"}`
    : `Token #${e.tokenId} · Reason: ${esc(e.reason || "—")}`;
  const fullHash = e.txHash || "";
  const shortTx  = fullHash ? fullHash.slice(0, 14) + "…" + fullHash.slice(-6) : "—";

  return `
    <div class="chain-tx ${isMint ? "mint" : "revoke"}">
      <div class="chain-tx-badge ${isMint ? "mint" : "revoke"}">${isMint ? "MINT" : "REVOKE"}</div>
      <div class="chain-tx-body">
        <div class="chain-tx-fn">${fnName}</div>
        <div class="chain-tx-detail">${detail}</div>
      </div>
      <div class="chain-tx-hash mono" title="${fullHash}">${shortTx}</div>
    </div>
  `;
}

function renderChainStats(data) {
  const el = document.getElementById("chainStatsBar");
  if (!el) return;
  const mintCount   = data.blocks.reduce((s, b) => s + b.events.filter(e => e.event === "BadgeMinted").length, 0);
  const revokeCount = data.blocks.reduce((s, b) => s + b.events.filter(e => e.event === "BadgeRevoked").length, 0);
  el.innerHTML = `
    <div class="cstat"><span class="cstat-val">${data.latestBlock}</span><span class="cstat-label">Latest Block</span></div>
    <div class="cstat-divider"></div>
    <div class="cstat"><span class="cstat-val">${data.blocks.length}</span><span class="cstat-label">Shown</span></div>
    <div class="cstat-divider"></div>
    <div class="cstat"><span class="cstat-val" style="color:var(--success)">${mintCount}</span><span class="cstat-label">Mints</span></div>
    <div class="cstat-divider"></div>
    <div class="cstat"><span class="cstat-val" style="color:var(--danger)">${revokeCount}</span><span class="cstat-label">Revokes</span></div>
    <div class="cstat-divider"></div>
    <div class="cstat" style="max-width:260px;overflow:hidden;">
      <span class="cstat-val mono" style="font-size:10px;">${esc(data.contractAddress)}</span>
      <span class="cstat-label">Contract</span>
    </div>
  `;
}

// ── Ledger view ───────────────────────────────────────────────────────────────

async function loadChainLedger() {
  const wrap = document.getElementById("chainLedgerPane");
  wrap.innerHTML = `<div class="chain-loading"><span class="chain-loading-spinner"></span>Loading ledger…</div>`;

  try {
    const { data } = await apiFetch("GET", "/api/chain/ledger");
    if (!data.ok) {
      wrap.innerHTML = `<div class="chain-loading chain-error">⚠ ${esc(data.message)}</div>`;
      return;
    }

    const maxBal = Math.max(...data.ledger.map(a => a.balanceEth), 0.001);

    let html = `<div class="ledger-table-wrap"><table class="ledger-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Address</th>
          <th>Name / Role</th>
          <th>Balance (ETH)</th>
          <th style="width:160px"></th>
        </tr>
      </thead>
      <tbody>`;

    data.ledger.forEach(acc => {
      const barPct = Math.max(2, Math.round((acc.balanceEth / maxBal) * 100));
      const roleClass = acc.role === "issuer" ? "role-issuer" : acc.role === "student" ? "role-student" : "role-unassigned";
      html += `
        <tr class="ledger-row ${acc.role}">
          <td class="ledger-idx">${acc.index}</td>
          <td class="ledger-addr mono">${acc.address}</td>
          <td class="ledger-name">
            <span class="ledger-name-text">${esc(acc.label)}</span>
            <span class="ledger-role-pill ${roleClass}">${acc.role}</span>
          </td>
          <td class="ledger-bal">
            <span class="ledger-bal-num">${acc.balanceEth.toFixed(4)}</span>
            <span class="ledger-bal-unit">ETH</span>
          </td>
          <td class="ledger-bar-cell">
            <div class="ledger-bar-track">
              <div class="ledger-bar-fill ${acc.role}" style="width:${barPct}%"></div>
            </div>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    wrap.innerHTML = html;

  } catch (err) {
    wrap.innerHTML = `<div class="chain-loading chain-error">⚠ ${esc(String(err))}</div>`;
  }
}

// ── Verify token (student) ────────────────────────────────────────────────────

async function verifyToken() {
  const tokenId = document.getElementById("verifyTokenId").value.trim();
  if (!tokenId) return;

  hide("verifyResult");
  const { data } = await apiFetch("GET", `/api/badges/${tokenId}/verify`);

  const el = document.getElementById("verifyResult");
  show("verifyResult");

  if (!data.ok) {
    el.style.borderColor = "rgba(153,27,27,.3)";
    el.innerHTML = `<h3 style="color:var(--danger);font-family:'Fraunces',serif;">Error</h3><p>${esc(data.message)}</p>`;
    return;
  }

  if (!data.exists) {
    el.style.borderColor = "rgba(153,27,27,.3)";
    el.innerHTML = `<h3 style="font-family:'Fraunces',serif;">Token #${tokenId}</h3><p style="color:var(--text2);">This token does not exist.</p>`;
    return;
  }

  el.style.borderColor = data.revoked ? "rgba(153,27,27,.3)" : "rgba(22,101,52,.3)";
  el.innerHTML = `
    <h3 style="font-family:'Fraunces',serif;margin-bottom:14px;">${data.revoked ? "⛔ Badge Revoked" : "✅ Badge Valid"}</h3>
    <div class="result-row"><span>Token ID</span><strong>#${data.tokenId}</strong></div>
    <div class="result-row"><span>Course</span><strong>${esc(data.courseName)}</strong></div>
    <div class="result-row"><span>Owner</span><code class="hash">${esc(data.owner)}</code></div>
    <div class="result-row"><span>Issued</span><strong>${data.issuedAtISO ? new Date(data.issuedAtISO).toLocaleDateString() : "—"}</strong></div>
    <div class="result-row"><span>Status</span><strong style="color:${data.revoked ? "var(--danger)" : "var(--success)"};">${data.revoked ? "REVOKED" : "VALID"}</strong></div>
  `;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Boot ──────────────────────────────────────────────────────────────────────

(async function boot() {
  await loadChainStatus();
  setInterval(loadChainStatus, 10000);

  if (restoreSession()) {
    renderTopbar();
    showDashboard();
  }

  document.getElementById("loginPassword").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
  document.getElementById("loginUsername").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
})();