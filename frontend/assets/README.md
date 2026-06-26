# Assets source `@capacitor/assets`

Fichiers source de l'icône et du splash de l'app mobile (le vrai logo CulturiaQuests : monogramme « CQ » sur fond pixel-art indigo).

- `icon-only.png` — icône pleine (logo + fond), 1024×1024
- `icon-foreground.png` — couche avant de l'icône adaptative (logo sur transparent)
- `icon-background.png` — couche arrière de l'icône adaptative (fond indigo)
- `splash.png` — écran de démarrage

## Régénérer les assets Android (mipmaps + icône adaptative + splash)

```bash
cd frontend
npx capacitor-assets generate --android
```

La sortie est écrite dans `frontend/android/app/src/main/res/` (mipmaps `ic_launcher*`, `mipmap-anydpi-v26/*`, `drawable-*/splash.png`). Les icônes adaptatives référencent `@mipmap/ic_launcher_foreground` + `@mipmap/ic_launcher_background` (pas les anciens drawables vectoriels du template Capacitor, supprimés car non référencés).
