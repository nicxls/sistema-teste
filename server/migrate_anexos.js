const fs = require('fs');
const path = require('path');
const db = require('./db');

async function migrateAnexos() {
    try {
        console.log('Iniciando migração de anexos (Base64 -> Arquivos)...');
        
        const uploadPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

        const [contratos] = await db.execute('SELECT id, numero, anexos FROM contratos');
        let totalFiles = 0;
        let totalContracts = 0;

        for (let contrato of contratos) {
            let anexos = [];
            try {
                anexos = JSON.parse(contrato.anexos || '[]');
            } catch (e) {
                console.error(`Erro ao parsear anexos do contrato ${contrato.id}:`, e);
                continue;
            }

            if (!Array.isArray(anexos) || anexos.length === 0) continue;

            let updatedAnexos = [];
            let changed = false;

            for (let anexo of anexos) {
                // Se já for URL ou não tiver dados base64, mantém
                if (anexo.data && anexo.data.startsWith('data:')) {
                    try {
                        const arr = anexo.data.split(',');
                        const mimeMatch = arr[0].match(/:(.*?);/);
                        if (!mimeMatch) throw new Error('Mime type não encontrado');
                        
                        const mime = mimeMatch[1];
                        const extension = mime.split('/')[1] || 'bin';
                        const bstr = Buffer.from(arr[1], 'base64');
                        
                        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                        const safeName = (anexo.name || 'anexo').replace(/[^a-zA-Z0-9.\-_]/g, '');
                        const filename = `${uniqueSuffix}-${safeName}`;
                        const filePath = path.join(uploadPath, filename);

                        fs.writeFileSync(filePath, bstr);
                        
                        updatedAnexos.push({
                            ...anexo,
                            data: '/uploads/' + filename,
                            isUrl: true
                        });
                        totalFiles++;
                        changed = true;
                    } catch (err) {
                        console.error(`Erro ao converter arquivo ${anexo.name} do contrato ${contrato.id}:`, err);
                        updatedAnexos.push(anexo);
                    }
                } else {
                    updatedAnexos.push(anexo);
                }
            }

            if (changed) {
                await db.execute('UPDATE contratos SET anexos = ? WHERE id = ?', [JSON.stringify(updatedAnexos), contrato.id]);
                totalContracts++;
            }
        }

        console.log(`Migração concluída!`);
        console.log(`Contratos atualizados: ${totalContracts}`);
        console.log(`Total de arquivos extraídos: ${totalFiles}`);
        process.exit(0);
    } catch (error) {
        console.error('Erro na migração:', error);
        process.exit(1);
    }
}

migrateAnexos();
