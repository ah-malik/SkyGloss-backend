import {
  countCompletedRequiredCourses,
  getEffectiveRequiredCourseKeys,
  isCourseCompleteForUser,
  isTrainingRequirementSatisfied,
} from './course-completion';

/** Production shape for elmer@riotgarage.shop (queried 2026-10-19). */
const ELMER_USER = {
  role: 'certified_shop',
  createdAt: '2026-08-20T19:12:22.805Z',
  isTrainingComplete: true,
  isCertified: false,
  completedCourses: [
    'WELCOME_TO_SKYGLOSS',
    'SKYGLOSS_SHOP_SETUP',
    'UNDERSTANDING_SKYGLOSS',
    'SOCIAL_MEDIA_COMMUNICATION',
    'FUSION',
    'RESIN_FILM',
    'MATTE',
    'SHINE',
    'SEAL',
  ],
  courseProgress: {
    WELCOME_TO_SKYGLOSS: Array.from({ length: 17 }, (_, i) => `w${i}`),
    SKYGLOSS_SHOP_SETUP: ['a', 'b', 'c', 'd'],
    SOCIAL_MEDIA_COMMUNICATION: Array.from({ length: 11 }, (_, i) => `sm${i}`),
    UNDERSTANDING_SKYGLOSS: Array.from({ length: 9 }, (_, i) => `u${i}`),
    FUSION: Array.from({ length: 20 }, (_, i) => `f${i}`),
    RESIN_FILM: Array.from({ length: 7 }, (_, i) => `r${i}`),
    MATTE: Array.from({ length: 6 }, (_, i) => `m${i}`),
    SHINE: Array.from({ length: 6 }, (_, i) => `h${i}`),
    SEAL: Array.from({ length: 5 }, (_, i) => `e${i}`),
  },
};

const legacyShopProgress = {
  WELCOME_TO_SKYGLOSS: Array.from({ length: 24 }, (_, i) => `w${i}`),
  SHOP_SALES: Array.from({ length: 26 }, (_, i) => `s${i}`),
  SKYGLOSS_SHOP_SETUP: ['a', 'b', 'c', 'd'],
  FUSION: Array.from({ length: 20 }, (_, i) => `f${i}`),
  RESIN_FILM: Array.from({ length: 8 }, (_, i) => `r${i}`),
  SHINE: Array.from({ length: 6 }, (_, i) => `h${i}`),
  MATTE: Array.from({ length: 6 }, (_, i) => `m${i}`),
  SEAL: Array.from({ length: 5 }, (_, i) => `e${i}`),
};

describe('course-completion grandfathering', () => {
  it('honors completedCourses even when step totals later increase', () => {
    const user = {
      role: 'certified_shop',
      completedCourses: ['FUSION'],
      courseProgress: { FUSION: ['only_one_old_step'] },
    };
    expect(isCourseCompleteForUser(user, 'FUSION')).toBe(true);
  });

  it('does not force marketing courses on pre-cutover shops that finished the old curriculum', () => {
    const user = {
      role: 'certified_shop',
      createdAt: '2026-09-01T00:00:00.000Z',
      courseProgress: legacyShopProgress,
    };
    const required = getEffectiveRequiredCourseKeys(user);
    expect(required).not.toContain('MARKETING_MASTERCLASS');
    expect(countCompletedRequiredCourses(user).allComplete).toBe(true);
    expect(isTrainingRequirementSatisfied(user)).toBe(true);
  });

  it('still requires marketing courses for post-cutover shops', () => {
    const user = {
      role: 'certified_shop',
      createdAt: '2026-10-10T00:00:00.000Z',
      courseProgress: legacyShopProgress,
    };
    const required = getEffectiveRequiredCourseKeys(user);
    expect(required).toContain('MARKETING_MASTERCLASS');
    expect(countCompletedRequiredCourses(user).allComplete).toBe(false);
    expect(isTrainingRequirementSatisfied(user)).toBe(false);
  });

  it('keeps finalized training complete even if marketing courses are missing', () => {
    const user = {
      role: 'certified_shop',
      createdAt: '2026-10-10T00:00:00.000Z',
      isTrainingComplete: true,
      courseProgress: legacyShopProgress,
    };
    expect(isTrainingRequirementSatisfied(user)).toBe(true);
    expect(getEffectiveRequiredCourseKeys(user)).not.toContain(
      'MARKETING_MASTERCLASS',
    );
  });

  it('requires marketing for pre-cutover shops that never finished the old curriculum', () => {
    const user = {
      role: 'certified_shop',
      createdAt: '2026-09-01T00:00:00.000Z',
      courseProgress: {
        WELCOME_TO_SKYGLOSS: Array.from({ length: 24 }, (_, i) => `w${i}`),
      },
    };
    const required = getEffectiveRequiredCourseKeys(user);
    expect(required).toContain('MARKETING_MASTERCLASS');
    expect(isTrainingRequirementSatisfied(user)).toBe(false);
  });

  it('grandfathers field partners who finished baseline courses before marketing cutover', () => {
    const user = {
      role: 'master_partner',
      createdAt: '2026-08-01T00:00:00.000Z',
      completedCourses: [
        'WELCOME_TO_SKYGLOSS',
        'SHOP_SALES',
        'SKYGLOSS_SHOP_SETUP',
        'FUSION',
        'UNDERSTANDING_SKYGLOSS',
        'PARTNER_SALES_MANUAL',
        'YOUR_ROLE_REPRESENTATIVE',
        'RESIN_FILM',
        'SHINE',
        'MATTE',
        'SEAL',
      ],
    };
    expect(getEffectiveRequiredCourseKeys(user)).not.toContain(
      'PARTNER_MARKETING_MANUAL',
    );
    expect(getEffectiveRequiredCourseKeys(user)).not.toContain(
      'MARKETING_MASTERCLASS',
    );
    expect(isTrainingRequirementSatisfied(user)).toBe(true);
  });

  it('accepts legacy Understanding (9 steps) for pre-cutover partners', () => {
    const user = {
      role: 'master_partner',
      createdAt: '2026-08-01T00:00:00.000Z',
      courseProgress: {
        UNDERSTANDING_SKYGLOSS: Array.from({ length: 9 }, (_, i) => `u${i}`),
      },
    };
    expect(isCourseCompleteForUser(user, 'UNDERSTANDING_SKYGLOSS')).toBe(true);
  });

  it('does not accept legacy Understanding floor for brand-new partners', () => {
    const user = {
      role: 'master_partner',
      createdAt: '2026-10-15T00:00:00.000Z',
      courseProgress: {
        UNDERSTANDING_SKYGLOSS: Array.from({ length: 9 }, (_, i) => `u${i}`),
      },
    };
    expect(isCourseCompleteForUser(user, 'UNDERSTANDING_SKYGLOSS')).toBe(false);
  });
});

describe('Elmer / Riot Garage production fixture', () => {
  it('treats Elmer training requirement as satisfied', () => {
    expect(isTrainingRequirementSatisfied(ELMER_USER)).toBe(true);
  });

  it('does not require Marketing Masterclass for Elmer', () => {
    expect(getEffectiveRequiredCourseKeys(ELMER_USER)).not.toContain(
      'MARKETING_MASTERCLASS',
    );
  });

  it('marks Elmer completedCourses as complete despite partial step counts', () => {
    expect(isCourseCompleteForUser(ELMER_USER, 'WELCOME_TO_SKYGLOSS')).toBe(
      true,
    );
    expect(isCourseCompleteForUser(ELMER_USER, 'RESIN_FILM')).toBe(true);
    expect(isCourseCompleteForUser(ELMER_USER, 'FUSION')).toBe(true);
    expect(isCourseCompleteForUser(ELMER_USER, 'UNDERSTANDING_SKYGLOSS')).toBe(
      true,
    );
  });

  it('does not mark Shop Sales complete for Elmer (never taken)', () => {
    expect(isCourseCompleteForUser(ELMER_USER, 'SHOP_SALES')).toBe(false);
  });

  it('still satisfies training when only the sticky flag is set', () => {
    expect(
      isTrainingRequirementSatisfied({
        role: 'certified_shop',
        isTrainingComplete: true,
        courseProgress: {},
        completedCourses: [],
      }),
    ).toBe(true);
  });

  it('does not satisfy training for empty new shop', () => {
    expect(
      isTrainingRequirementSatisfied({
        role: 'certified_shop',
        createdAt: '2026-10-15T00:00:00.000Z',
        isTrainingComplete: false,
        courseProgress: {},
        completedCourses: [],
      }),
    ).toBe(false);
  });
});

describe('safety: incomplete users stay blocked', () => {
  it('blocks post-cutover shop missing only marketing', () => {
    const user = {
      role: 'certified_shop',
      createdAt: '2026-10-12T00:00:00.000Z',
      isTrainingComplete: false,
      courseProgress: legacyShopProgress,
    };
    expect(isTrainingRequirementSatisfied(user)).toBe(false);
    expect(getEffectiveRequiredCourseKeys(user)).toContain(
      'MARKETING_MASTERCLASS',
    );
  });

  it('blocks pre-cutover shop with almost all courses but missing Fusion', () => {
    const { FUSION: _omit, ...rest } = legacyShopProgress;
    const user = {
      role: 'certified_shop',
      createdAt: '2026-09-01T00:00:00.000Z',
      isTrainingComplete: false,
      courseProgress: rest,
    };
    expect(isTrainingRequirementSatisfied(user)).toBe(false);
  });

  it('allows certified shops regardless of course progress', () => {
    expect(
      isTrainingRequirementSatisfied({
        role: 'certified_shop',
        isCertified: true,
        courseProgress: {},
      }),
    ).toBe(true);
  });
});
