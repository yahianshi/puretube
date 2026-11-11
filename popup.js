/**
 * PureTube - Popup Interface Controller
 * Licensed under the MIT License.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Volume Controls
  const volumeSlider = document.getElementById('volume-slider');
  const volumeLabel = document.getElementById('volume-label');
  const presetButtons = document.querySelectorAll('.btn-preset');

  // Silence Skipper Controls
  const silenceToggle = document.getElementById('silence-toggle');
  const silenceSliderContainer = document.getElementById('silence-slider-container');
  const silenceSlider = document.getElementById('silence-slider');
  const silenceValBadge = document.getElementById('silence-val-badge');

  // SponsorBlock Controls & Advanced Category Panel
  const sponsorToggle = document.getElementById('sponsor-toggle');
  const sponsorSub = document.getElementById('sponsor-sub');
  const sponsorAdvancedBtn = document.getElementById('sponsor-advanced-btn');
  const sponsorCategoriesPanel = document.getElementById('sponsor-categories-panel');
  const catCheckboxes = document.querySelectorAll('.cat-checkbox');

  // Debloater Feature Toggles
  const shortsToggle = document.getElementById('shorts-toggle');
  const commentsToggle = document.getElementById('comments-toggle');
  const relatedToggle = document.getElementById('related-toggle');

  // Status Indicators
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  // Statistics Controls
  const statTotalSaved = document.getElementById('stat-total-saved');
  const statBreakdown = document.getElementById('stat-breakdown');
  const statAvg30m = document.getElementById('stat-avg-30m');
  const statAvgSub = document.getElementById('stat-avg-sub');
  const statsResetBtn = document.getElementById('stats-reset-btn');

  const DEFAULT_SETTINGS = {
    sponsorBlockEnabled: true,
    sponsorCategories: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler'],
    silenceSkipperEnabled: false,
    silenceAggressiveness: 50,
    silenceSpeed: 1.62,
    silenceThreshold: 0.0060,
    silencePaddingMs: 220,
    volumeBoost: 100,
    hideShorts: true,
    hideComments: false,
    hideRelated: false
  };

  /**
   * Refined relaxed linear interpolation:
   * - 0%: Speed 1.15x, Padding 320ms, Threshold 0.0020 RMS
   * - 50%: Speed 1.62x, Padding 220ms, Threshold 0.0060 RMS
   * - 100%: Speed 2.10x, Padding 120ms, Threshold 0.0100 RMS
   */
  function calculateSilenceParams(sliderValue) {
    const val = Math.min(100, Math.max(0, parseInt(sliderValue, 10) || 0));
    const intensity = val / 100.0;

    const threshold = 0.002 + 0.00008 * val;
    const speed = parseFloat((1.15 + 0.0095 * val).toFixed(2));
    const paddingMs = Math.round(320 - 2.0 * val);

    return { val, intensity, threshold, speed, paddingMs };
  }

  function updateSilenceUI(params) {
    const { val } = params;
    silenceSlider.value = val;
    silenceValBadge.textContent = `${val}%`;
  }

  function setSilenceSliderVisibility(visible) {
    if (silenceSliderContainer) {
      silenceSliderContainer.classList.toggle('visible', Boolean(visible));
    }
  }

  function sendSilenceUpdateToTab(params) {
    if (!chrome.tabs || !chrome.tabs.query) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'UPDATE_SILENCE_SETTINGS',
          sliderValue: params.val,
          intensity: params.intensity,
          threshold: params.threshold,
          speed: params.speed,
          paddingMs: params.paddingMs
        }).catch(() => {});
      }
    });
  }

  function updatePresetButtons(val) {
    presetButtons.forEach(btn => {
      const btnVal = parseInt(btn.dataset.volume, 10);
      if (btnVal === val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function setVolume(value) {
    const val = parseInt(value, 10);
    volumeSlider.value = val;
    volumeLabel.textContent = `${val}%`;
    updatePresetButtons(val);

    chrome.storage.sync.set({ volumeBoost: val });
  }

  // Load saved settings
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    // Volume
    const vol = settings.volumeBoost || 100;
    volumeSlider.value = vol;
    volumeLabel.textContent = `${vol}%`;
    updatePresetButtons(vol);

    // Silence Skipper toggle & slider visibility
    const silenceEnabled = Boolean(settings.silenceSkipperEnabled);
    silenceToggle.checked = silenceEnabled;
    setSilenceSliderVisibility(silenceEnabled);

    const sliderVal = settings.silenceAggressiveness !== undefined ? settings.silenceAggressiveness : 50;
    const params = calculateSilenceParams(sliderVal);
    updateSilenceUI(params);

    // SponsorBlock Main Toggle
    sponsorToggle.checked = Boolean(settings.sponsorBlockEnabled);

    // Populate SponsorBlock Category Checkboxes
    const currentCats = Array.isArray(settings.sponsorCategories) ? settings.sponsorCategories : DEFAULT_SETTINGS.sponsorCategories;
    catCheckboxes.forEach(cb => {
      const primaryCat = cb.dataset.cat;
      const extraCat = cb.dataset.catExtra;
      // Checked only if the primary category (and extra category if present) is included
      if (extraCat) {
        cb.checked = currentCats.includes(primaryCat) && currentCats.includes(extraCat);
      } else {
        cb.checked = currentCats.includes(primaryCat);
      }
    });

    // Debloater Toggles
    shortsToggle.checked = Boolean(settings.hideShorts);
    commentsToggle.checked = Boolean(settings.hideComments);
    relatedToggle.checked = Boolean(settings.hideRelated);
  });

  // Silence Slider Events
  silenceSlider.addEventListener('input', (e) => {
    const params = calculateSilenceParams(e.target.value);
    updateSilenceUI(params);
    sendSilenceUpdateToTab(params);
  });

  silenceSlider.addEventListener('change', (e) => {
    const params = calculateSilenceParams(e.target.value);
    chrome.storage.sync.set({
      silenceAggressiveness: params.val,
      silenceThreshold: params.threshold,
      silenceSpeed: params.speed,
      silencePaddingMs: params.paddingMs
    });
    sendSilenceUpdateToTab(params);
  });

  // Silence Skipper Toggle
  silenceToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    setSilenceSliderVisibility(enabled);
    chrome.storage.sync.set({ silenceSkipperEnabled: enabled });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'TOGGLE_SILENCE_SKIPPER',
          enabled
        }).catch(() => {});
      }
    });
  });

  // Volume Slider Events
  volumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    volumeLabel.textContent = `${val}%`;
    updatePresetButtons(val);
  });

  volumeSlider.addEventListener('change', (e) => {
    setVolume(e.target.value);
  });

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setVolume(btn.dataset.volume);
    });
  });

  // SponsorBlock Main Toggle
  sponsorToggle.addEventListener('change', (e) => {
    chrome.storage.sync.set({ sponsorBlockEnabled: e.target.checked });
  });

  // SponsorBlock Advanced Categories Accordion
  if (sponsorAdvancedBtn && sponsorCategoriesPanel) {
    sponsorAdvancedBtn.addEventListener('click', () => {
      sponsorAdvancedBtn.classList.toggle('open');
      sponsorCategoriesPanel.classList.toggle('open');
    });
  }

  // SponsorBlock Category Checkbox Events
  catCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const selectedCategories = [];
      catCheckboxes.forEach(c => {
        if (c.checked) {
          selectedCategories.push(c.dataset.cat);
          if (c.dataset.catExtra) {
            selectedCategories.push(c.dataset.catExtra);
          }
        }
      });

      chrome.storage.sync.set({ sponsorCategories: selectedCategories });

      // Notify active YouTube tab to immediately refresh segments and seekbar
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'UPDATE_SPONSOR_CATEGORIES',
            categories: selectedCategories
          }).catch(() => {});
        }
      });
    });
  });

  // Debloater Toggles
  shortsToggle.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hideShorts: e.target.checked });
  });

  commentsToggle.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hideComments: e.target.checked });
  });

  relatedToggle.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hideRelated: e.target.checked });
  });

  // Active Tab Status Query
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      const activeTab = tabs[0];
      const isYouTube = !activeTab.url || activeTab.url.includes('youtube.com');

      if (!isYouTube) {
        statusText.textContent = 'Not YouTube';
        statusDot.classList.remove('active');
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { action: 'GET_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          statusText.textContent = 'Ready (Idle)';
          statusDot.classList.add('active');
          return;
        }

        if (res.connected) {
          statusText.textContent = 'Active';
          statusDot.classList.add('active');
          if (res.activeSegmentsCount > 0 && sponsorSub) {
            sponsorSub.textContent = `${res.activeSegmentsCount} skip segment(s) loaded`;
          }
        } else {
          statusText.textContent = 'Standby';
          statusDot.classList.add('active');
        }
      });
    });
  }

  // =========================================================================
  // Time Saved Statistics Controller
  // =========================================================================

  function formatDuration(totalSeconds) {
    const sec = Math.max(0, totalSeconds || 0);
    if (sec <= 0.05) return '0s';

    // Under 10s: show 1 decimal place so real-time skips are immediately noticeable
    if (sec < 10) {
      return `${sec.toFixed(1)}s`;
    }

    const rounded = Math.round(sec);
    const d = Math.floor(rounded / 86400);
    const h = Math.floor((rounded % 86400) / 3600);
    const m = Math.floor((rounded % 3600) / 60);
    const s = rounded % 60;

    if (d > 0) {
      return `${d}d ${h}h`;
    }
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    if (m > 0) {
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return `${s}s`;
  }

  function renderStats(stats) {
    if (!stats) return;
    const totalSaved = Math.max(0, stats.totalTimeSaved || 0);
    const sponsorSaved = Math.max(0, stats.sponsorTimeSaved || 0);
    const silenceSaved = Math.max(0, stats.silenceTimeSaved || 0);
    const totalVideo = Math.max(0, stats.totalVideoTime || 0);

    if (statTotalSaved) {
      statTotalSaved.textContent = formatDuration(totalSaved);
    }
    if (statBreakdown) {
      statBreakdown.textContent = `${formatDuration(sponsorSaved)} sp • ${formatDuration(silenceSaved)} sil`;
      statBreakdown.title = `${formatDuration(sponsorSaved)} from SponsorBlock • ${formatDuration(silenceSaved)} from Silence Skipper`;
    }

    if (statAvg30m && statAvgSub) {
      if (totalVideo >= 2) {
        const rate = totalVideo > 0 ? Math.min(1.0, totalSaved / totalVideo) : 0;
        const avg30m = rate * 1800; // 1800 seconds in 30 minutes
        statAvg30m.textContent = formatDuration(avg30m);
        const pct = (rate * 100).toFixed(1);
        statAvgSub.textContent = `~${pct}% trimmed (${formatDuration(totalVideo)} watched)`;
      } else {
        statAvg30m.textContent = '0s';
        statAvgSub.textContent = 'waiting for playback...';
      }
    }
  }

  function loadAndDisplayStats() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['puretube_stats'], (res) => {
        if (res && res.puretube_stats) {
          renderStats(res.puretube_stats);
        }
      });
    }

    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_STATS' }, (res) => {
            if (chrome.runtime.lastError || !res || !res.stats) return;
            renderStats(res.stats);
          });
        }
      });
    }
  }

  if (statsResetBtn) {
    statsResetBtn.addEventListener('click', () => {
      const emptyStats = {
        totalTimeSaved: 0,
        sponsorTimeSaved: 0,
        silenceTimeSaved: 0,
        totalVideoTime: 0
      };
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ puretube_stats: emptyStats });
      }
      renderStats(emptyStats);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'RESET_STATS' }).catch(() => {});
        }
      });
    });
  }

  // Initial load + periodic real-time tick while popup is open
  loadAndDisplayStats();
  setInterval(loadAndDisplayStats, 1000);
});
