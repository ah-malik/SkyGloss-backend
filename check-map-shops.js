const mongoose = require('mongoose');

async function main() {
  await mongoose.connect('mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/');
  
  const User = mongoose.connection.collection('users');
  
  // Find all certified shops and check their isVisibleOnMap
  const certifiedShops = await User.find({ 
    role: 'certified_shop', 
    isCertified: true 
  }).toArray();
  
  console.log('=== ALL CERTIFIED SHOPS - Map Visibility ===');
  console.log('Total certified shops:', certifiedShops.length);
  
  const visibleTrue = certifiedShops.filter(u => u.isVisibleOnMap === true);
  const visibleFalse = certifiedShops.filter(u => u.isVisibleOnMap === false);
  const visibleUndefined = certifiedShops.filter(u => u.isVisibleOnMap == null);
  
  console.log('isVisibleOnMap = true:', visibleTrue.length);
  console.log('isVisibleOnMap = false:', visibleFalse.length);
  console.log('isVisibleOnMap = undefined/null:', visibleUndefined.length);
  
  if (visibleFalse.length > 0) {
    console.log('\n--- Shops with isVisibleOnMap = FALSE (hidden from map) ---');
    visibleFalse.forEach(u => {
      console.log(`  ${u.email} | status: ${u.status} | country: ${u.country} | city: ${u.city}`);
    });
  }

  // Fix: Set isVisibleOnMap=true for all active certified shops that have it as false
  const result = await User.updateMany(
    { 
      role: 'certified_shop', 
      isCertified: true, 
      status: 'active',
      isVisibleOnMap: false 
    },
    { $set: { isVisibleOnMap: true } }
  );
  console.log('\n=== FIX APPLIED ===');
  console.log('Updated', result.modifiedCount, 'shops: isVisibleOnMap set to true');

  await mongoose.disconnect();
}

main().catch(console.error);
