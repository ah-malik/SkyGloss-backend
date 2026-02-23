const { MongoClient } = require('mongodb');

async function run() {
    const uri = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/?retryWrites=true&w=majority';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('test');

        console.log('--- Checking Used AccessCodes ---');
        const usedCodes = await db.collection('accesscodes').find({ isUsed: true }).toArray();
        console.log(`Total used codes: ${usedCodes.length}`);

        for (const c of usedCodes) {
            const user = await db.collection('users').findOne({ accessCode: c.code });
            console.log(`Code: ${c.code} (${c.targetRole}) -> User: ${user ? user.email + ' (' + user.role + ')' : 'NOT FOUND'}`);
        }

        console.log('\n--- Checking for Users with Legacy Roles ---');
        const legacyUsers = await db.collection('users').find({ role: { $in: ['shop', 'distributor', 'technician'] } }).toArray();
        console.log(`Total legacy users: ${legacyUsers.length}`);
        for (const u of legacyUsers) {
            console.log(`User: ${u.email}, Role: ${u.role}, AccessCode: ${u.accessCode}`);
        }

        console.log('\n--- Checking for AccessCodes with Legacy TargetRoles ---');
        const legacyCodes = await db.collection('accesscodes').find({ targetRole: { $in: ['shop', 'distributor'] } }).toArray();
        console.log(`Total legacy codes: ${legacyCodes.length}`);
        for (const c of legacyCodes) {
            console.log(`Code: ${c.code}, TargetRole: ${c.targetRole}, isUsed: ${c.isUsed}`);
        }

    } catch (err) {
        console.error('Audit error:', err);
    } finally {
        await client.close();
    }
}

run();
