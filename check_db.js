require('dotenv').config();
const db = require('./server/db');

(async () => {
    try {
        const [rows] = await db.execute('SELECT id, razao, modulo FROM empresas');
        console.log(JSON.stringify(rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
})();
