/**
 * Training completion helpers.
 *
 * Marketing courses were added as required on 2026-10-09. Existing users who
 * already finished the prior curriculum must keep a valid completion status
 * without being forced to re-complete or redo newly added courses.
 */

import {
  COURSE_STEPS,
  getRequiredCourseKeysForRole,
  POST_CUTOVER_REQUIRED_COURSE_KEYS,
  userCreatedBeforeMarketingCutover,
} from './course-catalog';

const WELCOME_SECTION_STEP_IDS = [
  'intro_foundation',
  'data_fusion',
  'data_core',
  'intro_replacement',
  'learning_curve',
  'intro_reality',
  'data_real_world',
  'intro_opportunity',
  'data_access',
  'intro_engine',
  'data_bigger_picture',
  'proper_perspective',
  'new_craft',
  'professional_mindset',
  'payoff',
  'intro_final',
];

/** Pre-1 Oct 2026 step floors — keep old runs valid after content expansion. */
const LEGACY_STEP_FLOORS: Record<string, number> = {
  UNDERSTANDING_SKYGLOSS: 9,
  RESIN_FILM: 7,
};

export type CourseProgressUser = {
  role?: string | null;
  createdAt?: Date | string | null;
  isTrainingComplete?: boolean | null;
  isCertified?: boolean | null;
  isAccountActivated?: boolean | null;
  completedCourses?: string[] | null;
  courseProgress?: Record<string, string[]> | Map<string, string[]> | null;
};

function progressMapOf(
  courseProgress?: CourseProgressUser['courseProgress'],
): Record<string, string[]> {
  if (!courseProgress) return {};
  return JSON.parse(JSON.stringify(courseProgress || {}));
}

export function courseProgressIsComplete(
  courseKey: string,
  progress: unknown,
  totalSteps: number,
) {
  const list = Array.isArray(progress) ? progress.map(String) : [];
  if (courseKey !== 'WELCOME_TO_SKYGLOSS') {
    return list.length >= totalSteps;
  }

  const questionHits = list.filter((id) => id.startsWith('q:')).length;
  const nonQuestion = list.length - questionHits;
  if (questionHits === 0 && nonQuestion >= WELCOME_SECTION_STEP_IDS.length) {
    return true;
  }

  const sectionHits = WELCOME_SECTION_STEP_IDS.filter((id) =>
    list.includes(id),
  ).length;
  // Catalog total (24) or all sections + at least 4 quiz answers (current player).
  return (
    list.length >= totalSteps ||
    sectionHits + questionHits >= WELCOME_SECTION_STEP_IDS.length + 4
  );
}

function mayUseLegacyStepFloor(user: CourseProgressUser) {
  return (
    !!user.isTrainingComplete ||
    !!user.isCertified ||
    !!user.isAccountActivated ||
    userCreatedBeforeMarketingCutover(user)
  );
}

/** True when this course is marked complete via progress steps or completedCourses. */
export function isCourseCompleteForUser(
  user: CourseProgressUser,
  courseKey: string,
): boolean {
  if (
    Array.isArray(user.completedCourses) &&
    user.completedCourses.includes(courseKey)
  ) {
    return true;
  }

  const progressMap = progressMapOf(user.courseProgress);
  const progress =
    progressMap[courseKey] ||
    progressMap[courseKey.replace(/_/g, ' ')] ||
    [];
  const totalSteps = COURSE_STEPS[courseKey] || 1;
  if (courseProgressIsComplete(courseKey, progress, totalSteps)) {
    return true;
  }

  const legacyFloor = LEGACY_STEP_FLOORS[courseKey];
  if (
    legacyFloor &&
    mayUseLegacyStepFloor(user) &&
    Array.isArray(progress) &&
    progress.length >= legacyFloor
  ) {
    return true;
  }

  return false;
}

/**
 * Required keys for gating / progress UI.
 * Preserves prior completions when marketing courses were added later.
 */
export function getEffectiveRequiredCourseKeys(
  user: CourseProgressUser,
): string[] {
  const allKeys = getRequiredCourseKeysForRole(user.role);
  const baseline = allKeys.filter(
    (k) =>
      !(POST_CUTOVER_REQUIRED_COURSE_KEYS as readonly string[]).includes(k),
  );

  if (user.isTrainingComplete || user.isCertified || user.isAccountActivated) {
    return baseline;
  }

  // Pre-cutover accounts that already finished the old curriculum stay complete
  // without being forced through newly added marketing courses.
  if (
    userCreatedBeforeMarketingCutover(user) &&
    baseline.length > 0 &&
    baseline.every((key) => isCourseCompleteForUser(user, key))
  ) {
    return baseline;
  }

  return allKeys;
}

export function countCompletedRequiredCourses(user: CourseProgressUser) {
  const requiredKeys = getEffectiveRequiredCourseKeys(user);
  let completedCount = 0;
  for (const courseKey of requiredKeys) {
    if (isCourseCompleteForUser(user, courseKey)) {
      completedCount += 1;
    }
  }
  return {
    completedCount,
    totalRequired: requiredKeys.length,
    allComplete:
      requiredKeys.length > 0 && completedCount >= requiredKeys.length,
  };
}

export function isTrainingRequirementSatisfied(
  user: CourseProgressUser,
): boolean {
  if (user.isTrainingComplete || user.isCertified || user.isAccountActivated) {
    return true;
  }
  return countCompletedRequiredCourses(user).allComplete;
}
