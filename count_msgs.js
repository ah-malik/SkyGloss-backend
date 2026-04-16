const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkAllMessages() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Total count of all messages
    const total = await mongoose.connection.collection('chatmessages').countDocuments();
    console.log('Total messages:', total);

    // Count by senderType
    const userCount = await mongoose.connection.collection('chatmessages').countDocuments({ senderType: 'user' });
    const adminCount = await mongoose.connection.collection('chatmessages').countDocuments({ senderType: 'admin' });
    const otherCount = await mongoose.connection.collection('chatmessages').countDocuments({ senderType: { $nin: ['user', 'admin'] } });

    console.log('User messages:', userCount);
    console.log('Admin messages:', adminCount);
    console.log('Other messages:', otherCount);

    if (otherCount > 0) {
      const others = await mongoose.connection.collection('chatmessages').find({ senderType: { $nin: ['user', 'admin'] } }).limit(5).toArray();
      console.log('Sample "other" messages:', JSON.stringify(others, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAllMessages();
