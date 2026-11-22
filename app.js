/**
 * HORLOGE IPAD BASSE CONSOMMATION + STATION MÉTÉO (iPad 8 & modèles suivants)
 * - Rafraîchissement adaptatif : 1 Hz normal, ou 1/60 Hz (1 fois par minute) en mode Ultra-Éco
 * - Météo Open-Meteo (sans clé API) actualisée toutes les 30 minutes :
 *   1) Pilule météo en haut sur TOUS les styles d'horloge
 *   2) Mode dédié "Station Météo" avec prévisions 4 jours, ressenti, vent et humidité
 * - Anti-veille : Screen Wake Lock API + fallback audio inaudible
 * - Anti-brûlure d'écran (Pixel Shifting) toutes les minutes
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'horloge_ipad_prefs_v2';
  const WEATHER_CACHE_KEY = 'horloge_ipad_weather_cache_v1';
  const WEATHER_REFRESH_MS = 30 * 60 * 1000; // 30 minutes pour économiser la batterie

  const defaultState = {
    style: 'digital',      // digital | weather | flip | analog | words | segment | rings
    theme: 'theme-white',  // theme-white | theme-red | theme-amber | theme-green | theme-cyan | theme-sepia
    brightness: 85,        // 5 à 100 (%)
    scale: 100,            // 60 à 125 (%)
    ecoMode: false,        // true = rafraîchissement 1 fois/minute + secondes masquées
    autoNight: true,       // true = 22h-07h bascule auto en rouge 15%
    showDate: true,
    showWeatherBar: true,  // Affiche le résumé météo en haut sur toutes les horloges
    use24h: true,
    city: 'Poitiers',
    lat: 46.5802,
    lon: 0.3404
  };

  let state = loadState();
  let tickTimer = null;
  let weatherTimer = null;
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
    weatherMini: document.getElementById('weather-mini'),
    wmIcon: document.getElementById('wm-icon'),
    wmTemp: document.getElementById('wm-temp'),
    wmDesc: document.getElementById('wm-desc'),
    wmMinmax: document.getElementById('wm-minmax'),
    wmCity: document.getElementById('wm-city'),
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

    // 7. Station Météo Complète
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
    toggleWeather: document.getElementById('toggle-weather'),
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

  // --- Codes météo WMO -> Icône & Description en français ---
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

  // --- Matrice de l'horloge en lettres française (11 colonnes x 10 lignes) ---
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('horloge_ipad_prefs_v1');
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
      // Ignore storage errors
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

  // --- Mise à jour de l'affichage de l'heure ---
  let lastMinuteRendered = -1;

  function updateClock() {
    const now = new Date();
    const hours24 = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();

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

  // --- Logique de l'horloge en lettres (Français) ---
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

  // --- Module Météo Basse Consommation (Open-Meteo API gratuite sans clé) ---
  async function fetchWeather(force = false) {
    try {
      // Vérifier le cache local si non forcé
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

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
      const response = await fetch(url);
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
      // En cas de coupure Wi-Fi, afficher le dernier cache s'il existe
      const cachedRaw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (cachedRaw) {
        try {
          renderWeatherData(JSON.parse(cachedRaw).data);
        } catch (e) {}
      } else {
        dom.wmDesc.textContent = 'Hors-ligne';
        dom.stDesc.textContent = 'Météo hors-ligne';
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

    // 1. Mise à jour de la pilule météo en haut (sur toutes les horloges)
    dom.wmIcon.textContent = wmo.icon;
    dom.wmTemp.textContent = `${temp}°C`;
    dom.wmDesc.textContent = wmo.label;
    dom.wmMinmax.textContent = `(${todayMin}° / ${todayMax}°)`;
    dom.wmCity.textContent = state.city;

    // 2. Mise à jour du mode "Station Météo"
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

    // 3. Prévisions des 4 prochains jours
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

  // Recherche de ville par nom via l'API de géocodage Open-Meteo
  async function searchCityByName(query) {
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    dom.weatherStatusMsg.textContent = `Recherche de « ${trimmed} »…`;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=fr&format=json`;
      const res = await fetch(url);
      const json = await res.json();
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
    updateClock();

    const now = new Date();
    let delayMs;
    if (state.ecoMode) {
      delayMs = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
    } else {
      delayMs = 1000 - now.getMilliseconds() + 10;
    }

    tickTimer = setTimeout(scheduleNextTick, Math.max(50, delayMs));
  }

  // --- Application de l'apparence & Mode Nuit Automatique ---
  function applyEffectiveAppearance(currentHour = new Date().getHours()) {
    const isNightHours = currentHour >= 22 || currentHour < 7;
    const useNightOverride = state.autoNight && isNightHours;

    dom.body.className = useNightOverride ? 'theme-red' : state.theme;

    const effectiveBrightness = useNightOverride ? Math.min(state.brightness, 18) : state.brightness;
    const dimmerOpacity = Math.max(0, Math.min(0.95, 1 - effectiveBrightness / 100));
    dom.dimmer.style.opacity = dimmerOpacity.toFixed(2);

    document.documentElement.style.setProperty('--clock-scale', (state.scale / 100).toFixed(2));

    // Visibilité de l'en-tête Date & Météo
    dom.topInfo.classList.toggle('hidden', !state.showDate);
    // Sur le mode "Station Météo", la météo est déjà affichée en grand au centre
    const hideMiniWeather = !state.showWeatherBar || state.style === 'weather';
    dom.weatherMini.classList.toggle('hidden', hideMiniWeather);

    // Visibilité des secondes selon le mode Éco
    dom.ecoBadge.classList.toggle('hidden', !state.ecoMode);
    dom.digSeconds.classList.toggle('hidden', state.ecoMode);
    dom.stSeconds.classList.toggle('hidden', state.ecoMode);
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
    dom.cityInput.value = state.city;
    dom.weatherStatusMsg.textContent = `Ville active : ${state.city}`;
    dom.brightnessSlider.value = state.brightness;
    dom.brightnessVal.textContent = `${state.brightness}%`;
    dom.scaleSlider.value = state.scale;
    dom.scaleVal.textContent = `${state.scale}%`;
    dom.toggleWeather.checked = state.showWeatherBar;
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
    enableSilentAudioKeepAwake();
  }

  function enableSilentAudioKeepAwake() {
    try {
      if (noSleepAudioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      noSleepAudioCtx = new AudioContextClass();
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
    } catch (e) {}
  }

  function updateWakeLockBadge(active) {
    dom.wakeLockBadge.textContent = active ? '⚡ Écran maintenu' : '⚡ Touchez pour maintenir';
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
  }

  function resetAutoCloseTimer() {
    if (hidePanelTimeout) clearTimeout(hidePanelTimeout);
    hidePanelTimeout = setTimeout(() => {
      if (
        dom.installModal.classList.contains('hidden') &&
        document.activeElement !== dom.cityInput
      ) {
        closeControlsPanel();
      }
    }, 12000);
  }

  function bindEvents() {
    dom.stage.addEventListener('click', () => {
      requestWakeLock();
      openControlsPanel();
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

    // Afficher la météo sur toutes les horloges
    dom.toggleWeather.addEventListener('change', (e) => {
      state.showWeatherBar = e.target.checked;
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

    // Afficher la barre supérieure
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

    // Bouton Plein écran
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

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        scheduleNextTick();
        fetchWeather(false);
      }
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function init() {
    initAnalogClock();
    initWordClock();
    initRingsClock();
    applyEffectiveAppearance();
    bindEvents();
    scheduleNextTick();
    startWeatherSchedule();
    requestWakeLock();
    initBatteryMonitor();
    registerServiceWorker();

    setTimeout(() => {
      dom.tapHint.classList.add('fade-out');
    }, 4500);
  }

  init();
})();
