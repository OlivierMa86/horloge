#!/bin/sh
# Script d'actualisation météo locale pour Horloge iPad hébergée sur Jeedom
# Récupère les prévisions Open-Meteo et les écrit dans weather_data.js (extension .js autorisée par le .htaccess de Jeedom)

LAT="${1:-46.5802}"
LON="${2:-0.3404}"
DIR="/var/www/html/horloge"
OUT="$DIR/weather_data.js"
TMP="$DIR/weather_data.tmp.js"

JSON=$(curl -s --max-time 15 "https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5")

if [ -n "$JSON" ]; then
  printf "window.JEEDOM_LOCAL_WEATHER = %s;\n" "$JSON" > "$TMP"
  mv "$TMP" "$OUT"
  chmod 644 "$OUT"
fi
