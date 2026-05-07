const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkShops() {
  try {
    await mongoose.connect(MONGO_URI);
    const users = await mongoose.connection.collection('users').find({
      role: 'certified_shop',
      latitude: { $ne: null },
      isCertified: true,
      status: 'active'
    }).project({ email: 1 }).toArray();

    console.log('Certified Active Shops with coords:', users.length);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkShops();
