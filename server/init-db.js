const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function init() {
    console.log('--- Iniciando Configuração do Banco de Dados ---');
    
    // Conecta sem selecionar banco primeiro
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || ''
    });

    try {
        console.log('1. Criando banco de dados sistema_gestao...');
        await connection.query('CREATE DATABASE IF NOT EXISTS sistema_gestao;');
        await connection.query('USE sistema_gestao;');
        
        console.log('2. Lendo arquivo schema.sql...');
        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        
        // Divide o SQL por ponto e vírgula para executar cada comando
        const commands = sql.split(';').filter(cmd => cmd.trim() !== '');
        
        console.log('3. Executando comandos SQL...');
        for (let cmd of commands) {
            await connection.query(cmd);
        }
        
        console.log('\n✅ SUCESSO: Banco de dados configurado com sucesso!');
        console.log('Agora você já pode iniciar o servidor com: node server.js');

    } catch (error) {
        console.error('\n❌ ERRO ao configurar banco:', error.message);
        console.log('\nCERTIFIQUE-SE DE QUE O SEU XAMPP (MYSQL) ESTÁ LIGADO!');
    } finally {
        await connection.end();
    }
}

init();
