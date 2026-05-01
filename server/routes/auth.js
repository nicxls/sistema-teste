const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const authenticateToken = require('../middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'chave-secreta-padrao-gestcondse';

// Login
router.post('/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const [rows] = await db.execute(
            'SELECT id, usuario, senha, role FROM usuarios WHERE usuario = ?',
            [usuario]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos' });
        }

        const user = rows[0];
        let isValid = false;

        if (user.senha.startsWith('$2a$') || user.senha.startsWith('$2b$')) {
            isValid = await bcrypt.compare(senha, user.senha);
        } else {
            if (senha === user.senha) {
                isValid = true;
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(senha, salt);
                await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [hash, user.id]);
            }
        }

        if (isValid) {
            const token = jwt.sign(
                { id: user.id, usuario: user.usuario, role: user.role },
                JWT_SECRET,
                { expiresIn: '12h' }
            );

            res.json({ 
                success: true, 
                token, 
                user: { usuario: user.usuario, role: user.role } 
            });
        } else {
            res.status(401).json({ success: false, message: 'Usuário ou senha inválidos' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verificar Sessão
router.get('/verify', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT usuario, role FROM usuarios WHERE id = ?', [req.user.id]);
        if (rows.length > 0) {
            res.json({ success: true, user: rows[0] });
        } else {
            res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
