#!/bin/bash
# ============================================================
# CulturiaQuests - Build de l'AAB Android (Google Play)
# ============================================================
# Génère le bundle signé qui pointe vers la prod déployée (option A :
# l'app mobile est une webview du serveur Nuxt déployé).
#
# Prérequis :
#   - JDK 17+ et Android SDK (Android Studio les fournit)
#   - frontend/android/keystore.properties configuré (sinon AAB NON signé)
#     -> cf. android/keystore.properties.example
#
# Usage (depuis frontend/) :
#   ./build-aab.sh
#   CAP_SERVER_URL=https://autre.domaine ./build-aab.sh   # pour surcharger l'URL
# ============================================================
set -e
cd "$(dirname "$0")"

# URL de la prod déployée — injectée dans server.url par capacitor.config.ts.
export CAP_SERVER_URL="${CAP_SERVER_URL:-https://culturia.heianenterprise.com}"

echo "→ [1/3] Build web (Nuxt) — cible mobile : $CAP_SERVER_URL"
npm run generate

echo "→ [2/3] Sync Capacitor (injecte server.url dans le projet Android)"
npx cap sync android

echo "→ [3/3] Build de l'AAB (bundleRelease)"
cd android
./gradlew bundleRelease

AAB="app/build/outputs/bundle/release/app-release.aab"
echo ""
if [ -f "$AAB" ]; then
  echo "✅ AAB généré : frontend/android/$AAB"
  if [ -f keystore.properties ]; then
    echo "   (signé — keystore.properties présent)"
  else
    echo "   ⚠️  NON signé (pas de keystore.properties) — cf. android/keystore.properties.example"
  fi
  echo ""
  echo "   Prochaine étape : uploader l'AAB dans la Google Play Console"
  echo "   (pense à incrémenter versionCode dans android/app/build.gradle avant chaque upload)."
else
  echo "❌ AAB introuvable — vérifie la sortie de gradlew ci-dessus."
  exit 1
fi
