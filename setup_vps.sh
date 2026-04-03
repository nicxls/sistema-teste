#!/bin/bash
echo "Starting VPS Setup..."

# Install unzip
apt update && apt install unzip -y

# Extract uploaded server bundle
unzip -o server_upload.zip -d /root/server
cd /root/server

# Install node dependencies
npm install

# Setup MySQL
mysql -e "CREATE DATABASE IF NOT EXISTS sistema_gestao;"
mysql -e "CREATE USER IF NOT EXISTS 'dse_admin'@'localhost' IDENTIFIED WITH mysql_native_password BY 'Senhadb@123';"
mysql -e "GRANT ALL PRIVILEGES ON sistema_gestao.* TO 'dse_admin'@'localhost'; FLUSH PRIVILEGES;"
mysql -u root sistema_gestao < dump.sql

# Update env vars
sed -i 's/DB_USER=root/DB_USER=dse_admin/g' .env
sed -i 's/DB_PASS=/DB_PASS=Senhadb@123/g' .env

# Start PM2
pm2 start server.js --name dse-api
pm2 save -f
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root

echo "VPS Setup Complete!"
