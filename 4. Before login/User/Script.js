/**
 * User/script.js
 */

const overlay = document.getElementById("loadingOverlay");
let selectedDate = null;
let selectedSlot = null;

function showLoading()  { overlay.classList.add("active"); }
function hideLoading()  { overlay.classList.remove("active"); }

function showMessage(msg, type) {
  const div = document.getElementById("statusMsg");
  div.textContent = msg;
  div.className   = `message ${type}`;
  setTimeout(() => { div.textContent = ""; div.className = "message"; }, CONFIG.UI.TOAST_DURATION_MS);
}

function getNext7Days() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

function formatDateYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalMidnight(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatSlotLabel(label) {
  if (!CONFIG.UI.SLOT_NO_LEADING_ZERO) return label;
  return label.replace(/^0(\d):/, "$1:");
}

// ---------------------------------------------------------------------------
// Load projects into dropdown
// ---------------------------------------------------------------------------

async function loadProjects() {
  const select = document.getElementById("projectSelect");
  if (!select) return;
  try {
    const res      = await fetch(`${CONFIG.SCRIPT_URL}?action=getProjects`);
    const projects = await res.json();

    // Clear all except placeholder
    while (select.options.length > 1) select.remove(1);

    if (!projects.length) {
      const opt  = document.createElement("option");
      opt.value  = "";
      opt.textContent = "No projects available";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }

    // Group: ongoing first, then to-be
    const ongoing = projects.filter(p => p.status === "ongoing");
    const tobe    = projects.filter(p => p.status !== "ongoing");

    if (ongoing.length) {
      const grp   = document.createElement("optgroup");
      grp.label   = "🟢 Ongoing";
      ongoing.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        opt.dataset.color = p.color || "#b34e1a";
        opt.dataset.status = "ongoing";
        grp.appendChild(opt);
      });
      select.appendChild(grp);
    }

    if (tobe.length) {
      const grp   = document.createElement("optgroup");
      grp.label   = "🔵 To Be";
      tobe.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        opt.dataset.color = p.color || "#2c5f7a";
        opt.dataset.status = "tobe";
        grp.appendChild(opt);
      });
      select.appendChild(grp);
    }

  } catch (err) {
    console.error("loadProjects error:", err);
  }
}

// ---------------------------------------------------------------------------
// Media upload box
// ---------------------------------------------------------------------------

function initMediaUploadBox() {
  const box       = document.getElementById("mediaUploadBox");
  const input     = document.getElementById("mediaFile");
  const ui        = document.getElementById("mediaUploadUI");
  const preview   = document.getElementById("mediaUploadPreview");
  const previewIn = document.getElementById("mediaPreviewInner");
  const fileName  = document.getElementById("mediaFileName");
  const clearBtn  = document.getElementById("mediaClearBtn");

  if (!box || !input) return;

  // Click on box triggers file input
  ui.addEventListener("click", () => input.click());

  // Drag and drop
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drag-over"); });
  box.addEventListener("dragleave", ()  => box.classList.remove("drag-over"));
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setMediaFile(file);
  });

  input.addEventListener("change", () => {
    if (input.files[0]) setMediaFile(input.files[0]);
  });

  clearBtn.addEventListener("click", () => {
    input.value  = "";
    previewIn.innerHTML = "";
    fileName.textContent = "";
    preview.classList.add("hidden");
    ui.classList.remove("hidden");
  });

  function setMediaFile(file) {
    fileName.textContent = file.name;
    previewIn.innerHTML  = "";

    if (file.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src   = URL.createObjectURL(file);
      img.style.cssText = "max-width:100%;max-height:160px;border-radius:0.8rem;";
      previewIn.appendChild(img);
    } else if (file.type.startsWith("video/")) {
      const vid = document.createElement("video");
      vid.src   = URL.createObjectURL(file);
      vid.controls = true;
      vid.style.cssText = "max-width:100%;max-height:160px;border-radius:0.8rem;";
      previewIn.appendChild(vid);
    } else {
      previewIn.innerHTML = `<i class="fas fa-file" style="font-size:2rem;color:#b34e1a;"></i>`;
    }

    ui.classList.add("hidden");
    preview.classList.remove("hidden");

    // Update the actual file input
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }
}

// ---------------------------------------------------------------------------
// Date picker
// ---------------------------------------------------------------------------

function renderDatePicker() {
  const container = document.getElementById("datePicker");
  const days      = getNext7Days();
  container.innerHTML = "";

  days.forEach((date, idx) => {
    const ymd     = formatDateYMD(date);
    const month   = date.toLocaleDateString(undefined, { month: "short" });
    const dayNum  = date.getDate();
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });

    const item = document.createElement("div");
    item.className    = "date-item" + (idx === 0 ? " active" : "");
    item.dataset.date = ymd;
    item.innerHTML    = `
      <div class="date-month">${month}</div>
      <div class="date-circle">${dayNum}</div>
      <div class="date-weekday">${weekday}</div>
    `;

    item.addEventListener("click", async () => {
      document.querySelectorAll(".date-item").forEach(el => el.classList.remove("active"));
      item.classList.add("active");
      selectedDate = ymd;
      document.getElementById("selectedDate").value = selectedDate;
      await loadTakenSlots(selectedDate);
    });

    container.appendChild(item);
  });

  const firstItem = container.querySelector(".date-item");
  if (firstItem) firstItem.click();
}

// ---------------------------------------------------------------------------
// Slot loading & rendering
// ---------------------------------------------------------------------------

async function loadTakenSlots(dateStr) {
  const slotContainer = document.getElementById("slotPicker");
  slotContainer.innerHTML = '<div style="text-align:center;">Loading slots…</div>';

  try {
    const res        = await fetch(CONFIG.SCRIPT_URL);
    const posts      = await res.json();
    const targetTime = toLocalMidnight(dateStr).getTime();
    const todayTime  = toLocalMidnight(formatDateYMD(new Date())).getTime();

    const taken = posts
      .filter(p => {
        if (!p.date || !p.timeslot) return false;
        if (p.status === "rejected") return false;
        return toLocalMidnight(p.date).getTime() === targetTime;
      })
      .map(p => p.timeslot);

    if (targetTime === todayTime) {
      const now = new Date();
      for (const [label, value] of Object.entries(CONFIG.SLOT_VALUES)) {
        const match = label.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
        if (!match) continue;
        let hour = parseInt(match[1]);
        const period = match[3].toUpperCase();
        if (period === "PM" && hour !== 12) hour += 12;
        if (period === "AM" && hour === 12) hour  = 0;
        const slotTime = new Date();
        slotTime.setHours(hour, 0, 0, 0);
        if (slotTime < now) {
          if (!taken.includes(label)) taken.push(label);
          if (!taken.includes(value)) taken.push(value);
        }
      }
    }

    renderSlotPicker(taken);
  } catch (err) {
    slotContainer.innerHTML = '<div style="color:red;">Error loading slots. Please refresh.</div>';
    console.error("loadTakenSlots error:", err);
  }
}

function renderSlotPicker(takenSlots) {
  const container = document.getElementById("slotPicker");
  container.innerHTML = "";
  const GROUP_ICONS = { Morning: "fa-sunrise", Afternoon: "fa-sun", Evening: "fa-moon" };

  for (const [groupName, slots] of Object.entries(CONFIG.SLOT_GROUPS)) {
    const groupDiv     = document.createElement("div");
    groupDiv.className = "slot-group";
    const iconClass    = GROUP_ICONS[groupName] ?? "fa-clock";
    groupDiv.innerHTML = `
      <h4><i class="fas ${iconClass}"></i> ${groupName}</h4>
      <div class="slot-buttons"></div>
    `;
    const btnsDiv = groupDiv.querySelector(".slot-buttons");

    for (const slot of slots) {
      const isTaken =
        takenSlots.includes(slot) ||
        takenSlots.includes(CONFIG.SLOT_VALUES[slot]);

      const btn         = document.createElement("div");
      btn.className     = `slot-option${isTaken ? " taken" : ""}`;
      btn.textContent   = formatSlotLabel(slot);
      btn.dataset.value = CONFIG.SLOT_VALUES[slot];

      if (selectedSlot === slot && !isTaken) btn.classList.add("selected");

      if (!isTaken) {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".slot-option.selected").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedSlot = slot;
          document.getElementById("selectedTimeslot").value = btn.dataset.value;
          renderSlotPicker(takenSlots);
        });
      }
      btnsDiv.appendChild(btn);
    }
    container.appendChild(groupDiv);
  }

  if (selectedSlot) {
    const info     = document.createElement("div");
    info.className = "selected-slot-info";
    info.innerHTML = `<i class="fas fa-check-circle"></i> Selected: ${formatSlotLabel(selectedSlot)}`;
    container.appendChild(info);
  }
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

document.getElementById("submitForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const title    = document.getElementById("projectSelect").value.trim();
  const content  = document.getElementById("content").value.trim();
  const author   = document.getElementById("author").value.trim();
  const timeslot = document.getElementById("selectedTimeslot").value;
  const date     = selectedDate;
  const file     = document.getElementById("mediaFile").files[0];

  if (!title)    { showMessage("Please select a project.",    "error"); return; }
  if (!date)     { showMessage("Please select a date.",       "error"); return; }
  if (!timeslot) { showMessage("Please select a time slot.",  "error"); return; }
  if (!file)     { showMessage("Please attach a media file.", "error"); return; }

  const maxImageBytes = CONFIG.APP.MAX_IMAGE_SIZE_MB * 1024 * 1024;
  const maxVideoBytes = CONFIG.APP.MAX_VIDEO_SIZE_MB * 1024 * 1024;

  if (file.type.startsWith("image/") && file.size > maxImageBytes) {
    showMessage(`Image must be under ${CONFIG.APP.MAX_IMAGE_SIZE_MB} MB.`, "error"); return;
  }
  if (file.type.startsWith("video/") && file.size > maxVideoBytes) {
    showMessage(`Video must be under ${CONFIG.APP.MAX_VIDEO_SIZE_MB} MB.`, "error"); return;
  }

  showLoading();

  try {
    // Race-condition guard
    const checkRes   = await fetch(CONFIG.SCRIPT_URL);
    const allPosts   = await checkRes.json();
    const targetTime = toLocalMidnight(date).getTime();

    const stillTaken = allPosts.some(p => {
      if (!p.date || !p.timeslot) return false;
      if (p.status === "rejected") return false;
      return (p.timeslot === timeslot || CONFIG.SLOT_VALUES[p.timeslot] === timeslot) &&
             toLocalMidnight(p.date).getTime() === targetTime;
    });

    if (stillTaken) {
      hideLoading();
      showMessage("That slot was just taken — please choose another.", "error");
      await loadTakenSlots(date);
      return;
    }

    // Upload to Cloudinary
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CONFIG.CLOUDINARY.UPLOAD_PRESET);
    const cloudRes  = await fetch(CONFIG.CLOUDINARY.UPLOAD_URL, { method: "POST", body: formData });
    const cloudData = await cloudRes.json();
    if (!cloudData.secure_url) throw new Error("Media upload failed.");

    // Submit
    const payload = { title, content, author, timeslot, media: cloudData.secure_url, date };
    const res     = await fetch(CONFIG.SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) });
    const result  = await res.json();

    hideLoading();

    if (result.success) {
      showMessage("Submitted! Awaiting admin approval.", "success");
      document.getElementById("submitForm").reset();
      document.getElementById("projectSelect").value = "";
      // Reset media box
      document.getElementById("mediaUploadPreview").classList.add("hidden");
      document.getElementById("mediaUploadUI").classList.remove("hidden");
      document.getElementById("mediaPreviewInner").innerHTML = "";
      document.getElementById("mediaFileName").textContent = "";
      selectedSlot = null;
      document.getElementById("selectedTimeslot").value = "";
      if (selectedDate) await loadTakenSlots(selectedDate);
    } else {
      showMessage("Submission failed: " + (result.error || "Unknown error"), "error");
    }

  } catch (err) {
    hideLoading();
    showMessage("Error: " + err.message, "error");
    console.error("Submission error:", err);
  }
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
loadProjects();
initMediaUploadBox();
renderDatePicker();