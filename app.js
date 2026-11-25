/**
 * HORLOGE IPAD BASSE CONSOMMATION + STATION MÉTÉO + PILOTAGE ALARME JEEDOM
 * - Rafraîchissement adaptatif : 1 Hz normal, ou 1/60 Hz (1 fois par minute) en mode Ultra-Éco
 * - Liaison directe API Jeedom (192.168.1.23 par défaut) :
 *   Interroge l'état de la commande Alarme Jeedom :
 *   -> Alarme activée : passe la tablette en veille (écran noir zéro-conso + option relâchement WakeLock)
 *   -> Alarme désactivée : rallume automatiquement l'horloge !
 * - Supporte aussi le pilotage direct par URL depuis Jeedom Connect (?standby=1 ou ?standby=0)
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'horloge_ipad_prefs_v3';
  const WEATHER_CACHE_KEY = 'horloge_ipad_weather_cache_v1';
  const WEATHER_REFRESH_MS = 30 * 60 * 1000;

  const defaultState = {
    style: 'digital',      // digital | weather | flip | analog | words | segment | rings
    theme: 'theme-white',  // theme-white | theme-red | theme-amber | theme-green | theme-cyan | theme-sepia
    brightness: 85,
    scale: 100,
    ecoMode: false,
    autoNight: true,
    nightStart: '22:00',
    nightEnd: '07:00',
    autoStandby: false,
    standbyStart: '23:00',
    standbyEnd: '07:00',
    showDate: true,
    showWeatherBar: true,
    showWorldClocks: true,
    worldOffset: 0,        // Permet aussi de tirer 4 autres villes manuellement en plus de la rotation quotidienne
    use24h: true,
    city: 'Poitiers',
    lat: 46.5802,
    lon: 0.3404,
    // Configuration Jeedom
    jeedomEnabled: false,
    jeedomUrl: 'http://192.168.1.23',
    jeedomApiKey: '',
    jeedomCmdId: '',
    jeedomActiveVal: '1',
    jeedomIntervalSec: 15,
    jeedomStandbyMode: 'blackout_auto' // blackout_auto | blackout_release
  };

  let state = loadState();
  let tickTimer = null;
  let weatherTimer = null;
  let jeedomTimer = null;
  let isAlarmStandby = false;
  let isJeedomStandby = false;
  let isScheduleStandby = false;
  let wakeLockSentinel = null;
  let noSleepAudioCtx = null;
  let noSleepInterval = null;
  let hidePanelTimeout = null;
  let standbyIndicatorTimeout = null;

  // --- Références DOM ---
  const dom = {
    body: document.body,
    dimmer: document.getElementById('dimmer-overlay'),
    standbyScreen: document.getElementById('alarm-standby-screen'),
    standbyIndicator: document.getElementById('standby-indicator'),
    standbyText: document.getElementById('standby-text'),
    stage: document.getElementById('clock-stage'),
    topInfo: document.getElementById('top-info'),
    dateDisplay: document.getElementById('date-display'),
    weatherMini: document.getElementById('weather-mini'),
    wmIcon: document.getElementById('wm-icon'),
    wmTemp: document.getElementById('wm-temp'),
    wmDesc: document.getElementById('wm-desc'),
    wmMinmax: document.getElementById('wm-minmax'),
    wmCity: document.getElementById('wm-city'),
    jeedomBadge: document.getElementById('jeedom-badge'),
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

    // 4. Mots
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

    // 7. Station Météo
    stHours: document.getElementById('st-hours'),
    stMinutes: document.getElementById('st-minutes'),
    stSeconds: document.getElementById('st-seconds'),
    stDate: document.getElementById('st-date'),
    stCity: document.getElementById('st-city'),
    stUpdated: document.getElementById('st-updated'),
    stIcon: document.getElementById('st-icon'),
    stTemp: document.getElementById('st-temp'),
    stDesc: document.getElementById('st-desc'),
    stFeels: document.getElementById('st-feels'),
    stMinmax: document.getElementById('st-minmax'),
    stHumidity: document.getElementById('st-humidity'),
    stWind: document.getElementById('st-wind'),
    stForecastGrid: document.getElementById('st-forecast-grid'),
    worldClocksBar: document.getElementById('world-clocks-bar'),

    // Contrôles
    panel: document.getElementById('controls-panel'),
    styleSelector: document.getElementById('style-selector'),
    themeSelector: document.getElementById('theme-selector'),
    cityInput: document.getElementById('city-input'),
    btnSearchCity: document.getElementById('btn-search-city'),
    btnGeoloc: document.getElementById('btn-geoloc'),
    weatherStatusMsg: document.getElementById('weather-status-msg'),
    brightnessSlider: document.getElementById('brightness-slider'),
    brightnessVal: document.getElementById('brightness-val'),
    scaleSlider: document.getElementById('scale-slider'),
    scaleVal: document.getElementById('scale-val'),
    toggleWorld: document.getElementById('toggle-world'),
    btnShuffleWorld: document.getElementById('btn-shuffle-world'),
    toggleWeather: document.getElementById('toggle-weather'),
    toggleEco: document.getElementById('toggle-eco'),
    toggleAutoNight: document.getElementById('toggle-autonight'),
    nightStartTime: document.getElementById('night-start-time'),
    nightEndTime: document.getElementById('night-end-time'),
    nightHoursRow: document.getElementById('night-hours-row'),
    toggleAutoStandby: document.getElementById('toggle-autostandby'),
    standbyStartTime: document.getElementById('standby-start-time'),
    standbyEndTime: document.getElementById('standby-end-time'),
    standbyHoursRow: document.getElementById('standby-hours-row'),
    toggleDate: document.getElementById('toggle-date'),
    toggle24h: document.getElementById('toggle-24h'),
    btnReloadApp: document.getElementById('btn-reload-app'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnInstallHelp: document.getElementById('btn-install-help'),
    btnClosePanel: document.getElementById('btn-close-panel'),
    installModal: document.getElementById('install-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),

    // Contrôles Jeedom
    toggleJeedom: document.getElementById('toggle-jeedom'),
    jeedomUrl: document.getElementById('jeedom-url'),
    jeedomApiKey: document.getElementById('jeedom-apikey'),
    jeedomCmdId: document.getElementById('jeedom-cmdid'),
    jeedomActiveVal: document.getElementById('jeedom-active-val'),
    jeedomInterval: document.getElementById('jeedom-interval'),
    jeedomStandbyMode: document.getElementById('jeedom-standby-mode'),
    btnTestJeedom: document.getElementById('btn-test-jeedom'),
    btnSimAlarm: document.getElementById('btn-sim-alarm'),
    jeedomStatusMsg: document.getElementById('jeedom-status-msg')
  };

  function decodeWmoWeather(code, isNight = false) {
    const map = {
      0: { icon: isNight ? '🌙' : '☀️', label: isNight ? 'Ciel dégagé' : 'Ensoleillé' },
      1: { icon: isNight ? '🌙' : '🌤️', label: 'Peu nuageux' },
      2: { icon: '⛅', label: 'Partiellement nuageux' },
      3: { icon: '☁️', label: 'Couvert' },
      45: { icon: '🌫️', label: 'Brouillard' },
      48: { icon: '🌫️', label: 'Brouillard givrant' },
      51: { icon: '🌦️', label: 'Bruine légère' },
      53: { icon: '🌦️', label: 'Bruine' },
      55: { icon: '🌧️', label: 'Bruine dense' },
      56: { icon: '🌧️', label: 'Bruine verglaçante' },
      57: { icon: '🌧️', label: 'Bruine verglaçante' },
      61: { icon: '🌦️', label: 'Pluie faible' },
      63: { icon: '🌧️', label: 'Pluie modérée' },
      65: { icon: '🌧️', label: 'Pluie forte' },
      66: { icon: '🌧️', label: 'Pluie verglaçante' },
      67: { icon: '🌧️', label: 'Pluie verglaçante' },
      71: { icon: '🌨️', label: 'Neige faible' },
      73: { icon: '❄️', label: 'Neige modérée' },
      75: { icon: '❄️', label: 'Neige forte' },
      77: { icon: '❄️', label: 'Grains de neige' },
      80: { icon: '🌦️', label: 'Averses faibles' },
      81: { icon: '🌧️', label: 'Averses modérées' },
      82: { icon: '⛈️', label: 'Fortes averses' },
      85: { icon: '🌨️', label: 'Averses de neige' },
      86: { icon: '❄️', label: 'Fortes averses neige' },
      95: { icon: '⛈️', label: 'Orage' },
      96: { icon: '⛈️', label: 'Orage & grêle' },
      99: { icon: '⛈️', label: 'Orage fort & grêle' }
    };
    return map[code] || { icon: '⛅', label: 'Variable' };
  }

  const WORD_MATRIX = [
    'ILNESTODEUX',
    'QUATRETROIS',
    'NEUFUNESEPT',
    'HUITSIXCINQ',
    'MIDIXMINUIT',
    'ONZERHEURES',
    'MOINSOLEDIX',
    'ETRQUARTPMD',
    'VINGT-CINQU',
    'ETSDEMIEPAM'
  ];

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
    // Supporte un fichier local config_local.js sur Jeedom (window.HORLOGE_DEFAULT_CONFIG)
    // pour pré-remplir automatiquement la clé API, l'ID alarme, le style et la ville sans jamais les perdre
    const localServerConfig = (typeof window !== 'undefined' && window.HORLOGE_DEFAULT_CONFIG) ? window.HORLOGE_DEFAULT_CONFIG : {};
    const mergedDefaults = { ...defaultState, ...localServerConfig };
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem('horloge_ipad_prefs_v2') ||
        localStorage.getItem('horloge_ipad_prefs_v1');
      if (!raw) return { ...mergedDefaults };
      const parsed = JSON.parse(raw);
      // Si localStorage avait une clé API vide mais que config_local.js en fournit une, on utilise celle de config_local.js
      if (!parsed.jeedomApiKey && localServerConfig.jeedomApiKey) {
        parsed.jeedomApiKey = localServerConfig.jeedomApiKey;
      }
      if (!parsed.jeedomCmdId && localServerConfig.jeedomCmdId) {
        parsed.jeedomCmdId = localServerConfig.jeedomCmdId;
        parsed.jeedomEnabled = true;
      }
      return { ...mergedDefaults, ...parsed };
    } catch (e) {
      return { ...mergedDefaults };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // Charge dynamiquement config_local.js avec un timestamp anti-cache (comme weather_data.js)
  // pour que Safari sur iPad ne garde jamais la version vide en cache !
  function loadLocalConfigScript() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `./config_local.js?t=${Date.now()}`;
      script.onload = () => {
        resolve(window.HORLOGE_DEFAULT_CONFIG || null);
        script.remove();
      };
      script.onerror = () => {
        resolve(window.HORLOGE_DEFAULT_CONFIG || null);
        script.remove();
      };
      document.head.appendChild(script);
    });
  }

  function applyLocalServerConfig(localServerConfig) {
    if (!localServerConfig || typeof localServerConfig !== 'object') return;
    let changed = false;

    if (localServerConfig.jeedomApiKey && (!state.jeedomApiKey || state.jeedomApiKey === 'VOTRE_CLE_API')) {
      state.jeedomApiKey = String(localServerConfig.jeedomApiKey).trim();
      changed = true;
    }
    if (localServerConfig.jeedomCmdId && (!state.jeedomCmdId || state.jeedomCmdId === 'VOTRE_ID_CMD')) {
      state.jeedomCmdId = String(localServerConfig.jeedomCmdId).trim();
      state.jeedomEnabled = true;
      changed = true;
    }
    if (localServerConfig.jeedomUrl && !state.jeedomUrl) {
      state.jeedomUrl = String(localServerConfig.jeedomUrl).trim();
      changed = true;
    }
    if (typeof localServerConfig.jeedomEnabled === 'boolean' && localServerConfig.jeedomApiKey && localServerConfig.jeedomCmdId) {
      state.jeedomEnabled = localServerConfig.jeedomEnabled;
      changed = true;
    }
    if (localServerConfig.style && !localStorage.getItem(STORAGE_KEY)) {
      state.style = localServerConfig.style;
      changed = true;
    }

    if (changed) {
      saveState();
      applyEffectiveAppearance();
      startJeedomSchedule();
    }
  }

  // Permet aussi de pré-configurer Jeedom ou déclencher la veille par paramètres d'URL
  // Exemple : ?standby=1 ou ?jeedomUrl=http://192.168.1.23&apikey=XXX&cmdId=452
  function checkUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    let updated = false;

    if (params.has('jeedomUrl')) {
      state.jeedomUrl = params.get('jeedomUrl');
      updated = true;
    }
    if (params.has('apikey')) {
      state.jeedomApiKey = params.get('apikey');
      updated = true;
    }
    if (params.has('cmdId')) {
      state.jeedomCmdId = params.get('cmdId');
      state.jeedomEnabled = true;
      updated = true;
    }
    if (updated) {
      saveState();
    }

    if (params.has('standby')) {
      const val = params.get('standby');
      isJeedomStandby = (val === '1' || val === 'true');
      checkStandbySchedule();
    }
  }

  // --- Initialisation des cadrans SVG et grilles ---
  function initAnalogClock() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const isMajor = i % 5 === 0;
      line.setAttribute('x1', '100');
      line.setAttribute('y1', '12');
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

  // --- 4 Grandes Villes du Monde réparties sur 4 régions autour du globe (changent chaque jour) ---
  const WORLD_REGIONS = [
    // 1. Amériques (Nord, Centre, Sud)
    [
      { city: 'New York', country: 'États-Unis', flag: '🇺🇸', tz: 'America/New_York' },
      { city: 'Rio de Janeiro', country: 'Brésil', flag: '🇧🇷', tz: 'America/Sao_Paulo' },
      { city: 'Vancouver', country: 'Canada', flag: '🇨🇦', tz: 'America/Vancouver' },
      { city: 'Mexico', country: 'Mexique', flag: '🇲🇽', tz: 'America/Mexico_City' },
      { city: 'Buenos Aires', country: 'Argentine', flag: '🇦🇷', tz: 'America/Argentina/Buenos_Aires' },
      { city: 'Lima', country: 'Pérou', flag: '🇵🇪', tz: 'America/Lima' },
      { city: 'Anchorage', country: 'Alaska (USA)', flag: '🇺🇸', tz: 'America/Anchorage' },
      { city: 'Montréal', country: 'Canada (Québec)', flag: '🇨🇦', tz: 'America/Toronto' },
      { city: 'Santiago', country: 'Chili', flag: '🇨🇱', tz: 'America/Santiago' },
      { city: 'La Havane', country: 'Cuba', flag: '🇨🇺', tz: 'America/Havana' }
    ],
    // 2. Afrique, Atlantique & Moyen-Orient
    [
      { city: 'Le Caire', country: 'Égypte', flag: '🇪🇬', tz: 'Africa/Cairo' },
      { city: 'Reykjavik', country: 'Islande', flag: '🇮🇸', tz: 'Atlantic/Reykjavik' },
      { city: 'Nairobi', country: 'Kenya', flag: '🇰🇪', tz: 'Africa/Nairobi' },
      { city: 'Le Cap', country: 'Afrique du Sud', flag: '🇿🇦', tz: 'Africa/Johannesburg' },
      { city: 'Dakar', country: 'Sénégal', flag: '🇸🇳', tz: 'Africa/Dakar' },
      { city: 'Antananarivo', country: 'Madagascar', flag: '🇲🇬', tz: 'Indian/Antananarivo' },
      { city: 'Dubaï', country: 'Émirats Arabes Unis', flag: '🇦🇪', tz: 'Asia/Dubai' },
      { city: 'Casablanca', country: 'Maroc', flag: '🇲🇦', tz: 'Africa/Casablanca' },
      { city: 'Saint-Denis', country: 'Île de La Réunion', flag: '🇷🇪', tz: 'Indian/Reunion' },
      { city: 'Istanbul', country: 'Turquie', flag: '🇹🇷', tz: 'Europe/Istanbul' }
    ],
    // 3. Asie
    [
      { city: 'Tokyo', country: 'Japon', flag: '🇯🇵', tz: 'Asia/Tokyo' },
      { city: 'Katmandou', country: 'Népal', flag: '🇳🇵', tz: 'Asia/Kathmandu' },
      { city: 'Bangkok', country: 'Thaïlande', flag: '🇹🇭', tz: 'Asia/Bangkok' },
      { city: 'Séoul', country: 'Corée du Sud', flag: '🇰🇷', tz: 'Asia/Seoul' },
      { city: 'New Delhi', country: 'Inde', flag: '🇮🇳', tz: 'Asia/Kolkata' },
      { city: 'Oulan-Bator', country: 'Mongolie', flag: '🇲🇳', tz: 'Asia/Ulaanbaatar' },
      { city: 'Singapour', country: 'Singapour', flag: '🇸🇬', tz: 'Asia/Singapore' },
      { city: 'Pékin', country: 'Chine', flag: '🇨🇳', tz: 'Asia/Shanghai' },
      { city: 'Hanoï', country: 'Vietnam', flag: '🇻🇳', tz: 'Asia/Bangkok' },
      { city: 'Samarcande', country: 'Ouzbékistan', flag: '🇺🇿', tz: 'Asia/Samarkand' }
    ],
    // 4. Océanie & Pacifique
    [
      { city: 'Sydney', country: 'Australie', flag: '🇦🇺', tz: 'Australia/Sydney' },
      { city: 'Papeete', country: 'Tahiti (Polynésie)', flag: '🇵🇫', tz: 'Pacific/Tahiti' },
      { city: 'Auckland', country: 'Nouvelle-Zélande', flag: '🇳🇿', tz: 'Pacific/Auckland' },
      { city: 'Honolulu', country: 'Hawaï (USA)', flag: '🇺🇸', tz: 'Pacific/Honolulu' },
      { city: 'Nouméa', country: 'Nouvelle-Calédonie', flag: '🇳🇨', tz: 'Pacific/Noumea' },
      { city: 'Perth', country: 'Australie-Occidentale', flag: '🇦🇺', tz: 'Australia/Perth' },
      { city: 'Suva', country: 'Îles Fidji', flag: '🇫🇯', tz: 'Pacific/Fiji' },
      { city: 'Île de Pâques', country: 'Pacifique Sud (Chili)', flag: '🇨🇱', tz: 'Pacific/Easter' },
      { city: 'Darwin', country: 'Australie du Nord', flag: '🇦🇺', tz: 'Australia/Darwin' },
      { city: 'Apia', country: 'Îles Samoa', flag: '🇼🇸', tz: 'Pacific/Apia' }
    ]
  ];

  function getDayOfYearIndex(now) {
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  function getTodayWorldCities(now) {
    const dayIdx = getDayOfYearIndex(now) + (Number(state.worldOffset) || 0);
    return WORLD_REGIONS.map((regionList, rIdx) => {
      const idx = Math.abs(dayIdx + rIdx * 3) % regionList.length;
      return regionList[idx];
    });
  }

  function updateWorldClocks(now) {
    if (!state.showWorldClocks || !dom.worldClocksBar) return;
    const cities = getTodayWorldCities(now);
    const fragment = document.createDocumentFragment();

    cities.forEach((item) => {
      let timeStr = '--:--';
      let dayNightIcon = '☀️';
      let diffLabel = '';

      try {
        const fmt = new Intl.DateTimeFormat('fr-FR', {
          timeZone: item.tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: !state.use24h
        });
        timeStr = fmt.format(now);

        const hour24Fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: item.tz,
          hour: 'numeric',
          hour12: false
        });
        const remoteHour = Number(hour24Fmt.format(now)) % 24;
        dayNightIcon = remoteHour >= 7 && remoteHour < 20 ? '☀️' : '🌙';

        // Calcul du décalage horaire avec l'heure locale de l'iPad
        const localDate = new Date(now.toLocaleString('en-US'));
        const targetDate = new Date(now.toLocaleString('en-US', { timeZone: item.tz }));
        const diffHours = Math.round((targetDate - localDate) / (1000 * 60 * 30)) / 2;
        if (diffHours === 0) {
          diffLabel = 'Même heure';
        } else {
          const sign = diffHours > 0 ? '+' : '';
          const hInt = Math.trunc(diffHours);
          const half = Math.abs(diffHours % 1) === 0.5 ? '30' : '';
          diffLabel = `${sign}${hInt}h${half}`;
        }
      } catch (e) {}

      const card = document.createElement('div');
      card.className = 'world-city-card';
      card.innerHTML = `
        <div class="wc-left">
          <div class="wc-city-line">
            <span>${item.flag}</span>
            <span>${item.city}</span>
          </div>
          <div class="wc-country-line">${item.country}</div>
        </div>
        <div class="wc-right">
          <div class="wc-time">${timeStr}</div>
          <div class="wc-diff">${dayNightIcon} ${diffLabel}</div>
        </div>
      `;
      fragment.appendChild(card);
    });

    dom.worldClocksBar.innerHTML = '';
    dom.worldClocksBar.appendChild(fragment);
  }

  // Helper pour vérifier si l'heure actuelle est dans une plage horaire [start, end]
  function isCurrentTimeInWindow(startTimeStr, endTimeStr, nowDate = new Date()) {
    if (!startTimeStr || !endTimeStr || startTimeStr === endTimeStr) return false;
    const [startH, startM] = (startTimeStr || '00:00').split(':').map(Number);
    const [endH, endM] = (endTimeStr || '00:00').split(':').map(Number);
    if (isNaN(startH) || isNaN(endH)) return false;

    const curMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const startMinutes = (startH % 24) * 60 + ((startM || 0) % 60);
    const endMinutes = (endH % 24) * 60 + ((endM || 0) % 60);

    if (startMinutes < endMinutes) {
      return curMinutes >= startMinutes && curMinutes < endMinutes;
    } else {
      // Plage traversant minuit (ex: 22:00 -> 07:00)
      return curMinutes >= startMinutes || curMinutes < endMinutes;
    }
  }

  // --- Mise à jour de l'affichage de l'heure ---
  let lastMinuteRendered = -1;

  function updateClock(now = new Date()) {
    // Si l'alarme Jeedom ou la veille a mis l'horloge en veille noire, ne rien dessiner (0% CPU/GPU)
    if (isAlarmStandby) return;

    const hours24 = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

    if (minutes !== lastMinuteRendered) {
      lastMinuteRendered = minutes;
      updateDateDisplay(now);
      updateWorldClocks(now);
      applyPixelShift(minutes);
      applyEffectiveAppearance(now);
    }

    const displayHours = state.use24h ? hours24 : (hours24 % 12 || 12);
    const padH = String(displayHours).padStart(2, '0');
    const padM = String(minutes).padStart(2, '0');
    const padS = String(seconds).padStart(2, '0');

    switch (state.style) {
      case 'digital':
        dom.digHours.textContent = padH;
        dom.digMinutes.textContent = padM;
        if (!state.ecoMode) {
          dom.digSeconds.textContent = padS;
        }
        break;

      case 'weather':
        dom.stHours.textContent = padH;
        dom.stMinutes.textContent = padM;
        if (!state.ecoMode) {
          dom.stSeconds.textContent = padS;
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

  function renderWordClock(hours24, minutes) {
    const activeCoords = [WORDS.IL, WORDS.EST];
    const fiveMinStep = Math.floor(minutes / 5) * 5;
    const extraMinutes = minutes % 5;

    let targetHour = hours24;
    if (fiveMinStep >= 35) {
      targetHour = (hours24 + 1) % 24;
    }

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
        activeCoords.push(WORDS.ET_D, WORDS.DEMIE);
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
    const formatted = formatter.format(now);
    dom.dateDisplay.textContent = formatted;
    dom.stDate.textContent = formatted;
  }

  // ==========================================================================
  // MODULE JEEDOM — PILOTAGE DE LA VEILLE PAR L'ÉTAT DE L'ALARME (192.168.1.23)
  // ==========================================================================
  function buildJeedomCmdUrl() {
    const baseUrl = (state.jeedomUrl || 'http://192.168.1.23').trim().replace(/\/+$/, '');
    const apiKey = encodeURIComponent((state.jeedomApiKey || '').trim());
    const cmdId = encodeURIComponent((state.jeedomCmdId || '').trim());
    // Ajout de &_t=timestamp pour éviter tout cache de Safari sur la valeur de l'alarme
    return `${baseUrl}/core/api/jeeApi.php?apikey=${apiKey}&type=cmd&id=${cmdId}&_t=${Date.now()}`;
  }

  function isJeedomValueActive(rawText, configuredTarget) {
    const val = String(rawText || '').trim().toLowerCase();
    const target = String(configuredTarget || '1').trim().toLowerCase();

    // Valeurs qui signifient explicitement que l'alarme est DÉSACTIVÉE
    const inactiveValues = ['0', 'false', 'off', '', 'inactif', 'inactive', 'désactivé', 'desactive', 'désactivée', 'desactivee', 'aucun', 'none', 'arret', 'arrêt', 'disarmed'];

    // Si la cible configurée est une liste séparée par des virgules (ex: "1,true,Total,Nuit,Présent,Absent")
    const targets = target.split(',').map((s) => s.trim()).filter(Boolean);
    if (targets.includes(val)) return true;

    // Si la cible configurée est restée sur "1" par défaut :
    // Toute valeur qui n'est PAS dans inactiveValues (ex: "1", "Total", "Nuit", "Absent", "Présent", "Activée") est considérée comme ALARME ACTIVE !
    if (target === '1') {
      if (inactiveValues.includes(val) || val.includes('inactif') || val.includes('désactiv') || val.includes('desactiv')) {
        return false;
      }
      return true;
    }
    return false;
  }

  async function pollJeedomAlarmState(isManualTest = false) {
    if (!state.jeedomEnabled && !isManualTest) {
      dom.jeedomBadge.classList.add('hidden');
      return;
    }

    const apiKey = (state.jeedomApiKey || '').trim();
    const cmdId = (state.jeedomCmdId || '').trim();
    if (!apiKey || !cmdId) {
      if (isManualTest) {
        dom.jeedomStatusMsg.textContent = '⚠️ Renseignez la clé API Jeedom et l’ID de la commande État Alarme.';
      }
      return;
    }

    // Si l'utilisateur clique sur "Enregistrer & Tester Jeedom" alors que la case "Activer la liaison Jeedom" n'était pas cochée, on la coche automatiquement !
    if (isManualTest && !state.jeedomEnabled) {
      state.jeedomEnabled = true;
      dom.toggleJeedom.checked = true;
      saveState();
    }

    const url = buildJeedomCmdUrl();
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const rawText = (await response.text()).trim().replace(/^"|"$/g, '');

      // Vérifier si Jeedom a renvoyé un message d'erreur d'autorisation au lieu d'une valeur de commande
      if (
        rawText.toLowerCase().includes('pas autoris') ||
        rawText.toLowerCase().includes('unauthorized') ||
        rawText.toLowerCase().includes('aucune méthode')
      ) {
        dom.jeedomStatusMsg.textContent = `⚠️ Refus Jeedom : « ${rawText} » — Utilisez la Clé API Globale Jeedom.`;
        dom.jeedomBadge.textContent = '🏠 API Refusée';
        dom.jeedomBadge.classList.remove('hidden');
        return;
      }

      const alarmIsActive = isJeedomValueActive(rawText, state.jeedomActiveVal);

      const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      dom.jeedomStatusMsg.textContent = `✅ Connecté à Jeedom (${timeStr}) — Valeur reçue : « ${rawText} » (${alarmIsActive ? 'ALARME ACTIVE → Mise en veille' : 'Alarme désactivée → Horloge allumée'})`;
      dom.jeedomBadge.textContent = alarmIsActive ? `🏠 Alarme ON (${rawText})` : `🏠 Alarme OFF (${rawText})`;
      dom.jeedomBadge.classList.remove('hidden');

      isJeedomStandby = alarmIsActive;
      checkStandbySchedule();
    } catch (err) {
      const isMixedContent =
        window.location.protocol === 'https:' &&
        (state.jeedomUrl || '').trim().toLowerCase().startsWith('http://');

      if (isMixedContent) {
        dom.jeedomStatusMsg.textContent =
          '⚠️ Safari bloque l’appel HTTP local (192.168.1.23) depuis une page HTTPS. Touchez « 📲 Guide iPad & Jeedom » en haut pour la solution en 1 clic.';
      } else {
        dom.jeedomStatusMsg.textContent = `⚠️ Impossible de joindre Jeedom (${err.message}). Vérifiez l'IP, la clé API et l'ID.`;
      }
      dom.jeedomBadge.textContent = '🏠 Jeedom Err';
      dom.jeedomBadge.classList.remove('hidden');
    }
  }

  let manualWakeUntil = 0;

  function checkStandbySchedule(now = new Date()) {
    if (state.autoStandby) {
      isScheduleStandby = isCurrentTimeInWindow(state.standbyStart || '23:00', state.standbyEnd || '07:00', now);
    } else {
      isScheduleStandby = false;
    }

    const shouldStandby = isJeedomStandby || isScheduleStandby;
    const reason = isJeedomStandby ? 'Alarme Jeedom' : 'Veille programmée';
    setStandbyState(shouldStandby, reason);
  }

  function setStandbyState(shouldStandby, reason = 'Mode Veille', force = false) {
    // Si l'utilisateur a touché l'écran noir pour voir l'heure ou consulte les réglages
    if (shouldStandby && !force) {
      if (Date.now() < manualWakeUntil) {
        return;
      }
      if (dom.panel && !dom.panel.classList.contains('hidden')) {
        return;
      }
    }

    if (isAlarmStandby === shouldStandby) {
      return;
    }

    isAlarmStandby = shouldStandby;

    if (isAlarmStandby) {
      // Fermer le panneau de réglages s'il était ouvert
      closeControlsPanel();

      // Masquer explicitement toute la scène de l'horloge (#clock-stage) ET afficher l'écran noir #000000 par-dessus
      dom.stage.classList.add('hidden');
      dom.tapHint.classList.add('hidden');
      if (reason === 'Veille programmée') {
        dom.standbyText.textContent = `Veille de nuit — Touchez pour afficher l'heure`;
      } else {
        dom.standbyText.textContent = `${reason} activée — Mode Veille`;
      }
      dom.standbyScreen.classList.remove('hidden');
      dom.standbyIndicator.classList.remove('dimmed');

      // Masquer totalement le petit témoin rouge après 4 secondes pour un écran 100% noir (#000000)
      if (standbyIndicatorTimeout) clearTimeout(standbyIndicatorTimeout);
      standbyIndicatorTimeout = setTimeout(() => {
        dom.standbyIndicator.classList.add('dimmed');
      }, 4000);

      // Si l'utilisateur a choisi de relâcher aussi le WakeLock matériel iPadOS
      if (state.jeedomStandbyMode === 'blackout_release') {
        releaseWakeLock();
      }
    } else {
      // Désactivation de la veille -> Rallumer immédiatement l'horloge !
      dom.standbyScreen.classList.add('hidden');
      dom.stage.classList.remove('hidden');
      lastMinuteRendered = -1;
      requestWakeLock();
      scheduleNextTick();
    }
  }

  const setAlarmStandbyState = setStandbyState;

  function startJeedomSchedule() {
    if (jeedomTimer) clearInterval(jeedomTimer);
    if (!state.jeedomEnabled) {
      dom.jeedomBadge.classList.add('hidden');
      return;
    }
    pollJeedomAlarmState(false);
    const intervalMs = Math.max(5, Number(state.jeedomIntervalSec) || 15) * 1000;
    jeedomTimer = setInterval(() => {
      pollJeedomAlarmState(false);
    }, intervalMs);
  }

  // --- Module Météo Basse Consommation (Supporte weather_data.js local Jeedom + Open-Meteo direct) ---
  function loadLocalWeatherScript() {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `./weather_data.js?t=${Date.now()}`;
      script.onload = () => {
        resolve(window.JEEDOM_LOCAL_WEATHER || null);
        script.remove();
      };
      script.onerror = () => {
        resolve(window.JEEDOM_LOCAL_WEATHER || null);
        script.remove();
      };
      document.head.appendChild(script);
    });
  }

  async function fetchWeather(force = false) {
    if (isAlarmStandby && !force) return;
    try {
      // 1. Essayer en priorité le fichier JavaScript local weather_data.js (jamais bloqué par le .htaccess d'Apache Jeedom !)
      const jsWeatherData = await loadLocalWeatherScript();
      if (jsWeatherData && jsWeatherData.current) {
        renderWeatherData(jsWeatherData);
        return;
      }

      if (!force) {
        const cachedRaw = localStorage.getItem(WEATHER_CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (
            cached.lat === state.lat &&
            cached.lon === state.lon &&
            Date.now() - cached.timestamp < WEATHER_REFRESH_MS
          ) {
            renderWeatherData(cached.data);
            return;
          }
        }
      }

      const directUrl = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
      const response = await fetch(directUrl);
      if (!response.ok) throw new Error('Erreur réseau météo');
      const data = await response.json();

      localStorage.setItem(
        WEATHER_CACHE_KEY,
        JSON.stringify({
          lat: state.lat,
          lon: state.lon,
          timestamp: Date.now(),
          data
        })
      );

      renderWeatherData(data);
    } catch (err) {
      if (window.JEEDOM_LOCAL_WEATHER && window.JEEDOM_LOCAL_WEATHER.current) {
        renderWeatherData(window.JEEDOM_LOCAL_WEATHER);
        return;
      }
      const cachedRaw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cachedRaw) {
        try {
          renderWeatherData(JSON.parse(cachedRaw).data);
        } catch (e) {}
      } else {
        dom.wmDesc.textContent = 'Hors-ligne';
        dom.stDesc.textContent = `Météo indisponible (${err && err.message ? err.message : 'réseau'})`;
      }
    }
  }

  function renderWeatherData(data) {
    if (!data || !data.current) return;

    const current = data.current;
    const daily = data.daily || {};
    const isNight = current.is_day === 0;
    const wmo = decodeWmoWeather(current.weather_code, isNight);

    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const humidity = Math.round(current.relative_humidity_2m);
    const wind = Math.round(current.wind_speed_10m);

    const todayMin = daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : '--';
    const todayMax = daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : '--';

    dom.wmIcon.textContent = wmo.icon;
    dom.wmTemp.textContent = `${temp}°C`;
    dom.wmDesc.textContent = wmo.label;
    dom.wmMinmax.textContent = `(${todayMin}° / ${todayMax}°)`;
    dom.wmCity.textContent = state.city;

    dom.stCity.textContent = state.city;
    const nowTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    dom.stUpdated.textContent = `Actualisé à ${nowTime}`;
    dom.stIcon.textContent = wmo.icon;
    dom.stTemp.textContent = `${temp}°C`;
    dom.stDesc.textContent = wmo.label;
    dom.stFeels.textContent = `${feels}°C`;
    dom.stMinmax.textContent = `${todayMin}° / ${todayMax}°`;
    dom.stHumidity.textContent = `${humidity}%`;
    dom.stWind.textContent = `${wind} km/h`;

    if (daily.time && daily.time.length > 1) {
      const fragment = document.createDocumentFragment();
      const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
      const count = Math.min(5, daily.time.length);
      for (let i = 1; i < count; i++) {
        const dateObj = new Date(daily.time[i] + 'T12:00:00');
        const dayInfo = decodeWmoWeather(daily.weather_code[i], false);
        const minT = Math.round(daily.temperature_2m_min[i]);
        const maxT = Math.round(daily.temperature_2m_max[i]);

        const card = document.createElement('div');
        card.className = 'forecast-day-card';
        card.innerHTML = `
          <div class="fc-day-name">${dayFmt.format(dateObj)}</div>
          <div class="fc-icon">${dayInfo.icon}</div>
          <div class="fc-temps">${maxT}° <span class="fc-temp-min">/ ${minT}°</span></div>
          <div class="fc-desc">${dayInfo.label}</div>
        `;
        fragment.appendChild(card);
      }
      dom.stForecastGrid.innerHTML = '';
      dom.stForecastGrid.appendChild(fragment);
    }
  }

  async function searchCityByName(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    dom.weatherStatusMsg.textContent = `Recherche de « ${trimmed} »…`;
    try {
      const proxySearchUrl = `./weather_proxy.php?action=search&name=${encodeURIComponent(trimmed)}`;
      const directSearchUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=fr&format=json`;

      let json = null;
      if (window.location.hostname !== 'olivierma86.github.io') {
        try {
          const proxyRes = await fetch(proxySearchUrl, { cache: 'no-store' });
          if (proxyRes.ok) {
            const candidate = await proxyRes.json();
            if (candidate && candidate.results) {
              json = candidate;
            }
          }
        } catch (e) {}
      }

      if (!json) {
        const res = await fetch(directSearchUrl);
        json = await res.json();
      }
      if (!json.results || json.results.length === 0) {
        dom.weatherStatusMsg.textContent = `Aucune ville trouvée pour « ${trimmed} ».`;
        return;
      }
      const place = json.results[0];
      state.city = place.name;
      state.lat = place.latitude;
      state.lon = place.longitude;
      saveState();
      dom.cityInput.value = state.city;
      const region = [place.admin1, place.country].filter(Boolean).join(', ');
      dom.weatherStatusMsg.textContent = `Ville active : ${state.city} (${region})`;
      await fetchWeather(true);
    } catch (err) {
      dom.weatherStatusMsg.textContent = `Erreur lors de la recherche de la ville.`;
    }
  }

  function useGeolocation() {
    if (!('geolocation' in navigator)) {
      dom.weatherStatusMsg.textContent = 'Géolocalisation non supportée sur ce navigateur.';
      return;
    }
    dom.weatherStatusMsg.textContent = 'Localisation GPS en cours…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        state.lat = Number(pos.coords.latitude.toFixed(4));
        state.lon = Number(pos.coords.longitude.toFixed(4));
        state.city = 'Ma position';
        saveState();
        dom.cityInput.value = state.city;
        dom.weatherStatusMsg.textContent = `Position GPS active (${state.lat}, ${state.lon})`;
        await fetchWeather(true);
      },
      () => {
        dom.weatherStatusMsg.textContent = 'Accès GPS refusé — saisissez le nom de votre ville ci-dessus.';
      },
      { timeout: 10000 }
    );
  }

  function startWeatherSchedule() {
    fetchWeather(false);
    if (weatherTimer) clearInterval(weatherTimer);
    weatherTimer = setInterval(() => fetchWeather(true), WEATHER_REFRESH_MS);
  }

  // --- Protection d'écran (Pixel Shifting) toutes les minutes ---
  function applyPixelShift(minute) {
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

    const now = new Date();
    checkStandbySchedule(now);
    updateClock(now);

    let delayMs;
    if (isAlarmStandby) {
      delayMs = 5000;
    } else if (state.ecoMode) {
      delayMs = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
    } else {
      delayMs = 1000 - now.getMilliseconds() + 10;
    }

    tickTimer = setTimeout(scheduleNextTick, Math.max(50, delayMs));
  }

  // --- Application de l'apparence & Mode Nuit Automatique ---
  function applyEffectiveAppearance(now = new Date()) {
    const nowDate = (now instanceof Date) ? now : new Date();
    const isNightHours = isCurrentTimeInWindow(state.nightStart || '22:00', state.nightEnd || '07:00', nowDate);
    const useNightOverride = state.autoNight && isNightHours;

    dom.body.className = useNightOverride ? 'theme-red' : state.theme;

    const effectiveBrightness = useNightOverride ? Math.min(state.brightness, 18) : state.brightness;
    const dimmerOpacity = Math.max(0, Math.min(0.95, 1 - effectiveBrightness / 100));
    dom.dimmer.style.opacity = dimmerOpacity.toFixed(2);

    document.documentElement.style.setProperty('--clock-scale', (state.scale / 100).toFixed(2));

    dom.topInfo.classList.toggle('hidden', !state.showDate);
    if (dom.worldClocksBar) {
      dom.worldClocksBar.classList.toggle('hidden', !state.showWorldClocks);
    }
    const hideMiniWeather = !state.showWeatherBar || state.style === 'weather';
    dom.weatherMini.classList.toggle('hidden', hideMiniWeather);

    dom.ecoBadge.classList.toggle('hidden', !state.ecoMode);
    dom.digSeconds.classList.toggle('hidden', state.ecoMode);
    dom.stSeconds.classList.toggle('hidden', state.ecoMode);
    dom.flipSecondsCard.classList.toggle('hidden', state.ecoMode);
    dom.handSecondGroup.classList.toggle('hidden', state.ecoMode);
    dom.segSecBox.classList.toggle('hidden', state.ecoMode);
    dom.ringSeconds.classList.toggle('hidden', state.ecoMode);
    dom.ringSecTrack.classList.toggle('hidden', state.ecoMode);
    dom.ringSecText.classList.toggle('hidden', state.ecoMode);

    document.querySelectorAll('.clock-face').forEach((section) => {
      section.classList.toggle('active', section.id === `clock-${state.style}`);
    });

    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === state.style);
    });
    document.querySelectorAll('.color-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.theme === state.theme);
    });

    dom.cityInput.value = state.city;
    dom.weatherStatusMsg.textContent = `Ville active : ${state.city}`;
    dom.brightnessSlider.value = state.brightness;
    dom.brightnessVal.textContent = `${state.brightness}%`;
    dom.scaleSlider.value = state.scale;
    dom.scaleVal.textContent = `${state.scale}%`;
    if (dom.toggleWorld) {
      dom.toggleWorld.checked = state.showWorldClocks;
    }
    dom.toggleWeather.checked = state.showWeatherBar;
    dom.toggleEco.checked = state.ecoMode;
    dom.toggleDate.checked = state.showDate;
    dom.toggle24h.checked = state.use24h;

    // Synchroniser les plages horaires Mode Nuit et Veille
    if (dom.toggleAutoNight) {
      dom.toggleAutoNight.checked = !!state.autoNight;
      dom.nightStartTime.value = state.nightStart || '22:00';
      dom.nightEndTime.value = state.nightEnd || '07:00';
      dom.nightHoursRow.classList.toggle('disabled', !state.autoNight);
    }
    if (dom.toggleAutoStandby) {
      dom.toggleAutoStandby.checked = !!state.autoStandby;
      dom.standbyStartTime.value = state.standbyStart || '23:00';
      dom.standbyEndTime.value = state.standbyEnd || '07:00';
      dom.standbyHoursRow.classList.toggle('disabled', !state.autoStandby);
    }

    // Synchroniser les champs Jeedom
    dom.toggleJeedom.checked = state.jeedomEnabled;
    dom.jeedomUrl.value = state.jeedomUrl || 'http://192.168.1.23';
    dom.jeedomApiKey.value = state.jeedomApiKey || '';
    dom.jeedomCmdId.value = state.jeedomCmdId || '';
    dom.jeedomActiveVal.value = state.jeedomActiveVal || '1';
    dom.jeedomInterval.value = state.jeedomIntervalSec || 15;
    dom.jeedomStandbyMode.value = state.jeedomStandbyMode || 'blackout_auto';
  }

  // --- Maintien de l'écran allumé (Screen Wake Lock API + Fallback iPadOS) ---
  async function requestWakeLock() {
    if (isAlarmStandby && state.jeedomStandbyMode === 'blackout_release') {
      return;
    }
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
    enableSilentAudioKeepAwake();
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockSentinel) {
        await wakeLockSentinel.release();
        wakeLockSentinel = null;
      }
      if (noSleepInterval) {
        clearInterval(noSleepInterval);
        noSleepInterval = null;
      }
      updateWakeLockBadge(false);
    } catch (e) {}
  }

  function enableSilentAudioKeepAwake() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!noSleepAudioCtx) {
        noSleepAudioCtx = new AudioContextClass();
      }
      if (noSleepInterval) clearInterval(noSleepInterval);
      noSleepInterval = setInterval(() => {
        if (!noSleepAudioCtx || document.hidden) return;
        if (isAlarmStandby && state.jeedomStandbyMode === 'blackout_release') return;
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
    } catch (e) {}
  }

  function updateWakeLockBadge(active) {
    dom.wakeLockBadge.textContent = active ? '⚡ Écran maintenu' : '⚡ Veille libre';
  }

  // --- Batterie ---
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
    checkStandbySchedule();
  }

  function resetAutoCloseTimer() {
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
    hidePanelTimeout = setTimeout(() => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (
        dom.installModal.classList.contains('hidden') &&
        activeTag !== 'INPUT' &&
        activeTag !== 'SELECT'
      ) {
        closeControlsPanel();
      }
    }, 15000);
  }

  function saveJeedomInputsFromDom() {
    state.jeedomEnabled = dom.toggleJeedom.checked;
    state.jeedomUrl = dom.jeedomUrl.value.trim() || 'http://192.168.1.23';
    state.jeedomApiKey = dom.jeedomApiKey.value.trim();
    state.jeedomCmdId = dom.jeedomCmdId.value.trim();
    state.jeedomActiveVal = dom.jeedomActiveVal.value.trim() || '1';
    state.jeedomIntervalSec = Math.max(5, Number(dom.jeedomInterval.value) || 15);
    state.jeedomStandbyMode = dom.jeedomStandbyMode.value;
    saveState();
  }

  function bindEvents() {
    dom.stage.addEventListener('click', () => {
      requestWakeLock();
      openControlsPanel();
    });

    // Si l'écran est en veille noire et qu'on touche l'écran, on affiche l'horloge temporairement pendant 15s
    dom.standbyScreen.addEventListener('click', () => {
      manualWakeUntil = Date.now() + 15000;
      setStandbyState(false, 'Réveil tactile (15s)', true);
    });

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

    // Événements Jeedom
    dom.toggleJeedom.addEventListener('change', () => {
      saveJeedomInputsFromDom();
      startJeedomSchedule();
    });

    dom.btnTestJeedom.addEventListener('click', () => {
      saveJeedomInputsFromDom();
      pollJeedomAlarmState(true);
      startJeedomSchedule();
    });

    // Bouton de simulation de mise en veille pendant 5 secondes
    dom.btnSimAlarm.addEventListener('click', () => {
      closeControlsPanel();
      setStandbyState(true, 'Test Veille (5s)', true);
      setTimeout(() => {
        setStandbyState(false, 'Fin du test', true);
        checkStandbySchedule();
      }, 5000);
    });

    // Recherche de ville météo
    dom.btnSearchCity.addEventListener('click', () => {
      searchCityByName(dom.cityInput.value);
    });

    dom.cityInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchCityByName(dom.cityInput.value);
        dom.cityInput.blur();
      }
    });

    dom.btnGeoloc.addEventListener('click', () => {
      useGeolocation();
    });

    // Changement de couleur / thème
    dom.themeSelector.addEventListener('click', (e) => {
      const dot = e.target.closest('.color-dot');
      if (!dot) return;
      state.theme = dot.dataset.theme;
      saveState();
      applyEffectiveAppearance();
    });

    dom.brightnessSlider.addEventListener('input', (e) => {
      state.brightness = Number(e.target.value);
      saveState();
      applyEffectiveAppearance();
    });

    dom.scaleSlider.addEventListener('input', (e) => {
      state.scale = Number(e.target.value);
      saveState();
      applyEffectiveAppearance();
    });

    if (dom.toggleWorld) {
      dom.toggleWorld.addEventListener('change', (e) => {
        state.showWorldClocks = e.target.checked;
        saveState();
        applyEffectiveAppearance();
        updateWorldClocks(new Date());
      });
    }

    if (dom.btnShuffleWorld) {
      dom.btnShuffleWorld.addEventListener('click', () => {
        state.worldOffset = (Number(state.worldOffset) || 0) + 1;
        saveState();
        updateWorldClocks(new Date());
      });
    }

    dom.toggleWeather.addEventListener('change', (e) => {
      state.showWeatherBar = e.target.checked;
      saveState();
      applyEffectiveAppearance();
    });

    dom.toggleEco.addEventListener('change', (e) => {
      state.ecoMode = e.target.checked;
      saveState();
      applyEffectiveAppearance();
      scheduleNextTick();
    });

    // Plages horaires automatiques : Mode Nuit (Rouge) & Veille
    dom.toggleAutoNight.addEventListener('change', (e) => {
      state.autoNight = e.target.checked;
      saveState();
      applyEffectiveAppearance();
    });

    ['change', 'input'].forEach((evt) => {
      dom.nightStartTime.addEventListener(evt, (e) => {
        state.nightStart = e.target.value || '22:00';
        saveState();
        applyEffectiveAppearance();
      });
      dom.nightEndTime.addEventListener(evt, (e) => {
        state.nightEnd = e.target.value || '07:00';
        saveState();
        applyEffectiveAppearance();
      });
    });

    dom.toggleAutoStandby.addEventListener('change', (e) => {
      state.autoStandby = e.target.checked;
      saveState();
      applyEffectiveAppearance();
      checkStandbySchedule();
    });

    ['change', 'input'].forEach((evt) => {
      dom.standbyStartTime.addEventListener(evt, (e) => {
        state.standbyStart = e.target.value || '23:00';
        saveState();
        checkStandbySchedule();
      });
      dom.standbyEndTime.addEventListener(evt, (e) => {
        state.standbyEnd = e.target.value || '07:00';
        saveState();
        checkStandbySchedule();
      });
    });

    dom.toggleDate.addEventListener('change', (e) => {
      state.showDate = e.target.checked;
      saveState();
      applyEffectiveAppearance();
    });

    dom.toggle24h.addEventListener('change', (e) => {
      state.use24h = e.target.checked;
      saveState();
      updateClock();
    });

    if (dom.btnReloadApp) {
      dom.btnReloadApp.addEventListener('click', async () => {
        saveState();
        try {
          if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
              await reg.unregister();
            }
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            for (const k of keys) {
              await caches.delete(k);
            }
          }
        } catch (e) {}
        // Recharger la page avec un timestamp pour forcer iPadOS WebApp à prendre la dernière version tout en gardant localStorage !
        const baseUrl = window.location.pathname;
        window.location.replace(`${baseUrl}?v=${Date.now()}`);
      });
    }

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

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        scheduleNextTick();
        fetchWeather(false);
        if (state.jeedomEnabled) {
          pollJeedomAlarmState(false);
        }
      }
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  async function init() {
    initAnalogClock();
    initWordClock();
    initRingsClock();
    const freshConfig = await loadLocalConfigScript();
    applyLocalServerConfig(freshConfig);
    checkUrlParameters();
    applyEffectiveAppearance();
    bindEvents();
    checkStandbySchedule();
    scheduleNextTick();
    startWeatherSchedule();
    startJeedomSchedule();
    requestWakeLock();
    initBatteryMonitor();
    registerServiceWorker();

    setTimeout(() => {
      dom.tapHint.classList.add('fade-out');
    }, 4500);
  }

  init();
})();
