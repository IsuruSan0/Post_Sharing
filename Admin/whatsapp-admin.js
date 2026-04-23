/**
 * whatsapp-admin.js
 * WhatsApp publish modal logic for the admin panel.
 * Requires script.js to be loaded first (uses SESSION_TOKEN, apiPost, showLoading, etc.)
 */

// ---------------------------------------------------------------------------
// WhatsApp helpers
// ---------------------------------------------------------------------------

function waFetch(path, options = {}) {
  return fetch(`${CONFIG.WHATSAPP.SERVER_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type":  "application/json",
      "x-api-secret":  CONFIG.WHATSAPP.API_SECRET,
      ...(options.headers || {})
    }
  });
}

// ---------------------------------------------------------------------------
// WhatsApp modal
// ---------------------------------------------------------------------------

async function openWhatsAppModal(post) {
  activePost = post;

  const modal        = document.getElementById("whatsappModal");
  const statusDot    = document.getElementById("waStatusDot");
  const statusEl     = document.getElementById("waStatus");
  const qrEl         = document.getElementById("waQrCode");
  const targetsEl    = document.getElementById("waTargetsList");
  const confirmBtn   = document.getElementById("confirmWaBtn");
  const contactInput = document.getElementById("waContactInput");

  // Reset
  statusDot.className   = "";
  statusEl.textContent  = "Checking connection…";
  qrEl.innerHTML        = "";
  targetsEl.innerHTML   = '<p style="text-align:center;color:#8a6a5a;">Loading…</p>';
  contactInput.value    = "";
  confirmBtn.disabled   = true;

  modal.classList.remove("hidden");

  try {
    const statusRes  = await waFetch("/status");
    const statusData = await statusRes.json();

    if (statusData.qrCode) {
      statusDot.className  = "wa-dot-warning";
      statusEl.textContent = "Scan QR code to connect";
      qrEl.innerHTML = `
        <img src="${statusData.qrCode}" style="width:200px;height:200px;border-radius:12px;border:3px solid #f0e2d6;" alt="WhatsApp QR Code">
        <p style="font-size:12px;color:#8a6a5a;margin-top:8px;">WhatsApp → Linked Devices → Link a Device</p>
      `;
      targetsEl.innerHTML = "";
      return;
    }

    if (!statusData.ready) {
      statusDot.className  = "wa-dot-error";
      statusEl.textContent = statusData.error || "WhatsApp is not connected.";
      targetsEl.innerHTML  = "";
      return;
    }

    // Connected
    statusDot.className  = "wa-dot-connected";
    statusEl.textContent = "Connected";

    const targetsRes  = await waFetch("/targets");
    const targetsData = await targetsRes.json();

    renderWaTargets(targetsData.targets || []);
    confirmBtn.disabled = false;

  } catch (err) {
    statusDot.className  = "wa-dot-error";
    statusEl.textContent = "Cannot reach WhatsApp server. Is it running?";
    targetsEl.innerHTML  = "";
    console.error("WhatsApp modal error:", err);
  }
}

function renderWaTargets(targets) {
  const el = document.getElementById("waTargetsList");
  el.innerHTML = "";

  const iconMap = {
    group:   "fa-users",
    channel: "fa-bullhorn",
    contact: "fa-user"
  };

  targets.forEach(target => {
    const item = document.createElement("label");
    item.className = "wa-target-item";
    item.innerHTML = `
      <input type="checkbox" class="wa-checkbox" value="${escapeAttr(target.id)}"
             data-target='${JSON.stringify(target)}' checked>
      <div class="wa-target-icon">
        <i class="fas ${iconMap[target.type] || "fa-comment"}"></i>
      </div>
      <div class="wa-target-info">
        <div class="wa-target-label">${escapeHTML(target.label)}</div>
        <div class="wa-target-type">${target.type}</div>
      </div>
      <div class="wa-checkmark" id="wachk-${escapeAttr(target.id)}">
        <i class="fas fa-check" style="color:white;font-size:11px;"></i>
      </div>
    `;

    item.classList.add("wa-target-selected");

    const cb = item.querySelector("input[type=checkbox]");
    cb.addEventListener("change", () => toggleWaTarget(item, cb, target.id));

    el.appendChild(item);
  });

  updateWaCount();
}

function toggleWaTarget(item, cb, id) {
  const chk = document.getElementById(`wachk-${id}`);
  if (cb.checked) {
    item.classList.add("wa-target-selected");
    chk.innerHTML = `<i class="fas fa-check" style="color:white;font-size:11px;"></i>`;
  } else {
    item.classList.remove("wa-target-selected");
    chk.innerHTML = "";
  }
  updateWaCount();
}

function updateWaCount() {
  const checked    = document.querySelectorAll(".wa-checkbox:checked").length;
  const contactVal = document.getElementById("waContactInput").value.trim();
  const total      = checked + (contactVal ? 1 : 0);
  const el         = document.getElementById("waSelCount");
  el.textContent   = total === 0 ? "Nothing selected" : `${total} destination${total > 1 ? "s" : ""} selected`;
  el.style.color   = total === 0 ? "#c62828" : "#8a6a5a";
}

// ---------------------------------------------------------------------------
// Confirm and send
// ---------------------------------------------------------------------------

async function confirmAndSendWhatsApp() {
  if (!activePost) return;

  const checkedBoxes = document.querySelectorAll(".wa-checkbox:checked");
  const targets      = Array.from(checkedBoxes).map(cb => JSON.parse(cb.dataset.target));

  const contactVal = document.getElementById("waContactInput").value.trim();
  if (contactVal) {
    const num = contactVal.replace(/[^\d]/g, "");
    if (num.length < 7) {
      showToast("Enter a valid phone number with country code.", "error");
      return;
    }
    targets.push({ type: "contact", number: num, label: contactVal });
  }

  if (!targets.length) {
    showToast("Select at least one destination.", "error");
    return;
  }

  const destList = targets.map(t => `• ${t.label || t.number}`).join("\n");
  const confirmed = confirm(
    `Send "${activePost.title}" to:\n\n${destList}\n\nThis will send immediately. Continue?`
  );
  if (!confirmed) return;

  showLoading();
  document.getElementById("whatsappModal").classList.add("hidden");

  try {
    const res = await waFetch("/send", {
      method: "POST",
      body: JSON.stringify({
        targets,
        message:  activePost.content,
        mediaUrl: activePost.media || null
      })
    });

    const result = await res.json();

    if (result.success) {
      const failed = (result.results || []).filter(r => !r.success);
      if (failed.length === 0) {
        showToast("WhatsApp: sent to all destinations!", "success");
      } else {
        showToast(`WhatsApp: sent, but failed for: ${failed.map(r => r.target).join(", ")}`, "info");
      }
    } else {
      showToast("WhatsApp send failed: " + (result.error || "Unknown error"), "error");
    }

  } catch (err) {
    showToast("Cannot reach WhatsApp server.", "error");
    console.error("WhatsApp send error:", err);
  } finally {
    hideLoading();
    await loadSchedule(getAdminDate());
  }
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.getElementById("cancelWaBtn").addEventListener("click", () => {
  document.getElementById("whatsappModal").classList.add("hidden");
});

document.getElementById("confirmWaBtn").addEventListener("click", confirmAndSendWhatsApp);

document.getElementById("waContactInput").addEventListener("input", updateWaCount);