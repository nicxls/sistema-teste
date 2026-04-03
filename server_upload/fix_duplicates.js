const mysql = require('mysql2/promise');
require('dotenv').config({ path: './server/.env' });

async function fixDuplicates() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME
    });

    try {
        console.log('Iniciando limpeza de duplicatas...');
        
        // Deleta duplicatas mantendo apenas o ID mais recente
        const [result] = await connection.execute(`
            DELETE s1 FROM solicitacoes_acesso s1
            INNER JOIN solicitacoes_acesso s2 
            WHERE s1.id < s2.id 
            AND s1.usuario = s2.usuario
            AND s1.status = 'pendente'
        `);
        
        console.log(`Sucesso! ${result.affectedRows} registros duplicados removidos.`);
        
        // Adiciona a restrição UNIQUE na tabela (correção no banco ativo)
        console.log('Adicionando restrição UNIQUE na tabela solicitacoes_acesso...');
        await connection.execute('ALTER TABLE solicitacoes_acesso ADD UNIQUE (usuario)');
        console.log('Restrição UNIQUE adicionada com sucesso!');

    } catch (error) {
        console.error('Erro durante a limpeza:', error.message);
    } finally {
        await connection.end();
    }
}

fixDuplicates();
