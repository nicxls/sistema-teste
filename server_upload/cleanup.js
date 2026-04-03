const mysql = require('mysql2/promise');
require('dotenv').config();

async function runCleanup() {
    console.log('--- Iniciando Limpeza Manual via Script ---');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'sistema_gestao'
    });

    try {
        console.log('1. Removendo duplicatas de solicitacoes_acesso...');
        const [delResult] = await connection.execute(`
            DELETE s1 FROM solicitacoes_acesso s1
            INNER JOIN solicitacoes_acesso s2 
            WHERE s1.id < s2.id AND s1.usuario = s2.usuario
        `);
        console.log(`Sucesso: ${delResult.affectedRows} registros removidos.`);

        console.log('2. Adicionando restrição UNIQUE...');
        try {
            await connection.execute('ALTER TABLE solicitacoes_acesso ADD UNIQUE (usuario)');
            console.log('Sucesso: Restrição UNIQUE adicionada.');
        } catch (e) {
            console.log('Aviso: Restrição UNIQUE já existia ou não pôde ser aplicada.');
        }

    } catch (error) {
        console.error('Erro na limpeza:', error.message);
    } finally {
        await connection.end();
        console.log('--- Fim da Limpeza ---');
    }
}

runCleanup();
