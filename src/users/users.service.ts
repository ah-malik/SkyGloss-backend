import { Injectable, BadRequestException, OnModuleInit, Logger, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import axios from 'axios';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
<<<<<<< Updated upstream
=======
import { getNetworkIdLabel, HUB_ID_LABEL } from '../common/role-labels';
import {
  normalizePartnerCode,
  validatePartnerCode,
} from '../common/partner-code';
import {
  canTraverseNetwork,
  canCertifyShops,
  getParentLinkLabel,
  requiresParentLink,
  validateParentRole,
} from '../common/user-hierarchy';
import {
  isCommissionEligibleRole,
  resolveShopCommissionChain,
  resolveShopEarningAssignments,
} from '../common/commission-distribution';
import {
  GLOBAL_HUB_PARTNER_CODE,
  isGlobalHubAccount,
  isGlobalHubPartnerCode,
} from '../common/global-hub';

export interface NetworkUsersResult {
  shops: UserDocument[];
  promoters: UserDocument[];
  subPromoters: UserDocument[];
  representatives: UserDocument[];
  /** @deprecated use representatives */
  represented: UserDocument[];
  distributors: UserDocument[];
  partners: UserDocument[];
  viewerRole: string;
}
>>>>>>> Stashed changes

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
  ) { }

  async onModuleInit() {
    // One-time cleanup to remove null emails that cause duplicate key errors with sparse index
    try {
      // Sync indexes to ensure unique: true, sparse: true is correctly applied
      await this.userModel.syncIndexes();
      console.log('[UsersService] Indexes synchronized.');

      const result = await this.userModel.updateMany(
        { email: null },
        { $unset: { email: '' } },
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[UsersService] Cleaned up ${result.modifiedCount} users with null emails.`,
        );
      }

      // Ensure Global Partner exists
      const globalPartnerCode = 'GLOBAL77';
      const existingGlobal = await this.userModel.findOne({ partnerCode: globalPartnerCode });
      if (!existingGlobal) {
        console.log(`[UsersService] Creating Global Partner (${globalPartnerCode})...`);
        const hashedPass = await bcrypt.hash('SkyGlossGlobal77!', 10);
        await this.userModel.create({
          firstName: 'Global',
          lastName: 'Partner',
          email: 'certified@skygloss.com',
          password: hashedPass,
          role: UserRole.MASTER_PARTNER,
          status: 'active',
          country: 'United States',
          address: 'Main Office',
          city: 'Global',
          partnerCode: globalPartnerCode,
          isSelfRegistered: false,
        });
        console.log('[UsersService] Global Partner created successfully.');
      }
    } catch (err) {
      console.error('[UsersService] Database initialization failed:', err);
    }
  }

  private async fetchCoordinates(address: string, city: string, country: string): Promise<{ latitude: number, longitude: number } | null> {
    const fetchWithQuery = async (query: string) => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'SkyGloss-Backend',
          },
        });
        const data = res.data;
        if (data && data[0]) {
          return {
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
          };
        }
      } catch (err) {
        console.error(`[Geocoding] Failed for query "${query}":`, err);
      }
      return null;
    };

    // Try 1: Full Address
    let coords = await fetchWithQuery(`${address}, ${city}, ${country}`);

    // Try 2: City and Country fallback (if address search fails)
    if (!coords && (city || country)) {
      coords = await fetchWithQuery(`${city}, ${country}`);
    }

    return coords;
  }

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    console.log(
      '[UsersService] Creating user with DTO:',
      JSON.stringify(createUserDto, null, 2),
    );
    if (createUserDto.email) {
      const existingUser = await this.userModel.findOne({
        email: createUserDto.email,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists (email)');
      }
    }

    if (createUserDto.username) {
      const existingUser = await this.userModel.findOne({
        username: createUserDto.username,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists (username)');
      }
    }

    const hashedPassword = createUserDto.password
      ? await bcrypt.hash(createUserDto.password, 10)
      : undefined;

    const userData: any = {
      ...createUserDto,
      password: hashedPassword,
    };

    // Validate Partner Code for partner roles
    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      UserRole.PARTNER,
    ];

    if (partnerRoles.includes(userData.role)) {
      // Auto-activate partners created by Admin
      userData.status = UserStatus.ACTIVE;
      
      if (!userData.partnerCode) {
        throw new BadRequestException('Partner Code is required for this role');
      }

      if (!/^[a-zA-Z0-9]{4,10}$/.test(userData.partnerCode)) {
        throw new BadRequestException('Partner Code must be 4-10 alphanumeric characters');
      }

      const existingCode = await this.userModel.findOne({
        partnerCode: userData.partnerCode,
      });
      if (existingCode) {
        throw new BadRequestException('Partner Code already exists');
      }
    } else {
      // Clear partnerCode if NOT a partner role (optional but consistency is good)
      delete userData.partnerCode;
    }

    // Auto-geocode if coordinates are missing
    if (!userData.latitude || !userData.longitude) {
      if (userData.address && userData.city && userData.country) {
        const coords = await this.fetchCoordinates(userData.address, userData.city, userData.country);
        if (coords) {
          userData.latitude = coords.latitude;
          userData.longitude = coords.longitude;
          console.log(`[Geocoding] Automatically detected coordinates for ${userData.email}:`, coords);
        }
      }
    }

    // Remove email if it's null/undefined to avoid duplicate key errors with sparse index
    if (!userData.email) {
      delete userData.email;
    }

    if (!userData.productGroup || userData.productGroup === '') {
      const defaultGroup = await this.productGroupModel.findOne({ isDefault: true }).exec();
      if (defaultGroup) {
        userData.productGroup = defaultGroup._id;
        console.log(`[UsersService] Assigned default product group ${defaultGroup.name} to new user.`);
      } else {
        delete userData.productGroup;
      }
    }

    const createdUser = new this.userModel(userData);
    const savedUser = await createdUser.save();

    if (savedUser.role === UserRole.CERTIFIED_SHOP) {
      await this.assignShopEarningRepresentatives(savedUser);
    }

    if (savedUser.role === UserRole.MASTER_PARTNER) {
      return this.assignRepresentativePartnerDevelopment(savedUser);
    }

    return savedUser;
  }

  /**
   * When Rep 1 invites/adds Rep 2, Rep 1 becomes Rep 2's Partner Development Representative.
   */
  async assignRepresentativePartnerDevelopment(
    rep: UserDocument,
  ): Promise<UserDocument> {
    if (rep.role !== UserRole.MASTER_PARTNER) return rep;
    if (rep.partnerDevelopmentRepresentativeCode) return rep;

    const parentCode = normalizePartnerCode(rep.referredByPartnerCode);
    if (!parentCode) return rep;

    const parent = await this.findByPartnerCode(parentCode);
    if (!parent || parent.role !== UserRole.MASTER_PARTNER) return rep;

    const updated = await this.userModel
      .findByIdAndUpdate(
        rep._id,
        {
          partnerDevelopmentRepresentativeCode: normalizePartnerCode(
            parent.partnerCode,
          ),
        },
        { new: true },
      )
      .exec();

    return updated || rep;
  }

  /** Backfill Partner Development assignment on shops under a linked Representative. */
  async backfillShopEarningAssignmentsForRepresentative(
    representative: UserDocument,
  ): Promise<void> {
    if (representative.role !== UserRole.MASTER_PARTNER) return;

    const network = await this.findNetworkUsersForViewer(representative);
    for (const shop of network.shops) {
      const fullShop = await this.findOne(shop._id.toString());
      if (fullShop) {
        await this.assignShopEarningRepresentatives(fullShop);
      }
    }
  }

  /** Assign Shop Introduction / Partner Development / Operational Support reps (one-time). */
  async assignShopEarningRepresentatives(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;

    const assignments = await resolveShopEarningAssignments(
      shop,
      (code) => this.findByPartnerCode(code),
      (shopIntroCode) =>
        this.userModel
          .findOne({
            role: UserRole.MASTER_PARTNER,
            operationalRepresentativeCodes: normalizePartnerCode(shopIntroCode),
          })
          .exec(),
    );

    const updatePayload: Record<string, unknown> = {};

    if (
      !shop.shopIntroductionRepresentativeCode &&
      assignments.shopIntroductionRepresentativeCode
    ) {
      updatePayload.shopIntroductionRepresentativeId =
        assignments.shopIntroductionRepresentativeId;
      updatePayload.shopIntroductionRepresentativeCode =
        assignments.shopIntroductionRepresentativeCode;
    }

    if (
      !shop.partnerDevelopmentRepresentativeCode &&
      assignments.partnerDevelopmentRepresentativeCode
    ) {
      updatePayload.partnerDevelopmentRepresentativeId =
        assignments.partnerDevelopmentRepresentativeId;
      updatePayload.partnerDevelopmentRepresentativeCode =
        assignments.partnerDevelopmentRepresentativeCode;
    }

    if (
      !shop.operationalSupportRepresentativeCode &&
      assignments.operationalSupportRepresentativeCode
    ) {
      updatePayload.operationalSupportRepresentativeId =
        assignments.operationalSupportRepresentativeId;
      updatePayload.operationalSupportRepresentativeCode =
        assignments.operationalSupportRepresentativeCode;
    }

    if (!Object.keys(updatePayload).length) {
      return shop;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(shop._id, updatePayload, { new: true })
      .exec();

    return updated || shop;
  }

  async ensureShopPartnerDevelopmentAssignment(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;
    if (shop.partnerDevelopmentRepresentativeCode) return shop;

    return this.assignShopEarningRepresentatives(shop);
  }

  async markPartnerDevelopmentCommissionPaid(shopId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(shopId, {
      partnerDevelopmentCommissionPaid: true,
    });
  }

  /**
   * Partner Development commission is a ONE-TIME earning per child Representative
   * (not per shop). Returns true once the parent has already been paid for this
   * child Representative's first shop's first order.
   */
  async hasRepresentativePartnerDevelopmentBeenPaid(
    representativeCode?: string,
  ): Promise<boolean> {
    const code = normalizePartnerCode(representativeCode);
    if (!code) return false;
    const rep = await this.userModel
      .findOne({ partnerCode: code, role: UserRole.MASTER_PARTNER })
      .select('partnerDevelopmentCommissionPaid')
      .lean();
    return rep?.partnerDevelopmentCommissionPaid === true;
  }

  /** Mark a child Representative so their parent is never paid Partner Development again. */
  async markRepresentativePartnerDevelopmentPaid(
    representativeCode?: string,
  ): Promise<void> {
    const code = normalizePartnerCode(representativeCode);
    if (!code) return;
    await this.userModel.updateOne(
      { partnerCode: code, role: UserRole.MASTER_PARTNER },
      { partnerDevelopmentCommissionPaid: true },
    );
  }

  /** Child Representatives whose parent still owes the one-time Partner Development commission. */
  async findChildRepresentativesPendingPartnerDevelopment(
    parentCode: string,
  ): Promise<UserDocument[]> {
    const code = normalizePartnerCode(parentCode);
    if (!code) return [];
    return this.userModel
      .find({
        role: UserRole.MASTER_PARTNER,
        partnerDevelopmentRepresentativeCode: code,
        partnerDevelopmentCommissionPaid: { $ne: true },
      })
      .exec();
  }

  /** Shops whose orders are visible to this Representative (shop introduction rep only). */
  async findShopUserIdsIntroducedByRep(partnerCode: string): Promise<string[]> {
    const code = normalizePartnerCode(partnerCode);
    if (!code) return [];

    const promoters = await this.userModel
      .find({
        role: UserRole.REGIONAL_PARTNER,
        referredByPartnerCode: code,
      })
      .select('partnerCode')
      .lean();
    const promoterCodes = promoters
      .map((p) => normalizePartnerCode(p.partnerCode))
      .filter(Boolean);

    const subPromoters = promoterCodes.length
      ? await this.userModel
          .find({
            role: UserRole.SUB_PROMOTER,
            referredByPartnerCode: { $in: promoterCodes },
          })
          .select('partnerCode')
          .lean()
      : [];
    const subPromoterCodes = subPromoters
      .map((p) => normalizePartnerCode(p.partnerCode))
      .filter(Boolean);

    const parentLinkCodes = [code, ...promoterCodes, ...subPromoterCodes];

    const candidateShops = await this.userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        $or: [
          { shopIntroductionRepresentativeCode: code },
          { referredByPartnerCode: { $in: parentLinkCodes } },
          { partnerDevelopmentRepresentativeCode: code },
        ],
      })
      .select(
        '_id referredByPartnerCode shopIntroductionRepresentativeCode partnerDevelopmentRepresentativeCode',
      )
      .lean();

    const visibleIds: string[] = [];

    for (const shop of candidateShops) {
      const introCode = await this.resolveShopIntroductionRepresentativeCode(shop);
      if (introCode === code) {
        visibleIds.push(String(shop._id));
      }
    }

    return visibleIds;
  }

  /** Resolve Shop Introduction Representative — assigned once at shop create, never changed. */
  async resolveShopIntroductionRepresentativeCode(shop: {
    _id?: { toString(): string };
    referredByPartnerCode?: string;
    shopIntroductionRepresentativeCode?: string;
  }): Promise<string | null> {
    const storedIntro = shop.shopIntroductionRepresentativeCode
      ? normalizePartnerCode(shop.shopIntroductionRepresentativeCode)
      : null;

    if (storedIntro) {
      return storedIntro;
    }

    const chain = await resolveShopCommissionChain(shop, (partnerCode) =>
      this.findByPartnerCode(partnerCode),
    );
    const chainIntro = chain.represented?.partnerCode
      ? normalizePartnerCode(chain.represented.partnerCode)
      : null;

    if (!chainIntro || !shop._id) {
      return null;
    }

    const introRep = chain.represented
      ? await this.findByPartnerCode(chain.represented.partnerCode)
      : null;

    await this.userModel.findByIdAndUpdate(shop._id, {
      shopIntroductionRepresentativeCode: chainIntro,
      ...(introRep ? { shopIntroductionRepresentativeId: introRep._id } : {}),
    });

    const fullShop = await this.findOne(shop._id.toString());
    if (fullShop) {
      await this.assignShopEarningRepresentatives(fullShop);
    }

    return chainIntro;
  }

  async findShopsPendingPartnerDevelopment(
    partnerCode: string,
  ): Promise<UserDocument[]> {
    const code = normalizePartnerCode(partnerCode);
    if (!code) return [];

    const linkedReps = await this.userModel
      .find({
        role: UserRole.MASTER_PARTNER,
        partnerDevelopmentRepresentativeCode: code,
      })
      .select('partnerCode')
      .lean();

    const introRepCodes = linkedReps
      .map((rep) => normalizePartnerCode(rep.partnerCode))
      .filter(Boolean);

    return this.userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        partnerDevelopmentCommissionPaid: { $ne: true },
        $or: [
          { partnerDevelopmentRepresentativeCode: code },
          ...(introRepCodes.length
            ? [{ shopIntroductionRepresentativeCode: { $in: introRepCodes } }]
            : []),
        ],
      })
      .exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().populate('productGroup').populate('blockedBy', 'firstName lastName role').exec();
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findByUsernameOrEmail(
    identifier: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        $or: [{ email: identifier }, { username: identifier }],
      })
      .exec();
  }

  async findByAccessCode(accessCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ accessCode }).exec();
  }

  async findByPartnerCode(partnerCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ partnerCode }).exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: UserDocument,
  ): Promise<UserDocument | null> {
    console.log(
      `[UsersService] Updating user ${id} by ${currentUser.email} with DTO:`,
      JSON.stringify(updateUserDto, null, 2),
    );

    // Permission check: Non-admins can only update themselves or shops they referred
    if (currentUser.role !== UserRole.ADMIN) {
      const targetUser = await this.userModel.findById(id);
      if (!targetUser) throw new BadRequestException('User not found');

      // Allow self-update (e.g., training-complete)
      const isSelfUpdate = currentUser._id.toString() === targetUser._id.toString();

      // Check if this is a shop referred by the current partner OR a self-update
      const isGlobalPartner = currentUser.partnerCode === 'GLOBAL77';
      const isReferredShop = targetUser.referredByPartnerCode === currentUser.partnerCode;

      if (!isSelfUpdate && !isGlobalPartner && !isReferredShop) {
        throw new ForbiddenException('You do not have permission to update this user');
      }

      // Optional: Restrict what fields a Partner can update
      // For now, let's just proceed since we trust the DTO validation for other roles
    }

    const updatePayload: any = { ...updateUserDto };

    // Handle Blocking/Unblocking Logic and Overrides
    if (updatePayload.status) {
      if (updatePayload.status === UserStatus.BLOCKED) {
        updatePayload.blockedBy = currentUser._id;
        // Always hide from map when blocked
        updatePayload.isVisibleOnMap = false;
      } else if (updatePayload.status === UserStatus.ACTIVE) {
        const targetUser = await this.userModel.findById(id);
        if (targetUser && targetUser.status === UserStatus.BLOCKED) {
           // If Admin is unblocking, it overrides anything
           if (currentUser.role === UserRole.ADMIN) {
             updatePayload.blockedBy = null;
             updatePayload.blockedReason = 'Unblocked by Admin';
           } else {
             // If Partner is unblocking, check if they were the one who blocked it
             // Actually, the request says Partner should be able to block/unblock their own shops
             // but Admin can override. 
             // If Admin blocked it, maybe Partner shouldn't be able to unblock?
             if (targetUser.blockedBy && targetUser.blockedBy.toString() !== currentUser._id.toString()) {
                const blocker = await this.userModel.findById(targetUser.blockedBy);
                if (blocker && (blocker.role as any) === UserRole.ADMIN && (currentUser.role as any) !== UserRole.ADMIN) {
                  throw new ForbiddenException('This user was blocked by an Admin and cannot be unblocked by a Partner.');
                }
             }
             updatePayload.blockedBy = null;
           }
        }
      }
    }

    // partnerCode cleanup to avoid duplicate key errors on empty strings (sparse index only allows one "")
    if (updatePayload.partnerCode) {
      updatePayload.partnerCode = updatePayload.partnerCode.toString().trim();
      if (updatePayload.partnerCode === '') delete updatePayload.partnerCode;
    } else if (updatePayload.partnerCode === '') {
      delete updatePayload.partnerCode;
    }

    // Clean up other unique fields if they are empty strings
    if (updatePayload.email === '') delete updatePayload.email;
    if (updatePayload.username === '') delete updatePayload.username;

    if (updatePayload.password) {
      updatePayload.password = await bcrypt.hash(updatePayload.password, 10);
    }
    if (updatePayload.productGroup === '') {
      updatePayload.productGroup = null;
    }
    if (updatePayload.referredByPartnerCode === '') {
      updatePayload.referredByPartnerCode = null;
    }

    // Auto-enable map visibility when a shop is certified
    if (updatePayload.isCertified === true) {
      updatePayload.isVisibleOnMap = true;
      
      // Assign certificate number if not already present
      const targetUser = await this.userModel.findById(id);
      if (targetUser && !targetUser.certificateNumber) {
        updatePayload.certificateNumber = await this.getNextCertificateNumber();
      }
    }

    // Explicitly sync isPartnerPaid to its DB name isDistributorPaid to ensure persistence during raw updates
    if (updatePayload.isPartnerPaid !== undefined) {
      updatePayload.isDistributorPaid = updatePayload.isPartnerPaid;
    }

    console.log(`[UsersService] Final Update Payload for ${id}:`, JSON.stringify(updatePayload, null, 2));

    // Capture location related fields to see if geocoding is needed
    const { address, city, country, latitude, longitude } = updatePayload;

    // If address changed and coordinates are NOT manually provided in this update, re-geocode
    if ((address || city || country) && (!latitude && !longitude)) {
      // Get current user data to merge with update for geocoding query
      const currentUser = await this.userModel.findById(id);
      if (currentUser) {
        const qAddress = address || currentUser.address;
        const qCity = city || currentUser.city;
        const qCountry = country || currentUser.country;

        if (qAddress && qCity && qCountry) {
          const coords = await this.fetchCoordinates(qAddress, qCity, qCountry);
          if (coords) {
            updatePayload.latitude = coords.latitude;
            updatePayload.longitude = coords.longitude;
            console.log(`[Geocoding] Updated coordinates for ${currentUser.email}:`, coords);
          }
        }
      }
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .exec();



    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument | null> {
    const user = await this.userModel.findById(id);
    // Role-based deletion blocks removed per user request to allow full management of all accounts
    return this.userModel.findByIdAndDelete(id).exec();
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async getStats() {
    const total = await this.userModel.countDocuments();
    const admin = await this.userModel.countDocuments({ role: UserRole.ADMIN });
    const master_partner = await this.userModel.countDocuments({
      role: UserRole.MASTER_PARTNER,
    });
    const regional_partner = await this.userModel.countDocuments({
      role: UserRole.REGIONAL_PARTNER,
    });
    const partner = await this.userModel.countDocuments({
      role: UserRole.PARTNER,
    });
    const certified_shop = await this.userModel.countDocuments({
      role: UserRole.CERTIFIED_SHOP,
    });

    return {
      total,
      admin,
      master_partner,
      regional_partner,
      partner,
      certified_shop,
    };
  }

  async completeCourse(
    userId: string,
    courseName: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $addToSet: { completedCourses: courseName } },
        { new: true },
      )
      .exec();
  }
  async updateCourseProgress(
    userId: string,
    courseName: string,
    stepId: string,
  ): Promise<UserDocument | null> {
    const update: any = {};
    update[`courseProgress.${courseName}`] = stepId;

    return this.userModel
      .findByIdAndUpdate(userId, { $addToSet: update }, { new: true })
      .exec();
  }

  async updateCertificationVideoUrl(
    userId: string,
    videoUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { certificationVideoUrl: videoUrl },
        { new: true },
      )
      .exec();
  }

  async updateProfileImage(
    userId: string,
    imageUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { profileImage: imageUrl }, { new: true })
      .exec();
  }

  async findReferredShops(partnerCode: string): Promise<{ shops: UserDocument[], partners: any[] }> {
    if (!partnerCode) return { shops: [], partners: [] };

    const query: any = {
      role: UserRole.CERTIFIED_SHOP,
    };

    // If it's NOT the Global Partner, filter by their specific code
    const isGlobal = partnerCode === 'GLOBAL77';

    if (!isGlobal) {
      query.referredByPartnerCode = partnerCode;
    }

    const shops = await this.userModel.find(query).exec();

    // Include partners list if it's the Global Partner
    let partners: any[] = [];
    if (isGlobal) {
      partners = await this.findAllPartners();
    }

<<<<<<< Updated upstream
    return { shops, partners };
=======
    if (viewer.role === UserRole.SUB_PROMOTER) {
      const shops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: partnerCode,
        })
        .exec();
      return { ...empty, shops };
    }

    if (viewer.role === UserRole.REGIONAL_PARTNER) {
      const subPromoters = await this.userModel
        .find({
          role: UserRole.SUB_PROMOTER,
          referredByPartnerCode: partnerCode,
        })
        .exec();
      const subCodes = subPromoters
        .map((u) => u.partnerCode)
        .filter(Boolean) as string[];
      const shopCodes = [partnerCode, ...subCodes];
      const shops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: { $in: shopCodes },
        })
        .exec();
      return { ...empty, shops, subPromoters };
    }

    const collected: UserDocument[] = [];
    const seenIds = new Set<string>();
    await this.collectNetworkDescendants([partnerCode], collected, seenIds);

    if (viewer.role === UserRole.MASTER_PARTNER) {
      const freshViewer = await this.userModel
        .findById(viewer._id)
        .select('operationalRepresentativeCodes partnerCode')
        .lean();
      const operationalCodes = (freshViewer?.operationalRepresentativeCodes || [])
        .map((code) => normalizePartnerCode(code))
        .filter(
          (code) => code && code !== normalizePartnerCode(partnerCode),
        );

      for (const operationalCode of operationalCodes) {
        const linkedRep = await this.findByPartnerCode(operationalCode);
        if (
          linkedRep?.role === UserRole.MASTER_PARTNER &&
          !seenIds.has(linkedRep._id.toString())
        ) {
          seenIds.add(linkedRep._id.toString());
          collected.push(linkedRep);
        }
        await this.collectOperationalSupportScope(
          [operationalCode],
          collected,
          seenIds,
        );
      }
    }

    const distributors = collected.filter((u) => u.role === UserRole.DISTRIBUTOR);
    const representatives = collected.filter(
      (u) => u.role === UserRole.MASTER_PARTNER,
    );
    const promoters = collected.filter((u) => u.role === UserRole.REGIONAL_PARTNER);
    const subPromoters = collected.filter((u) => u.role === UserRole.SUB_PROMOTER);
    const shops = collected.filter((u) => u.role === UserRole.CERTIFIED_SHOP);

    if (viewer.role === UserRole.PARTNER) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors,
        representatives,
        represented: representatives,
        partners: [...distributors, ...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.DISTRIBUTOR) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.MASTER_PARTNER) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    return empty;
>>>>>>> Stashed changes
  }

  async updateShopVisibility(shopId: string, isVisibleOnMap: boolean, partnerCode: string): Promise<UserDocument | null> {
    const query: any = {
      _id: shopId,
      role: UserRole.CERTIFIED_SHOP
    };

<<<<<<< Updated upstream
    if (partnerCode !== 'GLOBAL77') {
      query.referredByPartnerCode = partnerCode;
=======
    const network = await this.findNetworkUsersForViewer(viewer);
    const all = [
      ...network.shops,
      ...network.promoters,
      ...network.subPromoters,
      ...network.representatives,
      ...network.represented,
      ...network.distributors,
    ];
    return all.some((u) => u._id.toString() === targetUserId);
  }

  /**
   * Order/receipt access for certified shops: only the Shop Introduction Representative.
   * Operational parent reps may see the shop in Network Team but not its orders/invoices.
   */
  async canViewerAccessShopOrder(
    viewer: UserDocument,
    shopUserId: string,
  ): Promise<boolean> {
    if (viewer._id.toString() === shopUserId) return true;
    if (isGlobalHubPartnerCode(viewer.partnerCode)) return true;

    const shop = await this.userModel.findById(shopUserId);
    if (!shop || shop.role !== UserRole.CERTIFIED_SHOP) {
      return this.isUserInViewerNetwork(viewer, shopUserId);
    }

    if (viewer.role === UserRole.MASTER_PARTNER && viewer.partnerCode) {
      const introCode = await this.resolveShopIntroductionRepresentativeCode(shop);
      if (!introCode) return false;
      return (
        normalizePartnerCode(introCode) ===
        normalizePartnerCode(viewer.partnerCode)
      );
    }

    const network = await this.findNetworkUsersForViewer(viewer);
    return network.shops.some((s) => s._id.toString() === shopUserId);
  }

  /** @deprecated Use findNetworkUsersForViewer */
  async findReferredShops(partnerCode: string): Promise<{
    shops: UserDocument[];
    partners: any[];
  }> {
    const viewer = await this.findByPartnerCode(partnerCode);
    if (!viewer) return { shops: [], partners: [] };
    const network = await this.findNetworkUsersForViewer(viewer);
    return { shops: network.shops, partners: network.partners };
  }

  async updateShopVisibility(
    memberId: string,
    isVisibleOnMap: boolean,
    viewer: UserDocument,
  ): Promise<UserDocument | null> {
    const member = await this.userModel.findById(memberId);
    if (!member) return null;

    const isSelf = viewer._id.toString() === memberId;
    const isGlobalHubTarget = isGlobalHubPartnerCode(member.partnerCode);

    if (member.role === UserRole.PARTNER && !isGlobalHubTarget) {
      throw new BadRequestException('Hub accounts cannot be shown on the map.');
>>>>>>> Stashed changes
    }

    const shop = await this.userModel.findOne(query);

    if (!shop) return null;

    const updatePayload: any = { isVisibleOnMap };

    // If making visible and coordinates are missing, attempt geocoding
    if (isVisibleOnMap && (!shop.latitude || !shop.longitude)) {
      if (shop.address && shop.city && shop.country) {
        const coords = await this.fetchCoordinates(shop.address, shop.city, shop.country);
        if (coords) {
          updatePayload.latitude = coords.latitude;
          updatePayload.longitude = coords.longitude;
          console.log(`[Geocoding] Success during visibility toggle for shop ${shop.email}:`, coords);
        } else {
          console.warn(`[Geocoding] Failed during visibility toggle for shop ${shop.email}. Shop may not appear on map.`);
        }
      }
    }

    return this.userModel.findByIdAndUpdate(
      shopId,
      updatePayload,
      { new: true },
    ).exec();
  }

  async findAllPartners() {
    this.logger.log('Fetching all partners for list...');
    const partners = await this.userModel.find({
      role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] },
    }).select('firstName lastName partnerCode email status').sort({ firstName: 1 });
    this.logger.log(`Found ${partners.length} partners.`);
    return partners;
  }

<<<<<<< Updated upstream
=======
  async getPartnerContactForShop(user: UserDocument | null | undefined) {
    if (!user?.referredByPartnerCode || user.role !== UserRole.CERTIFIED_SHOP) {
      return null;
    }
    if (isGlobalHubPartnerCode(user.referredByPartnerCode)) {
      return null;
    }
    const partner = await this.findByPartnerCode(user.referredByPartnerCode);
    if (!partner) return null;
    return {
      partnerCode: partner.partnerCode,
      email: partner.email,
      firstName: partner.firstName,
      lastName: partner.lastName,
    };
  }

  async searchRepresentativeForLinking(
    query: string,
    viewer: UserDocument,
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (viewer.role !== UserRole.MASTER_PARTNER || !viewer.partnerCode) {
      throw new ForbiddenException('Only Representatives can search for other Representatives.');
    }

    const normalizedQuery = trimmed.toUpperCase();
    const isEmailQuery = trimmed.includes('@');

    const target = await this.userModel.findOne(
      isEmailQuery
        ? { email: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, role: UserRole.MASTER_PARTNER }
        : { partnerCode: normalizedQuery, role: UserRole.MASTER_PARTNER },
    );

    if (!target) {
      throw new BadRequestException('No active Representative found with that Partner ID or email.');
    }
    if (target._id.toString() === viewer._id.toString()) {
      throw new BadRequestException('You cannot add yourself to your network.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Representative account is blocked.');
    }
    if (target.referredByPartnerCode === viewer.partnerCode) {
      throw new BadRequestException('This Representative is already linked to your network.');
    }
    if (
      normalizePartnerCode(target.referredByPartnerCode) ===
      normalizePartnerCode(viewer.partnerCode)
    ) {
      throw new BadRequestException('This Representative is already linked to your network.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const existingOperational = (viewer.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetCode && existingOperational.includes(targetCode)) {
      throw new BadRequestException(
        'This Representative is already linked for operational support.',
      );
    }

    return {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      partnerCode: target.partnerCode,
      referredByPartnerCode: target.referredByPartnerCode,
      city: target.city,
      country: target.country,
      status: target.status,
    };
  }

  async linkRepresentativeToViewer(query: string, viewer: UserDocument) {
    const targetPreview = await this.searchRepresentativeForLinking(query, viewer);
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Representative not found.');
    }

    const viewerSubtree = await this.findNetworkUsersForViewer(viewer);
    const subtreeIds = new Set(
      [...viewerSubtree.representatives, ...viewerSubtree.promoters, ...viewerSubtree.subPromoters, ...viewerSubtree.shops]
        .map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Representative is already in your network.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const viewerCode = normalizePartnerCode(viewer.partnerCode);
    if (!targetCode || !viewerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    const existingOperational = (viewer.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (existingOperational.includes(targetCode)) {
      throw new BadRequestException('This Representative is already linked for operational support.');
    }

    // Operational soft link only — never re-parent the target Representative.
    await this.userModel.findByIdAndUpdate(viewer._id, {
      $addToSet: { operationalRepresentativeCodes: targetCode },
    });

    if (!target.partnerDevelopmentRepresentativeCode) {
      await this.userModel.findByIdAndUpdate(target._id, {
        partnerDevelopmentRepresentativeCode: viewerCode,
      });
    }

    const refreshedTarget = await this.userModel.findById(target._id);
    if (refreshedTarget) {
      await this.backfillShopEarningAssignmentsForRepresentative(refreshedTarget);
    }

    return {
      message: `${target.firstName} ${target.lastName} linked for operational support. Their Promoters and Shops are now visible in your network. New members under them will appear automatically.`,
      linkType: 'operational',
      representative: {
        _id: target._id,
        firstName: target.firstName,
        lastName: target.lastName,
        email: target.email,
        partnerCode: target.partnerCode,
        referredByPartnerCode: target.referredByPartnerCode,
        city: target.city,
        country: target.country,
        status: target.status,
      },
    };
  }

>>>>>>> Stashed changes
  async assignPartner(shopId: string, partnerCode: string) {
    // 1. Verify Partner exists
    const partner = await this.userModel.findOne({
      partnerCode,
      role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] }
    });
    if (!partner) throw new BadRequestException('Invalid Partner Code');

    // 2. Update Shop with partner's code
    const shop = await this.userModel.findByIdAndUpdate(
      shopId,
      {
        referredByPartnerCode: partnerCode
      },
      { new: true }
    );
    if (!shop) throw new BadRequestException('Shop not found');

    return shop;
  }

<<<<<<< Updated upstream
=======
  private normalizeCustomCommissionRate(
    role: UserRole,
    payload: { customCommissionRate?: number | null },
  ): void {
    if (payload.customCommissionRate === undefined) return;

    if (!isCommissionEligibleRole(role)) {
      payload.customCommissionRate = null;
      return;
    }

    if (payload.customCommissionRate === null) return;

    const rate = Number(payload.customCommissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException(
        'Commission rate must be a number between 0 and 100',
      );
    }
    payload.customCommissionRate = rate;
  }

  /** Walk parent links upward and return true if partnerCode appears in viewer's upline. */
  private async isPartnerCodeInViewerAncestry(
    viewer: UserDocument,
    partnerCode: string,
  ): Promise<boolean> {
    const targetCode = normalizePartnerCode(partnerCode);
    if (!targetCode) return false;

    let current: UserDocument | null = viewer;
    const visited = new Set<string>();

    for (let depth = 0; depth < 25 && current; depth++) {
      const parentCode = current.referredByPartnerCode?.trim();
      if (!parentCode) return false;

      const normalizedParent = normalizePartnerCode(parentCode);
      if (!normalizedParent || visited.has(normalizedParent)) return false;
      visited.add(normalizedParent);

      if (normalizedParent === targetCode) return true;

      const parent = await this.findByPartnerCode(normalizedParent);
      if (!parent) return false;
      if (parent._id.toString() === current._id.toString()) return false;
      current = parent;
    }

    return false;
  }

  private async collectNetworkDescendants(
    rootCodes: string[],
    collected: UserDocument[],
    seenIds: Set<string>,
  ): Promise<void> {
    let frontier = rootCodes
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean);

    for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
      const batch = await this.userModel
        .find({ referredByPartnerCode: { $in: frontier } })
        .exec();

      const nextFrontier: string[] = [];
      for (const user of batch) {
        const id = user._id.toString();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(user);

        if (user.partnerCode && canTraverseNetwork(user.role)) {
          nextFrontier.push(normalizePartnerCode(user.partnerCode));
        }
      }
      frontier = nextFrontier;
    }
  }

  /**
   * Operational support scope: linked rep's direct network only.
   * Does not traverse into child Representatives (e.g. Rep3 under Rep2).
   */
  private async collectOperationalSupportScope(
    rootCodes: string[],
    collected: UserDocument[],
    seenIds: Set<string>,
  ): Promise<void> {
    let frontier = rootCodes
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean);

    for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
      const batch = await this.userModel
        .find({ referredByPartnerCode: { $in: frontier } })
        .exec();

      const nextFrontier: string[] = [];
      for (const user of batch) {
        const id = user._id.toString();
        if (seenIds.has(id)) continue;

        // Child Representatives (and their downstream) are NOT part of the
        // operational support scope — only the linked rep's own promoters,
        // sub-promoters and shops are visible for support.
        if (user.role === UserRole.MASTER_PARTNER) {
          seenIds.add(id);
          continue;
        }

        seenIds.add(id);
        collected.push(user);

        if (user.partnerCode && canTraverseNetwork(user.role)) {
          nextFrontier.push(normalizePartnerCode(user.partnerCode));
        }
      }
      frontier = nextFrontier;
    }
  }

  private async validateHierarchyLink(
    role: UserRole,
    referredByPartnerCode?: string | null,
    excludeUserId?: string,
  ): Promise<void> {
    if (!requiresParentLink(role)) {
      return;
    }

    const code = referredByPartnerCode?.trim();
    if (!code) {
      throw new BadRequestException(`${getParentLinkLabel(role)} is required`);
    }

    const parent = await this.findByPartnerCode(code);
    if (!parent) {
      throw new BadRequestException(
        `${getParentLinkLabel(role)} is invalid: partner code not found`,
      );
    }

    const roleError = validateParentRole(role, parent.role);
    if (roleError) {
      throw new BadRequestException(roleError);
    }

    if (role === UserRole.SUB_PROMOTER) {
      await this.assertMainPromoterCanAcceptSub(code, excludeUserId);
    }
  }

  private async assertMainPromoterCanAcceptSub(
    mainPartnerCode: string,
    excludeUserId?: string,
  ): Promise<void> {
    const main = await this.findByPartnerCode(mainPartnerCode);
    if (!main || main.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException(
        'Sub-Promoter must be linked to a Main Promoter (Promoter role)',
      );
    }

    const existingSub = await this.userModel.findOne({
      role: UserRole.SUB_PROMOTER,
      referredByPartnerCode: mainPartnerCode,
      ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
    });

    if (existingSub) {
      throw new BadRequestException(
        'This Main Promoter already has a Sub-Promoter assigned',
      );
    }
  }

>>>>>>> Stashed changes
  private async getNextCertificateNumber(): Promise<number> {
    const lastUser = await this.userModel
      .findOne({ certificateNumber: { $exists: true } })
      .sort({ certificateNumber: -1 })
      .exec();
    
    if (lastUser && lastUser.certificateNumber) {
      return lastUser.certificateNumber + 1;
    }
    return 14943212; // Starting number
  }
}

