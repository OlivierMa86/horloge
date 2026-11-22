# Horloge iPad — Basse Consommation (PWA)

Application Web Progressive (PWA) d'horloge permanente ultra basse consommation conçue pour **iPad 8** et tous les modèles suivants.

## Accès direct sur iPad (GitHub Pages)
Une fois GitHub Pages activé sur ce dépôt, ouvrez sur votre iPad dans **Safari** :
👉 **https://olivierma86.github.io/Horloge/**

Puis touchez **Partager** → **Sur l'écran d'accueil** pour l'installer comme une application plein écran.

## Fonctionnalités
- **6 styles d'horloges** : Digitale Géante, Flip Rétro, Gare Suisse (CFF), En Lettres (Français), LED / Nixie, Anneaux concentriques.
- **Mode Ultra-Éco (1/min)** : Masque les secondes et ne rafraîchit l'écran qu'une seule fois par minute.
- **Mode Nuit Auto (22h–07h)** : Bascule automatiquement en rouge sombre (15 %) la nuit.
- **Anti-veille** : Screen Wake Lock API + fallback audio silencieux.
- **Protection d'écran (Pixel Shifting)** : Léger décalage circulaire chaque minute.
- **100 % Hors-ligne** grâce au Service Worker (`sw.js`).
