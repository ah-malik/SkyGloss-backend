require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.collection('productgroups');
    const naGroup = await db.findOne({ name: 'North America Shop Pricing' });
    
    if (!naGroup) {
      console.log('North America Shop Pricing not found!');
      process.exit(1);
    }
    
    await db.updateMany({}, { $set: { isDefault: false } });
    await db.updateOne({ _id: naGroup._id }, { $set: { isDefault: true } });
    
    const usersDb = mongoose.connection.collection('users');
    const result = await usersDb.updateMany(
      { $or: [{ productGroup: { $exists: false } }, { productGroup: null }] },
      { $set: { productGroup: naGroup._id } }
    );
    
    console.log('Updated users:', result.modifiedCount);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
