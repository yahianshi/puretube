/**
 * PureTube - High-Performance YouTube Optimizer
 * Licensed under the MIT License.
 * 
 * Architecture & Constraints:
 * 1. Single Audio Graph: Video -> GainNode -> AnalyserNode -> AudioContext.destination
 * 2. SPA Navigation: AudioContext is NOT re-created on navigation; hooks 'yt-navigate-finish'.
 * 3. Pure CSS Debloater: Uses root dataset attributes; NO MutationObserver.
 * 4. Deterministic Priority: SponsorBlock skips take absolute priority over Silence Skipper.
 * 5. Seekbar Highlighting: Real-time visual overlays on the YouTube progress bar.
 * 6. Pop-Free Silence Engine: Pure playbackRate adjustments with dual-threshold hysteresis.
 */

(() => {
  'use strict';

  // --- Configuration & Default Settings ---
  const DEFAULT_SETTINGS = {
    sponsorBlockEnabled: true,
    sponsorCategories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler'],
    silenceSkipperEnabled: false,
    silenceAggressiveness: 50, // Default 50%
    silenceSpeed: 1.62,
    silenceThreshold: 0.0060,
    silencePaddingMs: 220,
    volumeBoost: 100, // 100% = 1.0x gain, up to 600% = 6.0x gain
    hideShorts: true,
    hideComments: false,
    hideRelated: false
  };

  let settings = { ...DEFAULT_SETTINGS };

  // --- Single Audio Graph State ---
  let audioCtx = null;
  let sourceNode = null;
  let gainNode = null;
  let analyserNode = null;
  let audioBuffer = null;
  let currentVideo = null;

  // --- Playback State ---
  let basePlaybackRate = 1.0;
  let isSponsorSkipping = false;

  // --- SponsorBlock State ---
  let currentVideoId = null;
  let activeSegments = [];
  const segmentCache = new Map();
  const ignoredSegments = new Set();
  let lastSkippedSegment = null;

  // --- UI Elements Reference ---
  let activeToastElement = null;
  let toastTimeoutId = null;
  let seekbarOverlay = null;

  // =========================================================================
  // 1. Time Saved Statistics Tracker (Persistent in chrome.storage.local)
  // =========================================================================

  const StatsManager = {
    unsaved: {
      sponsorTimeSaved: 0,
      silenceTimeSaved: 0,
      totalVideoTime: 0
    },
    cachedStats: {
      totalTimeSaved: 0,
      sponsorTimeSaved: 0,
      silenceTimeSaved: 0,
      totalVideoTime: 0
    },
    lastFlushTime: performance.now(),

    init() {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['puretube_stats'], (res) => {
          if (res && res.puretube_stats) {
            this.cachedStats = {
              totalTimeSaved: res.puretube_stats.totalTimeSaved || 0,
              sponsorTimeSaved: res.puretube_stats.sponsorTimeSaved || 0,
              silenceTimeSaved: res.puretube_stats.silenceTimeSaved || 0,
              totalVideoTime: res.puretube_stats.totalVideoTime || 0
            };
          }
        });
      }

      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flush();
        }
      });
      window.addEventListener('pagehide', () => this.flush());
      window.addEventListener('beforeunload', () => this.flush());
    },

    addSilenceTime(savedSeconds, videoSeconds) {
      if (savedSeconds > 0) this.unsaved.silenceTimeSaved += savedSeconds;
      if (videoSeconds > 0) this.unsaved.totalVideoTime += videoSeconds;
      this.checkAutoFlush();
    },

    addNormalWatchTime(videoSeconds) {
      if (videoSeconds > 0) this.unsaved.totalVideoTime += videoSeconds;
      this.checkAutoFlush();
    },

    addSponsorSkip(savedSeconds) {
      if (savedSeconds > 0) {
        this.unsaved.sponsorTimeSaved += savedSeconds;
        this.unsaved.totalVideoTime += savedSeconds;
        this.flush();
      }
    },

    undoSponsorSkip(savedSeconds) {
      if (savedSeconds > 0) {
        this.unsaved.sponsorTimeSaved -= savedSeconds;
        this.unsaved.totalVideoTime -= savedSeconds;
        this.flush();
      }
    },

    checkAutoFlush() {
      const now = performance.now();
      if (now - this.lastFlushTime > 2500) {
        this.flush();
      }
    },

    flush() {
      this.lastFlushTime = performance.now();
      const sSponsor = this.unsaved.sponsorTimeSaved;
      const sSilence = this.unsaved.silenceTimeSaved;
      const sVideo = this.unsaved.totalVideoTime;

      if (Math.abs(sSponsor) < 0.001 && Math.abs(sSilence) < 0.001 && Math.abs(sVideo) < 0.001) {
        return;
      }

      this.unsaved.sponsorTimeSaved = 0;
      this.unsaved.silenceTimeSaved = 0;
      this.unsaved.totalVideoTime = 0;

      this.cachedStats.sponsorTimeSaved = Math.max(0, (this.cachedStats.sponsorTimeSaved || 0) + sSponsor);
      this.cachedStats.silenceTimeSaved = Math.max(0, (this.cachedStats.silenceTimeSaved || 0) + sSilence);
      this.cachedStats.totalTimeSaved = this.cachedStats.sponsorTimeSaved + this.cachedStats.silenceTimeSaved;
      this.cachedStats.totalVideoTime = Math.max(0, (this.cachedStats.totalVideoTime || 0) + sVideo);

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ puretube_stats: this.cachedStats }).catch(() => {});
      }
    },

    getCombinedStats() {
      const sponsor = Math.max(0, (this.cachedStats.sponsorTimeSaved || 0) + this.unsaved.sponsorTimeSaved);
      const silence = Math.max(0, (this.cachedStats.silenceTimeSaved || 0) + this.unsaved.silenceTimeSaved);
      const totalSaved = sponsor + silence;
      const totalVideo = Math.max(0, (this.cachedStats.totalVideoTime || 0) + this.unsaved.totalVideoTime);

      return {
        totalTimeSaved: totalSaved,
        sponsorTimeSaved: sponsor,
        silenceTimeSaved: silence,
        totalVideoTime: totalVideo
      };
    },

    reset() {
      this.unsaved = { sponsorTimeSaved: 0, silenceTimeSaved: 0, totalVideoTime: 0 };
      this.cachedStats = { totalTimeSaved: 0, sponsorTimeSaved: 0, silenceTimeSaved: 0, totalVideoTime: 0 };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ puretube_stats: this.cachedStats }).catch(() => {});
      }
    }
  };

  StatsManager.init();

  // =========================================================================
  // 2. Pop-Free SilenceEngine (Zero Seek, Dual-Threshold Hysteresis)
  // =========================================================================

  class SilenceEngine {
    constructor() {
      this.enabled = false;
      this.intensity = 0.5;
      this.threshold = 0.0060;
      this.speed = 1.62;
      this.paddingMs = 220;

      this.isSpeeding = false;
      this.lastSoundTime = performance.now();
      this.lastSpeedDownTime = 0;
    }

    updateParameters({ intensity, threshold, speed, paddingMs }) {
      if (intensity !== undefined) this.intensity = intensity;
      if (threshold !== undefined) this.threshold = threshold;
      if (speed !== undefined) {
        this.speed = speed;
        if (this.isSpeeding && currentVideo) {
          this.applyPlaybackRate(this.speed);
        }
      }
      if (paddingMs !== undefined) this.paddingMs = paddingMs;
    }

    setEnabled(val) {
      this.enabled = Boolean(val);
      if (!this.enabled && this.isSpeeding) {
        this.reset();
      }
    }

    reset() {
      this.lastSoundTime = performance.now();
      this.lastSpeedDownTime = 0;
      if (this.isSpeeding) {
        this.isSpeeding = false;
        if (currentVideo) {
          this.applyPlaybackRate(basePlaybackRate || 1.0);
        }
      }
    }

    applyPlaybackRate(targetRate) {
      if (!currentVideo) return;
      if (Math.abs(currentVideo.playbackRate - targetRate) > 0.02) {
        currentVideo.playbackRate = targetRate;
      }
    }

    analyzeAudioWindow(analyser, buffer) {
      if (!analyser || !buffer) return { rawRMS: 0, peak: 0 };
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      let peak = 0;
      const len = buffer.length;
      for (let i = 0; i < len; i++) {
        const val = buffer[i];
        const abs = val < 0 ? -val : val;
        if (abs > peak) peak = abs;
        sum += val * val;
      }
      return { rawRMS: Math.sqrt(sum / len), peak };
    }

    tick(currentTimeStamp) {
      if (
        !this.enabled ||
        isSponsorSkipping ||
        !currentVideo ||
        currentVideo.paused ||
        currentVideo.ended ||
        currentVideo.seeking ||
        currentVideo.muted ||
        currentVideo.readyState < 2 ||
        !analyserNode ||
        !audioBuffer
      ) {
        if (this.isSpeeding) {
          this.reset();
        } else {
          this.lastSoundTime = performance.now();
        }
        return;
      }

      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const now = currentTimeStamp || performance.now();
      const { rawRMS, peak } = this.analyzeAudioWindow(analyserNode, audioBuffer);

      // Dual-threshold Schmitt trigger:
      // When at 1.0x, use pure RMS energy so room noise/hiss peaks do not block silence detection.
      // When speeding, wake threshold + plosive peak catches pre-vocal breath and consonants early.
      const wakeThreshold = this.threshold * 0.75;
      const hasSound = this.isSpeeding
        ? (rawRMS >= wakeThreshold || peak >= this.threshold * 2.2)
        : (rawRMS >= this.threshold);

      if (hasSound) {
        this.lastSoundTime = now;

        if (this.isSpeeding) {
          this.isSpeeding = false;
          this.lastSpeedDownTime = now;
          this.applyPlaybackRate(basePlaybackRate || 1.0);
        }
      } else {
        const silenceDuration = now - this.lastSoundTime;
        const timeSinceSpeedDown = now - this.lastSpeedDownTime;

        // Trailing padding & speech hold window
        if (silenceDuration >= this.paddingMs && timeSinceSpeedDown >= 220) {
          if (!this.isSpeeding) {
            this.isSpeeding = true;
            this.applyPlaybackRate(this.speed);
          }
        }
      }
    }
  }

  const silenceEngine = new SilenceEngine();

  // =========================================================================
  // 2. Storage & Debloat Attribute Initialization
  // =========================================================================

  function applyDebloatAttributes() {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.puretubeHideShorts = settings.hideShorts ? 'true' : 'false';
    root.dataset.puretubeHideComments = settings.hideComments ? 'true' : 'false';
    root.dataset.puretubeHideRelated = settings.hideRelated ? 'true' : 'false';
  }

  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
        if (chrome.runtime.lastError) {
          console.warn('[PureTube] Failed to load settings from sync storage:', chrome.runtime.lastError);
          return;
        }
        settings = { ...DEFAULT_SETTINGS, ...stored };
        applyDebloatAttributes();
        applyVolumeGain();

        silenceEngine.setEnabled(settings.silenceSkipperEnabled);
        silenceEngine.updateParameters({
          threshold: settings.silenceThreshold,
          speed: settings.silenceSpeed,
          paddingMs: settings.silencePaddingMs
        });

        renderSeekbarSegments();
      });
    } else {
      applyDebloatAttributes();
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync' && namespace !== 'local') return;

      for (const [key, { newValue }] of Object.entries(changes)) {
        if (key in settings) {
          settings[key] = newValue;
        }
      }

      applyDebloatAttributes();
      applyVolumeGain();

      if ('silenceSkipperEnabled' in changes) {
        silenceEngine.setEnabled(changes.silenceSkipperEnabled.newValue);
      }
      if ('silenceThreshold' in changes || 'silenceSpeed' in changes || 'silencePaddingMs' in changes) {
        silenceEngine.updateParameters({
          threshold: settings.silenceThreshold,
          speed: settings.silenceSpeed,
          paddingMs: settings.silencePaddingMs
        });
      }
      if ('sponsorBlockEnabled' in changes) {
        renderSeekbarSegments();
      }
      if ('sponsorCategories' in changes) {
        settings.sponsorCategories = changes.sponsorCategories.newValue;
        renderSeekbarSegments();
      }
    });
  }

  applyDebloatAttributes();
  loadSettings();

  // =========================================================================
  // 3. Single Audio Graph Pipeline
  // =========================================================================

  function findVideoElement() {
    return document.querySelector('video.html5-main-video') ||
           document.querySelector('#movie_player video') ||
           document.querySelector('video');
  }

  function applyVolumeGain() {
    if (!gainNode || !audioCtx) return;
    try {
      const multiplier = Math.max(0, (settings.volumeBoost || 100) / 100);
      gainNode.gain.setTargetAtTime(multiplier, audioCtx.currentTime, 0.015);
    } catch (e) {
      console.warn('[PureTube] Error updating volume gain:', e);
    }
  }

  function setupAudioGraph(video) {
    if (!video) return false;

    if (video.__puretube_connected) {
      currentVideo = video;
      return true;
    }

    try {
      if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
      }

      sourceNode = audioCtx.createMediaElementSource(video);
      gainNode = audioCtx.createGain();
      analyserNode = audioCtx.createAnalyser();

      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.1;
      audioBuffer = new Float32Array(analyserNode.fftSize);

      sourceNode.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);

      video.__puretube_connected = true;
      currentVideo = video;
      basePlaybackRate = video.playbackRate || 1.0;

      video.addEventListener('ratechange', () => {
        if (!silenceEngine.isSpeeding && currentVideo) {
          basePlaybackRate = currentVideo.playbackRate;
        }
      }, { passive: true });

      video.addEventListener('durationchange', renderSeekbarSegments, { passive: true });
      video.addEventListener('loadedmetadata', renderSeekbarSegments, { passive: true });

      const resumeAudio = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      };

      video.addEventListener('play', resumeAudio, { passive: true });
      video.addEventListener('playing', resumeAudio, { passive: true });
      window.addEventListener('click', resumeAudio, { passive: true, once: true });
      window.addEventListener('keydown', resumeAudio, { passive: true, once: true });

      if (!video.paused) {
        resumeAudio();
      }

      applyVolumeGain();
      renderSeekbarSegments();
      console.log('[PureTube] Audio graph initialized successfully');
      return true;
    } catch (err) {
      console.error('[PureTube] Failed to initialize AudioGraph:', err);
      return false;
    }
  }

  function ensureVideoConnected() {
    const video = findVideoElement();
    if (video) {
      currentVideo = video;
      if (!video.__puretube_connected) {
        setupAudioGraph(video);
      }
    }
  }

  // =========================================================================
  // 4. SPA Navigation & SponsorBlock API Integration
  // =========================================================================

  function extractVideoId(urlString) {
    try {
      const url = new URL(urlString, window.location.origin);
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }
    } catch (e) {}
    return null;
  }

  const ALL_SPONSOR_CATEGORIES = [
    'sponsor',
    'intro',
    'outro',
    'selfpromo',
    'interaction',
    'preview',
    'filler',
    'music_offtopic'
  ];

  async function fetchSponsorSegments(videoId) {
    if (!videoId) return;

    if (segmentCache.has(videoId)) {
      activeSegments = segmentCache.get(videoId);
      renderSeekbarSegments();
      return;
    }

    try {
      const categoriesParam = encodeURIComponent(JSON.stringify(ALL_SPONSOR_CATEGORIES));
      const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}&categories=${categoriesParam}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (response.status === 200) {
        const segments = await response.json();
        if (Array.isArray(segments)) {
          const parsed = segments
            .filter(item => Array.isArray(item.segment) && item.segment.length === 2)
            .sort((a, b) => a.segment[0] - b.segment[0]);

          segmentCache.set(videoId, parsed);
          if (currentVideoId === videoId) {
            activeSegments = parsed;
            renderSeekbarSegments();
          }
        }
      } else if (response.status === 404) {
        segmentCache.set(videoId, []);
        if (currentVideoId === videoId) {
          activeSegments = [];
          renderSeekbarSegments();
        }
      }
    } catch (err) {
      console.warn('[PureTube] SponsorBlock fetch error:', err);
    }
  }

  function handleNavigation() {
    const newVideoId = extractVideoId(window.location.href);

    if (newVideoId !== currentVideoId) {
      currentVideoId = newVideoId;
      activeSegments = [];
      ignoredSegments.clear();
      isSponsorSkipping = false;

      silenceEngine.reset();
      renderSeekbarSegments();

      if (currentVideoId) {
        fetchSponsorSegments(currentVideoId);
      }
    }

    ensureVideoConnected();

    let attempts = 0;
    const retryInterval = setInterval(() => {
      attempts++;
      ensureVideoConnected();
      renderSeekbarSegments();
      if ((currentVideo && currentVideo.__puretube_connected) || attempts > 10) {
        clearInterval(retryInterval);
      }
    }, 200);
  }

  window.addEventListener('yt-navigate-finish', handleNavigation, { passive: true });
  window.addEventListener('popstate', handleNavigation, { passive: true });

  // =========================================================================
  // 5. Seekbar Highlighting Overlay & Category Filtering
  // =========================================================================

  function isCategoryEnabled(category) {
    if (!category || !Array.isArray(settings.sponsorCategories)) return false;
    const catLower = category.toLowerCase().trim();
    return settings.sponsorCategories.some(c => c.toLowerCase().trim() === catLower);
  }

  function renderSeekbarSegments() {
    const progressBar = document.querySelector('.ytp-progress-bar') ||
                        document.querySelector('.ytp-progress-list');

    if (!settings.sponsorBlockEnabled || !activeSegments.length || !currentVideo) {
      if (seekbarOverlay) seekbarOverlay.innerHTML = '';
      return;
    }

    if (!progressBar) return;

    const duration = currentVideo.duration;
    if (!duration || isNaN(duration) || duration <= 0) {
      return;
    }

    if (!seekbarOverlay || !progressBar.contains(seekbarOverlay)) {
      if (seekbarOverlay && seekbarOverlay.parentElement) {
        seekbarOverlay.remove();
      }
      seekbarOverlay = document.createElement('div');
      seekbarOverlay.className = 'puretube-seekbar-overlay';
      progressBar.appendChild(seekbarOverlay);
    }

    seekbarOverlay.innerHTML = '';

    for (const item of activeSegments) {
      if (!item.segment || item.segment.length !== 2) continue;

      // Filter: only highlight categories actively enabled by the user
      if (!isCategoryEnabled(item.category)) {
        continue;
      }

      const [start, end] = item.segment;
      const startPct = Math.max(0, Math.min(100, (start / duration) * 100));
      const endPct = Math.max(0, Math.min(100, (end / duration) * 100));
      const widthPct = Math.max(0.2, endPct - startPct);

      const seg = document.createElement('div');
      const cat = item.category || 'sponsor';
      seg.className = `puretube-seekbar-segment puretube-cat-${cat}`;
      seg.style.left = `${startPct}%`;
      seg.style.width = `${widthPct}%`;

      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      seg.title = `PureTube: ${label} (${formatTime(start)} → ${formatTime(end)})`;

      seekbarOverlay.appendChild(seg);
    }
  }

  // =========================================================================
  // 6. Skip Notification UI Popup
  // =========================================================================

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function showSkipToast(item, start, end, savedSec) {
    try {
      const playerContainer = document.querySelector('#movie_player') ||
                              document.querySelector('.html5-video-player') ||
                              (currentVideo && currentVideo.parentElement);
      if (!playerContainer) return;

      if (!activeToastElement || !playerContainer.contains(activeToastElement)) {
        if (activeToastElement && activeToastElement.parentElement) {
          activeToastElement.remove();
        }
        activeToastElement = document.createElement('div');
        activeToastElement.className = 'puretube-toast-container';
        playerContainer.appendChild(activeToastElement);
      }

      if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
      }

      const cat = item.category || 'sponsor';
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      const displaySec = savedSec || Math.max(1, Math.round(end - start));

      activeToastElement.innerHTML = `
        <span class="puretube-toast-badge puretube-badge-${cat}">${label}</span>
        <span class="puretube-toast-text">
          <span>Skipped to ${formatTime(end)}</span>
          <span class="puretube-toast-saved">(-${displaySec}s)</span>
        </span>
        <button class="puretube-toast-unskip" id="puretube-unskip-btn" title="Undo this skip">Unskip</button>
      `;

      const unskipBtn = activeToastElement.querySelector('#puretube-unskip-btn');
      if (unskipBtn) {
        unskipBtn.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (currentVideo) {
            ignoredSegments.add(item.UUID);
            if (displaySec) {
              StatsManager.undoSponsorSkip(displaySec);
            }
            currentVideo.currentTime = start;
            if (activeToastElement) {
              activeToastElement.classList.remove('puretube-toast-show');
            }
          }
        };
      }

      requestAnimationFrame(() => {
        if (activeToastElement) {
          activeToastElement.classList.add('puretube-toast-show');
        }
      });

      toastTimeoutId = setTimeout(() => {
        if (activeToastElement) {
          activeToastElement.classList.remove('puretube-toast-show');
        }
      }, 4500);
    } catch (e) {
      console.warn('[PureTube] Error displaying skip popup:', e);
    }
  }

  // =========================================================================
  // 7. SponsorBlock Priority Handling
  // =========================================================================

  function checkAndExecuteSponsorSkip(currentTime) {
    if (!settings.sponsorBlockEnabled || !activeSegments.length || isSponsorSkipping) {
      return false;
    }

    for (const item of activeSegments) {
      if (ignoredSegments.has(item.UUID)) continue;

      // Only skip categories actively enabled by the user
      if (!isCategoryEnabled(item.category)) {
        continue;
      }

      const [start, end] = item.segment;

      if (currentTime >= start && currentTime < end - 0.05) {
        isSponsorSkipping = true;
        lastSkippedSegment = item;

        if (silenceEngine.isSpeeding) {
          silenceEngine.reset();
        }

        const savedSec = Math.max(1, Math.round(end - currentTime));
        item.__savedSec = savedSec;
        StatsManager.addSponsorSkip(savedSec);

        currentVideo.currentTime = end;
        showSkipToast(item, start, end, savedSec);

        setTimeout(() => {
          isSponsorSkipping = false;
        }, 350);

        return true;
      }
    }

    return false;
  }

  // =========================================================================
  // 8. Detection Loops (requestAnimationFrame & Interval)
  // =========================================================================

  let lastRafTime = performance.now();
  let lastStatsTime = performance.now();

  function onFrame() {
    const now = performance.now();
    lastRafTime = now;

    if (currentVideo && !currentVideo.paused && !currentVideo.ended) {
      const currentTime = currentVideo.currentTime;
      const didSkipSponsor = checkAndExecuteSponsorSkip(currentTime);

      if (!didSkipSponsor && !isSponsorSkipping) {
        silenceEngine.tick(now);
      }

      // Track playback duration for time-saved statistics
      const deltaStats = Math.min(0.25, Math.max(0, (now - lastStatsTime) / 1000));
      lastStatsTime = now;

      if (!didSkipSponsor && !isSponsorSkipping && deltaStats > 0) {
        if (silenceEngine.isSpeeding) {
          const speed = currentVideo.playbackRate || silenceEngine.speed || 1.62;
          const videoSec = deltaStats * speed;
          const savedSec = deltaStats * Math.max(0, speed - 1);
          StatsManager.addSilenceTime(savedSec, videoSec);
        } else {
          const rate = currentVideo.playbackRate || 1.0;
          const videoSec = deltaStats * rate;
          StatsManager.addNormalWatchTime(videoSec);
        }
      }
    } else {
      lastStatsTime = now;
    }

    requestAnimationFrame(onFrame);
  }

  requestAnimationFrame(onFrame);

  setInterval(() => {
    if (!currentVideo || !currentVideo.isConnected) {
      ensureVideoConnected();
    }

    // Ensure seekbar segments remain mounted across player layout shifts
    if (activeSegments.length && (!seekbarOverlay || !document.contains(seekbarOverlay))) {
      renderSeekbarSegments();
    }

    const now = performance.now();
    if (now - lastRafTime > 45 && currentVideo && !currentVideo.paused && !currentVideo.ended) {
      const currentTime = currentVideo.currentTime;
      const didSkipSponsor = checkAndExecuteSponsorSkip(currentTime);
      if (!didSkipSponsor && !isSponsorSkipping) {
        silenceEngine.tick(now);
      }

      const deltaStats = Math.min(0.25, Math.max(0, (now - lastStatsTime) / 1000));
      lastStatsTime = now;

      if (!didSkipSponsor && !isSponsorSkipping && deltaStats > 0) {
        if (silenceEngine.isSpeeding) {
          const speed = currentVideo.playbackRate || silenceEngine.speed || 1.62;
          const videoSec = deltaStats * speed;
          const savedSec = deltaStats * Math.max(0, speed - 1);
          StatsManager.addSilenceTime(savedSec, videoSec);
        } else {
          const rate = currentVideo.playbackRate || 1.0;
          const videoSec = deltaStats * rate;
          StatsManager.addNormalWatchTime(videoSec);
        }
      }
    }
  }, 35);

  // =========================================================================
  // 9. Runtime Messaging
  // =========================================================================

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'UPDATE_SILENCE_SETTINGS') {
        silenceEngine.updateParameters({
          intensity: request.intensity,
          threshold: request.threshold,
          speed: request.speed,
          paddingMs: request.paddingMs
        });
        sendResponse({ success: true });
      } else if (request.action === 'TOGGLE_SILENCE_SKIPPER') {
        silenceEngine.setEnabled(request.enabled);
        sendResponse({ success: true });
      } else if (request.action === 'UPDATE_SPONSOR_CATEGORIES') {
        settings.sponsorCategories = Array.isArray(request.categories) ? request.categories : [];
        renderSeekbarSegments();
        sendResponse({ success: true });
      } else if (request.action === 'GET_STATUS') {
        sendResponse({
          currentVideoId,
          activeSegmentsCount: activeSegments.length,
          isSilenceSpeeding: silenceEngine.isSpeeding,
          isSponsorSkipping,
          basePlaybackRate,
          silenceSpeed: silenceEngine.speed,
          silenceThreshold: silenceEngine.threshold,
          silencePaddingMs: silenceEngine.paddingMs,
          connected: Boolean(currentVideo && currentVideo.__puretube_connected)
        });
      } else if (request.action === 'GET_STATS') {
        sendResponse({
          success: true,
          stats: StatsManager.getCombinedStats()
        });
      } else if (request.action === 'RESET_STATS') {
        StatsManager.reset();
        sendResponse({ success: true });
      } else if (request.action === 'UNDO_LAST_SKIP') {
        if (lastSkippedSegment && currentVideo) {
          ignoredSegments.add(lastSkippedSegment.UUID);
          const savedSec = lastSkippedSegment.__savedSec || Math.max(0, lastSkippedSegment.segment[1] - lastSkippedSegment.segment[0]);
          StatsManager.undoSponsorSkip(savedSec);
          currentVideo.currentTime = lastSkippedSegment.segment[0];
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false });
        }
      }
      return true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleNavigation, { once: true });
  } else {
    handleNavigation();
  }

})();
