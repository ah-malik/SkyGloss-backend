const mongoose = require('mongoose');
const uri = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function migrate() {
    try {
        await mongoose.connect(uri);
        console.log('Connected to DB');

        // Migrate distributors to master_distributor
        const distResult = await mongoose.connection.db.collection('users').updateMany(
            { role: 'distributor' },
            { $set: { role: 'master_distributor' } }
        );
        console.log(`Migrated ${distResult.modifiedCount} distributors to master_distributor.`);

        // Migrate shops to certified_shop
        const shopResult = await mongoose.connection.db.collection('users').updateMany(
            { role: 'shop' },
            { $set: { role: 'certified_shop' } }
        );
        console.log(`Migrated ${shopResult.modifiedCount} shops to certified_shop.`);

        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
