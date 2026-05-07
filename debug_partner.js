const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function debugPartnerProducts() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // 1. Find a partner (e.g. info@skygloss.uk)
    const partner = await mongoose.connection.collection('users').findOne({ email: 'info@skygloss.uk' });
    if (!partner) {
      console.log('Partner not found');
      process.exit(1);
    }
    
    console.log('Partner details:', {
      email: partner.email,
      role: partner.role,
      country: partner.country,
      productGroup: partner.productGroup
    });
    
    // 2. Find matching groups by country
    const matchingGroups = await mongoose.connection.collection('productgroups').find({
      $or: [
        { countries: partner.country },
        { country: partner.country }
      ],
      isActive: true
    }).toArray();
    
    console.log(`Found ${matchingGroups.length} matching groups for country: ${partner.country}`);
    matchingGroups.forEach(g => {
      console.log(`Group: ${g.name}, Products count: ${g.products?.length}`);
    });
    
    // 3. Check default group if no match
    if (matchingGroups.length === 0) {
      const defaultGroup = await mongoose.connection.collection('productgroups').findOne({ isDefault: true, isActive: true });
      console.log('Default group:', defaultGroup ? defaultGroup.name : 'NONE');
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
debugPartnerProducts();
