/**
 * One-time migration: partner + regional_partner → master_partner (Represented)
 * Run: npm run migrate-partner-roles
 */
import * as dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function bootstrap() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in environment');
  }

  await mongoose.connect(uri);

  const users = mongoose.connection.collection('users');

  const hubResult = await users.updateMany(
    { role: 'partner' },
    { $set: { role: 'master_partner' } },
  );
  const promoterResult = await users.updateMany(
    { role: 'regional_partner' },
    { $set: { role: 'master_partner' } },
  );

  console.log(
    `Migration complete: ${hubResult.modifiedCount} hub user(s), ${promoterResult.modifiedCount} promoter user(s) → Represented (master_partner).`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
