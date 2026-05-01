const bcrypt = require('bcryptjs');
const db = require('./db');

async function migratePasswords() {
    try {
        console.log('Iniciando migração de senhas...');
        const [users] = await db.execute('SELECT id, usuario, senha FROM usuarios');
        let count = 0;

        for (let user of users) {
            // Se a senha não começar com $2a$ (ou $2b$), provavelmente não é um hash do bcrypt
            if (!user.senha.startsWith('$2a$') && !user.senha.startsWith('$2b$')) {
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(user.senha, salt);
                
                await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, user.id]);
                console.log(`Senha do usuário ${user.usuario} encriptada com sucesso.`);
                count++;
            }
        }
        
        console.log(`Migração concluída! ${count} senhas foram encriptadas.`);
        process.exit(0);
    } catch (error) {
        console.error('Erro ao migrar senhas:', error);
        process.exit(1);
    }
}

migratePasswords();
