const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkAdminMessages() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const adminMessages = await mongoose.connection.collection('chatmessages').find({ senderType: 'admin' }).sort({ createdAt: -1 }).limit(5).toArray();
    console.log('Admin messages:', JSON.stringify(adminMessages, null, 2));

    const allTypes = await mongoose.connection.collection('chatmessages').distinct('senderType');
    console.log('All senderTypes in DBs:', allTypes);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAdminMessages();
