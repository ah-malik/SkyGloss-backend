const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkProducts() {
  try {
    await mongoose.connect(MONGO_URI);
    
    const products = await mongoose.connection.collection('products').find({}).project({ name: 1, status: 1, targetAudience: 1, category: 1 }).toArray();
    console.log('All Products:');
    products.forEach(p => console.log(`- ${p.name} | Status: ${p.status} | Target: ${p.targetAudience} | Category: ${p.category}`));
    
    const partner = await mongoose.connection.collection('users').findOne({ email: 't@t.com' });
    console.log('\nTest Partner (t@t.com):', partner ? { role: partner.role, status: partner.status, productGroup: partner.productGroup } : 'Not found');
    
    if (partner && partner.productGroup) {
      const group = await mongoose.connection.collection('productgroups').findOne({ _id: partner.productGroup });
      console.log('\nAssigned Product Group:', group ? { name: group.name, productsCount: group.products?.length } : 'Not found');
      
      if (group && group.products) {
        console.log('Products in Group:');
        for (const item of group.products) {
          const prod = products.find(p => p._id.toString() === item.productId?.toString());
          console.log(`  - Product ID: ${item.productId} -> ${prod ? prod.name : 'PRODUCT NOT FOUND IN DB'}`);
        }
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkProducts();
