<?php
/**
 * Relais local (Proxy PHP) pour Open-Meteo hébergé sur Jeedom
 * Permet de contourner la politique Content-Security-Policy (CSP) d'Apache sur Jeedom
 * qui bloque les appels JavaScript externes (connect-src 'self') depuis http://192.168.1.23/horloge/
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$action = isset($_GET['action']) ? $_GET['action'] : 'forecast';

if ($action === 'search') {
    $name = isset($_GET['name']) ? trim($_GET['name']) : 'Poitiers';
    $url = 'https://geocoding-api.open-meteo.com/v1/search?name=' . urlencode($name) . '&count=1&language=fr&format=json';
} else {
    $lat = isset($_GET['lat']) ? floatval($_GET['lat']) : 46.5802;
    $lon = isset($_GET['lon']) ? floatval($_GET['lon']) : 0.3404;
    $url = 'https://api.open-meteo.com/v1/forecast?latitude=' . $lat
         . '&longitude=' . $lon
         . '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m'
         . '&daily=weather_code,temperature_2m_max,temperature_2m_min'
         . '&timezone=auto&forecast_days=5';
}

$response = false;

// 1. Essai avec cURL (présent par défaut sur toutes les box Jeedom)
if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Horloge-iPad-Jeedom/1.0');
    $response = curl_exec($ch);
    curl_close($ch);
}

// 2. Fallback file_get_contents si cURL non disponible
if ($response === false || empty($response)) {
    $ctx = stream_context_create([
        'http' => [
            'timeout' => 10,
            'header' => "User-Agent: Horloge-iPad-Jeedom/1.0\r\n"
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false
        ]
    ]);
    $response = @file_get_contents($url, false, $ctx);
}

if ($response === false || empty($response)) {
    http_response_code(502);
    echo json_encode(['error' => 'Impossible de contacter Open-Meteo depuis Jeedom']);
    exit;
}

echo $response;
