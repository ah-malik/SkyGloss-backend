const MONGO_URI = 'mongodb+srv://malik26040_db_user:03102604021@crudauth.moere8d.mongodb.net/';

async function checkVisibility() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    const users = await mongoose.connection.collection('users').find({
      $or: [
        { email: 'canada1@gmail.com' },
        { email: 'canada@gmail.com' },
        { email: 'julioluevano16@gmail.com' }
      ]
    }).project({
      email: 1,
      role: 1,
      isCertified: 1,
      status: 1,
      latitude: 1,
      longitude: 1,
      isVisibleOnMap: 1
    }).toArray();

    console.log('Visibility check:');
    users.forEach(u => {
      console.log(`Email: ${u.email}, Role: ${u.role}, Certified: ${u.isCertified}, Status: ${u.status}, VisibleOnMap: ${u.isVisibleOnMap}, Coords: ${u.latitude}, ${u.longitude}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkVisibility();
