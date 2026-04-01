const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkMessages() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Check specific message structure
    const messages = await mongoose.connection.collection('chatmessages').find().sort({ createdAt: -1 }).limit(5).toArray();
    console.log('Last 5 messages:', JSON.stringify(messages, null, 2));

    const rooms = await mongoose.connection.collection('chatrooms').find().sort({ updatedAt: -1 }).limit(3).toArray();
    console.log('Last 3 rooms:', JSON.stringify(rooms, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkMessages();
