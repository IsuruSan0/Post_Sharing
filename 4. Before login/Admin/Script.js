/**
 * Admin/script.js  —  All admin panel logic
 *
 * Features added / updated:
 *  1. Session token sent with every request (auth-gated API)
 *  2. Download without redirect (fetch + blob)
 *  3. Overdue posts: restricted to reject/delete/change-slot only
 *  4. Approve → Manual/Scheduled choice modal
 *  5. Change slot: future dates only
 *  6. YouTube extra fields in Buffer modal
 *  7. Admin whitelist management (owner only)
 *  8. Activity log viewer (owner only)
 *  9. "Who approved" tracked in DB
 */

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────
let SESSION_TOKEN = sessionStorage.getItem("sched_token") || "";
let SESSION_NAME  = sessionStorage.getItem("sched_name")  || "";
let SESSION_PHONE = sessionStorage.getItem("sched_phone") || "";
let SESSION_OWNER = sessionStorage.getItem("sched_owner") === "true";
let SESSION_ADMIN = sessionStorage.getItem("sched_admin") === "true";

// Redirect to submit/login if not authenticated as admin
if (!SESSION_TOKEN || (!SESSION_ADMIN && !SESSION_OWNER)) {
  window.location.href = "Submit.html";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const overlay = document.getElementById("loadingOverlay");
function showLoading()  { overlay.classList.add("active"); }
function hideLoading()  { overlay.classList.remove("active"); }

function escapeHTML(s) {
  return String(s || "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

function escapeAttr(s) { return escapeHTML(s); }

function showToast(msg, type = "info") {
  document.querySelectorAll(".admin-toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "admin-toast";
  const colors = { success:"#2e7d32", error:"#c62828", info:"#1e293b" };
  t.style.background = colors[type] || colors.info;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), CONFIG.UI?.TOAST_DURATION_MS || 3500);
}

function formatDateYMD(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function toLocalMidnight(dateStr) {
  const [y,m,d] = dateStr.split("-").map(Number);
  return new Date(y, m-1, d);
}

function formatSlotLabel(label) {
  if (!CONFIG.UI?.SLOT_NO_LEADING_ZERO) return label;
  return label.replace(/^0(\d):/, "$1:");
}

function isPostOverdue(post) {
  if (!post.date || !post.timeslot) return false;
  // Find the hour of the timeslot
  const match = post.timeslot.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return false;
  let hour = parseInt(match[1]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour  = 0;
  const slotTime = toLocalMidnight(post.date);
  slotTime.setHours(hour, 0, 0, 0);
  return slotTime < new Date();
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers (always include token)
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const sep = url.includes("?") ? "&" : "?";
  return fetch(`${url}${sep}token=${SESSION_TOKEN}`);
}

async function apiPost(payload) {
  return fetch(CONFIG.SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ ...payload, token: SESSION_TOKEN })
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let activePost = null;
let allBufferProfiles = [];

// ─────────────────────────────────────────────────────────────────────────────
// Admin header
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("adminCurrentDate").textContent =
  new Date().toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });

function getAdminDate() {
  return document.getElementById("adminDatePicker").value || formatDateYMD(new Date());
}

// Set date picker default to today
document.getElementById("adminDatePicker").value = formatDateYMD(new Date());

// ─────────────────────────────────────────────────────────────────────────────
// Load & render schedule
// ─────────────────────────────────────────────────────────────────────────────
async function loadSchedule(dateStr) {
  const grid = document.getElementById("scheduleGrid");
  grid.innerHTML = "Loading…";

  try {
    const res   = await apiFetch(CONFIG.SCRIPT_URL);
    const posts = await res.json();

    if (!Array.isArray(posts)) {
      grid.innerHTML = '<div style="color:#c62828;">Session expired. <a href="Submit.html">Login again</a></div>';
      return;
    }

    const targetTime = toLocalMidnight(dateStr).getTime();

    const dayPosts = posts.filter(p =>
      p.date && toLocalMidnight(p.date).getTime() === targetTime
    );

    // Check overdue manual posts that are still pending
    const overdueManual = dayPosts.filter(p =>
      p.scheduled === "false" && p.status === "approved" && isPostOverdue(p)
    );
    renderOverdueBanner(overdueManual);

    renderSchedule(dayPosts);

  } catch (err) {
    grid.innerHTML = '<div style="color:#c62828;">Error loading. Please refresh.</div>';
    console.error(err);
  }
}

function renderOverdueBanner(posts) {
  const bar = document.getElementById("overdueReminders");
  if (!posts.length) { bar.style.display = "none"; return; }
  bar.style.display = "";
  bar.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <strong>${posts.length}</strong>
    overdue manual post${posts.length > 1 ? "s" : ""} need attention:
    ${posts.map(p => `<span class="overdue-pill" onclick="openPostModal(${p.row})">${escapeHTML(p.title)}</span>`).join("")}`;
}

function renderSchedule(dayPosts) {
  const grid = document.getElementById("scheduleGrid");
  grid.innerHTML = "";

  const GROUP_ICONS = { Morning:"fa-sunrise", Afternoon:"fa-sun", Evening:"fa-moon" };

  for (const [groupName, slots] of Object.entries(CONFIG.SLOT_GROUPS)) {
    const col = document.createElement("div");
    col.className = "time-column";
    const iconClass = GROUP_ICONS[groupName] || "fa-clock";
    col.innerHTML = `
      <div class="column-heading">
        <i class="fas ${iconClass}"></i>
        <h2>${groupName}</h2>
      </div>
      <div class="slot-list" id="slot-list-${groupName}"></div>
    `;
    grid.appendChild(col);

    const listEl = col.querySelector(".slot-list");
    slots.forEach(slotLabel => {
      const slotValue = CONFIG.SLOT_VALUES[slotLabel];
      const post = dayPosts.find(p =>
        p.timeslot === slotLabel || p.timeslot === slotValue
      );

      if (!post) {
        const empty = document.createElement("div");
        empty.className = "time-slot empty-slot";
        empty.innerHTML = `<span class="slot-time"><i class="fas fa-clock"></i>${formatSlotLabel(slotLabel)}</span>
          <span style="color:#c8b8a8;font-size:0.8rem;">— empty —</span>`;
        listEl.appendChild(empty);
        return;
      }

      const statusClass = post.status === "approved" ? "approved-slot"
                        : post.status === "rejected" ? "rejected-slot" : "";
      const isScheduled = post.scheduled === "true";
      const dotClass    = isScheduled ? "scheduled" : "manual";
      const overdue     = isPostOverdue(post);

      const slot = document.createElement("div");
      slot.className = `time-slot ${statusClass}${overdue ? " overdue-slot" : ""}`;
      slot.dataset.row = post.row;

      slot.innerHTML = `
        <span class="slot-time">
          <i class="fas fa-clock"></i>${formatSlotLabel(slotLabel)}
        </span>
        <span class="slot-project">
          <span class="schedule-dot ${dotClass}" title="${isScheduled ? "Scheduled" : "Manual"}"></span>
          ${escapeHTML(post.title)}
        </span>
        <span class="status-badge" style="${statusBadgeStyle(post.status)}">${post.status}</span>
        ${overdue && post.status === "approved" ? '<i class="fas fa-clock" style="color:#c62828;font-size:0.8rem;" title="Overdue"></i>' : ""}
      `;

      slot.addEventListener("click", () => openPostModal(post.row));
      listEl.appendChild(slot);
    });
  }
}

function statusBadgeStyle(status) {
  const styles = {
    pending:  "background:#fff3e0;color:#e65100;",
    approved: "background:#e8f5e9;color:#2e7d32;",
    rejected: "background:#f3f3f3;color:#757575;"
  };
  return styles[status] || "background:#eee;color:#555;";
}

// ─────────────────────────────────────────────────────────────────────────────
// Post detail modal
// ─────────────────────────────────────────────────────────────────────────────
async function openPostModal(rowIndex) {
  const modal = document.getElementById("postModal");
  const body  = document.getElementById("modalBody");
  body.innerHTML = '<div style="text-align:center;padding:2rem;color:#888;">Loading…</div>';
  modal.classList.remove("hidden");

  try {
    const res   = await apiFetch(CONFIG.SCRIPT_URL);
    const posts = await res.json();
    const post  = posts.find(p => p.row === rowIndex);
    if (!post) { body.innerHTML = "<p>Post not found.</p>"; return; }

    activePost = post;
    const overdue    = isPostOverdue(post);
    const isOwner    = SESSION_OWNER;
    const isScheduled = post.scheduled === "true";

    // Build media HTML
    let mediaHTML = "";
    if (post.media) {
      const isVideo = /\.(mp4|mov|webm|avi)(\?|$)/i.test(post.media);
      mediaHTML = isVideo
        ? `<video src="${escapeAttr(post.media)}" controls class="media-preview-inner"></video>`
        : `<img src="${escapeAttr(post.media)}" class="media-preview-inner" alt="post media">`;
    } else {
      mediaHTML = `<div class="no-media-placeholder"><i class="fas fa-image" style="font-size:2rem;opacity:0.3;"></i><span>No media</span></div>`;
    }

    body.innerHTML = `
      <div class="preview-card">
        <div class="preview-header">
          <div class="preview-title">${escapeHTML(post.title)}</div>
          <span class="status-badge" style="${statusBadgeStyle(post.status)}">${post.status}</span>
          ${overdue ? '<span class="status-badge" style="background:#ffebee;color:#c62828;"><i class="fas fa-clock"></i> Overdue</span>' : ""}
        </div>

        <div class="preview-media">${mediaHTML}</div>

        <div class="preview-details-grid">
          <div class="detail-item"><i class="fas fa-user"></i><span>${escapeHTML(post.author)}</span></div>
          <div class="detail-item"><i class="fas fa-calendar"></i><span>${escapeHTML(post.date)}</span></div>
          <div class="detail-item"><i class="fas fa-clock"></i><span>${escapeHTML(post.timeslot)}</span></div>
          <div class="detail-item">
            <i class="fas fa-circle" style="color:${isScheduled ? "#2e7d32" : "#c62828"};font-size:0.6rem;"></i>
            <span>${isScheduled ? "Scheduled (auto-post)" : "Manual"}</span>
          </div>
          ${post.approvedBy ? `<div class="detail-item"><i class="fas fa-check-circle"></i><span>Approved by: ${escapeHTML(post.approvedBy)}</span></div>` : ""}
          ${isOwner && post.submitterPhone ? `<div class="detail-item"><i class="fab fa-whatsapp"></i><span style="font-size:0.8rem;color:#888;">${escapeHTML(post.submitterPhone)}</span></div>` : ""}
        </div>

        <div class="preview-content">
          <label><i class="fas fa-align-left"></i> Content</label>
          <div class="preview-content-display">${escapeHTML(post.content)}</div>
        </div>
      </div>
    `;

    renderModalButtons(post, overdue);
  } catch (err) {
    body.innerHTML = "<p>Error loading post.</p>";
    console.error(err);
  }
}

function renderModalButtons(post, overdue) {
  const group = document.getElementById("modalButtonGroup");
  group.innerHTML = "";

  const closeBtn = document.createElement("div");
  closeBtn.className = "button-row";

  // Always show close
  const close = btn("close", "fas fa-times", "Close", () => document.getElementById("postModal").classList.add("hidden"));

  if (overdue && post.status === "approved") {
    // OVERDUE approved post — restricted options only
    const rejectBtn = btn("reject", "fas fa-ban", "Reject",      () => updateStatus(post.row, "rejected"));
    const deleteBtn = btn("delete", "fas fa-trash", "Delete",    () => deletePost(post.row));
    const slotBtn   = btn("change-slot", "fas fa-exchange-alt", "Change Slot", () => openChangeSlot(post));
    closeBtn.append(rejectBtn, deleteBtn, slotBtn, close);
  } else if (overdue && post.status === "pending") {
    // OVERDUE pending post — can't approve, only reject/delete/slot
    closeBtn.innerHTML = "";
    const note = document.createElement("div");
    note.style.cssText = "color:#c62828;font-size:0.85rem;text-align:center;padding:0.5rem;";
    note.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Time slot has passed — cannot approve.';
    const rejectBtn = btn("reject", "fas fa-ban", "Reject",      () => updateStatus(post.row, "rejected"));
    const deleteBtn = btn("delete", "fas fa-trash", "Delete",    () => deletePost(post.row));
    const slotBtn   = btn("change-slot", "fas fa-exchange-alt", "Change Slot", () => openChangeSlot(post));
    group.appendChild(note);
    closeBtn.append(rejectBtn, deleteBtn, slotBtn, close);
  } else {
    // Normal post
    const row1 = document.createElement("div");
    row1.className = "button-row";

    if (post.status === "pending") {
      row1.appendChild(btn("approve", "fas fa-check", "Approve", () => showApproveModal(post)));
      row1.appendChild(btn("reject", "fas fa-ban", "Reject",     () => updateStatus(post.row, "rejected")));
    }

    if (post.status === "approved") {
      // Share dropdown
      const shareWrap = document.createElement("div");
      shareWrap.className = "share-dropdown-wrap";
      shareWrap.innerHTML = `
        <button class="share-main-btn" id="shareMainBtn">
          <i class="fas fa-share-alt"></i> Share <i class="fas fa-chevron-up share-chevron"></i>
        </button>
        <div class="share-dropdown hidden" id="shareDropdown">
          <button class="share-drop-item" id="shareBufferItem">
            <i class="fas fa-globe"></i> Social Media
          </button>
          <button class="share-drop-item whatsapp-drop" id="shareWaItem">
            <i class="fab fa-whatsapp"></i> WhatsApp
          </button>
        </div>
      `;
      row1.appendChild(shareWrap);

      shareWrap.querySelector("#shareMainBtn").addEventListener("click", e => {
        e.stopPropagation();
        shareWrap.querySelector("#shareDropdown").classList.toggle("hidden");
      });
      shareWrap.querySelector("#shareBufferItem").addEventListener("click", () => {
        shareWrap.querySelector("#shareDropdown").classList.add("hidden");
        openBufferModal(post);
      });
      shareWrap.querySelector("#shareWaItem").addEventListener("click", () => {
        shareWrap.querySelector("#shareDropdown").classList.add("hidden");
        openWhatsAppModal(post);
      });
    }

    row1.appendChild(btn("edit",        "fas fa-pen-alt",      "Edit",        () => openEditModal(post)));
    row1.appendChild(btn("change-slot", "fas fa-exchange-alt", "Change Slot", () => openChangeSlot(post)));

    if (post.media) {
      row1.appendChild(btn("download", "fas fa-download", "Download", () => downloadMedia(post.media)));
    }

    row1.appendChild(btn("delete", "fas fa-trash", "Delete", () => deletePost(post.row)));

    group.appendChild(row1);

    // Schedule toggle (if approved)
    if (post.status === "approved") {
      const toggleRow = document.createElement("div");
      toggleRow.className = "button-row";
      toggleRow.innerHTML = `
        <div class="schedule-toggle-wrap">
          <span class="schedule-toggle-label">Auto-post:</span>
          <label class="schedule-switch">
            <input type="checkbox" id="scheduleToggle" ${post.scheduled === "true" ? "checked" : ""}>
            <span class="schedule-slider"></span>
          </label>
          <span id="scheduleLabel" style="font-size:0.8rem;color:#7a5a4a;">${post.scheduled === "true" ? "Scheduled" : "Manual"}</span>
        </div>
      `;
      toggleRow.querySelector("#scheduleToggle").addEventListener("change", function() {
        setScheduled(post.row, this.checked);
        toggleRow.querySelector("#scheduleLabel").textContent = this.checked ? "Scheduled" : "Manual";
      });
      group.appendChild(toggleRow);
    }

    closeBtn.appendChild(close);
  }

  group.appendChild(closeBtn);

  // Close on outside click
  document.getElementById("postModal").addEventListener("click", e => {
    if (e.target === document.getElementById("postModal")) {
      document.getElementById("postModal").classList.add("hidden");
    }
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".share-dropdown").forEach(d => d.classList.add("hidden"));
  }, { once: true });
}

function btn(cls, icon, label, handler) {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = `<i class="${icon}"></i> ${label}`;
  b.addEventListener("click", handler);
  return b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Download without redirect
// ─────────────────────────────────────────────────────────────────────────────
async function downloadMedia(url) {
  try {
    showToast("Downloading…", "info");
    const res  = await fetch(url);
    const blob = await res.blob();
    const a    = document.createElement("a");
    const ext  = url.split("?")[0].split(".").pop() || "jpg";
    a.href     = URL.createObjectURL(blob);
    a.download = `media_${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showToast("Download failed: " + err.message, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Approve → Manual / Scheduled choice modal
// ─────────────────────────────────────────────────────────────────────────────
function showApproveModal(post) {
  // Create inline modal if not exists
  let modal = document.getElementById("approveChoiceModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "approveChoiceModal";
    modal.className = "modal hidden";
    modal.setAttribute("role", "dialog");
    modal.innerHTML = `
      <div class="modal-content" style="max-width:400px;text-align:center;">
        <h3 style="color:#2e7d32;margin-bottom:0.5rem;"><i class="fas fa-check-circle"></i> Approve Post</h3>
        <p style="color:#7a5a4a;font-size:0.9rem;margin-bottom:1.5rem;">How should this post be published?</p>
        <div style="display:flex;gap:1rem;margin-bottom:1.5rem;">
          <button id="approveManualBtn" style="flex:1;padding:1.2rem;border-radius:1.2rem;border:2px solid #e2d4c8;background:#fefaf5;cursor:pointer;font-weight:700;font-size:0.9rem;color:#4a2a1a;display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
            <i class="fas fa-hand-paper" style="font-size:1.5rem;color:#b34e1a;"></i>
            Manual
            <span style="font-size:0.75rem;font-weight:400;color:#9a7a6a;">I'll share it myself</span>
          </button>
          <button id="approveScheduleBtn" style="flex:1;padding:1.2rem;border-radius:1.2rem;border:2px solid #e2d4c8;background:#fefaf5;cursor:pointer;font-weight:700;font-size:0.9rem;color:#4a2a1a;display:flex;flex-direction:column;align-items:center;gap:0.5rem;">
            <i class="fas fa-robot" style="font-size:1.5rem;color:#2e7d32;"></i>
            Scheduled
            <span style="font-size:0.75rem;font-weight:400;color:#9a7a6a;">Auto-post at slot time</span>
          </button>
        </div>
        <button id="cancelApproveBtn" class="close" style="width:100%;"><i class="fas fa-times"></i> Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#cancelApproveBtn").addEventListener("click", () => modal.classList.add("hidden"));
  }

  modal.classList.remove("hidden");

  modal.querySelector("#approveManualBtn").onclick = async () => {
    modal.classList.add("hidden");
    await updateStatus(post.row, "approved", false);
  };
  modal.querySelector("#approveScheduleBtn").onclick = async () => {
    modal.classList.add("hidden");
    await updateStatus(post.row, "approved", true);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status update
// ─────────────────────────────────────────────────────────────────────────────
async function updateStatus(row, status, scheduleFlag) {
  showLoading();
  try {
    const payload = { action: "update", row, status };
    const res    = await apiPost(payload);
    const result = await res.json();

    if (result.success && scheduleFlag !== undefined) {
      // Also set the scheduled flag
      const res2    = await apiPost({ action: "setScheduled", row, scheduled: scheduleFlag });
      await res2.json();
    }

    if (result.success) {
      showToast(`Post ${status}.`, "success");
      document.getElementById("postModal").classList.add("hidden");
      await loadSchedule(getAdminDate());
    } else {
      showToast("Failed: " + result.error, "error");
    }
  } catch {
    showToast("Network error.", "error");
  } finally {
    hideLoading();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Set scheduled flag
// ─────────────────────────────────────────────────────────────────────────────
async function setScheduled(row, scheduled) {
  await apiPost({ action: "setScheduled", row, scheduled });
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete post
// ─────────────────────────────────────────────────────────────────────────────
async function deletePost(row) {
  if (!confirm("Delete this post and its media permanently?")) return;
  showLoading();
  try {
    const res    = await apiPost({ action: "deleteRow", row });
    const result = await res.json();
    if (result.success) {
      showToast("Post deleted.", "success");
      document.getElementById("postModal").classList.add("hidden");
      await loadSchedule(getAdminDate());
    } else {
      showToast("Delete failed: " + result.error, "error");
    }
  } finally {
    hideLoading();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit modal (content + media only)
// ─────────────────────────────────────────────────────────────────────────────
function openEditModal(post) {
  document.getElementById("postModal").classList.add("hidden");
  const modal = document.getElementById("editModal");
  document.getElementById("editContent").value = post.content || "";
  document.getElementById("mediaPreview").innerHTML = post.media
    ? `<img src="${escapeAttr(post.media)}" style="max-width:100%;max-height:180px;border-radius:1rem;" alt="current media">`
    : "<p style='color:#999;'>No current media</p>";
  modal.classList.remove("hidden");

  document.getElementById("editForm").onsubmit = async (e) => {
    e.preventDefault();
    showLoading();
    let mediaUrl = post.media;

    const file = document.getElementById("editMediaFile").files[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CONFIG.CLOUDINARY.UPLOAD_PRESET);
      const cloud = await fetch(CONFIG.CLOUDINARY.UPLOAD_URL, { method:"POST", body:formData });
      const cData = await cloud.json();
      if (cData.secure_url) mediaUrl = cData.secure_url;
    }

    const res    = await apiPost({ action:"edit", row:post.row, content: document.getElementById("editContent").value, media: mediaUrl });
    const result = await res.json();
    hideLoading();
    if (result.success) {
      showToast("Post updated.", "success");
      modal.classList.add("hidden");
      await loadSchedule(getAdminDate());
    } else {
      showToast("Edit failed: " + result.error, "error");
    }
  };
}

document.getElementById("cancelEditBtn").addEventListener("click", () => {
  document.getElementById("editModal").classList.add("hidden");
});

// ─────────────────────────────────────────────────────────────────────────────
// Change slot modal — FUTURE DATES ONLY
// ─────────────────────────────────────────────────────────────────────────────
function openChangeSlot(post) {
  document.getElementById("postModal").classList.add("hidden");
  const modal = document.getElementById("changeSlotModal");

  document.getElementById("currentSlotDate").value  = post.date    || "";
  document.getElementById("currentSlotValue").value = post.timeslot || "";

  // Set min date to today
  const todayYMD = formatDateYMD(new Date());
  const newDateInput = document.getElementById("newSlotDate");
  newDateInput.min   = todayYMD;
  newDateInput.value = todayYMD;

  loadFutureSlotsForDate(todayYMD, post);
  newDateInput.addEventListener("change", () => loadFutureSlotsForDate(newDateInput.value, post));

  modal.classList.remove("hidden");
}

async function loadFutureSlotsForDate(dateStr, currentPost) {
  const select = document.getElementById("newSlotSelect");
  const note   = document.getElementById("slotAvailabilityNote");
  select.innerHTML = '<option value="">Loading…</option>';

  try {
    const res   = await apiFetch(CONFIG.SCRIPT_URL);
    const posts = await res.json();
    const targetTime = toLocalMidnight(dateStr).getTime();
    const now        = new Date();
    const isToday    = targetTime === toLocalMidnight(formatDateYMD(now)).getTime();

    const takenSlots = posts
      .filter(p => {
        if (!p.date || !p.timeslot) return false;
        if (p.status === "rejected") return false;
        if (p.row === currentPost.row) return false; // exclude self
        return toLocalMidnight(p.date).getTime() === targetTime;
      })
      .map(p => p.timeslot);

    select.innerHTML = '<option value="">— Select a slot —</option>';
    let available = 0;

    for (const [label, value] of Object.entries(CONFIG.SLOT_VALUES)) {
      const isTaken = takenSlots.includes(label) || takenSlots.includes(value);

      // For today, also check if slot time has passed
      let isPast = false;
      if (isToday) {
        const match = label.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
        if (match) {
          let hour = parseInt(match[1]);
          const period = match[3].toUpperCase();
          if (period === "PM" && hour !== 12) hour += 12;
          if (period === "AM" && hour === 12) hour  = 0;
          const slotTime = new Date();
          slotTime.setHours(hour, 0, 0, 0);
          isPast = slotTime < now;
        }
      }

      if (!isTaken && !isPast) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = formatSlotLabel(label);
        select.appendChild(opt);
        available++;
      }
    }

    note.textContent = available === 0 ? "No available slots on this date." : `${available} slot(s) available`;
    note.style.color = available === 0 ? "#c62828" : "#2e7d32";
  } catch {
    select.innerHTML = '<option value="">Error loading slots</option>';
  }
}

document.getElementById("cancelChangeSlotBtn").addEventListener("click", () => {
  document.getElementById("changeSlotModal").classList.add("hidden");
});

document.getElementById("confirmChangeSlotBtn").addEventListener("click", async () => {
  const newSlot = document.getElementById("newSlotSelect").value;
  const newDate = document.getElementById("newSlotDate").value;
  if (!newSlot) { showToast("Select a slot first.", "error"); return; }

  showLoading();
  try {
    const res    = await apiPost({ action:"changeSlot", row:activePost.row, newSlot, newDate });
    const result = await res.json();
    if (result.success) {
      showToast("Slot changed.", "success");
      document.getElementById("changeSlotModal").classList.add("hidden");
      await loadSchedule(getAdminDate());
    } else {
      showToast("Failed: " + result.error, "error");
    }
  } finally {
    hideLoading();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Buffer modal — with YouTube extra fields
// ─────────────────────────────────────────────────────────────────────────────
const YT_CATEGORIES = [
  { id:"1",  name:"Film & Animation" }, { id:"2",  name:"Autos & Vehicles" },
  { id:"10", name:"Music" },            { id:"15", name:"Pets & Animals" },
  { id:"17", name:"Sports" },           { id:"20", name:"Gaming" },
  { id:"22", name:"People & Blogs" },   { id:"23", name:"Comedy" },
  { id:"24", name:"Entertainment" },    { id:"25", name:"News & Politics" },
  { id:"26", name:"Howto & Style" },    { id:"27", name:"Education" },
  { id:"28", name:"Science & Technology" }, { id:"29", name:"Nonprofits & Activism" }
];

async function openBufferModal(post) {
  activePost = post;
  const modal = document.getElementById("bufferModal");
  const list  = document.getElementById("bufferProfilesList");
  list.innerHTML = '<p style="text-align:center;color:#888;">Loading…</p>';
  modal.classList.remove("hidden");

  if (!allBufferProfiles.length) {
    try {
      const res = await apiFetch(`${CONFIG.SCRIPT_URL}?action=getProfiles`);
      allBufferProfiles = await res.json();
    } catch { allBufferProfiles = []; }
  }

  renderBufferProfiles(allBufferProfiles, post);
}

function renderBufferProfiles(profiles, post) {
  const list = document.getElementById("bufferProfilesList");
  list.innerHTML = "";

  const SERVICE_COLORS = {
    facebook:"#1877F2", instagram:"#E1306C", twitter:"#1DA1F2",
    linkedin:"#0A66C2", youtube:"#FF0000", tiktok:"#010101", pinterest:"#E60023"
  };
  const SERVICE_ICONS = {
    facebook:"fab fa-facebook-f", instagram:"fab fa-instagram", twitter:"fab fa-twitter",
    linkedin:"fab fa-linkedin-in", youtube:"fab fa-youtube", tiktok:"fab fa-tiktok", pinterest:"fab fa-pinterest-p"
  };

  profiles.forEach(profile => {
    const color = SERVICE_COLORS[profile.serviceName] || "#888";
    const icon  = SERVICE_ICONS[profile.serviceName]  || "fas fa-globe";
    const isYT  = profile.serviceName === "youtube";

    const item = document.createElement("div");
    item.className = "social-profile-item social-profile-selected";
    item.innerHTML = `
      <label class="social-profile-label">
        <input type="checkbox" class="social-checkbox buffer-cb" value="${escapeAttr(profile.id)}"
               data-profile='${JSON.stringify(profile)}' checked>
        <div class="social-profile-icon" style="background:${color};">
          <i class="${icon}" style="color:white;"></i>
        </div>
        <div class="social-profile-info">
          <div class="social-profile-name">${escapeHTML(profile.username || profile.id)}</div>
          <div style="font-size:0.78rem;color:#9a7a6a;">${profile.serviceName}</div>
        </div>
        <div class="social-profile-check"><i class="fas fa-check" style="color:white;font-size:11px;"></i></div>
      </label>
      ${isYT ? renderYouTubeFields(profile.id, post) : ""}
      <button class="social-preview-btn" data-profile-id="${escapeAttr(profile.id)}">
        <i class="fas fa-eye"></i> Preview
      </button>
    `;

    const cb = item.querySelector(".buffer-cb");
    const checkIcon = item.querySelector(".social-profile-check");
    cb.addEventListener("change", () => {
      item.classList.toggle("social-profile-selected", cb.checked);
      checkIcon.innerHTML = cb.checked ? '<i class="fas fa-check" style="color:white;font-size:11px;"></i>' : "";
      // Show/hide YouTube fields
      const ytFields = item.querySelector(".yt-extra-fields");
      if (ytFields) ytFields.style.display = cb.checked ? "" : "none";
    });

    item.querySelector(".social-preview-btn").addEventListener("click", () =>
      showSocialPreview(profile.serviceName, post, item)
    );

    list.appendChild(item);
  });

  if (!profiles.length) {
    list.innerHTML = '<p style="text-align:center;color:#888;">No connected channels found.</p>';
  }
}

function renderYouTubeFields(profileId, post) {
  const categoryOptions = YT_CATEGORIES.map(c =>
    `<option value="${c.id}" ${c.id === "22" ? "selected" : ""}>${c.name}</option>`
  ).join("");

  return `
    <div class="yt-extra-fields" style="background:#fff0f0;border-radius:0.8rem;padding:0.8rem;margin-top:0.5rem;border:1px solid #ffd0d0;">
      <div style="font-size:0.75rem;font-weight:700;color:#cc0000;margin-bottom:0.5rem;">
        <i class="fab fa-youtube"></i> YouTube Settings
      </div>
      <label style="font-size:0.8rem;font-weight:600;color:#4a2a1a;display:block;margin-bottom:0.3rem;">Video Title (max 100 chars)</label>
      <input type="text" class="edit-input yt-title" maxlength="100"
             value="${escapeAttr(post.title || post.content.substring(0,100))}"
             style="margin-bottom:0.6rem;font-size:0.85rem;padding:0.5rem 0.8rem;">
      <label style="font-size:0.8rem;font-weight:600;color:#4a2a1a;display:block;margin-bottom:0.3rem;">Category</label>
      <select class="edit-input yt-category" style="margin-bottom:0.6rem;font-size:0.85rem;padding:0.5rem 0.8rem;">
        ${categoryOptions}
      </select>
      <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem;font-weight:600;color:#4a2a1a;">
        <input type="checkbox" class="yt-notify" checked style="width:auto;">
        Notify subscribers
      </label>
    </div>
  `;
}

function showSocialPreview(service, post, container) {
  // Remove existing preview in this container
  const existing = container.querySelector(".social-preview-popup");
  if (existing) { existing.remove(); return; }

  const SERVICE_COLORS = { facebook:"#1877F2", instagram:"#E1306C", twitter:"#1DA1F2", linkedin:"#0A66C2", youtube:"#FF0000", tiktok:"#010101", pinterest:"#E60023" };
  const color = SERVICE_COLORS[service] || "#888";

  const popup = document.createElement("div");
  popup.className = "social-preview-popup";
  popup.innerHTML = `
    <div class="spp-header" style="background:${color};">
      <i class="fab fa-${service}"></i> Preview on ${service}
      <button class="spp-close" onclick="this.closest('.social-preview-popup').remove()"><i class="fas fa-times"></i></button>
    </div>
    <div class="spp-body">
      ${post.media ? `<div class="spp-media"><img src="${escapeAttr(post.media)}" alt="media"></div>` : ""}
      <div class="spp-text">${escapeHTML(post.content)}</div>
    </div>
  `;
  container.appendChild(popup);
}

document.getElementById("cancelBufferBtn").addEventListener("click", () => {
  document.getElementById("bufferModal").classList.add("hidden");
});

document.getElementById("confirmBufferBtn").addEventListener("click", async () => {
  const checked = document.querySelectorAll(".buffer-cb:checked");
  if (!checked.length) { showToast("Select at least one channel.", "error"); return; }

  const profiles = Array.from(checked).map(cb => {
    const prof   = JSON.parse(cb.dataset.profile);
    const parent = cb.closest(".social-profile-item");
    if (prof.serviceName === "youtube") {
      prof.youtubeTitle       = parent.querySelector(".yt-title")?.value    || "";
      prof.youtubeCategory    = parent.querySelector(".yt-category")?.value  || "22";
      prof.notifySubscribers  = parent.querySelector(".yt-notify")?.checked !== false;
    }
    prof.profileId = prof.id;
    return prof;
  });

  if (!confirm(`Publish to ${profiles.length} channel(s) now?`)) return;
  showLoading();
  document.getElementById("bufferModal").classList.add("hidden");

  try {
    const res    = await apiPost({ action:"publishToBuffer", row:activePost.row, profiles });
    const result = await res.json();
    if (result.success) {
      showToast("Published to social media!", "success");
      await loadSchedule(getAdminDate());
    } else {
      showToast("Publish failed: " + result.error, "error");
    }
  } finally {
    hideLoading();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Projects modal
// ─────────────────────────────────────────────────────────────────────────────
async function loadProjectsModal() {
  const list = document.getElementById("projectsList");
  list.innerHTML = '<p style="color:#888;text-align:center;">Loading…</p>';

  try {
    const res      = await apiFetch(`${CONFIG.SCRIPT_URL}?action=getProjects`);
    const projects = await res.json();
    list.innerHTML = "";

    projects.forEach(p => {
      const item = document.createElement("div");
      item.className = "project-list-item";
      item.style.cssText = "display:flex;align-items:center;gap:0.7rem;padding:0.6rem 0.8rem;border-radius:0.8rem;border:1px solid #f0e2d6;margin-bottom:0.5rem;background:#fefaf5;";
      item.innerHTML = `
        <span style="width:12px;height:12px;border-radius:50%;background:${p.color || "#b34e1a"};flex-shrink:0;"></span>
        <span style="flex:1;font-weight:600;">${escapeHTML(p.name)}</span>
        <span style="font-size:0.75rem;color:#9a7a6a;">${p.status === "ongoing" ? "🟢 Ongoing" : "🔵 To Be"}</span>
        <label class="schedule-switch" title="Toggle status">
          <input type="checkbox" class="project-status-toggle" ${p.status === "ongoing" ? "checked" : ""}
                 data-row="${p.row}" data-name="${escapeAttr(p.name)}" data-color="${escapeAttr(p.color || "#b34e1a")}">
          <span class="schedule-slider"></span>
        </label>
        <button class="close" style="padding:0.3rem 0.7rem;font-size:0.78rem;" data-row="${p.row}">
          <i class="fas fa-trash"></i>
        </button>
      `;

      item.querySelector(".project-status-toggle").addEventListener("change", async function() {
        await apiPost({ action:"updateProject", row:this.dataset.row, name:this.dataset.name,
          status: this.checked ? "ongoing" : "tobe", color: this.dataset.color });
        loadProjectsModal();
      });

      item.querySelector(".close").addEventListener("click", async function() {
        if (!confirm(`Remove "${p.name}"?`)) return;
        await apiPost({ action:"removeProject", row:p.row });
        loadProjectsModal();
      });

      list.appendChild(item);
    });

    if (!projects.length) list.innerHTML = '<p style="color:#888;text-align:center;">No projects yet.</p>';
  } catch {
    list.innerHTML = '<p style="color:#c62828;">Error loading projects.</p>';
  }
}

document.getElementById("manageProjectsBtn").addEventListener("click", async () => {
  document.getElementById("projectsModal").classList.remove("hidden");
  await loadProjectsModal();
});

document.getElementById("cancelProjectsBtn").addEventListener("click", () => {
  document.getElementById("projectsModal").classList.add("hidden");
});

document.getElementById("addProjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name   = document.getElementById("newProjectName").value.trim();
  const status = document.getElementById("newProjectStatus").value;
  const color  = document.getElementById("newProjectColor").value;
  if (!name) return;

  const res    = await apiPost({ action:"addProject", name, status, color });
  const result = await res.json();
  if (result.success) {
    document.getElementById("newProjectName").value = "";
    loadProjectsModal();
  } else {
    showToast("Failed: " + result.error, "error");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin management (owner only)
// ─────────────────────────────────────────────────────────────────────────────
if (SESSION_OWNER) {
  // Add Manage Admins button to admin controls
  const adminControls = document.querySelector(".admin-controls");
  const adminsBtn = document.createElement("button");
  adminsBtn.innerHTML = '<i class="fas fa-user-shield"></i> Admins';
  adminsBtn.addEventListener("click", openAdminsModal);
  adminControls.appendChild(adminsBtn);

  const logBtn = document.createElement("button");
  logBtn.innerHTML = '<i class="fas fa-history"></i> Activity Log';
  logBtn.addEventListener("click", openLogModal);
  adminControls.appendChild(logBtn);
}

function openAdminsModal() {
  let modal = document.getElementById("adminsModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "adminsModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:500px;">
        <h3><i class="fas fa-user-shield"></i> Manage Admins</h3>
        <p style="font-size:0.85rem;color:#8a6a5a;margin-bottom:1rem;">Phone numbers that can access the admin panel.</p>
        <div id="adminsList"></div>
        <div style="margin-top:1rem;display:flex;gap:0.6rem;">
          <input type="tel" id="newAdminPhone" class="edit-input" placeholder="Phone (e.g. 94767633875)" style="flex:1;">
          <select id="newAdminRole" class="edit-input" style="width:auto;">
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <button class="approve" id="addAdminBtn"><i class="fas fa-plus"></i> Add</button>
        </div>
        <div class="button-group" style="justify-content:flex-end;margin-top:1rem;">
          <button class="close" id="closeAdminsBtn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#closeAdminsBtn").addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector("#addAdminBtn").addEventListener("click", async () => {
      const phone = modal.querySelector("#newAdminPhone").value.replace(/[^\d]/g,"");
      const role  = modal.querySelector("#newAdminRole").value;
      if (!phone) { showToast("Enter a phone number.", "error"); return; }
      await apiPost({ action:"addAdmin", phone, role });
      loadAdminsList(modal);
    });
  }
  modal.classList.remove("hidden");
  loadAdminsList(modal);
}

async function loadAdminsList(modal) {
  const list = modal.querySelector("#adminsList");
  list.innerHTML = "Loading…";
  const res   = await apiFetch(`${CONFIG.SCRIPT_URL}?action=getAdmins`);
  const data  = await res.json();
  list.innerHTML = "";
  (data || []).forEach(a => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:0.7rem;padding:0.5rem 0.8rem;border-radius:0.8rem;border:1px solid #f0e2d6;margin-bottom:0.4rem;background:#fefaf5;";
    row.innerHTML = `
      <span style="flex:1;font-weight:600;">${escapeHTML(a.phone)}</span>
      <span style="font-size:0.78rem;background:${a.role==="owner"?"#b34e1a":"#2c5f7a"};color:white;padding:2px 10px;border-radius:2rem;">${a.role}</span>
      ${a.role !== "owner" ? `<button class="delete" style="padding:0.3rem 0.7rem;font-size:0.78rem;" data-row="${a.row}"><i class="fas fa-trash"></i></button>` : ""}
    `;
    if (a.role !== "owner") {
      row.querySelector("button").addEventListener("click", async () => {
        if (!confirm("Remove this admin?")) return;
        await apiPost({ action:"removeAdmin", row:a.row });
        loadAdminsList(modal);
      });
    }
    list.appendChild(row);
  });
}

function openLogModal() {
  let modal = document.getElementById("logModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "logModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-content" style="max-width:700px;">
        <h3><i class="fas fa-history"></i> Activity Log</h3>
        <p style="font-size:0.85rem;color:#8a6a5a;margin-bottom:1rem;">Last 200 actions. Newest first.</p>
        <div id="logList" style="max-height:60vh;overflow-y:auto;font-size:0.82rem;"></div>
        <div class="button-group" style="justify-content:flex-end;margin-top:1rem;">
          <button class="close" id="closeLogBtn">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#closeLogBtn").addEventListener("click", () => modal.classList.add("hidden"));
  }
  modal.classList.remove("hidden");
  loadLog(modal);
}

async function loadLog(modal) {
  const list = modal.querySelector("#logList");
  list.innerHTML = "Loading…";
  const res  = await apiFetch(`${CONFIG.SCRIPT_URL}?action=getLog`);
  const data = await res.json();
  list.innerHTML = "";
  (data || []).forEach(entry => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:0.7rem;padding:0.5rem 0.8rem;border-bottom:1px solid #f5f0e8;align-items:flex-start;";
    const ts = new Date(entry.timestamp).toLocaleString();
    row.innerHTML = `
      <span style="color:#9a7a6a;white-space:nowrap;min-width:130px;">${ts}</span>
      <span style="font-weight:600;min-width:80px;color:#b34e1a;">${escapeHTML(entry.action)}</span>
      <span style="flex:1;">${escapeHTML(entry.detail)}</span>
      <span style="color:#9a7a6a;font-size:0.75rem;">${escapeHTML(entry.actor)}</span>
    `;
    list.appendChild(row);
  });
  if (!data?.length) list.innerHTML = '<p style="text-align:center;color:#888;">No activity yet.</p>';
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh & date picker
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("refreshBtn").addEventListener("click", () => loadSchedule(getAdminDate()));
document.getElementById("adminDatePicker").addEventListener("change", () => loadSchedule(getAdminDate()));

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
loadSchedule(getAdminDate());