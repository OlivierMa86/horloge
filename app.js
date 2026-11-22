/**
 * HORLOGE IPAD BASSE CONSOMMATION (iPad 8 & modèles suivants)
 * - Rafraîchissement adaptatif : 1 Hz normal, ou 1/60 Hz (1 fois par minute) en mode Ultra-Éco
 * - Anti-veille : Screen Wake Lock API + fallback audio inaudible pour anciens iPadOS
 * - Anti-brûlure d'écran (Pixel Shifting) toutes les minutes
 * - 6 styles d'horloges : Digitale, Flip Rétro, Gare Suisse, En Lettres, LED/Nixie, Anneaux
 */

(function () {
  'use strict';

  // --- État et préférences sauvegardées ---
  const STORAGE_KEY = 'horloge_ipad_prefs_v1';
  const defaultState = {
    style: 'digital',      // digital | flip | analog | words | segment | rings
    theme: 'theme-white',  // theme-white | theme-red | theme-amber | theme-green | theme-cyan | theme-sepia
    brightness: 85,        // 5 à 100 (%)
    scale: 100,            // 60 à 125 (%)
    ecoMode: false,        // true = rafraîchissement 1 fois/minute + secondes masquées
    autoNight: true,       // true = 22h-07h bascule auto en rouge 15%
    showDate: true,
    use24h: true
  };

  let state = loadState();
  let tickTimer = null;
  let wakeLockSentinel = null;
  let noSleepAudioCtx = null;
  let hidePanelTimeout = null;

  // --- Références DOM ---
  const dom = {
    body: document.body,
    dimmer: document.getElementById('dimmer-overlay'),
    stage: document.getElementById('clock-stage'),
    topInfo: document.getElementById('top-info'),
    dateDisplay: document.getElementById('date-display'),
    ecoBadge: document.getElementById('eco-badge'),
    wakeLockBadge: document.getElementById('wakelock-badge'),
    batteryBadge: document.getElementById('battery-badge'),
    tapHint: document.getElementById('tap-hint'),

    // 1. Digitale
    digHours: document.getElementById('dig-hours'),
    digSep: document.getElementById('dig-sep'),
    digMinutes: document.getElementById('dig-minutes'),
    digSeconds: document.getElementById('dig-seconds'),

    // 2. Flip
    flipHours: document.getElementById('flip-hours'),
    flipMinutes: document.getElementById('flip-minutes'),
    flipSeconds: document.getElementById('flip-seconds'),
    flipSecondsCard: document.getElementById('flip-seconds-card'),

    // 3. Analogique
    analogTicks: document.getElementById('analog-ticks'),
    handHour: document.getElementById('hand-hour'),
    handMinute: document.getElementById('hand-minute'),
    handSecondGroup: document.getElementById('hand-second-group'),

    // 4. Mots (En lettres)
    wordGrid: document.getElementById('word-grid'),

    // 5. LED / 7-Segments
    segHm: document.getElementById('seg-hm'),
    segSec: document.getElementById('seg-sec'),
    segSecBox: document.getElementById('seg-sec-box'),

    // 6. Anneaux
    ringHours: document.getElementById('ring-hours'),
    ringMinutes: document.getElementById('ring-minutes'),
    ringSeconds: document.getElementById('ring-seconds'),
    ringSecTrack: document.getElementById('ring-sec-track'),
    ringTimeText: document.getElementById('ring-time-text'),
    ringSecText: document.getElementById('ring-sec-text'),

    // Contrôles
    panel: document.getElementById('controls-panel'),
    styleSelector: document.getElementById('style-selector'),
    themeSelector: document.getElementById('theme-selector'),
    brightnessSlider: document.getElementById('brightness-slider'),
    brightnessVal: document.getElementById('brightness-val'),
    scaleSlider: document.getElementById('scale-slider'),
    scaleVal: document.getElementById('scale-val'),
    toggleEco: document.getElementById('toggle-eco'),
    toggleAutoNight: document.getElementById('toggle-autonight'),
    toggleDate: document.getElementById('toggle-date'),
    toggle24h: document.getElementById('toggle-24h'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnInstallHelp: document.getElementById('btn-install-help'),
    btnClosePanel: document.getElementById('btn-close-panel'),
    installModal: document.getElementById('install-modal'),
    btnCloseModal: document.getElementById('btn-close-modal')
  };

  // --- Matrice de l'horloge en lettres française (11 colonnes x 10 lignes) ---
  const WORD_MATRIX = [
    'ILNESTODEUX', // Ligne 0 : IL(0-1) EST(3-5) DEUX(7-10)
    'QUATRETROIS', // Ligne 1 : QUATRE(0-5) TROIS(6-10)
    'NEUFUNESEPT', // Ligne 2 : NEUF(0-3) UNE(4-6) SEPT(7-10)
    'HUITSIXCINQ', // Ligne 3 : HUIT(0-3) SIX(4-6) CINQ(7-10)
    'MIDIXMINUIT', // Ligne 4 : MIDI(0-3) DIX(2-4) MINUIT(5-10)
    'ONZERHEURES', // Ligne 5 : ONZE(0-3) HEURE(5-9) HEURES(5-10)
    'MOINSOLEDIX', // Ligne 6 : MOINS(0-4) LE(6-7) DIX(8-10)
    'ETRQUARTPMD', // Ligne 7 : ET(0-1) QUART(3-7)
    'VINGT-CINQU', // Ligne 8 : VINGT(0-4) VINGT-CINQ(0-9) CINQ(6-9)
    'ETSDEMIEPAM'  // Ligne 9 : ET(0-1) DEMIE(3-7)
  ];

  // Coordonnées [row, startCol, endCol] pour allumer chaque mot
  const WORDS = {
    IL: [0, 0, 1],
    EST: [0, 3, 5],
    UNE: [2, 4, 6],
    DEUX: [0, 7, 10],
    TROIS: [1, 6, 10],
    QUATRE: [1, 0, 5],
    CINQ_H: [3, 7, 10],
    SIX: [3, 4, 6],
    SEPT: [2, 7, 10],
    HUIT: [3, 0, 3],
    NEUF: [2, 0, 3],
    DIX_H: [4, 2, 4],
    ONZE: [5, 0, 3],
    MIDI: [4, 0, 3],
    MINUIT: [4, 5, 10],
    HEURE: [5, 5, 9],
    HEURES: [5, 5, 10],
    MOINS: [6, 0, 4],
    LE: [6, 6, 7],
    ET_Q: [7, 0, 1],
    QUART: [7, 3, 7],
    DIX_M: [6, 8, 10],
    VINGT: [8, 0, 4],
    CINQ_M: [8, 6, 9],
    VINGT_CINQ: [8, 0, 9],
    ET_D: [9, 0, 1],
    DEMIE: [9, 3, 7]
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState };
      return { ...defaultState, ...JSON.parse(raw) };
    } catch (e) {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // Ignore storage errors in private mode
    }
  }

  // --- Initialisation des cadrans SVG et grilles ---
  function initAnalogClock() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const isMajor = i % 5 === 0;
      line.setAttribute('x1', '100');
      line.setAttribute('y1', isMajor ? '12' : '12');
      line.setAttribute('x2', '100');
      line.setAttribute('y2', isMajor ? '26' : '18');
      line.setAttribute('class', isMajor ? 'tick-major' : 'tick-minor');
      line.setAttribute('transform', `rotate(${i * 6} 100 100)`);
      fragment.appendChild(line);
    }
    dom.analogTicks.appendChild(fragment);
  }

  function initWordClock() {
    const fragment = document.createDocumentFragment();
    for (let r = 0; r < WORD_MATRIX.length; r++) {
      for (let c = 0; c < 11; c++) {
        const span = document.createElement('span');
        span.className = 'word-cell';
        span.dataset.r = r;
        span.dataset.c = c;
        span.textContent = WORD_MATRIX[r][c];
        fragment.appendChild(span);
      }
    }
    dom.wordGrid.appendChild(fragment);
  }

  function initRingsClock() {
    setupRingCircumference(dom.ringHours, 102);
    setupRingCircumference(dom.ringMinutes, 84);
    setupRingCircumference(dom.ringSeconds, 66);
  }

  function setupRingCircumference(circleEl, radius) {
    const circumference = 2 * Math.PI * radius;
    circleEl.style.strokeDasharray = `${circumference} ${circumference}`;
    circleEl.dataset.circumference = circumference;
  }

  function setRingProgress(circleEl, fraction) {
    const c = parseFloat(circleEl.dataset.circumference || '0');
    const offset = c - fraction * c;
    circleEl.style.strokeDashoffset = offset;
  }

  // --- Mise à jour de l'affichage de l'heure ---
  let lastMinuteRendered = -1;

  function updateClock() {
    const now = new Date();
    const hours24 = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    // Gestion du mode nuit automatique & Pixel-Shift une fois par minute
    if (minutes !== lastMinuteRendered) {
      lastMinuteRendered = minutes;
      updateDateDisplay(now);
      applyPixelShift(minutes);
      applyEffectiveAppearance(hours24);
    }

    const displayHours = state.use24h ? hours24 : (hours24 % 12 || 12);
    const padH = String(displayHours).padStart(2, '0');
    const padM = String(minutes).padStart(2, '0');
    const padS = String(seconds).padStart(2, '0');

    // Ne mettre à jour que le cadran actif pour économiser le CPU/GPU
    switch (state.style) {
      case 'digital':
        dom.digHours.textContent = padH;
        dom.digMinutes.textContent = padM;
        if (!state.ecoMode) {
          dom.digSeconds.textContent = padS;
        }
        break;

      case 'flip':
        dom.flipHours.textContent = padH;
        dom.flipMinutes.textContent = padM;
        if (!state.ecoMode) {
          dom.flipSeconds.textContent = padS;
        }
        break;

      case 'analog': {
        const hAngle = ((hours24 % 12) + minutes / 60) * 30;
        const mAngle = (minutes + (state.ecoMode ? 0 : seconds / 60)) * 6;
        dom.handHour.setAttribute('transform', `rotate(${hAngle} 100 100)`);
        dom.handMinute.setAttribute('transform', `rotate(${mAngle} 100 100)`);
        if (!state.ecoMode) {
          const sAngle = seconds * 6;
          dom.handSecondGroup.setAttribute('transform', `rotate(${sAngle} 100 100)`);
        }
        break;
      }

      case 'words':
        renderWordClock(hours24, minutes);
        break;

      case 'segment':
        dom.segHm.textContent = `${padH}:${padM}`;
        if (!state.ecoMode) {
          dom.segSec.textContent = padS;
        }
        break;

      case 'rings':
        setRingProgress(dom.ringHours, ((hours24 % 12) + minutes / 60) / 12);
        setRingProgress(dom.ringMinutes, (minutes + (state.ecoMode ? 0 : seconds / 60)) / 60);
        dom.ringTimeText.textContent = `${padH}:${padM}`;
        if (!state.ecoMode) {
          setRingProgress(dom.ringSeconds, seconds / 60);
          dom.ringSecText.textContent = `${padS}s`;
        }
        break;
    }
  }

  // --- Logique de l'horloge en lettres (Français) ---
  function renderWordClock(hours24, minutes) {
    const activeCoords = [WORDS.IL, WORDS.EST];
    const fiveMinStep = Math.floor(minutes / 5) * 5;
    const extraMinutes = minutes % 5;

    // Si on est à 35 min ou plus ("MOINS ..."), on annonce l'heure suivante
    let targetHour = hours24;
    if (fiveMinStep >= 35) {
      targetHour = (hours24 + 1) % 24;
    }

    // Heure
    if (targetHour === 0) {
      activeCoords.push(WORDS.MINUIT);
    } else if (targetHour === 12) {
      activeCoords.push(WORDS.MIDI);
    } else {
      const h12 = targetHour % 12;
      const hourMap = {
        1: WORDS.UNE,
        2: WORDS.DEUX,
        3: WORDS.TROIS,
        4: WORDS.QUATRE,
        5: WORDS.CINQ_H,
        6: WORDS.SIX,
        7: WORDS.SEPT,
        8: WORDS.HUIT,
        9: WORDS.NEUF,
        10: WORDS.DIX_H,
        11: WORDS.ONZE
      };
      activeCoords.push(hourMap[h12]);
      activeCoords.push(h12 === 1 ? WORDS.HEURE : WORDS.HEURES);
    }

    // Minutes par tranche de 5
    switch (fiveMinStep) {
      case 5:
        activeCoords.push(WORDS.CINQ_M);
        break;
      case 10:
        activeCoords.push(WORDS.DIX_M);
        break;
      case 15:
        activeCoords.push(WORDS.ET_Q, WORDS.QUART);
        break;
      case 20:
        activeCoords.push(WORDS.VINGT);
        break;
      case 25:
        activeCoords.push(WORDS.VINGT_CINQ);
        break;
      case 30:
        if (targetHour === 0 || targetHour === 12) {
          activeCoords.push(WORDS.ET_D, WORDS.DEMIE);
        } else {
          activeCoords.push(WORDS.ET_D, WORDS.DEMIE);
        }
        break;
      case 35:
        activeCoords.push(WORDS.MOINS, WORDS.VINGT_CINQ);
        break;
      case 40:
        activeCoords.push(WORDS.MOINS, WORDS.VINGT);
        break;
      case 45:
        activeCoords.push(WORDS.MOINS, WORDS.LE, WORDS.QUART);
        break;
      case 50:
        activeCoords.push(WORDS.MOINS, WORDS.DIX_M);
        break;
      case 55:
        activeCoords.push(WORDS.MOINS, WORDS.CINQ_M);
        break;
    }

    // Allumer les lettres correspondantes
    const cells = dom.wordGrid.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      let isLit = false;
      for (let w = 0; w < activeCoords.length; w++) {
        const [wr, cStart, cEnd] = activeCoords[w];
        if (r === wr && c >= cStart && c <= cEnd) {
          isLit = true;
          break;
        }
      }
      cell.classList.toggle('lit', isLit);
    }

    // Points des 1 à 4 minutes intermédiaires
    const dots = document.querySelectorAll('.w-dot');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('lit', idx < extraMinutes);
    });
  }

  function updateDateDisplay(now) {
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    dom.dateDisplay.textContent = formatter.format(now);
  }

  // --- Protection d'écran (Pixel Shifting) toutes les minutes ---
  function applyPixelShift(minute) {
    // Déplacement circulaire doux entre -8px et +8px pour éviter toute rémanence sur la dalle
    const angle = (minute % 12) * (Math.PI / 6);
    const dx = Math.round(Math.cos(angle) * 7);
    const dy = Math.round(Math.sin(angle) * 7);
    dom.stage.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // --- Boucle d'horloge ultra-économe alignée sur la seconde ou la minute ---
  function scheduleNextTick() {
    if (tickTimer) {
      clearTimeout(tickTimer);
    }
    updateClock();

    const now = new Date();
    let delayMs;
    if (state.ecoMode) {
      // Mode Ultra-Éco : prochain réveil au début exact de la minute suivante
      delayMs = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
    } else {
      // Mode Normal 1 Hz : prochain réveil au début exact de la seconde suivante
      delayMs = 1000 - now.getMilliseconds() + 10;
    }

    tickTimer = setTimeout(scheduleNextTick, Math.max(50, delayMs));
  }

  // --- Application de l'apparence & Mode Nuit Automatique ---
  function applyEffectiveAppearance(currentHour = new Date().getHours()) {
    const isNightHours = currentHour >= 22 || currentHour < 7;
    const useNightOverride = state.autoNight && isNightHours;

    // Thème de couleur
    dom.body.className = useNightOverride ? 'theme-red' : state.theme;

    // Luminosité logicielle (opacité du voile noir)
    const effectiveBrightness = useNightOverride ? Math.min(state.brightness, 18) : state.brightness;
    const dimmerOpacity = Math.max(0, Math.min(0.95, 1 - effectiveBrightness / 100));
    dom.dimmer.style.opacity = dimmerOpacity.toFixed(2);

    // Taille de l'horloge
    document.documentElement.style.setProperty('--clock-scale', (state.scale / 100).toFixed(2));

    // Visibilité de l'en-tête Date
    dom.topInfo.classList.toggle('hidden', !state.showDate);

    // Visibilité des secondes selon le mode Éco
    dom.ecoBadge.classList.toggle('hidden', !state.ecoMode);
    dom.digSeconds.classList.toggle('hidden', state.ecoMode);
    dom.flipSecondsCard.classList.toggle('hidden', state.ecoMode);
    dom.handSecondGroup.classList.toggle('hidden', state.ecoMode);
    dom.segSecBox.classList.toggle('hidden', state.ecoMode);
    dom.ringSeconds.classList.toggle('hidden', state.ecoMode);
    dom.ringSecTrack.classList.toggle('hidden', state.ecoMode);
    dom.ringSecText.classList.toggle('hidden', state.ecoMode);

    // Cadran actif
    document.querySelectorAll('.clock-face').forEach((section) => {
      section.classList.toggle('active', section.id === `clock-${state.style}`);
    });

    // Synchroniser les contrôles UI
    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === state.style);
    });
    document.querySelectorAll('.color-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.theme === state.theme);
    });
    dom.brightnessSlider.value = state.brightness;
    dom.brightnessVal.textContent = `${state.brightness}%`;
    dom.scaleSlider.value = state.scale;
    dom.scaleVal.textContent = `${state.scale}%`;
    dom.toggleEco.checked = state.ecoMode;
    dom.toggleAutoNight.checked = state.autoNight;
    dom.toggleDate.checked = state.showDate;
    dom.toggle24h.checked = state.use24h;
  }

  // --- Maintien de l'écran allumé (Screen Wake Lock API + Fallback iPadOS) ---
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        updateWakeLockBadge(true);
        wakeLockSentinel.addEventListener('release', () => {
          updateWakeLockBadge(false);
        });
        return;
      } catch (err) {
        updateWakeLockBadge(false);
      }
    }
    // Fallback silencieux si WakeLock non actif avant interaction tactile
    enableSilentAudioKeepAwake();
  }

  function enableSilentAudioKeepAwake() {
    try {
      if (noSleepAudioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      noSleepAudioCtx = new AudioContextClass();
      // Impulsion silencieuse toutes les 25 secondes pour éviter la mise en veille WebKit ancienne
      setInterval(() => {
        if (!noSleepAudioCtx || document.hidden) return;
        if (noSleepAudioCtx.state === 'suspended') {
          noSleepAudioCtx.resume();
        }
        const buffer = noSleepAudioCtx.createBuffer(1, 1, 22050);
        const source = noSleepAudioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(noSleepAudioCtx.destination);
        source.start(0);
      }, 25000);
      updateWakeLockBadge(true);
    } catch (e) {
      // Ignore audio context restrictions
    }
  }

  function updateWakeLockBadge(active) {
    dom.wakeLockBadge.textContent = active ? '⚡ Écran maintenu' : '⚡ Touchez pour maintenir';
  }

  // --- Batterie (si disponible) ---
  function initBatteryMonitor() {
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        const renderBattery = () => {
          const pct = Math.round(battery.level * 100);
          const icon = battery.charging ? '⚡' : '🔋';
          dom.batteryBadge.textContent = `${icon} ${pct}%`;
          dom.batteryBadge.classList.remove('hidden');
        };
        renderBattery();
        battery.addEventListener('levelchange', renderBattery);
        battery.addEventListener('chargingchange', renderBattery);
      });
    }
  }

  // --- Interactions UI & Panneau de configuration ---
  function openControlsPanel() {
    dom.panel.classList.remove('hidden');
    dom.tapHint.classList.add('fade-out');
    resetAutoCloseTimer();
  }

  function closeControlsPanel() {
    dom.panel.classList.add('hidden');
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
  }

  function resetAutoCloseTimer() {
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
    hidePanelTimeout = setTimeout(() => {
      if (dom.installModal.classList.contains('hidden')) {
        closeControlsPanel();
      }
    }, 10000);
  }

  function bindEvents() {
    // Toucher la scène principale ouvre les contrôles et ré-active le WakeLock
    dom.stage.addEventListener('click', () => {
      requestWakeLock();
      openControlsPanel();
    });

    // Fermer en touchant le fond sombre autour de la carte
    dom.panel.addEventListener('click', (e) => {
      if (e.target === dom.panel) {
        closeControlsPanel();
      } else {
        resetAutoCloseTimer();
      }
    });

    dom.btnClosePanel.addEventListener('click', closeControlsPanel);

    // Changement de style d'horloge
    dom.styleSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.style-btn');
      if (!btn) return;
      state.style = btn.dataset.style;
      saveState();
      applyEffectiveAppearance();
      updateClock();
    });

    // Changement de couleur / thème
    dom.themeSelector.addEventListener('click', (e) => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      state.theme = dot.dataset.theme;
      saveState();
      applyEffectiveAppearance();
    });

    // Luminosité logicielle
    dom.brightnessSlider.addEventListener('input', (e) => {
      state.brightness = Number(e.target.value);
      saveState();
      applyEffectiveAppearance();
    });

    // Taille de l'horloge
    dom.scaleSlider.addEventListener('input', (e) => {
      state.scale = Number(e.target.value);
      saveState();
      applyEffectiveAppearance();
    });

    // Mode Ultra-Éco (1/min)
    dom.toggleEco.addEventListener('change', (e) => {
      state.ecoMode = e.target.checked;
      saveState();
      applyEffectiveAppearance();
      scheduleNextTick();
    });

    // Mode Nuit Automatique
    dom.toggleAutoNight.addEventListener('change', (e) => {
      state.autoNight = e.target.checked;
      saveState();
      applyEffectiveAppearance();
    });

    // Afficher la date
    dom.toggleDate.addEventListener('change', (e) => {
      state.showDate = e.target.checked;
      saveState();
      applyEffectiveAppearance();
    });

    // Format 24h / 12h
    dom.toggle24h.addEventListener('change', (e) => {
      state.use24h = e.target.checked;
      saveState();
      updateClock();
    });

    // Bouton Plein écran (Safari iPadOS Fullscreen API)
    dom.btnFullscreen.addEventListener('click', () => {
      const docEl = document.documentElement;
      const requestFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
      const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
      const isFs = document.fullscreenElement || document.webkitFullscreenElement;
      if (!isFs && requestFs) {
        requestFs.call(docEl).catch(() => {
          dom.installModal.classList.remove('hidden');
        });
      } else if (isFs && exitFs) {
        exitFs.call(document);
      } else {
        dom.installModal.classList.remove('hidden');
      }
    });

    // Modale d'aide iPad
    dom.btnInstallHelp.addEventListener('click', () => {
      dom.installModal.classList.remove('hidden');
    });

    dom.btnCloseModal.addEventListener('click', () => {
      dom.installModal.classList.add('hidden');
    });

    dom.installModal.addEventListener('click', (e) => {
      if (e.target === dom.installModal) {
        dom.installModal.classList.add('hidden');
      }
    });

    // Ré-acquérir le WakeLock quand l'application revient au premier plan
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        scheduleNextTick();
      }
    });
  }

  // --- Enregistrement du Service Worker pour fonctionnement 100% hors-ligne ---
  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // --- Démarrage ---
  function init() {
    initAnalogClock();
    initWordClock();
    initRingsClock();
    applyEffectiveAppearance();
    bindEvents();
    scheduleNextTick();
    requestWakeLock();
    initBatteryMonitor();
    registerServiceWorker();

    // Estomper l'indice de démarrage après 4,5 secondes
    setTimeout(() => {
      dom.tapHint.classList.add('fade-out');
    }, 4500);
  }

  init();
})();

