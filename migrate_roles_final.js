const { MongoClient } = require('mongodb');

async function migrate() {
    const uri = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/test?retryWrites=true&w=majority';
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db();

        // 1. Migrate Users
        console.log('Migrating Users...');
        const usersResult1 = await db.collection('users').updateMany(
            { role: 'shop' },
            { $set: { role: 'certified_shop' } }
        );
        console.log(`Updated ${usersResult1.modifiedCount} users (shop -> certified_shop)`);

        const usersResult2 = await db.collection('users').updateMany(
            { role: 'distributor' },
            { $set: { role: 'master_distributor' } }
        );
        console.log(`Updated ${usersResult2.modifiedCount} users (distributor -> master_distributor)`);

        // 2. Migrate AccessCodes
        console.log('Migrating AccessCodes...');
        const codesResult1 = await db.collection('accesscodes').updateMany(
            { targetRole: 'shop' },
            { $set: { targetRole: 'certified_shop' } }
        );
        console.log(`Updated ${codesResult1.modifiedCount} accesscodes (shop -> certified_shop)`);

        const codesResult2 = await db.collection('accesscodes').updateMany(
            { targetRole: 'distributor' },
            { $set: { targetRole: 'master_distributor' } }
        );
        console.log(`Updated ${codesResult2.modifiedCount} accesscodes (distributor -> master_distributor)`);

        // 3. Fix potential "already used" inconsistencies
        // Look for used codes that don't have a matching user
        const usedCodes = await db.collection('accesscodes').find({ isUsed: true }).toArray();
        for (const codeObj of usedCodes) {
            const user = await db.collection('users').findOne({ accessCode: codeObj.code });
            if (!user) {
                console.log(`Found orphaned used code: ${codeObj.code}. Resetting isUsed to false.`);
                await db.collection('accesscodes').updateOne(
                    { _id: codeObj._id },
                    { $set: { isUsed: false } }
                );
            }
        }

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await client.close();
    }
}

migrate();
