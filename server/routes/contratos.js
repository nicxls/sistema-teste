const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuração do Multer (Reutilizando a mesma lógica)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
        cb(null, uniqueSuffix + '-' + safeName);
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Listar Contratos
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM contratos');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Criar Contrato
router.post('/', upload.array('novos_anexos'), async (req, res) => {
    const data = req.body;
    try {
        const anexosExistentes = data.anexos_existentes ? JSON.parse(data.anexos_existentes) : [];
        const novosAnexos = req.files ? req.files.map(f => ({ 
            name: f.originalname, 
            data: '/uploads/' + f.filename,
            isUrl: true 
        })) : [];
        const anexosFinal = [...anexosExistentes, ...novosAnexos];
        
        const [result] = await db.execute(
            `INSERT INTO contratos (
                numero, proa, lote, cre, tipo, modalidade, empresa_id, periodo_inicial, periodo_final, 
                situacao, gestor, alunos, municipio, valor_diario, valor_km, km, valor_mensal, postos, anexos
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, data.modalidade || null, 
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null, JSON.stringify(anexosFinal)
            ]
        );
        res.json({ id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Atualizar Contrato
router.put('/:id', upload.array('novos_anexos'), async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        const anexosExistentes = data.anexos_existentes ? JSON.parse(data.anexos_existentes) : [];
        const novosAnexos = req.files ? req.files.map(f => ({ 
            name: f.originalname, 
            data: '/uploads/' + f.filename,
            isUrl: true 
        })) : [];
        const anexosFinal = [...anexosExistentes, ...novosAnexos];

        await db.execute(
            `UPDATE contratos SET 
                numero = ?, proa = ?, lote = ?, cre = ?, tipo = ?, modalidade = ?, empresa_id = ?, periodo_inicial = ?, 
                periodo_final = ?, situacao = ?, gestor = ?, alunos = ?, municipio = ?, valor_diario = ?, 
                valor_km = ?, km = ?, valor_mensal = ?, postos = ?, anexos = ?
            WHERE id = ?`,
            [
                data.numero || null, data.proa || null, data.lote || null, data.cre || null, data.tipo || null, data.modalidade || null,
                parseInt(data.empresa_id) || null, data.periodo_inicial || null, data.periodo_final || null, 
                data.situacao || null, data.gestor || null, parseInt(data.alunos) || 0, data.municipio || null, 
                parseFloat(data.valor_diario) || 0, parseFloat(data.valor_km) || 0, parseFloat(data.km) || 0, 
                parseFloat(data.valor_mensal) || 0, data.postos || null, JSON.stringify(anexosFinal), id
            ]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deletar Contrato
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const userRole = req.user.role;
    try {
        if (userRole === 'master') {
            await db.execute('DELETE FROM contratos WHERE id = ?', [id]);
            res.json({ success: true });
        } else {
            await db.execute(
                'INSERT INTO solicitacoes_exclusao (tabela, registro_id, motivo, solicitante) VALUES (?, ?, ?, ?)',
                ['contratos', id, `Exclusão do contrato ID ${id}`, req.user.usuario]
            );
            res.json({ requested: true, message: 'Solicitação de exclusão enviada ao Master.' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
