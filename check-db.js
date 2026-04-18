const { MongoClient } = require('mongodb');
require('dotenv').config({ path: './.env' });

async function checkActivePartners() {
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
    
    const users = client.db(targetDbName).collection('users');
    
    const activePartners = await users.find({
      role: { $in: ['master_partner', 'regional_partner', 'partner'] },
      status: 'active'
    }).toArray();
    
    console.log(`Found ${activePartners.length} ACTIVE partners.`);
    activePartners.forEach(p => {
       console.log(`- ${p.firstName} ${p.lastName} | Role: ${p.role} | Code: ${p.partnerCode}`);
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

checkActivePartners();
