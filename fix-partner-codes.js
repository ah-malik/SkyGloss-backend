const { MongoClient } = require('mongodb');
require('dotenv').config({ path: './.env' });

async function fixPartnerCodes() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    
    const dbs = await client.db().admin().listDatabases();
    let targetDbName = 'test';
    for (const dbInfo of dbs.databases) {
       const collections = await client.db(dbInfo.name).listCollections().toArray();
       if (collections.some(c => c.name === 'users')) {
          targetDbName = dbInfo.name;
          break;
       }
    }
    
    console.log(`Using database: ${targetDbName}`);
    const users = client.db(targetDbName).collection('users');
    
    const partners = await users.find({
      role: { $in: ['master_partner', 'regional_partner', 'partner'] },
      $or: [
        { partnerCode: { $exists: false } },
        { partnerCode: null },
        { partnerCode: '' }
      ]
    }).toArray();
    
    console.log(`Found ${partners.length} partners missing a partner code.`);
    
    for (const partner of partners) {
       // Generate a unique code
       const initials = ((partner.firstName || 'S')[0] + (partner.lastName || 'G')[0]).toUpperCase();
       let isUnique = false;
       let newCode = '';
       
       while (!isUnique) {
          const rand = Math.floor(1000 + Math.random() * 9000);
          newCode = `${initials}${rand}`;
          const existing = await users.findOne({ partnerCode: newCode });
          if (!existing) isUnique = true;
       }
       
       await users.updateOne(
          { _id: partner._id },
          { $set: { partnerCode: newCode } }
       );
       console.log(`Assigned ${newCode} to ${partner.firstName} ${partner.lastName}`);
    }
    
    console.log('Migration complete.');

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

fixPartnerCodes();
