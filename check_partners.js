const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkPartners() {
  try {
    await mongoose.connect(MONGO_URI);
    const users = await mongoose.connection.collection('users').find({
      role: { $in: ['master_partner', 'regional_partner', 'partner'] },
      latitude: { $ne: null }
    }).project({ email: 1, status: 1 }).toArray();

    console.log('Partners with coords:', users.length);
    users.forEach(u => {
      console.log(`Email: ${u.email}, Status: ${u.status}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkPartners();
