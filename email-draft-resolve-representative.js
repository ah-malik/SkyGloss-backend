/**
 * Resolve a certified shop's local representative for draft email tests.
 * Mirrors UsersService.getLocalRepresentativeForShop (simplified chain walk).
 */

const mongoose = require('mongoose');

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRepresentativeRole(role) {
  return role === 'master_partner';
}

function isMainPromoterRole(role) {
  return role === 'regional_partner';
}

function isSubPromoterRole(role) {
  return role === 'sub_promoter';
}

function toRepresentativeContact(user) {
  if (!user) return null;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: fullName || user.partnerCode,
    email: user.email || null,
    phoneNumber: user.phoneNumber || null,
    partnerCode: user.partnerCode,
    profileImage: user.profileImage || null,
  };
}

async function findByPartnerCode(userModel, partnerCode) {
  const normalized = partnerCode?.trim();
  if (!normalized) return null;
  return userModel
    .findOne({
      partnerCode: {
        $regex: `^${escapeRegex(normalized)}$`,
        $options: 'i',
      },
    })
    .lean();
}

async function resolveRepresentativeForPromoter(promoter, userModel) {
  if (!promoter?.referredByPartnerCode) return null;
  const repParent = await findByPartnerCode(userModel, promoter.referredByPartnerCode);
  if (repParent && isRepresentativeRole(repParent.role)) {
    return repParent;
  }
  return null;
}

async function resolveShopCommissionChain(shop, userModel) {
  const directCode = shop.referredByPartnerCode?.trim();
  if (!directCode) return null;

  const directParent = await findByPartnerCode(userModel, directCode);
  if (!directParent?.partnerCode) return null;

  if (directParent.role === 'partner') return null;

  if (isSubPromoterRole(directParent.role)) {
    const mainCode = directParent.referredByPartnerCode?.trim();
    const mainParent = mainCode ? await findByPartnerCode(userModel, mainCode) : null;
    if (mainParent && isMainPromoterRole(mainParent.role)) {
      return resolveRepresentativeForPromoter(mainParent, userModel);
    }
    return null;
  }

  if (isMainPromoterRole(directParent.role)) {
    return resolveRepresentativeForPromoter(directParent, userModel);
  }

  if (isRepresentativeRole(directParent.role)) {
    return directParent;
  }

  return null;
}

async function getLocalRepresentativeForShop(userModel, shop) {
  if (!shop || shop.role !== 'certified_shop') return null;

  const rep = await resolveShopCommissionChain(shop, userModel);
  return toRepresentativeContact(rep);
}

async function loadShopAndRepresentative(shopEmail) {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not set in .env');
  }

  await mongoose.connect(mongoUri);

  const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
  const User = mongoose.models.DraftEmailUser || mongoose.model('DraftEmailUser', userSchema);

  const shop = await User.findOne({
    email: shopEmail,
    role: 'certified_shop',
  })
    .select('email role referredByPartnerCode shopIntroductionRepresentativeCode')
    .lean();

  if (!shop) {
    return { shop: null, representative: null };
  }

  const representative = await getLocalRepresentativeForShop(User, shop);
  return { shop, representative };
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  getLocalRepresentativeForShop,
  loadShopAndRepresentative,
  disconnect,
};
