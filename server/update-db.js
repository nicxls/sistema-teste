const db = require('./db');

async function updateSchema() {
    console.log('--- Verificando e Atualizando Schema do Banco de Dados ---');
    
    try {
        // Verifica se a coluna 'modalidade' existe na tabela 'contratos'
        const [columns] = await db.execute('SHOW COLUMNS FROM contratos');
        const columnNames = columns.map(c => c.Field);

        if (!columnNames.includes('modalidade')) {
            console.log('Adicionando coluna "modalidade" à tabela contratos...');
            await db.execute('ALTER TABLE contratos ADD COLUMN modalidade VARCHAR(50) AFTER tipo');
        } else {
            console.log('Coluna "modalidade" já existe.');
        }

        if (!columnNames.includes('anexos')) {
            console.log('Adicionando coluna "anexos" à tabela contratos...');
            await db.execute('ALTER TABLE contratos ADD COLUMN anexos LONGTEXT');
        } else {
            console.log('Coluna "anexos" já existe.');
        }

        console.log('✅ Banco de dados verificado com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('❌ ERRO ao atualizar banco:', error.message);
        process.exit(1);
    }
}

updateSchema();
