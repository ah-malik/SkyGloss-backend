const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkUsers() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    const users = await mongoose.connection.collection('users').find({
      role: { $in: ['certified_shop', 'master_partner', 'regional_partner', 'partner'] }
    }).project({
      email: 1,
      role: 1,
      isCertified: 1,
      status: 1,
      latitude: 1,
      longitude: 1,
      country: 1
    }).toArray();

    console.log('Total potential map users:', users.length);
    users.forEach(u => {
      console.log(`Email: ${u.email}, Role: ${u.role}, Certified: ${u.isCertified}, Status: ${u.status}, Coords: ${u.latitude}, ${u.longitude}, Country: ${u.country}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkUsers();
