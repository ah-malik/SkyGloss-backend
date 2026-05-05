
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const OrderSchema = new mongoose.Schema({
  orderNumber: String,
  currency: String,
  totalAmount: Number,
}, { timestamps: true });

async function checkOrders() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const Order = mongoose.model('Order', OrderSchema);
    const lastOrders = await Order.find().sort({ createdAt: -1 }).limit(5);

    console.log('Last 5 orders:');
    lastOrders.forEach(o => {
      console.log(`Order: ${o.orderNumber}, Currency: ${o.currency}, Total: ${o.totalAmount}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkOrders();
