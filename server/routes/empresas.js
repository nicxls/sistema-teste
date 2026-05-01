const express = require('express');
const router = express.Router();
const db = require('../db');

// Listar Empresas
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM empresas');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Criar Empresa
router.post('/', async (req, res) => {
    const { razao, cnpj, email, telefone, modulo } = req.body;
    try {
        const [result] = await db.execute(
            'INSERT INTO empresas (razao, cnpj, email, telefone, modulo) VALUES (?, ?, ?, ?, ?)',
            [razao, cnpj, email, telefone, modulo || 'mao-de-obra']
        );
        res.json({ id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar Empresa
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { razao, cnpj, email, telefone, modulo } = req.body;
    try {
        await db.execute(
            'UPDATE empresas SET razao = ?, cnpj = ?, email = ?, telefone = ?, modulo = ? WHERE id = ?',
            [razao, cnpj, email, telefone, modulo, id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar Empresa (com proteção de Master)
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const userRole = req.user.role; // Vem do token JWT agora

    try {
        if (userRole === 'master') {
            await db.execute('DELETE FROM empresas WHERE id = ?', [id]);
            res.json({ success: true });
        } else {
            // Cria solicitação de exclusão para o master
            const [emp] = await db.execute('SELECT razao FROM empresas WHERE id = ?', [id]);
            const nome = emp[0]?.razao || id;
            
            await db.execute(
                'INSERT INTO solicitacoes_exclusao (tabela, registro_id, motivo, solicitante) VALUES (?, ?, ?, ?)',
                ['empresas', id, `Exclusão da empresa ${nome}`, req.user.usuario]
            );
            res.json({ requested: true, message: 'Solicitação de exclusão enviada ao Master.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
