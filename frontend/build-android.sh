#!/bin/bash
# Build script for Android app
# Usage: ./build-android.sh [dev|prod]

set -e

MODE="${1:-prod}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  CulturiaQuests - Android Build       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

if [ "$MODE" = "dev" ]; then
    echo -e "${YELLOW}[1/3] Building in DEVELOPMENT mode...${NC}"
    npm run build
else
    echo -e "${YELLOW}[1/3] Building in PRODUCTION mode...${NC}"
    npm run generate
fi
echo -e "${GREEN}  ✓ Build completed${NC}"

echo -e "${YELLOW}[2/3] Syncing with Capacitor...${NC}"
npx cap sync android
echo -e "${GREEN}  ✓ Sync completed${NC}"

echo -e "${YELLOW}[3/3] Opening Android Studio...${NC}"
npx cap open android || echo -e "${YELLOW}  ⚠ Android Studio not installed - skip this step${NC}"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Build process completed!              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

if command -v npx &> /dev/null && ! command -v android-studio &> /dev/null; then
    echo -e "${CYAN}To build the Play Store bundle (AAB) without Android Studio:${NC}"
    echo -e "  cd android && ./gradlew bundleRelease"
    echo ""
    echo -e "${CYAN}AAB will be located at:${NC}"
    echo -e "  android/app/build/outputs/bundle/release/app-release.aab"
    echo -e "  ${YELLOW}(signé si android/keystore.properties existe — cf. android/keystore.properties.example)${NC}"
    echo ""
fi
