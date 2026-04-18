const { MongoClient } = require('mongodb');

async function run() {
    const uri = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/?retryWrites=true&w=majority';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const dbs = await client.db().admin().listDatabases();

        for (const dbInfo of dbs.databases) {
            const dbName = dbInfo.name;
            if (['admin', 'local', 'config'].includes(dbName)) continue;

            const db = client.db(dbName);
            const collections = await db.listCollections().toArray();
            console.log(`\n--- DB: ${dbName} ---`);

            for (const col of collections) {
                if (col.name === 'users' || col.name === 'accesscodes') {
                    const count = await db.collection(col.name).countDocuments();
                    console.log(`  Collection: ${col.name} (${count} docs)`);

                    if (col.name === 'users') {
                        const roles = await db.collection(col.name).distinct('role');
                        console.log('    Roles found:', roles);
                    }
                    if (col.name === 'accesscodes') {
                        const tRoles = await db.collection(col.name).distinct('targetRole');
                        console.log('    TargetRoles found:', tRoles);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Audit failed:', err);
    } finally {
        await client.close();
    }
}

run();
