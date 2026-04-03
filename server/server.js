const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http'); // Necessário para o Socket.IO
const { Server } = require('socket.io'); // Socket.IO
require('dotenv').config();
const db = require('./db');

const app = express();
const server = http.createServer(app); // Criar servidor HTTP para o Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", // Permite conexões de qualquer origem (Vercel, etc)
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Função helper para notificar todos os clientes via WebSocket
const notifyUpdate = () => {
    io.emit('data-updated');
};

// ==========================================
// AUTHENTICATION & USERS
// ==========================================

// Login
app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body;
    try {
        const [rows] = await db.execute(
            'SELECT usuario, role FROM usuarios WHERE usuario = ? AND senha = ?',
            [usuario, senha]
        );
        if (rows.length > 0) {
            res.json({ success: true, user: rows[0] });
        } else {
            res.status(401).json({ success: false, message: 'Usuário ou senha inválidos' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verificar se usuário ainda existe (sessão ativa)
app.get('/api/auth/verify', async (req, res) => {
    const { usuario } = req.query;
    try {
        const [rows] = await db.execute('SELECT usuario, role FROM usuarios WHERE usuario = ?', [usuario]);
        if (rows.length > 0) {
            res.json({ success: true, user: rows[0] });
        } else {
            res.status(401).json({ success: false, message: 'Usuário não encontrado ou removido.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Solicitar Acesso
app.post('/api/acessos', async (req, res) => {
    let { usuario, email, senha } = req.body;
    usuario = usuario.trim();
    
    try {
        const [existingUser] = await db.execute('SELECT id FROM usuarios WHERE TRIM(usuario) = ?', [usuario]);
        if (existingUser.length > 0) {
            return res.status(409).json({ message: 'Usuário já cadastrado.' });
        }

        const [existingReq] = await db.execute('SELECT id, status FROM solicitacoes_acesso WHERE TRIM(usuario) = ?', [usuario]);
        if (existingReq.length > 0) {
            return res.status(409).json({ message: 'Usuário já cadastrado.' });
        }

        await db.execute(
            'INSERT INTO solicitacoes_acesso (usuario, email, senha) VALUES (?, ?, ?)',
            [usuario, email, senha]
        );
        notifyUpdate(); // Notifica admins que há nova solicitação
        res.json({ success: true, message: 'Solicitação enviada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Listar Solicitações Pendentes e Admins
app.get('/api/admin/acessos', async (req, res) => {
    try {
        const [reqs] = await db.execute('SELECT * FROM solicitacoes_acesso WHERE status = "pendente"');
        const [users] = await db.execute('SELECT usuario as user, role FROM usuarios WHERE role != "master"');
        res.json({ solicitacoes: reqs, usuarios: users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Decidir Solicitação
app.post('/api/admin/acessos/:id/decide', async (req, res) => {
    const { id } = req.params;
    const { acao, role } = req.body;
    try {
        if (acao === 'aceitar') {
            const [rows] = await db.execute('SELECT * FROM solicitacoes_acesso WHERE id = ?', [id]);
            if (rows.length > 0) {
                const reqData = rows[0];
                const finalRole = role || 'usuario';
                await db.execute(
                    'INSERT INTO usuarios (usuario, senha, role) VALUES (?, ?, ?)',
                    [reqData.usuario, reqData.senha, finalRole]
                );
                await db.execute('UPDATE solicitacoes_acesso SET status = "aprovado" WHERE id = ?', [id]);
            }
        } else {
            await db.execute('UPDATE solicitacoes_acesso SET status = "recusado" WHERE id = ?', [id]);
        }
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trocar Perfil de Usuário
app.put('/api/admin/usuarios/:usuario/role', async (req, res) => {
    const { usuario } = req.params;
    const { role } = req.body;
    try {
        await db.execute('UPDATE usuarios SET role = ? WHERE usuario = ? AND role != "master"', [role, usuario]);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remover Usuário
app.delete('/api/admin/usuarios/:usuario', async (req, res) => {
    const { usuario } = req.params;
    try {
        await db.execute('DELETE FROM usuarios WHERE usuario = ? AND role != "master"', [usuario]);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// EMPRESAS
// ==========================================

app.get('/api/empresas', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM empresas ORDER BY razao ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/empresas', async (req, res) => {
    const { razao, cnpj, email, telefone } = req.body;
    try {
        const [result] = await db.execute(
            'INSERT INTO empresas (razao, cnpj, email, telefone) VALUES (?, ?, ?, ?)',
            [razao, cnpj, email, telefone]
        );
        notifyUpdate();
        res.json({ id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Este CNPJ já está cadastrado para outra empresa.' });
        }
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/empresas/:id', async (req, res) => {
    const { id } = req.params;
    const { razao, cnpj, email, telefone } = req.body;
    try {
        await db.execute(
            'UPDATE empresas SET razao = ?, cnpj = ?, email = ?, telefone = ? WHERE id = ?',
            [razao, cnpj, email, telefone, id]
        );
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Este CNPJ já está sendo usado por outra empresa.' });
        }
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/empresas/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM empresas WHERE id = ?', [id]);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// CONTRATOS
// ==========================================

app.get('/api/contratos', async (req, res) => {
    const { system } = req.query;
    try {
        let query = 'SELECT * FROM contratos';
        let params = [];
        if (system === 'transporte') {
            query += ' WHERE tipo = "Transporte Escolar"';
        } else if (system === 'mao-de-obra') {
            query += ' WHERE tipo IN ("Merendeiras", "Limpeza", "Vigilância", "Porteiros")';
        }
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/contratos', async (req, res) => {
    const data = req.body;
    try {
        const [result] = await db.execute(
            `INSERT INTO contratos (
                numero, proa, lote, cre, tipo, empresa_id, periodo_inicial, periodo_final, 
                situacao, gestor, alunos, municipio, valor_diario, valor_km, km, valor_mensal, postos
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, 
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null
            ]
        );
        notifyUpdate();
        res.json({ id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/contratos/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await db.execute(
            `UPDATE contratos SET 
                numero=?, proa=?, lote=?, cre=?, tipo=?, empresa_id=?, periodo_inicial=?, 
                periodo_final=?, situacao=?, gestor=?, alunos=?, municipio=?, valor_diario=?, 
                valor_km=?, km=?, valor_mensal=?, postos=? 
            WHERE id = ?`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, 
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null, id
            ]
        );
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/contratos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM contratos WHERE id = ?', [id]);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// POSTOS / ESCOLAS (LOTAÇÕES)
// ==========================================

app.get('/api/postos', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM escolas_alocadas');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/postos/save', async (req, res) => {
    const { contratoId, escolas } = req.body;
    try {
        await db.execute('DELETE FROM escolas_alocadas WHERE contrato_id = ?', [contratoId]);
        for (const esc of escolas) {
            await db.execute(
                `INSERT INTO escolas_alocadas (contrato_id, municipio, nome, valor, carga_horaria, implantados, vagos) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [contratoId, esc.municipio, esc.nome, esc.valor, esc.carga_horaria, esc.implantados, esc.vagos]
            );
        }
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Iniciar servidor usando o objeto 'server' que inclui o Socket.IO
server.listen(PORT, () => {
    console.log(`Servidor rodando em tempo real na porta ${PORT}`);
});
