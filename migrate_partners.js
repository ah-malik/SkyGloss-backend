const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

const envPath = path.join(__dirname, '.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
    console.error('MONGO_URI not found in backend/.env');
    process.exit(1);
}

async function migrateRoles() {
    try {
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB');

        const User = mongoose.model('User', new mongoose.Schema({
            role: String
        }, { strict: false }));

        // 1. master_distributor -> master_partner
        console.log('Migrating master_distributor to master_partner...');
        const masterRes = await User.updateMany(
            { role: 'master_distributor' },
            { $set: { role: 'master_partner' } }
        );
        console.log(`Updated ${masterRes.modifiedCount} master distributors.`);

        // 2. regional_distributor -> regional_partner
        console.log('Migrating regional_distributor to regional_partner...');
        const regionalRes = await User.updateMany(
            { role: 'regional_distributor' },
            { $set: { role: 'regional_partner' } }
        );
        console.log(`Updated ${regionalRes.modifiedCount} regional distributors.`);

        // 3. shop -> certified_shop (Check if some are still 'shop' from an older migration)
        const shopRes = await User.updateMany(
            { role: 'shop' },
            { $set: { role: 'certified_shop' } }
        );
        if (shopRes.modifiedCount > 0) {
            console.log(`Updated ${shopRes.modifiedCount} legacy 'shop' users to 'certified_shop'.`);
        }

        console.log('Migration completed successfully.');
        await mongoose.disconnect();
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrateRoles();
