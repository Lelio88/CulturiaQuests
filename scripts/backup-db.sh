#!/bin/bash

# Configuration
CONTAINER_NAME="${PG_CONTAINER:-postgres_db}"
DB_USER="strapi"
DB_NAME="strapi"
BACKUP_DIR="$(dirname "$0")/../backups"
UPLOADS_DIR="$(dirname "$0")/../backend/public/uploads"

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Créer le dossier de backup s'il n'existe pas
mkdir -p "$BACKUP_DIR"

# Vérifier que le conteneur PostgreSQL est en cours d'exécution
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}Erreur: Le conteneur ${CONTAINER_NAME} n'est pas en cours d'exécution.${NC}"
    echo "Lance d'abord: docker-compose up -d database"
    exit 1
fi

# Générer le nom des fichiers avec timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TEMP_DIR="$BACKUP_DIR/temp_$TIMESTAMP"
SQL_FILE="database.sql"
ARCHIVE_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Backup Complet (DB + Uploads)         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Créer un dossier temporaire
mkdir -p "$TEMP_DIR"

# 1. Backup de la base de données
echo -e "${YELLOW}[1/3] Sauvegarde de la base de données...${NC}"
if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" > "$TEMP_DIR/$SQL_FILE" 2>/dev/null; then
    if [ -s "$TEMP_DIR/$SQL_FILE" ]; then
        SQL_SIZE=$(du -h "$TEMP_DIR/$SQL_FILE" | cut -f1)
        echo -e "${GREEN}      ✓ Base de données sauvegardée ($SQL_SIZE)${NC}"
    else
        echo -e "${RED}      ✗ Erreur: Le fichier SQL est vide${NC}"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
else
    echo -e "${RED}      ✗ Erreur lors du dump PostgreSQL${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# 2. Backup des fichiers uploadés
echo -e "${YELLOW}[2/3] Sauvegarde des fichiers uploadés...${NC}"
if [ -d "$UPLOADS_DIR" ]; then
    UPLOAD_COUNT=$(find "$UPLOADS_DIR" -type f 2>/dev/null | wc -l)
    if [ "$UPLOAD_COUNT" -gt 0 ]; then
        cp -r "$UPLOADS_DIR" "$TEMP_DIR/uploads"
        UPLOADS_SIZE=$(du -sh "$TEMP_DIR/uploads" | cut -f1)
        echo -e "${GREEN}      ✓ $UPLOAD_COUNT fichier(s) uploadé(s) sauvegardé(s) ($UPLOADS_SIZE)${NC}"
    else
        echo -e "${YELLOW}      ⚠ Aucun fichier uploadé trouvé${NC}"
        mkdir -p "$TEMP_DIR/uploads"
    fi
else
    echo -e "${YELLOW}      ⚠ Dossier uploads introuvable, création d'un dossier vide${NC}"
    mkdir -p "$TEMP_DIR/uploads"
fi

# 3. Création de l'archive compressée
echo -e "${YELLOW}[3/3] Création de l'archive compressée...${NC}"
if tar -czf "$ARCHIVE_FILE" -C "$TEMP_DIR" . 2>/dev/null; then
    ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)
    echo -e "${GREEN}      ✓ Archive créée avec succès${NC}"

    # Nettoyage
    rm -rf "$TEMP_DIR"

    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  Backup terminé avec succès!           ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  📦 Fichier: ${CYAN}$(basename "$ARCHIVE_FILE")${NC}"
    echo -e "  📊 Taille:  ${CYAN}$ARCHIVE_SIZE${NC}"
    echo -e "  📁 Chemin:  ${CYAN}$ARCHIVE_FILE${NC}"

    # Afficher le nombre de backups existants
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null | wc -l)
    echo -e "  🗂️  Total:   ${CYAN}$BACKUP_COUNT backup(s)${NC}"
    echo ""
else
    echo -e "${RED}      ✗ Erreur lors de la création de l'archive${NC}"
    rm -rf "$TEMP_DIR"
    rm -f "$ARCHIVE_FILE"
    exit 1
fi
