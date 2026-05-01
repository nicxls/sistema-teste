#!/bin/bash

# Configurações
DB_USER="dse_admin"
DB_PASS="Senhadb@123"
DB_NAME="sistema_gestao"
BACKUP_DIR="/root/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="backup_${DB_NAME}_${DATE}.sql"

# Cria diretório de backup se não existir
mkdir -p $BACKUP_DIR

# Executa o dump
echo "Iniciando backup do banco $DB_NAME..."
mysqldump -u$DB_USER -p$DB_PASS $DB_NAME > $BACKUP_DIR/$FILENAME

# Compacta o backup
gzip $BACKUP_DIR/$FILENAME

# Remove backups com mais de 7 dias para economizar espaço
find $BACKUP_DIR -type f -name "*.sql.gz" -mtime +7 -delete

echo "Backup concluído com sucesso: $BACKUP_DIR/$FILENAME.gz"
