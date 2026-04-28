/**
 * Config.js
 * Central configuration for Time Slot Scheduler.
 * Edit values here; everything else in the app reads from CONFIG.
 *
 * Structure:https://script.google.com/macros/s/AKfycbzzx_eCV
 *   CONFIG.SCRIPT_URL      – Google Apps Script Web App endpoint
 *   CONFIG.CLOUDINARY      – Cloudinary upload settings
 *   CONFIG.BUFFER          – Buffer GraphQL API & org IDs
 *   CONFIG.APP             – General app settings (email, file size limits, etc.)
 *   CONFIG.SLOT_GROUPS     – Display-label time slots grouped by period
 *   CONFIG.SLOT_VALUES     – Maps display labels → internal values sent to the backend
 *   CONFIG.FEATURES        – Feature flags (toggle Buffer publish, media download, etc.)
 *   CONFIG.UI              – UI behaviour (toast duration, leading-zero formatting)
 */

const CONFIG = {

  /** Google Apps Script Web App URL */
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzWcF6b1CbaYnHlTfFJW9J7Qoun_SUiUv_lTE8_RgjLgJ8xLQ4KQXDcvNimWb44D3Tl/exec",

  /** Cloudinary media upload settings */
  CLOUDINARY: {
    UPLOAD_URL:    "https://api.cloudinary.com/v1_1/dfxbg9cr1/upload",
    UPLOAD_PRESET: "unsigned_upload",
    CLOUD_NAME:    "dfxbg9cr1"
  },

  /**
   * Buffer GraphQL API.
   * Auth tokens are stored server-side in Google Apps Script Properties —
   * never put tokens here.
  */
  BUFFER: {
    GRAPHQL_URL: "https://api.buffer.com/graphql",
    ORG_SOCIAL:  "69cbe2988113fa521a4e6d6c",  // Facebook, Instagram, LinkedIn
    ORG_VIDEO:   "69d8b6007d05daf89785f93b"   // YouTube, TikTok
  },

  WHATSAPP: {
    SERVER_URL: "https://champagne-appointment-consequence-meeting.trycloudflare.com", // <- Replace with your VPS IP
    API_SECRET: "hiru12345"// <- Must match server .env
  },

  /** General application settings */
  APP: {
    NAME:                 "Time Slot Scheduler",
    ADMIN_EMAIL:          "isuruthegreat1@gmail.com",
    ADMIN_WHATSAPP:       "94767633875",  // No leading +, no spaces
    MAX_IMAGE_SIZE_MB:    10,
    MAX_VIDEO_SIZE_MB:    100,
    EDIT_IMAGE_MAX_SIZE_MB: 2
  },

  /**
   * Time slot groups shown in the UI.
   * Keys are group headings; values are arrays of display labels.
   * Labels must match keys in SLOT_VALUES below.
   */
  SLOT_GROUPS: {
    "Morning":   ["08:00 AM", "09:00 AM", "10:00 AM"],
    "Afternoon": ["12:00 PM", "01:00 PM", "02:00 PM"],
    "Evening":   ["06:00 PM", "07:00 PM", "08:00 PM"]
  },

  /**
   * Maps display labels (with leading zeros) → internal values sent to the backend.
   * Keeping leading zeros in keys ensures consistent lookups regardless of
   * the SLOT_NO_LEADING_ZERO display flag.
   */
  SLOT_VALUES: {
    "08:00 AM": "8:00 AM",
    "09:00 AM": "9:00 AM",
    "10:00 AM": "10:00 AM",
    "12:00 PM": "12:00 PM",
    "01:00 PM": "1:00 PM",
    "02:00 PM": "2:00 PM",
    "06:00 PM": "6:00 PM",
    "07:00 PM": "7:00 PM",
    "08:00 PM": "8:00 PM"
  },

  /** Feature flags – set to false to disable a feature without deleting code */
  FEATURES: {
    ENABLE_BUFFER_PUBLISH:   true,
    ENABLE_MEDIA_DOWNLOAD:   true,
    ENABLE_WHATSAPP_PUBLISH: true
  },

  /**
   * UI behaviour settings.
   * NOTE: CONFIG.UI is intentionally NOT frozen so individual pages can override
   * SLOT_NO_LEADING_ZERO (e.g. submit.html sets it to true for a cleaner look).
   */
  UI: {
    TOAST_DURATION_MS:     3000,
    SLOT_NO_LEADING_ZERO:  false  // Set to true per-page to strip leading zeros from slot labels
  }

};

// Freeze immutable sections to prevent accidental mutations at runtime.
// CONFIG.UI is deliberately left unfrozen so pages can override display settings.
Object.freeze(CONFIG.CLOUDINARY);
Object.freeze(CONFIG.BUFFER);
Object.freeze(CONFIG.APP);
Object.freeze(CONFIG.SLOT_GROUPS);
Object.freeze(CONFIG.SLOT_VALUES);
Object.freeze(CONFIG.FEATURES);
// Top-level freeze must come AFTER nested freezes
Object.freeze(CONFIG);
Object.freeze(CONFIG.WHATSAPP);

// ---------------------------------------------------------------------------
// Convenience aliases (backward-compatible – existing code can keep using these)
// ---------------------------------------------------------------------------
const SCRIPT_URL     = CONFIG.SCRIPT_URL;
const CLOUDINARY_URL = CONFIG.CLOUDINARY.UPLOAD_URL;
const UPLOAD_PRESET  = CONFIG.CLOUDINARY.UPLOAD_PRESET;
const slotGroups     = CONFIG.SLOT_GROUPS;
const slotValues     = CONFIG.SLOT_VALUES;
