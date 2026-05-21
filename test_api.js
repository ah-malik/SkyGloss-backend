const jwt = require('jsonwebtoken');
const axios = require('axios');
const mongoose = require('mongoose');

async function test() {
  await mongoose.connect('mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/');
  const User = mongoose.model('User', new mongoose.Schema({}, {strict: false}), 'users');
  const Order = mongoose.model('Order', new mongoose.Schema({}, {strict: false}), 'orders');
  
  // Find a partner
  const partner = await User.findOne({ role: 'partner' });
  if (!partner) {
    console.log('No partner found');
    process.exit(0);
  }
  
  const payload = {
    email: partner.email,
    sub: partner._id.toString()
  };
  
  const token = jwt.sign(payload, 'secretKey');
  console.log('Testing with partner:', partner.email);
  
  try {
    const res = await axios.get('http://127.0.0.1:3001/orders/network-orders', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Success!', res.data);
  } catch (err) {
    console.error('API Error:', err.response ? err.response.data : err.message);
  }
  process.exit(0);
}

test();
