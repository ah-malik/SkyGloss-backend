const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function fixNotifications() {
  try {
    // Try to find mongoose in nearby node_modules if not global
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    // Mark all as read in the 'notifications' collection
    const result = await mongoose.connection.collection('notifications').updateMany({ isRead: false }, { $set: { isRead: true } });
    console.log(`Successfully marked ${result.modifiedCount} notifications as read.`);
    process.exit(0);
  } catch (err) {
    console.error('Error fixing notifications:', err);
    process.exit(1);
  }
}

fixNotifications();
