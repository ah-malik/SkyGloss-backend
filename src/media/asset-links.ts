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
  // SkyGloss presentation for shop owners -> "For presenting"
  'owner-pres': {
    0: 'Copy of Get SkyGloss Certified.pdf',
  },
  // Paint Health Check form -> "Print or fill in on screen"
  'phc-form': {
    0: 'SkyGloss Paint Health Check Form.pdf',
  },
  // FUSION service booklet -> "For sharing", "For printing" (one PDF for both)
  'bk-fusion': {
    0: 'FUSION BOOKLET.pdf',
    1: 'FUSION BOOKLET.pdf',
  },
  // RESIN FILM service booklet -> "For sharing", "For printing"
  'bk-resin': {
    0: 'RESIN BOOKLET.pdf',
    1: 'RESIN BOOKLET.pdf',
  },
  // SHIELD service booklet -> "For sharing", "For printing"
  'bk-shield': {
    0: 'SHIELD Booklet.pdf',
    1: 'SHIELD Booklet.pdf',
  },
  // Care sheet for car owners -> "For printing", "For sharing"
  care: {
    0: 'SkyGloss Care Instructions.pdf',
    1: 'SkyGloss Care Instructions.pdf',
  },
  // Product catalogue 2026 -> "For sharing"
  catalogue: {
    0: '2026 SkyGloss Catalog_Presentation.pdf',
  },
  // Sales philosophy cheat sheet -> "For reading"
  'sales-cheat': {
    0: 'SkyGloss Sales Philosophy Cheat Sheet.pdf',
  },
};
