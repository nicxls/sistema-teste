require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const db = require('./server/db');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    path: '/socket.io',
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// Servir arquivos de upload
app.use('/uploads', express.static(path.join(__dirname, 'server/uploads')));

// Socket.io Notificação
const notifyUpdate = () => io.emit('data-updated');

// ==========================================
// ROTAS MODULARIZADAS
// ==========================================
const authRoutes = require('./server/routes/auth');
const empresasRoutes = require('./server/routes/empresas');
const contratosRoutes = require('./server/routes/contratos');
const adminRoutes = require('./server/routes/admin');
const authenticateToken = require('./server/middlewares/auth');

// Rotas Públicas
app.use('/api', authRoutes);

// Solicitar Acesso (Rota Pública Especial)
app.post('/api/acessos', async (req, res) => {
    let { usuario, email, senha } = req.body;
    try {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(senha, salt);
        await db.execute(
            'INSERT INTO solicitacoes_acesso (usuario, email, senha) VALUES (?, ?, ?)',
            [usuario.trim(), email, hash]
        );
        notifyUpdate();
        res.json({ success: true, message: 'Solicitação enviada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rotas Protegidas (JWT Required)
app.use('/api/empresas', authenticateToken, empresasRoutes);
app.use('/api/contratos', authenticateToken, contratosRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Rotas de Postos/Escolas (Modularizar se necessário)
app.get('/api/postos', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM escolas_alocadas');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/postos', authenticateToken, async (req, res) => {
    const { contrato_id, municipio, nome, valor, carga_horaria, implantados, vagos } = req.body;
    try {
        await db.execute(
            `INSERT INTO escolas_alocadas (contrato_id, municipio, nome, valor, carga_horaria, implantados, vagos) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [contrato_id, municipio, nome, valor, carga_horaria, implantados || 0, vagos || 0]
        );
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/postos/:id', authenticateToken, async (req, res) => {
    try {
        await db.execute('DELETE FROM escolas_alocadas WHERE id = ?', [req.params.id]);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rotas de Faturamentos
app.get('/api/faturamentos', authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM faturamentos');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/faturamentos', authenticateToken, async (req, res) => {
    const { ano, contrato_id, dados } = req.body;
    try {
        await db.execute(
            'INSERT INTO faturamentos (ano, contrato_id, dados) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE dados = VALUES(dados)',
            [ano, contrato_id, JSON.stringify(dados)]
        );
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Redirecionamento Fallback (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicia o Servidor
server.listen(PORT, () => {
    console.log(`Servidor GestCon DSE rodando na porta ${PORT}`);
});
