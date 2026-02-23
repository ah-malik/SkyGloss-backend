const { MongoClient } = require('mongodb');

async function run() {
    const uri = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/?retryWrites=true&w=majority';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('test');

        console.log('--- Migrating Users role: shop -> certified_shop ---');
        const u1 = await db.collection('users').updateMany(
            { role: 'shop' },
            { $set: { role: 'certified_shop' } }
        );
        console.log('Updated users (shop):', u1.modifiedCount);

        console.log('--- Migrating Users role: distributor -> master_distributor ---');
        const u2 = await db.collection('users').updateMany(
            { role: 'distributor' },
            { $set: { role: 'master_distributor' } }
        );
        console.log('Updated users (distributor):', u2.modifiedCount);

        console.log('--- Migrating AccessCodes targetRole: shop -> certified_shop ---');
        const a1 = await db.collection('accesscodes').updateMany(
            { targetRole: 'shop' },
            { $set: { targetRole: 'certified_shop' } }
        );
        console.log('Updated accesscodes (shop):', a1.modifiedCount);

        console.log('--- Migrating AccessCodes targetRole: distributor -> master_distributor ---');
        const a2 = await db.collection('accesscodes').updateMany(
            { targetRole: 'distributor' },
            { $set: { targetRole: 'master_distributor' } }
        );
        console.log('Updated accesscodes (distributor):', a2.modifiedCount);

        console.log('--- Checking for orphaned used codes ---');
        const usedCodes = await db.collection('accesscodes').find({ isUsed: true }).toArray();
        let resetCount = 0;
        for (const codeObj of usedCodes) {
            const user = await db.collection('users').findOne({ accessCode: codeObj.code });
            if (!user) {
                console.log(`Resetting orphaned code: ${codeObj.code}`);
                await db.collection('accesscodes').updateOne(
                    { _id: codeObj._id },
                    { $set: { isUsed: false } }
                );
                resetCount++;
            }
        }
        console.log(`Reset ${resetCount} orphaned access codes.`);

        console.log('--- Migration Complete ---');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        await client.close();
    }
}

run();
