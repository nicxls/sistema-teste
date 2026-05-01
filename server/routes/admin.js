const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// Listar Solicitações e Usuários
router.get('/acessos', async (req, res) => {
    try {
        const [reqs] = await db.execute('SELECT * FROM solicitacoes_acesso WHERE status = "pendente"');
        const [users] = await db.execute('SELECT id, usuario as user, role FROM usuarios WHERE role != "master"');
        const [excl] = await db.execute('SELECT * FROM solicitacoes_exclusao WHERE status = "pendente"');
        res.json({ solicitacoes: reqs, usuarios: users, exclusoes: excl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Decidir Solicitação de Acesso
router.post('/acessos/:id/decide', async (req, res) => {
    const { id } = req.params;
    const { acao, role } = req.body;
    try {
        if (acao === 'aceitar') {
            const [rows] = await db.execute('SELECT * FROM solicitacoes_acesso WHERE id = ?', [id]);
            if (rows.length > 0) {
                const reqData = rows[0];
                await db.execute(
                    'INSERT INTO usuarios (usuario, senha, role) VALUES (?, ?, ?)',
                    [reqData.usuario, reqData.senha, role || 'usuario']
                );
                await db.execute('UPDATE solicitacoes_acesso SET status = "aprovado" WHERE id = ?', [id]);
            }
        } else {
            await db.execute('UPDATE solicitacoes_acesso SET status = "recusado" WHERE id = ?', [id]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Resetar Senha (Admin)
router.put('/reset-password', async (req, res) => {
    const { id, novaSenha } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(novaSenha, salt);
        await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, id]);
        res.json({ message: 'Senha resetada com sucesso!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
