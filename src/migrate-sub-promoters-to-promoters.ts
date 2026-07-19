/**
 * One-time migration: sub_promoter → regional_partner (Promoter)
 * and operational-link each former Sub under their former Main Promoter.
 *
 * Run: npm run migrate-sub-promoters-to-promoters
 *
 * Also runs automatically on backend startup via UsersService.onModuleInit.
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

  const subs = await users.find({ role: 'sub_promoter' }).toArray();
  let converted = 0;
  let linked = 0;

  for (const sub of subs) {
    const subCode = String(sub.partnerCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const mainCode = String(sub.referredByPartnerCode || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    let newParentCode = mainCode || null;

    if (mainCode) {
      const main = await users.findOne({
        partnerCode: mainCode,
        role: 'regional_partner',
      });

      if (main) {
        // Walk up to a Representative for hierarchical parent
        let walkCode = String(main.referredByPartnerCode || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        for (let depth = 0; depth < 10 && walkCode; depth += 1) {
          const ancestor = await users.findOne({ partnerCode: walkCode });
          if (!ancestor) break;
          if (ancestor.role === 'master_partner') {
            newParentCode = walkCode;
            break;
          }
          walkCode = String(ancestor.referredByPartnerCode || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        }

        // Operational Promoter Network link (mirrors Representative Network)
        if (subCode) {
          const linkResult = await users.updateOne(
            { _id: main._id },
            { $addToSet: { operationalPromoterCodes: subCode } },
          );
          if (linkResult.modifiedCount > 0 || linkResult.matchedCount > 0) {
            linked += 1;
          }
        }
      }
    }

    const update: Record<string, unknown> = { role: 'regional_partner' };
    if (newParentCode) {
      update.referredByPartnerCode = newParentCode;
    }

    await users.updateOne({ _id: sub._id }, { $set: update });
    converted += 1;
  }

  console.log(
    `Migration complete: ${converted} Sub-Promoter(s) → Promoter (regional_partner); ${linked} operational Promoter Network link(s) ensured.`,
  );

  await mongoose.disconnect();
}

bootstrap().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
