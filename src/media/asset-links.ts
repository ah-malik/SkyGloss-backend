/**
 * Links items in the portal Assets library (/assets2) to files in the admin
 * Media Library, by the file name they were uploaded with.
 *
 * Key: asset id from public/assets2.html (e.g. "tesla-ff").
 * Value: index of the item's download row -> uploaded file name.
 *
 * If several uploads share a name, the newest one is used, so uploading a file
 * with the same name again replaces what partners download.
 * Only files listed here are exposed to portal users.
 */
export const ASSET_FILE_LINKS: Record<string, Record<number, string>> = {
  // Factory Forever: Tesla appearance maintenance program -> "For presenting"
  'tesla-ff': {
    0: 'Copy of FACTORY FOREVER - Tesla Appearance Maintenance Program.pdf',
  },
  // Get SkyGloss Certified booklet -> "For printing"
  'getcert-book': {
    1: 'Copy of Get SkyGloss Certified.pdf',
  },
};
