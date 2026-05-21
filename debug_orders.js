const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/').then(async () => {
  const User = mongoose.model('User', new mongoose.Schema({}, {strict: false}), 'users');
  const Order = mongoose.model('Order', new mongoose.Schema({}, {strict: false}), 'orders');
  
  // Find shops that actually have orders
  const orders = await Order.find({ status: { $ne: 'PENDING' } }).populate('user');
  console.log('Total non-pending orders:', orders.length);
  
  const partnerCodes = new Set();
  for (const order of orders) {
    if (order.user && order.user.referredByPartnerCode) {
      partnerCodes.add(order.user.referredByPartnerCode);
    }
  }
  
  console.log('Partner codes that have non-pending orders:', Array.from(partnerCodes));
    
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
