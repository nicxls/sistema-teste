const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const path = require('path');
const db = require('./db');

// Auto-Migration: Garante que a coluna anexos exista
(async () => {
    try {
        const [columns] = await db.execute('SHOW COLUMNS FROM contratos LIKE "anexos"');
        if (columns.length === 0) {
            await db.execute('ALTER TABLE contratos ADD COLUMN anexos LONGTEXT');
            console.log('Coluna "anexos" adicionada à tabela "contratos".');
        }

        // Migration: Tabela lotes_indenizatorios
        await db.execute(`
            CREATE TABLE IF NOT EXISTS lotes_indenizatorios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lote VARCHAR(255),
                cre VARCHAR(255),
                empresa_id INT,
                alunos INT DEFAULT 0,
                geo VARCHAR(255),
                valor_km DECIMAL(10,2) DEFAULT 0,
                km DECIMAL(10,2) DEFAULT 0,
                valor_diario DECIMAL(10,2) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Tabela logs_auditoria
        await db.execute(`
            CREATE TABLE IF NOT EXISTS logs_auditoria (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario VARCHAR(255),
                acao VARCHAR(50),
                modulo VARCHAR(50),
                detalhes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: Tabela faturamentos
        await db.execute(`
            CREATE TABLE IF NOT EXISTS faturamentos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                contrato_id INT NOT NULL,
                ano VARCHAR(4) NOT NULL,
                dados LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_faturamento (contrato_id, ano)
            )
        `);

        // Migration: Tabela aditivos
        await db.execute(`
            CREATE TABLE IF NOT EXISTS aditivos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                contrato_id INT NOT NULL,
                numero VARCHAR(50),
                tipo VARCHAR(50),
                data_assinatura DATE,
                vigencia_inicio DATE,
                vigencia_fim DATE,
                novo_valor DECIMAL(15,2),
                anexo_b64 LONGTEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        console.error('Erro na migração:', err);
    }
})();

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
app.use(bodyParser.json({ limit: '10mb' })); // Aumentar limite para Base64 de PDFs
app.use(express.static(path.join(__dirname, '..')));

// Rota para servir o frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Função helper para notificar todos os clientes via WebSocket
const notifyUpdate = () => {
    io.emit('data-updated');
};

// Função helper para gravar logs de auditoria
const registrarLog = async (usuario, acao, modulo, detalhes) => {
    try {
        const usr = usuario || 'Sistema'; // Fallback
        await db.execute(
            'INSERT INTO logs_auditoria (usuario, acao, modulo, detalhes) VALUES (?, ?, ?, ?)',
            [usr, acao, modulo, detalhes]
        );
    } catch (error) {
        console.error('Erro ao salvar log de auditoria:', error);
    }
};

// ==========================================
// LOGS DE AUDITORIA
// ==========================================
app.get('/api/logs', async (req, res) => {
    try {
        // Ordenado do mais recente para o mais antigo, limite 500 para evitar travamento
        const [rows] = await db.execute('SELECT * FROM logs_auditoria ORDER BY created_at DESC LIMIT 500');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// FATURAMENTOS APIs
// ==========================================

app.get('/api/faturamentos/:contratoId/:ano', async (req, res) => {
    try {
        const { contratoId, ano } = req.params;
        const [rows] = await db.execute('SELECT dados FROM faturamentos WHERE contrato_id = ? AND ano = ?', [contratoId, ano]);
        if (rows.length > 0) {
            res.json(JSON.parse(rows[0].dados));
        } else {
            res.json(Array(12).fill({}));
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/faturamentos/:contratoId/:ano', async (req, res) => {
    try {
        const { contratoId, ano } = req.params;
        const { dados, username } = req.body;
        const dadosStr = JSON.stringify(dados);
        
        await db.execute(
            `INSERT INTO faturamentos (contrato_id, ano, dados) VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE dados = ?`,
            [contratoId, ano, dadosStr, dadosStr]
        );
        
        await registrarLog(username, 'Edição', 'Faturamentos', `Atualização de faturamentos do contrato ID ${contratoId} - Ano ${ano}`);
        notifyUpdate();
        res.json({ message: 'Faturamentos salvos com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ADITIVOS APIs
// ==========================================

app.get('/api/aditivos/:contratoId', async (req, res) => {
    try {
        const { contratoId } = req.params;
        const [rows] = await db.execute('SELECT * FROM aditivos WHERE contrato_id = ? ORDER BY data_assinatura ASC, id ASC', [contratoId]);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/aditivos/:contratoId', async (req, res) => {
    try {
        const { contratoId } = req.params;
        const { numero, tipo, data_assinatura, vigencia_inicio, vigencia_fim, novo_valor, anexo_b64, username } = req.body;
        
        await db.execute(
            `INSERT INTO aditivos 
             (contrato_id, numero, tipo, data_assinatura, vigencia_inicio, vigencia_fim, novo_valor, anexo_b64) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                contratoId, numero, tipo, data_assinatura, 
                vigencia_inicio || null, vigencia_fim || null, 
                novo_valor || null, anexo_b64 || null
            ]
        );
        
        await registrarLog(username, 'Criação', 'Aditivos', `Novo aditivo (${numero}) do tipo ${tipo} adicionado ao contrato ID ${contratoId}`);
        notifyUpdate();
        res.json({ message: 'Aditivo criado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/aditivos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const username = req.query.username;
        await db.execute('DELETE FROM aditivos WHERE id = ?', [id]);
        await registrarLog(username, 'Exclusão', 'Aditivos', `Exclusão do aditivo ID ${id}`);
        notifyUpdate();
        res.json({ message: 'Aditivo removido com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// AUTHENTICATION & USERS
// ==========================================

// --- AUTHENTICATION ROUTES ---

// Change Password (Logged User)
app.post('/api/auth/change-password', async (req, res) => {
    const { usuario, senhaAtual, novaSenha } = req.body;
    try {
        const [users] = await db.execute('SELECT * FROM usuarios WHERE usuario = ? AND senha = ?', [usuario, senhaAtual]);
        if (users.length === 0) return res.status(401).json({ error: 'Senha atual incorreta' });
        
        await db.execute('UPDATE usuarios SET senha = ? WHERE usuario = ?', [novaSenha, usuario]);
        res.json({ message: 'Senha alterada com sucesso!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Forgot Password Request (Creates a "Reset Request")
app.post('/api/auth/forgot-password', async (req, res) => {
    const { usuario, email } = req.body;
    try {
        // Find user first
        const [users] = await db.execute('SELECT * FROM usuarios WHERE usuario = ? AND email = ?', [usuario, email]);
        if (users.length === 0) return res.status(404).json({ error: 'Usuário ou e-box não encontrados' });
        
        // Create request in 'acessos' with status 'reset_pendente'
        await db.execute('INSERT INTO acessos (usuario, email, senha, perfil, status) VALUES (?, ?, ?, ?, ?)', 
            [usuario, email, 'SOLICITACA_RESET', users[0].perfil, 'reset_pendente']);
        
        notifyUpdate();
        res.json({ message: 'Solicitação enviada! O Administrador irá resetar sua senha em breve.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin Reset Password
app.put('/api/admin/reset-password', async (req, res) => {
    const { id, novaSenha, solicitacaoId } = req.body;
    try {
        const [users] = await db.execute('SELECT * FROM usuarios WHERE id = ?', [id]);
        if (users.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
        
        await db.execute('UPDATE usuarios SET senha = ? WHERE id = ?', [novaSenha, id]);
        
        // Remove or update the request if exists
        if (solicitacaoId) {
            await db.execute('DELETE FROM acessos WHERE id = ?', [solicitacaoId]);
        }
        
        notifyUpdate();
        res.json({ message: 'Senha resetada pelo Administrador com sucesso!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
    const { razao, cnpj, email, telefone, userRole, username } = req.body;
    try {
        const [result] = await db.execute(
            'INSERT INTO empresas (razao, cnpj, email, telefone) VALUES (?, ?, ?, ?)',
            [razao, cnpj, email, telefone]
        );
        registrarLog(username, 'CRIAR', 'Empresas', `Nova empresa: ${razao} (${cnpj})`);
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
    const { razao, cnpj, email, telefone, userRole, username } = req.body;
    
    // Proteção básica no backend
    if (userRole === 'usuario') {
        return res.status(403).json({ error: 'Acesso negado. Usuários não podem editar empresas.' });
    }
    
    try {
        await db.execute(
            'UPDATE empresas SET razao = ?, cnpj = ?, email = ?, telefone = ? WHERE id = ?',
            [razao, cnpj, email, telefone, id]
        );
        registrarLog(username, 'EDITAR', 'Empresas', `Empresa ID ${id} editada (${razao})`);
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
    const { userRole, username } = req.query; // Pega o role por query no delete
    
    // Proteção básica no backend
    if (userRole === 'usuario') {
        return res.status(403).json({ error: 'Acesso negado. Usuários não podem excluir empresas.' });
    }
    
    try {
        await db.execute('DELETE FROM empresas WHERE id = ?', [id]);
        registrarLog(username, 'EXCLUIR', 'Empresas', `Registro de Empresa ID ${id} foi removido`);
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
                situacao, gestor, alunos, municipio, valor_diario, valor_km, km, valor_mensal, postos, anexos
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, 
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null, JSON.stringify(data.anexos || [])
            ]
        );
        registrarLog(data.username, 'CRIAR', 'Contratos', `Novo contrato Nº ${data.numero} (${data.tipo})`);
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
                valor_km=?, km=?, valor_mensal=?, postos=?, anexos=? 
            WHERE id = ?`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, 
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null, JSON.stringify(data.anexos || []), id
            ]
        );
        registrarLog(data.username, 'EDITAR', 'Contratos', `Contrato ID ${id} atualizado`);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/contratos/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.query;
    try {
        await db.execute('DELETE FROM contratos WHERE id = ?', [id]);
        registrarLog(username, 'EXCLUIR', 'Contratos', `Contrato ID ${id} removido`);
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


// ==========================================
// LOTES INDENIZATÓRIOS
// ==========================================

app.get('/api/indenizatorios', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM lotes_indenizatorios ORDER BY created_at DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/indenizatorios', async (req, res) => {
    const data = req.body;
    try {
        await db.execute(
            `INSERT INTO lotes_indenizatorios (lote, cre, empresa_id, alunos, geo, valor_km, km, valor_diario) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.lote || null, data.cre || null, parseInt(data.empresa_id) || null, 
                parseInt(data.alunos) || 0, data.geo || null, 
                parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, parseFloat(data.valor_diario) || 0
            ]
        );
        registrarLog(data.username, 'CRIAR', 'Indenizatórios', `Lote ${data.lote} criado`);
        notifyUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/indenizatorios/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await db.execute(
            `UPDATE lotes_indenizatorios SET 
                lote=?, cre=?, empresa_id=?, alunos=?, geo=?, valor_km=?, km=?, valor_diario=?
             WHERE id=?`,
            [
                data.lote || null, data.cre || null, parseInt(data.empresa_id) || null,
                parseInt(data.alunos) || 0, data.geo || null,
                parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, parseFloat(data.valor_diario) || 0,
                id
            ]
        );
        registrarLog(data.username, 'EDITAR', 'Indenizatórios', `Lote ID ${id} atualizado`);
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

