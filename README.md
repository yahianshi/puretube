<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="PureTube Logo" />
</p>

<h1 align="center">PureTube</h1>

<p align="center">
  <strong>The all-in-one, high-performance YouTube optimizer for Chromium browsers.</strong><br />
  Combines SponsorBlock, silence skipping, volume amplification, UI debloating, and time-saved analytics into a single ultra-efficient extension.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License MIT" />
  <img src="https://img.shields.io/badge/Platform-Chromium-red.svg" alt="Chromium" />
  <img src="https://img.shields.io/badge/Dependencies-Zero-brightgreen.svg" alt="Zero Dependencies" />
</p>

---

## ⚡ Features

### 1. 🛡️ SponsorBlock API Integration
- Fetches segment metadata from the community-driven [SponsorBlock API](https://sponsor.ajay.app/).
- Automatically skips sponsored segments, self-promotions, interaction reminders (like/subscribe), filler tangents, previews, and intros/outros.
- **Customizable Skip Categories:** Toggle specific segment types independently in the popup interface.
- **Color-Coded Seekbar Highlights:** Visual segments directly on the YouTube progress bar corresponding to each category.
- **In-Player Toast & Instant Undo:** In-player skip notification displaying seconds saved with a one-click "Unskip" button.

### 2. ⏭️ Pop-Free Silence Skipper (Jump Cutter)
- Dynamically accelerates video playback (1.15x – 2.10x) during silence, pauses, and breaths, and seamlessly returns to 1.0x when speech resumes.
- **Dual-Threshold Schmitt Trigger (Hysteresis):** Uses RMS energy calculations with high-frequency consonants & plosive protection to prevent clipped words without false room-noise triggers.
- **Zero Audio Popping & Zero Scrubber Glitches:** Pure `playbackRate` control with no audio buffer flushes or timeline seeking.
- **Dynamic Aggressiveness Slider:** A unified slider that interpolates threshold, jump speed, and debounce padding.

### 3. 🔊 Volume Master (100% – 600%)
- Amplifies audio up to 600% using a Web Audio `GainNode`.
- Instant preset buttons for `100%`, `200%`, `400%`, and `600%`.
- Clean ramp curves to prevent audio clipping and distortions.

### 4. 🧹 Pure CSS UI Debloater
- **Zero `MutationObserver` Overhead:** Relies entirely on pure CSS injection and root HTML attributes.
- Eliminates YouTube Shorts (shelves, navigation tabs, sidebar buttons).
- Optionally hides comments and related/recommended sidebar videos for a distraction-free experience.

### 5. ⏱️ Time-Saved Analytics Dashboard
- Tracks cumulative time saved across both SponsorBlock skips and silence acceleration.
- Displays **Total Time Saved** with a granular breakdown (Sponsors vs. Silence).
- Calculates the **Normalized Average Time Saved per 30 Minutes** based on actual watch history.
- Real-time live updating in the popup with persistent storage via `chrome.storage.local`.

---

## 🏗️ Architecture & Constraints

PureTube is designed from the ground up to operate cleanly inside YouTube's Single-Page Application (SPA) architecture without resource leaks or performance penalties:

1. **Single Audio Graph:**
   YouTube only allows a single `MediaElementAudioSourceNode` per `<video>` element. PureTube establishes a single serial audio pipeline:
   ```
   HTML5 <video> ──► GainNode (Volume) ──► AnalyserNode (Silence) ──► AudioContext.destination
   ```
2. **SPA Navigation Lifecycle:**
   YouTube maintains video element references across in-app page transitions. PureTube hooks `yt-navigate-finish` to refresh segment metadata and reset silence states without rebuilding the audio pipeline.
3. **Deterministic Priority:**
   SponsorBlock segment skips always take absolute precedence over the Silence Skipper. While a sponsor jump is executing, silence detection is temporarily suspended to eliminate race conditions.
4. **Zero MutationObserver:**
   DOM elements are toggled using CSS selectors tied to root attributes (`html[data-puretube-hide-shorts]`), preserving maximum battery life and frame rates.

---

## 🚀 Installation

PureTube is packaged as a standard Manifest V3 Chromium extension. It works on **Google Chrome**, **Brave**, **Microsoft Edge**, **Opera**, and **Vivaldi**.

### Load Unpacked (Developer Mode):
1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/PureTube.git
   ```
2. Open your browser's extension management page:
   - **Chrome / Brave:** `chrome://extensions` or `brave://extensions`
   - **Edge:** `edge://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `PureTube` directory.
5. Navigate to [YouTube](https://www.youtube.com) and start watching!

---

## 📁 Project Structure

```
PureTube/
├── manifest.json       # Manifest V3 extension configuration
├── content.js          # Core engine (Web Audio graph, SponsorBlock, Silence Skipper)
├── debloat.css         # Pure CSS rules for debloater, seekbar highlights & skip toast
├── popup.html          # Clean dark-mode extension popup interface
├── popup.css           # Modern CSS styles for popup controls & stats dashboard
├── popup.js            # Settings controller, storage sync & live stats poller
├── icons/              # Extension icons (16px, 48px, 128px)
├── LICENSE             # MIT License
└── README.md           # Documentation
```

---

## 🔒 Privacy & Permissions

PureTube runs 100% locally in your browser:
- **No telemetry, analytics, or tracking.**
- **Permissions:**
  - `storage`: Saves user preferences and cumulative time-saved metrics locally.
  - `activeTab`: Allows popup interface to read active player states.
  - `*://*.youtube.com/*`: Content script execution and audio graph management.
  - `https://sponsor.ajay.app/*`: Direct SponsorBlock API segment queries.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
SponsorBlock API data is provided by [SponsorBlock](https://sponsor.ajay.app/).
